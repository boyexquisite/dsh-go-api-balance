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
import { newapiSubscriptionFields, presetDraft } from './presets.js'
import { createRunner } from './query.js'
import {
  createState,
  draftForm,
  normalizeSiteBase,
  emptyForm,
  panelData,
  panelView,
  parseDetailText,
  providerForm,
  words,
} from './view.js'

export const PANEL_ID = 'balance'

const STALE_MS = 60000
const CACHE_LIMIT = 24
const PENDING_TIMEOUT_MS = 30000
const TOAST_MAX_CHARS = 40

function nowOf (options) {
  return typeof options.now === 'function' ? options.now : Date.now
}

function localeText (locale) {
  return String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
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
const MAX_DETAILS = 6
const ENRICH_DETAIL_PRESETS = ['newapi', 'oneapi', 'openrouter', 'commandcode']
const SUBSCRIPTION_ORDER = ['订阅剩余', '订阅到期', '订阅总量', '订阅已用']

function mergeDetails (current, defaults) {
  const rows = Array.isArray(current) ? current.slice(0, MAX_DETAILS) : []
  const seen = new Set(rows.map((row) => (row && typeof row.label === 'string' ? row.label : '')))
  for (const row of defaults) {
    if (rows.length >= MAX_DETAILS) break
    if (!row || typeof row.label !== 'string' || seen.has(row.label)) continue
    rows.push({ ...row })
    seen.add(row.label)
  }
  return rows
}

function upgradeProvider (provider) {
  if (!provider || typeof provider !== 'object') return provider
  let next = provider
  if (next.preset === 'newapi') {
    const hasExtra = typeof next.extraUrl === 'string' && next.extraUrl.trim() !== ''
    const url = typeof next.url === 'string' ? next.url.trim() : ''
    if (!hasExtra && /\/api\/user\/self\/?$/.test(url)) {
      const base = normalizeSiteBase(url.replace(/\/api\/user\/self\/?$/, ''))
      next = { ...next, ...newapiSubscriptionFields(base) }
    }
  }
  if (ENRICH_DETAIL_PRESETS.includes(next.preset)) {
    const seed = presetDraft(next.preset)
    next = { ...next, detailPaths: mergeDetails(next.detailPaths, seed.detailPaths) }
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
      next = { ...next, extraUrl: seed.extraUrl, extraFields: seed.extraFields }
    }
  }
  return next
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
  let disposed = false

  function currentLocale (event) {
    if (event && typeof event.locale === 'string' && event.locale !== '') return event.locale
    return state.locale || 'zh-CN'
  }

  function localeWords (event) {
    return words(currentLocale(event))
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
        state.config = { ...config, providers: config.providers.map(upgradeProvider) }
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

  async function persistResults () {
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
      const controller = new AbortController()
      backgroundController = controller
      state.busy = true
      broadcastPanels()
      try {
        const timeoutMs = timeoutOf(state.config.settings)
        const results = await runner.queryAll(providers, { signal: controller.signal, timeoutMs })
        if (!disposed && !controller.signal.aborted && revision === configRevision) {
          applyResults(results)
          await persistResults()
          // 卡片上的订阅行等是视图静态内容，结果回来后要重建一次视图。
          updateView()
        }
      } catch {
        // 后台刷新失败保持旧缓存
      } finally {
        if (backgroundController === controller) backgroundController = null
        state.busy = false
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
    clearTransient()
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  function clearTransient () {
    state.menuId = ''
    state.confirmDelete = null
  }

  // 收起「添加服务」流程（类型列表 / 表单 / 编辑态一起清掉）。
  function closeAddFlow () {
    state.pickTemplate = false
    state.formOpen = false
    state.editingId = ''
    state.presetOrigin = ''
    state.form = emptyForm()
    clearTransient()
  }

  function panelFeed (scope, emit, caps) {
    const feed = { emit, caps: caps && typeof caps === 'object' ? caps : {} }
    panelFeeds.add(feed)
    state.viewServed = true
    if (feed.caps.locale) state.locale = feed.caps.locale
    if (Array.isArray(feed.caps.components)) state.v2 = feed.caps.components.includes('form')
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
    const preset = ['deepseek', 'newapi', 'oneapi', 'kimi', 'mimo', 'openrouter', 'openai-cost', 'anthropic-cost', 'opencode-go', 'commandcode', 'custom'].includes(value) ? value : 'custom'
    state.pickTemplate = false
    state.formOpen = true
    state.editingId = ''
    state.presetOrigin = preset
    state.form = draftForm(presetDraft(preset))
    clearTransient()
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  // 「自动识别站点货币」toggle：只翻状态并重建表单（onChange 只允许 patch/refresh）。
  async function onAutoUnit (scope, event) {
    state.form = {
      ...(state.form && typeof state.form === 'object' ? state.form : emptyForm()),
      autoUnit: !(state.form && state.form.autoUnit === true),
    }
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  // 合并模板里的平台下拉：onChange 时把选中值同步进表单状态，避免中间 patch 把 select 回跳。
  async function onPresetChange (scope, event) {
    const value = event && event.value && typeof event.value === 'object'
      ? (typeof event.value.value === 'string' ? event.value.value : event.value.preset)
      : undefined
    const allowed = ['newapi', 'oneapi', 'openai-cost', 'anthropic-cost', 'opencode-go', 'commandcode']
    if (typeof value === 'string' && allowed.includes(value)) {
      state.form = { ...(state.form && typeof state.form === 'object' ? state.form : emptyForm()), preset: value }
      updateView()
    }
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

  function sameEndpointScope (left, right) {
    const a = endpointScope(left)
    const b = endpointScope(right)
    if (a.size !== b.size) return false
    for (const origin of a) if (!b.has(origin)) return false
    return true
  }

  async function onSave (scope, event) {
    await ensureReady()
    const w = localeWords(event)
    const values = event && event.value && event.value.values && typeof event.value.values === 'object'
      ? event.value.values
      : {}
    const base = state.form && typeof state.form === 'object' ? { ...state.form } : emptyForm()
    const initialPreset = ['deepseek', 'newapi', 'oneapi', 'kimi', 'mimo', 'openrouter', 'openai-cost', 'anthropic-cost', 'opencode-go', 'commandcode', 'custom'].includes(state.presetOrigin)
      ? state.presetOrigin
      : (typeof base.preset === 'string' ? base.preset : 'custom')
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith('data.form.')) continue
      const field = key.slice('data.form.'.length)
      if (field === 'detailText') {
        base.detailText = typeof value === 'string' ? value : ''
        continue
      }
      if (field === 'usageFieldsText') {
        base.usageFieldsText = typeof value === 'string' ? value : ''
        continue
      }
      if (field === 'enabled' || field === 'usageScale' || field === 'autoUnit') {
        base[field] = value === true || value === 'true'
        continue
      }
      if (field === 'divisor' || field === 'multiplier' || field === 'decimals') {
        base[field] = value
        continue
      }
      if (typeof value === 'string' || typeof value === 'number') base[field] = value
    }
    const existing = state.editingId === '' ? null : findProvider(state, state.editingId)
    const preset = ['deepseek', 'newapi', 'oneapi', 'kimi', 'mimo', 'openrouter', 'openai-cost', 'anthropic-cost', 'opencode-go', 'commandcode', 'custom'].includes(base.preset) ? base.preset : 'custom'
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
    } else if (preset === 'openrouter' || preset === 'openai-cost' || preset === 'anthropic-cost' || preset === 'opencode-go' || preset === 'commandcode') {
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
        const table = new Map()
        for (const row of Array.isArray(source) ? source : []) {
          if (row && typeof row.label === 'string' && typeof row.kind === 'string') table.set(row.label, row.kind)
        }
        return list.map((row) => (table.has(row.label) ? { ...row, kind: table.get(row.label) } : row))
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
        // 换了站点/平台却留空密钥：提示重填，别让旧 key 发到新厂商。
        state.form = { ...(state.form && typeof state.form === 'object' ? state.form : emptyForm()), secretSet: false }
        updateView()
        return [patchEffect(event), refreshEffect(), failToast(event, w.secretRequired)]
      }
      return failToast(event, first)
    }
    const provider = checked.provider
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
    // 旧结果属于旧配置，先丢掉，避免卡片短暂显示旧站余额。
    delete state.results[provider.id]
    runner.clearTokenCache()
    state.formOpen = false
    state.pickTemplate = false
    state.editingId = ''
    state.presetOrigin = ''
    state.form = emptyForm()
    clearTransient()
    updateView()
    startBackgroundRefresh()
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
    delete state.results[id]
    runner.clearTokenCache()
    await persistResults()
    state.formOpen = false
    state.editingId = ''
    state.form = emptyForm()
    clearTransient()
    updateView()
    broadcastPanels()
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
        state.busy = true
        broadcastPanels()
        try {
          const results = await runner.queryAll(providers, {
            signal,
            timeoutMs: timeoutOf(state.config.settings),
          })
          if (disposed || (signal && signal.aborted)) {
            state.busy = false
            broadcastPanels()
            return {}
          }
          if (revision !== configRevision) {
            state.busy = false
            broadcastPanels()
            startBackgroundRefresh()
            return {}
          }
          applyResults(results)
          state.busy = false
          await persistResults()
          updateView()
          broadcastPanels()
          return [
            { type: 'patch', data: panelData(state, { locale }) },
            toastEffect(w.refreshed(results.length)),
          ]
        } catch {
          state.busy = false
          broadcastPanels()
          return { toast: w.refreshFailed }
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
      if (backgroundController) backgroundController.abort()
      backgroundController = null
      runner.clearTokenCache()
    },
    isReady: () => ready !== null,
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
