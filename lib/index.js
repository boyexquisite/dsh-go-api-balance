// 插件注册与点按处理：面板 balance、数据缓存与动作。
import {
  RESULTS_VERSION,
  configPath,
  resultsPath,
  loadConfig,
  saveConfig,
  loadResults,
  saveResults,
  validateProvider,
} from './config.js'
import { PRESET_IDS } from './constants.js'
import { newapiSubscriptionFields, presetDraft } from './presets.js'
import { createRunner } from './query.js'
import {
  createState,
  draftForm,
  normalizeSiteBase,
  emptyForm,
  isEditableCaps,
  panelData,
  panelView,
  parseDetailText,
  providerForm,
  words,
} from './view.js'

const PANEL_ID = 'balance'

const STALE_MS = 60000
// 前台刷新要赶在宿主的 30s pending 之前收尾；后台刷新给更宽的总预算。
const MANUAL_TOTAL_TIMEOUT_MS = 28000
const BACKGROUND_TOTAL_TIMEOUT_MS = 120000
const CACHE_LIMIT = 24
const PENDING_TIMEOUT_MS = 30000
const TOAST_MAX_CHARS = 40

function nowOf (options) {
  return typeof options.now === 'function' ? options.now : Date.now
}

function clipToast (value) {
  const text = typeof value === 'string' ? value : String(value === undefined || value === null ? '' : value)
  return [...text].slice(0, TOAST_MAX_CHARS).join('')
}

function timeoutOf (settings) {
  const value = Number(settings && settings.timeoutMs)
  if (!Number.isFinite(value)) return 12000
  return Math.min(30000, Math.max(4000, Math.round(value)))
}

function stringValue (value) {
  return typeof value === 'string' ? value : ''
}

function enabledProviders (state) {
  const providers = state && state.config && Array.isArray(state.config.providers) ? state.config.providers : []
  return providers.filter((provider) => provider && provider.enabled !== false)
}

function findProvider (state, id) {
  const providers = state && state.config && Array.isArray(state.config.providers) ? state.config.providers : []
  return providers.find((provider) => provider && provider.id === id) || null
}

// v2.0 迁移：老版 new-api 配置里的「订阅额度」字段是错的（/api/user/self 不返回），
// 改成正确的 /api/subscription/self 附加请求。只在缺额外信息时补，不改用户其它设置。
// v0.6.0 迁移：按模板补新加的卡片明细/附加字段（只补缺，不覆盖用户已有项）。
// v0.7.2：迁移只做一次（provider.enriched 落盘），之后用户删掉的默认项不会被重新加回来。
const MAX_DETAILS = 6
const MAX_EXTRA_FIELDS = 4
const ENRICH_DETAIL_PRESETS = ['newapi', 'oneapi', 'openrouter', 'aihubmix', 'commandcode']
const SUBSCRIPTION_ORDER = ['订阅剩余', '订阅到期', '订阅总量', '订阅已用']

function sameOriginOf (left, right) {
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return false
  }
}

function mergeRows (current, defaults, max) {
  const rows = Array.isArray(current) ? current.slice(0, max) : []
  const seen = new Set(rows.map((row) => (row && typeof row.label === 'string' ? row.label : '')))
  for (const row of defaults) {
    if (rows.length >= max) break
    if (!row || typeof row.label !== 'string' || seen.has(row.label)) continue
    rows.push({ ...row })
    seen.add(row.label)
  }
  return rows
}

// 已发布配置里写死的字段修正（与 enriched 无关，迁移过也要修）。
// - Claude 用量报告的输入 token 字段是 uncached_input_tokens，不是 input_tokens；
// - Claude 缓存写要把 5 分钟和 1 小时两个缓存档都算上；
// - OpenRouter 的 limit_reset 是 daily/weekly/monthly 周期枚举，不是日期。
function migratePresetRows (provider) {
  let next = provider
  if (next.preset === 'anthropic-cost' && Array.isArray(next.extraFields)) {
    const extraFields = next.extraFields.map((row) => {
      if (!row || typeof row !== 'object') return row
      if (row.path === 'data[].results[].input_tokens') {
        return { ...row, path: 'data[].results[].uncached_input_tokens' }
      }
      if (row.path === 'data[].results[].cache_creation.ephemeral_5m_input_tokens') {
        return {
          ...row,
          path: 'data[].results[].cache_creation.ephemeral_5m_input_tokens + data[].results[].cache_creation.ephemeral_1h_input_tokens',
        }
      }
      return row
    })
    if (extraFields.some((row, index) => row !== next.extraFields[index])) {
      next = { ...next, extraFields }
    }
  }
  if (next.preset === 'openrouter' && Array.isArray(next.detailPaths)) {
    const detailPaths = next.detailPaths.map((row) => {
      if (!row || typeof row !== 'object' || row.path !== 'data.limit_reset') return row
      return { ...row, label: row.label === '限额重置' ? '限额重置周期' : row.label, kind: 'text' }
    })
    if (detailPaths.some((row, index) => row !== next.detailPaths[index])) {
      next = { ...next, detailPaths }
    }
  }
  return next
}

async function upgradeProvider (provider, configFile) {
  if (!provider || typeof provider !== 'object') return provider
  provider = migratePresetRows(provider)

  // One-time migration for the exact AIHubMix Manage-Key configuration created
  // before a dedicated endpoint existed. Never carry the old gateway header
  // into plugin config or the App form: only the account Manage Key remains.
  if (provider.preset === 'custom' &&
      provider.url === 'https://miao233.top/aihubmix/api/user/self' &&
      typeof provider.secret === 'string' && provider.secret !== '') {
    const oldHeaders = (() => {
      try { return JSON.parse(provider.headersText || '{}') } catch { return {} }
    })()
    if (oldHeaders && typeof oldHeaders === 'object' && !Array.isArray(oldHeaders) &&
        Object.keys(oldHeaders).some((name) => name.toLowerCase() === 'x-miao-gw')) {
      const seed = presetDraft('aihubmix')
      const headers = Object.fromEntries(Object.entries(oldHeaders)
        .filter(([name]) => name.toLowerCase() !== 'x-miao-gw'))
      provider = {
        ...provider,
        ...seed,
        id: provider.id,
        name: provider.name || seed.name,
        secret: provider.secret,
        enabled: provider.enabled !== false,
        headersText: Object.keys(headers).length ? JSON.stringify(headers) : '',
        enriched: false,
      }
      // Persist the migration immediately so old gateway credentials are removed
      // from config.json as well as from the live panel state.
      try {
        const current = await loadConfig(configFile)
        const providers = current.providers.map((item) => item.id === provider.id ? provider : item)
        await saveConfig({ ...current, providers }, configFile)
      } catch {
        // Continue with the in-memory safe configuration; the next user save persists it.
      }
    }
  }

  if (provider.enriched === true) return provider
  let next = provider
  if (next.preset === 'newapi') {
    const hasExtra = typeof next.extraUrl === 'string' && next.extraUrl.trim() !== ''
    const url = typeof next.url === 'string' ? next.url.trim() : ''
    if (!hasExtra && /\/api\/user\/self\/?$/.test(url)) {
      const base = normalizeSiteBase(url.replace(/\/api\/user\/self\/?$/, ''))
      const seed = newapiSubscriptionFields(base)
      next = {
        ...next,
        extraUrl: seed.extraUrl,
        // 保留用户自定义的附加字段，只补缺的订阅项。
        extraFields: mergeRows(next.extraFields, seed.extraFields, MAX_EXTRA_FIELDS),
      }
    }
  }
  if (ENRICH_DETAIL_PRESETS.includes(next.preset)) {
    const seed = presetDraft(next.preset)
    next = { ...next, detailPaths: mergeRows(next.detailPaths, seed.detailPaths, MAX_DETAILS) }
  }
  if (next.preset === 'aihubmix') {
    const seed = presetDraft('aihubmix')
    next = {
      ...next,
      detailPaths: mergeRows(next.detailPaths, seed.detailPaths, MAX_DETAILS),
      usageFields: mergeRows(next.usageFields, seed.usageFields, 4),
    }
  }
  // 订阅四项按「剩余、到期、总量、已用」排序，卡片的 2 条附加信息才会显示到期时间。
  if (Array.isArray(next.extraFields) && next.extraFields.length > 0 &&
      next.extraFields.every((row) => row && typeof row.label === 'string' && SUBSCRIPTION_ORDER.includes(row.label))) {
    next = {
      ...next,
      extraFields: SUBSCRIPTION_ORDER
        .map((label) => next.extraFields.find((row) => row.label === label))
        .filter(Boolean),
    }
  }
  if ((next.preset === 'openai-cost' || next.preset === 'anthropic-cost')) {
    const hasExtra = typeof next.extraUrl === 'string' && next.extraUrl.trim() !== ''
    const hasExtraFields = Array.isArray(next.extraFields) && next.extraFields.length > 0
    if (!hasExtra && !hasExtraFields) {
      const seed = presetDraft(next.preset)
      // 只给“当前余额地址就是该厂商”的 provider 补硬编码的用量地址，
      // 防止 preset 与 url 不一致（手工/旧配置）时把中转站密钥发给 OpenAI/Anthropic。
      if (sameOriginOf(next.url, seed.extraUrl)) {
        next = { ...next, extraUrl: seed.extraUrl, extraFields: seed.extraFields }
      }
    }
  }
  return { ...next, enriched: true }
}

/**
 * 建立插件状态与注册逻辑。apply() 用它把两侧接起来；单测也可以直接用它。
 * options: { home, fetchImpl, now } 透传（测试用）。
 */
export function createStore (options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const clock = nowOf(opts)
  const home = typeof opts.home === 'string' && opts.home !== '' ? opts.home : undefined
  const configFile = home === undefined ? configPath() : configPath(home)
  const resultsFile = home === undefined ? resultsPath() : resultsPath(home)
  const runner = createRunner({ fetchImpl: opts.fetchImpl, now: clock })
  const state = createState({ now: () => clock() })
  const panelFeeds = new Set()
  let dshGo = null
  let ready = null
  let refreshInFlight = null
  let refreshAgain = false
  let configRevision = 0
  let backgroundController = null
  // 手动刷新在途的控制器：保存/删除配置时要立刻中止，别再用旧密钥请求旧服务。
  const manualControllers = new Set()
  // 后台/手动刷新都从同一个序号取号；只有“开始得更晚”的刷新结果允许落库，
  // 防止先发起的慢刷新晚到后覆盖后发起的新结果。
  let refreshSeq = 0
  let appliedSeq = 0
  const shutdownController = new AbortController()
  let disposed = false

  function currentLocale (event) {
    if (event && typeof event.locale === 'string' && event.locale !== '') return event.locale
    return state.locale || 'zh-CN'
  }

  function localeWords (event) {
    return words(currentLocale(event))
  }

  // 手动请求的 signal 与插件销毁联动：dispose 时也中止仍在跑的请求。
  function withShutdownSignal (signal) {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    shutdownController.signal.addEventListener('abort', onAbort, { once: true })
    if (signal && signal.aborted) controller.abort()
    if (shutdownController.signal.aborted) controller.abort()
    return {
      signal: controller.signal,
      controller,
      cleanup () {
        if (signal) signal.removeEventListener('abort', onAbort)
        shutdownController.signal.removeEventListener('abort', onAbort)
      },
    }
  }

  // 配置变了：中止所有用旧配置发起的刷新；结果本来就会被 revision 丢弃，这里只是尽快收口。
  // 返回是否真的中止了请求（删除服务时据此决定要不要给剩余服务补一轮）。
  function abortInflightRefreshes () {
    let aborted = false
    if (backgroundController) {
      backgroundController.abort()
      aborted = true
    }
    for (const controller of manualControllers) {
      controller.abort()
      aborted = true
    }
    return aborted
  }

  function updateView () {
    if (disposed) return
    if (dshGo && typeof dshGo.refresh === 'function') {
      try {
        dshGo.refresh(PANEL_ID)
      } catch {
        // 视图刷新失败不影响数据
      }
    }
    // 多面板（不同 scope）共用一份 state：刷新视图后也把数据推给所有订阅者，
    // 否则另一个面板会拿到新视图配旧数据。
    broadcastPanels()
  }

  function broadcastPanels () {
    if (disposed) return
    for (const feed of [...panelFeeds]) {
      try {
        feed.emit(panelData(state, feed.caps))
      } catch {
        // 单个订阅者出错不打断别人
      }
    }
  }

  function ensureReady () {
    if (ready !== null) return ready
    ready = (async () => {
      try {
        const [config, results] = await Promise.all([loadConfig(configFile), loadResults(resultsFile)])
        if (disposed) return
        state.config = { ...config, providers: await Promise.all(config.providers.map((item) => upgradeProvider(item, configFile))) }
        state.results = results && results.results && typeof results.results === 'object'
          ? { ...results.results }
          : {}
      } catch {
        // 读失败就用默认值，不打扰 UI
      }
      if (disposed) return
      if (state.viewServed === true) {
        updateView()
        broadcastPanels()
      }
    })()
    return ready
  }

  function shouldAutoRefresh () {
    const settings = state.config.settings && typeof state.config.settings === 'object' ? state.config.settings : {}
    if (settings.refreshOnOpen === false) return false
    const providers = enabledProviders(state)
    if (providers.length === 0) return false
    const at = clock()
    for (const provider of providers) {
      const result = state.results[provider.id]
      if (!result || typeof result.fetchedAt !== 'number' || !Number.isFinite(result.fetchedAt)) return true
      if (at - result.fetchedAt > STALE_MS) return true
    }
    return false
  }

  function applyResults (results) {
    for (const result of Array.isArray(results) ? results : []) {
      if (!result || typeof result !== 'object' || typeof result.id !== 'string' || result.id === '') continue
      state.results[result.id] = { ...result }
    }
  }

  // force 只给保存/删除用：即使插件恰好在这时被销毁，也要把「旧结果已失效」写盘，
  // 否则重启后刷新失败时卡片会复活旧站余额（后台刷新仍遵守 dispose 后不写）。
  async function persistResults ({ force = false } = {}) {
    if (disposed && force !== true) return
    try {
      await saveResults({ v: RESULTS_VERSION, results: state.results }, resultsFile)
    } catch {
      // 缓存只是加速，写失败不打扰 UI
    }
  }

  // 后台刷新：同一时间只跑一轮；配置在途中变了（保存/删除）就丢弃旧结果，收尾后再补一轮。
  function startBackgroundRefresh () {
    if (disposed) return null
    if (refreshInFlight !== null) {
      refreshAgain = true
      return refreshInFlight
    }
    const providers = enabledProviders(state)
    if (providers.length === 0) return null
    refreshInFlight = (async () => {
      const revision = configRevision
      const seq = ++refreshSeq
      const controller = new AbortController()
      backgroundController = controller
      broadcastPanels()
      try {
        const timeoutMs = timeoutOf(state.config.settings)
        const results = await runner.queryAll(providers, {
          signal: controller.signal,
          timeoutMs,
          totalTimeoutMs: BACKGROUND_TOTAL_TIMEOUT_MS,
        })
        if (!disposed && !controller.signal.aborted && revision === configRevision && seq > appliedSeq) {
          appliedSeq = seq
          applyResults(results)
          await persistResults()
          // 卡片上的订阅行等是视图静态内容，结果回来后要重建一次视图。
          updateView()
        }
      } catch {
        // 后台刷新失败保持旧缓存
      } finally {
        if (backgroundController === controller) backgroundController = null
        broadcastPanels()
        refreshInFlight = null
        if (refreshAgain || revision !== configRevision) {
          refreshAgain = false
          startBackgroundRefresh()
        }
      }
    })()
    return refreshInFlight
  }

  function providerFromEvent (event) {
    const value = event && event.value && typeof event.value === 'object' ? event.value : {}
    const id = stringValue(value.id)
    return id === '' ? null : findProvider(state, id)
  }

  function openEditForm (provider, event) {
    state.pickTemplate = false
    state.formOpen = true
    state.editingId = provider.id
    state.presetOrigin = typeof provider.preset === 'string' ? provider.preset : 'custom'
    state.form = providerForm(provider)
    state.editClipped = state.form.clippedOriginals || {}
    clearTransient()
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  function clearTransient () {
    state.menuId = ''
    state.confirmDelete = null
  }

  function truthy (value) {
    return value === true || value === 1 || value === 'true' || value === '1' || value === 'on'
  }

  // 把 App 提交的 data.form.* 值合并进表单快照；onSave / onChange 共用。
  function mergeFormValues (base, values, { includeSecret = false } = {}) {
    for (const [key, value] of Object.entries(values && typeof values === 'object' ? values : {})) {
      if (!key.startsWith('data.form.')) continue
      const field = key.slice('data.form.'.length)
      // onChange 的未提交值只用于保持界面草稿，不能把明文密钥写进共享 state.form。
      if (field === 'secret' && includeSecret !== true) continue
      if (field === 'detailText') {
        base.detailText = typeof value === 'string' ? value : ''
        continue
      }
      if (field === 'usageFieldsText') {
        base.usageFieldsText = typeof value === 'string' ? value : ''
        continue
      }
      if (field === 'enabled' || field === 'usageScale' || field === 'autoUnit') {
        base[field] = truthy(value)
        continue
      }
      if (field === 'divisor' || field === 'multiplier' || field === 'decimals') {
        base[field] = value
        continue
      }
      if (typeof value === 'string' || typeof value === 'number') base[field] = value
    }
    return base
  }

  // 收起「添加服务」流程（类型列表 / 表单 / 编辑态一起清掉）。
  function closeAddFlow () {
    state.pickTemplate = false
    state.formOpen = false
    state.editingId = ''
    state.presetOrigin = ''
    state.editClipped = {}
    state.form = emptyForm()
    clearTransient()
  }

  function panelFeed (scope, emit, caps) {
    const feed = { emit, caps: caps && typeof caps === 'object' ? caps : {} }
    panelFeeds.add(feed)
    state.viewServed = true
    if (feed.caps.locale) state.locale = feed.caps.locale
    // 与 panelView 同一个口径：只报 form 而缺 textField/tabs 的宿主会渲染 V1（要用 rows），
    // 这里若只看 form 就会判成 v2 → data 不生成 rows → 面板列表空白。
    if (Array.isArray(feed.caps.components)) state.v2 = isEditableCaps(feed.caps)
    let stopped = false
    const cancel = () => {
      stopped = true
      panelFeeds.delete(feed)
      // 面板关掉后收起临时 UI（类型列表/菜单/删除确认），重新打开直接看卡片。
      if (panelFeeds.size === 0) {
        state.pickTemplate = false
        state.menuId = ''
        state.confirmDelete = null
      }
    }
    emit(panelData(state, feed.caps))
    ensureReady().then(() => {
      if (disposed || stopped) return
      emit(panelData(state, feed.caps))
      if (shouldAutoRefresh()) startBackgroundRefresh()
    })
    return cancel
  }

  function patchEffect (event) {
    return { type: 'patch', data: panelData(state, { locale: currentLocale(event) }) }
  }

  function refreshEffect () {
    return { type: 'refresh', id: PANEL_ID }
  }

  function toastEffect (value) {
    const text = clipToast(value)
    return { type: 'toast', text: text === '' ? clipToast('…') : text }
  }

  function failToast (event, message) {
    return toastEffect(message || localeWords(event).saveFailed)
  }

  async function onAdd (scope, event) {
    await ensureReady()
    // 类型列表已展开时，再点一次「添加服务」就是收起，别让列表只能选不能退。
    if (state.pickTemplate === true) {
      closeAddFlow()
      updateView()
      return [patchEffect(event), refreshEffect()]
    }
    state.pickTemplate = true
    state.formOpen = false
    state.editingId = ''
    state.presetOrigin = ''
    state.editClipped = {}
    state.form = emptyForm()
    clearTransient()
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  // 选完服务类型才出对应表单。
  async function onChooseTemplate (scope, event) {
    await ensureReady()
    const value = event && event.value && typeof event.value === 'object'
      ? (event.value.preset !== undefined ? event.value.preset : event.value.value)
      : undefined
    const preset = PRESET_IDS.includes(value) ? value : 'custom'
    state.pickTemplate = false
    state.formOpen = true
    state.editingId = ''
    state.presetOrigin = preset
    state.editClipped = {}
    state.form = draftForm(presetDraft(preset))
    clearTransient()
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  // 「自动识别站点货币」toggle：只翻状态并重建表单（onChange 只允许 patch/refresh）。
  async function onAutoUnit (scope, event) {
    const form = mergeFormValues(
      { ...(state.form && typeof state.form === 'object' ? state.form : emptyForm()) },
      event && event.value && typeof event.value === 'object' ? event.value.values : null,
    )
    form.autoUnit = !(form.autoUnit === true)
    state.form = form
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  // 合并模板里的平台下拉：onChange 时把选中值同步进表单状态，避免中间 patch 把 select 回跳。
  async function onPresetChange (scope, event) {
    const raw = event && event.value
    const value = typeof raw === 'string'
      ? raw
      : (raw && typeof raw === 'object'
          ? (typeof raw.value === 'string' ? raw.value : raw.preset)
          : undefined)
    // onChange 可能带回 App 里还没提交的表单值，先合并进来，避免刷新后输入被清掉。
    const form = mergeFormValues(
      { ...(state.form && typeof state.form === 'object' ? state.form : emptyForm()) },
      raw && typeof raw === 'object' ? raw.values : null,
    )
    const allowed = ['newapi', 'oneapi', 'aihubmix', 'openai-cost', 'anthropic-cost', 'opencode-go', 'commandcode']
    if (typeof value === 'string' && allowed.includes(value)) form.preset = value
    state.form = form
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  async function onCardMenu (scope, event) {
    await ensureReady()
    const provider = providerFromEvent(event)
    if (!provider) return failToast(event, localeWords(event).noSelection)
    state.menuId = state.menuId === provider.id ? '' : provider.id
    state.confirmDelete = null
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  async function onCardEdit (scope, event) {
    await ensureReady()
    const provider = providerFromEvent(event)
    if (!provider) return failToast(event, localeWords(event).noSelection)
    state.menuId = ''
    return openEditForm(provider, event)
  }

  async function onCardDelete (scope, event) {
    await ensureReady()
    const provider = providerFromEvent(event)
    if (!provider) return failToast(event, localeWords(event).noSelection)
    state.menuId = ''
    state.confirmDelete = { id: provider.id }
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  async function onCardDeleteConfirm (scope, event) {
    await ensureReady()
    // 只认当前确认态，而且确认必须来自同一条服务的视图：
    // 旧视图/多面板里可能还挂着别家的「确认删除」，不能凭全局状态删错。
    const value = event && event.value && typeof event.value === 'object' ? event.value : {}
    const eventId = stringValue(value.id)
    const confirmId = state.confirmDelete && typeof state.confirmDelete === 'object'
      ? stringValue(state.confirmDelete.id)
      : ''
    state.menuId = ''
    if (eventId === '' || confirmId === '' || eventId !== confirmId) {
      state.confirmDelete = null
      updateView()
      return [patchEffect(event), refreshEffect()]
    }
    const provider = findProvider(state, confirmId)
    if (!provider) {
      state.confirmDelete = null
      updateView()
      return [patchEffect(event), refreshEffect()]
    }
    return deleteProvider(provider, event)
  }

  async function onCardDeleteCancel (scope, event) {
    state.menuId = ''
    state.confirmDelete = null
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  async function onFormCancel (scope, event) {
    closeAddFlow()
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  // 密钥只会发给这些地址的 origin；切换站点/平台后不再复用旧密钥。
  function endpointScope (provider) {
    const origins = new Set()
    if (!provider || typeof provider !== 'object') return origins
    for (const raw of [provider.url, provider.loginUrl, provider.usageUrl, provider.extraUrl]) {
      if (typeof raw !== 'string' || raw.trim() === '') continue
      try {
        const parsed = new URL(raw.trim())
        origins.add(`${parsed.protocol}//${parsed.hostname}:${parsed.port}`)
      } catch {
        // 占位符/非法 URL 解析不了就不算一个 origin
      }
    }
    return origins
  }

  // 只要新配置不会把密钥发到“以前没有的 origin”就允许复用：删掉可选地址/替换成已有 origin 不算换站。
  function sameEndpointScope (existing, draft) {
    const allowed = endpointScope(existing)
    for (const origin of endpointScope(draft)) if (!allowed.has(origin)) return false
    return true
  }

  // 保存串行化：两个面板同时保存时，后一次必须等前一次写完再读 state.config。
  // 否则两次都拿旧快照各自拼 providers，磁盘 last-write-wins，先保存的那家会凭空消失。
  let saveQueue = Promise.resolve()
  function serializeSave (task) {
    const run = saveQueue.then(task, task)
    // 队列本身不能被单次失败卡死（task 内部会把错误转成 toast）。
    saveQueue = run.then(() => {}, () => {})
    return run
  }

  function onSave (scope, event) {
    return serializeSave(() => saveProvider(scope, event))
  }

  async function saveProvider (scope, event) {
    await ensureReady()
    const w = localeWords(event)
    const values = event && event.value && event.value.values && typeof event.value.values === 'object'
      ? event.value.values
      : {}
    const base = state.form && typeof state.form === 'object' ? { ...state.form } : emptyForm()
    const initialPreset = PRESET_IDS.includes(state.presetOrigin)
      ? state.presetOrigin
      : (typeof base.preset === 'string' ? base.preset : 'custom')
    mergeFormValues(base, values, { includeSecret: true })
    // 编辑时被截断显示的旧字段：用户没改过就还原原值，避免静默截断保存。
    for (const [field, pair] of Object.entries(state.editClipped && typeof state.editClipped === 'object' ? state.editClipped : {})) {
      if (pair && base[field] === pair.clipped) base[field] = pair.original
    }
    const existing = state.editingId === '' ? null : findProvider(state, state.editingId)
    const preset = PRESET_IDS.includes(base.preset) ? base.preset : 'custom'
    // 在表单里切换了平台/站点类型、但名称没改过时，默认名跟着目标模板走（别留下入口模板的名字）。
    const pickName = (seed) => {
      const entered = stringValue(base.name).trim()
      if (entered === '') return seed.name
      if (initialPreset !== preset && entered === presetDraft(initialPreset).name) return seed.name
      return entered
    }
    let draft
    if (preset === 'kimi') {
      const region = base.region === 'global' ? 'global' : 'cn'
      const seed = presetDraft('kimi', { region })
      draft = {
        ...seed,
        name: pickName(seed),
        secret: stringValue(base.secret),
        enabled: base.enabled !== false,
        autoUnit: false,
      }
    } else if (preset === 'mimo') {
      const seed = presetDraft('mimo')
      draft = {
        ...seed,
        name: pickName(seed),
        secret: stringValue(base.secret),
        enabled: base.enabled !== false,
        autoUnit: false,
      }
    } else if (preset === 'openrouter' || preset === 'aihubmix' || preset === 'openai-cost' || preset === 'anthropic-cost' || preset === 'opencode-go' || preset === 'commandcode') {
      const seed = presetDraft(preset)
      draft = {
        ...seed,
        name: pickName(seed),
        secret: stringValue(base.secret),
        enabled: base.enabled !== false,
        autoUnit: false,
      }
    } else if (preset === 'newapi' || preset === 'oneapi') {
      const site = normalizeSiteBase(stringValue(base.siteBase))
      if (site === '') return failToast(event, w.siteRequired)
      if (!/^https?:\/\//i.test(site)) return failToast(event, w.siteInvalid)
      const seed = presetDraft(preset, { base: site })
      // autoUnit 开着时符号只是兜底：在表单里切换 new-api ↔ one-api 时用模板默认（one-api 默认 $），
      // 不要被另一个模板草稿里的 ¥ 盖掉；关掉自动识别才用表单里手填的符号。
      const switched = initialPreset !== preset
      draft = {
        ...seed,
        name: pickName(seed),
        secret: stringValue(base.secret),
        symbol: switched && (base.autoUnit === true || stringValue(base.symbol).trim() === presetDraft(initialPreset).symbol)
          ? seed.symbol
          : typeof base.symbol === 'string' && base.symbol.trim() !== ''
            ? base.symbol
            : seed.symbol,
        divisor: base.divisor,
        multiplier: base.multiplier,
        enabled: base.enabled !== false,
        autoUnit: typeof base.autoUnit === 'boolean' ? base.autoUnit : seed.autoUnit === true,
      }
    } else if (preset === 'deepseek') {
      const seed = presetDraft('deepseek')
      draft = {
        ...seed,
        name: pickName(seed),
        secret: stringValue(base.secret),
        enabled: base.enabled !== false,
        autoUnit: typeof base.autoUnit === 'boolean' ? base.autoUnit : seed.autoUnit === true,
      }
    } else {
      // 表单只存 label=path；编辑保存时把旧配置里的 kind（date/count/text）和 balanceOptional 找回来。
      const applyKinds = (list, source) => {
        const byLabel = new Map()
        const byPath = new Map()
        for (const row of Array.isArray(source) ? source : []) {
          if (!row || typeof row.kind !== 'string') continue
          if (typeof row.label === 'string') byLabel.set(row.label, row.kind)
          if (typeof row.path === 'string') byPath.set(row.path, row.kind)
        }
        // 先按路径找回 kind（改标签不丢）；路径也改了再退回按标签。
        return list.map((row) => {
          const kind = byPath.get(row.path) ?? byLabel.get(row.label)
          return kind === undefined ? row : { ...row, kind }
        })
      }
      draft = {
        ...base,
        detailPaths: applyKinds(parseDetailText(base.detailText), existing && existing.detailPaths),
        usageFields: parseDetailText(base.usageFieldsText),
        extraFields: applyKinds(parseDetailText(base.extraFieldsText), existing && existing.extraFields),
        autoUnit: base.autoUnit === true,
        balanceOptional: existing ? existing.balanceOptional === true : false,
      }
    }
    const secretEntered = stringValue(base.secret).trim() !== ''
    const allowSecretReuse = existing === null || secretEntered || sameEndpointScope(existing, draft)
    const checked = validateProvider(draft, { existing, allowSecretReuse })
    if (checked.ok !== true) {
      const first = Object.values(checked.errors || {})[0]
      if (existing !== null && !secretEntered && !allowSecretReuse) {
        // 换了站点/平台却留空密钥：保留用户刚填的名称/地址，只要求重填密钥。
        state.form = { ...base, secret: '', secretSet: false }
        updateView()
        return [patchEffect(event), refreshEffect(), failToast(event, w.secretRequired)]
      }
      return failToast(event, first)
    }
    const provider = { ...checked.provider, enriched: true }
    const providers = state.config.providers.slice()
    const index = existing ? providers.findIndex((item) => item.id === provider.id) : -1
    if (!existing && providers.length >= CACHE_LIMIT) return failToast(event, w.tooMany)
    if (index >= 0) providers[index] = provider
    else providers.push(provider)
    const nextConfig = { ...state.config, providers }
    try {
      await saveConfig(nextConfig, configFile)
    } catch {
      return failToast(event, w.saveFailed)
    }
    state.config = nextConfig
    configRevision += 1
    abortInflightRefreshes()
    // 旧结果属于旧配置：内存和磁盘都清掉，避免重启后旧站余额复活。
    delete state.results[provider.id]
    await persistResults({ force: true })
    runner.clearTokenCache()
    state.formOpen = false
    state.pickTemplate = false
    state.editingId = ''
    state.presetOrigin = ''
    state.editClipped = {}
    state.form = emptyForm()
    clearTransient()
    updateView()
    // 被中止的后台刷新会在 finally 里按新配置自行补一轮；只有确实没在跑时才在这里启动，
    // 否则会多刷一整轮（24 家服务时就是 24 个多余请求）。
    if (refreshInFlight === null) startBackgroundRefresh()
    return [patchEffect(event), refreshEffect(), toastEffect(w.saved)]
  }

  async function deleteProvider (provider, event) {
    const w = localeWords(event)
    const id = provider.id
    const nextConfig = {
      ...state.config,
      providers: state.config.providers.filter((item) => item.id !== id),
    }
    try {
      await saveConfig(nextConfig, configFile)
    } catch {
      return failToast(event, w.saveFailed)
    }
    state.config = nextConfig
    configRevision += 1
    const aborted = abortInflightRefreshes()
    delete state.results[id]
    runner.clearTokenCache()
    await persistResults({ force: true })
    state.formOpen = false
    state.editingId = ''
    state.form = emptyForm()
    clearTransient()
    updateView()
    broadcastPanels()
    // 删服务时被中止的如果只有手动刷新（没有后台刷新接力），给剩余服务补一轮。
    if (aborted && refreshInFlight === null) startBackgroundRefresh()
    return [patchEffect(event), refreshEffect(), toastEffect(w.deleted)]
  }

  function onRefresh (scope, event) {
    const w = localeWords(event)
    const locale = currentLocale(event)
    ensureReady()
    return {
      pending: { label: w.pendingRefresh, timeoutMs: PENDING_TIMEOUT_MS },
      result: async (signal) => {
        if (disposed || (signal && signal.aborted)) return {}
        await ensureReady()
        if (disposed || (signal && signal.aborted)) return {}
        const providers = enabledProviders(state)
        if (providers.length === 0) return { toast: w.noServices }
        // 请求期间配置可能被保存/删除改动：记住版本，变了就丢弃这批旧结果。
        const revision = configRevision
        const seq = ++refreshSeq
        const linked = withShutdownSignal(signal)
        manualControllers.add(linked.controller)
        broadcastPanels()
        try {
          const results = await runner.queryAll(providers, {
            signal: linked.signal,
            timeoutMs: timeoutOf(state.config.settings),
            totalTimeoutMs: MANUAL_TOTAL_TIMEOUT_MS,
          })
          if (disposed || (signal && signal.aborted) || linked.signal.aborted) {
            broadcastPanels()
            return {}
          }
          if (revision !== configRevision) {
            broadcastPanels()
            startBackgroundRefresh()
            return {}
          }
          if (seq <= appliedSeq) {
            broadcastPanels()
            return {}
          }
          appliedSeq = seq
          applyResults(results)
          await persistResults()
          updateView()
          broadcastPanels()
          const okCount = results.filter((result) => result && result.ok === true).length
          return [
            { type: 'patch', data: panelData(state, { locale }) },
            toastEffect(w.refreshed(okCount, results.length - okCount)),
          ]
        } catch {
          broadcastPanels()
          return { toast: w.refreshFailed }
        } finally {
          manualControllers.delete(linked.controller)
          linked.cleanup()
        }
      },
    }
  }

  const actions = {
    refresh: onRefresh,
    add: onAdd,
    'choose-template': onChooseTemplate,
    'auto-unit': onAutoUnit,
    'preset-change': onPresetChange,
    'form-cancel': onFormCancel,
    save: onSave,
    'card-menu': onCardMenu,
    'card-edit': onCardEdit,
    'card-delete': onCardDelete,
    'card-delete-confirm': onCardDeleteConfirm,
    'card-delete-cancel': onCardDeleteCancel,
  }

  function attach (go) {
    if (!go || typeof go !== 'object') return
    dshGo = go
    go.panel(PANEL_ID, {
      view (scope, caps) {
        state.viewServed = true
        if (caps && caps.locale) state.locale = caps.locale
        // 宿主调用 data 时不传 components，v2/v1 只能在这里判定（与 panelView 同一个条件）。
        state.v2 = isEditableCaps(caps)
        return panelView(state, caps)
      },
      data: panelFeed,
      actions,
    })
    ensureReady()
  }

  return {
    state,
    actions,
    attach,
    ensureReady,
    panelView: (caps) => panelView(state, caps),
    panelData: (caps) => panelData(state, caps),
    dispose () {
      disposed = true
      panelFeeds.clear()
      shutdownController.abort()
      if (backgroundController) backgroundController.abort()
      backgroundController = null
      manualControllers.clear()
      runner.clearTokenCache()
    },
  }
}

export function apply (ctx, options = {}) {
  const store = createStore(options)
  if (ctx && typeof ctx.inject === 'function') {
    ctx.inject(['dshGo'], (sub) => {
      store.attach(sub && sub.dshGo ? sub.dshGo : sub)
    })
  }
  // 宿主销毁插件时清掉订阅/在途请求，别让回调继续改状态。
  if (ctx && typeof ctx.effect === 'function') {
    try {
      ctx.effect(() => () => store.dispose())
    } catch {
      // 没有 effect 能力的测试宿主忽略
    }
  }
  return store
}
