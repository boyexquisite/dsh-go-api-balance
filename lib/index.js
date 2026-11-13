// 插件注册与点按处理：面板 balance、状态条 balance-strip、数据缓存与动作。
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
import { presetDraft } from './presets.js'
import { createRunner } from './query.js'
import { redactPreview } from './format.js'
import {
  createState,
  draftForm,
  normalizeSiteBase,
  emptyForm,
  panelData,
  panelView,
  parseDetailText,
  providerForm,
  stripData,
  words,
} from './view.js'

export const PANEL_ID = 'balance'
export const STRIP_ID = 'balance-strip'

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
  const stripFeeds = new Set()

  let dshGo = null
  let ready = null
  let autoRefresh = null
  let backgroundController = null

  function currentLocale (event) {
    if (event && typeof event.locale === 'string' && event.locale !== '') return event.locale
    return state.locale || 'zh-CN'
  }

  function localeWords (event) {
    return words(currentLocale(event))
  }

  function updateView () {
    if (dshGo && typeof dshGo.refresh === 'function') {
      try {
        dshGo.refresh(PANEL_ID)
      } catch {
        // 视图刷新失败不影响数据
      }
    }
  }

  function broadcastPanels () {
    for (const feed of [...panelFeeds]) {
      try {
        feed.emit(panelData(state, feed.caps))
      } catch {
        // 单个订阅者出错不打断别人
      }
    }
  }

  function broadcastStrips () {
    for (const feed of [...stripFeeds]) {
      try {
        feed.emit(stripData(state, feed.caps))
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
        state.config = config
        state.results = results && results.results && typeof results.results === 'object'
          ? { ...results.results }
          : {}
      } catch {
        // 读失败就用默认值，不打扰 UI
      }
      if (state.viewServed === true) {
        updateView()
        broadcastPanels()
      }
      broadcastStrips()
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
      state.results[result.id] = { ...result, rawPreview: null }
    }
  }

  async function persistResults () {
    try {
      await saveResults({ v: RESULTS_VERSION, results: state.results }, resultsFile)
    } catch {
      // 缓存只是加速，写失败不打扰 UI
    }
  }

  function startBackgroundRefresh () {
    if (autoRefresh !== null) return autoRefresh
    autoRefresh = (async () => {
      const providers = enabledProviders(state)
      if (providers.length === 0) {
        autoRefresh = null
        return
      }
      const controller = new AbortController()
      backgroundController = controller
      state.busy = true
      broadcastPanels()
      try {
        const timeoutMs = timeoutOf(state.config.settings)
        const results = await runner.queryAll(providers, { signal: controller.signal, timeoutMs })
        if (!controller.signal.aborted) {
          applyResults(results)
          await persistResults()
        }
      } catch {
        // 后台刷新失败保持旧缓存
      } finally {
        if (backgroundController === controller) backgroundController = null
        state.busy = false
        broadcastPanels()
        broadcastStrips()
        autoRefresh = null
      }
    })()
    return autoRefresh
  }

  function selectedProvider () {
    return state.selectedId === '' ? null : findProvider(state, state.selectedId)
  }

  function clearTransient () {
    state.test = null
    state.confirmDelete = null
  }

  function panelFeed (scope, emit, caps) {
    const feed = { emit, caps: caps && typeof caps === 'object' ? caps : {} }
    panelFeeds.add(feed)
    state.viewServed = true
    if (feed.caps.locale) state.locale = feed.caps.locale
    let stopped = false
    const cancel = () => {
      stopped = true
      panelFeeds.delete(feed)
    }
    emit(panelData(state, feed.caps))
    ensureReady().then(() => {
      if (stopped) return
      emit(panelData(state, feed.caps))
      if (shouldAutoRefresh()) startBackgroundRefresh()
    })
    return cancel
  }

  function stripFeed (scope, emit, caps) {
    const feed = { emit, caps: caps && typeof caps === 'object' ? caps : {} }
    stripFeeds.add(feed)
    if (feed.caps.locale) state.locale = feed.caps.locale
    let stopped = false
    const cancel = () => {
      stopped = true
      stripFeeds.delete(feed)
    }
    emit(stripData(state, feed.caps))
    ensureReady().then(() => {
      if (!stopped) emit(stripData(state, feed.caps))
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

  async function onSelect (scope, event) {
    await ensureReady()
    const id = event && event.value && typeof event.value.id === 'string' ? event.value.id : ''
    const provider = id === '' ? null : findProvider(state, id)
    if (!provider) return failToast(event, localeWords(event).noSelection)
    state.selectedId = id
    clearTransient()
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  async function onAdd (scope, event) {
    await ensureReady()
    state.pickTemplate = true
    state.formOpen = false
    state.editingId = ''
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
    const preset = ['deepseek', 'newapi', 'custom'].includes(value) ? value : 'custom'
    state.pickTemplate = false
    state.formOpen = true
    state.editingId = ''
    state.form = draftForm(presetDraft(preset))
    clearTransient()
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  async function onEdit (scope, event) {
    await ensureReady()
    const provider = selectedProvider()
    if (!provider) return failToast(event, localeWords(event).noSelection)
    state.pickTemplate = false
    state.formOpen = true
    state.editingId = provider.id
    state.form = providerForm(provider)
    clearTransient()
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  async function onFormCancel (scope, event) {
    state.formOpen = false
    state.pickTemplate = false
    state.editingId = ''
    state.form = emptyForm()
    clearTransient()
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  async function onSave (scope, event) {
    await ensureReady()
    const w = localeWords(event)
    const values = event && event.value && event.value.values && typeof event.value.values === 'object'
      ? event.value.values
      : {}
    const base = state.form && typeof state.form === 'object' ? { ...state.form } : emptyForm()
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
      if (field === 'enabled' || field === 'usageScale') {
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
    const preset = ['deepseek', 'newapi', 'custom'].includes(base.preset) ? base.preset : 'custom'
    let draft
    if (preset === 'newapi') {
      const site = normalizeSiteBase(stringValue(base.siteBase))
      if (site === '') return failToast(event, w.siteRequired)
      if (!/^https?:\/\//i.test(site)) return failToast(event, w.siteInvalid)
      const seed = presetDraft('newapi', { base: site })
      draft = {
        ...seed,
        name: stringValue(base.name).trim() || seed.name,
        secret: stringValue(base.secret),
        symbol: typeof base.symbol === 'string' && base.symbol.trim() !== '' ? base.symbol : seed.symbol,
        multiplier: base.multiplier,
        enabled: base.enabled !== false,
      }
    } else if (preset === 'deepseek') {
      const seed = presetDraft('deepseek')
      draft = {
        ...seed,
        name: stringValue(base.name).trim() || seed.name,
        secret: stringValue(base.secret),
        enabled: base.enabled !== false,
      }
    } else {
      draft = {
        ...base,
        detailPaths: parseDetailText(base.detailText),
        usageFields: parseDetailText(base.usageFieldsText),
      }
    }
    const checked = validateProvider(draft, { existing })
    if (checked.ok !== true) {
      const first = Object.values(checked.errors || {})[0]
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
    state.selectedId = provider.id
    state.formOpen = false
    state.pickTemplate = false
    state.editingId = ''
    state.form = emptyForm()
    clearTransient()
    updateView()
    broadcastStrips()
    startBackgroundRefresh()
    return [patchEffect(event), refreshEffect(), toastEffect(w.saved)]
  }

  async function onDelete (scope, event) {
    await ensureReady()
    const w = localeWords(event)
    const value = event && event.value && typeof event.value === 'object' ? event.value : null
    const provider = selectedProvider() ||
      (state.confirmDelete && typeof state.confirmDelete === 'object'
        ? findProvider(state, state.confirmDelete.id)
        : null)
    if (!provider) {
      state.confirmDelete = null
      updateView()
      return [patchEffect(event), refreshEffect()]
    }
    if (value && value.confirmed === false) {
      state.confirmDelete = null
      updateView()
      return [patchEffect(event), refreshEffect()]
    }
    if (value && value.confirmed === true) {
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
      delete state.results[id]
      await persistResults()
      state.selectedId = ''
      state.formOpen = false
      state.editingId = ''
      state.form = emptyForm()
      clearTransient()
      updateView()
      broadcastPanels()
      broadcastStrips()
      return [patchEffect(event), refreshEffect(), toastEffect(w.deleted)]
    }
    state.confirmDelete = { id: provider.id }
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  async function onCloseTest (scope, event) {
    state.test = null
    updateView()
    return [patchEffect(event), refreshEffect()]
  }

  function onRefresh (scope, event) {
    const w = localeWords(event)
    const locale = currentLocale(event)
    ensureReady()
    return {
      pending: { label: w.pendingRefresh, timeoutMs: PENDING_TIMEOUT_MS },
      result: async (signal) => {
        if (signal && signal.aborted) return {}
        await ensureReady()
        if (signal && signal.aborted) return {}
        const providers = enabledProviders(state)
        if (providers.length === 0) return { toast: w.noServices }
        state.busy = true
        broadcastPanels()
        try {
          const results = await runner.queryAll(providers, {
            signal,
            timeoutMs: timeoutOf(state.config.settings),
          })
          if (signal && signal.aborted) {
            state.busy = false
            broadcastPanels()
            return {}
          }
          applyResults(results)
          state.busy = false
          await persistResults()
          broadcastStrips()
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

  function onTest (scope, event) {
    const w = localeWords(event)
    const locale = currentLocale(event)
    ensureReady()
    return {
      pending: { label: w.pendingTest, timeoutMs: PENDING_TIMEOUT_MS },
      result: async (signal) => {
        if (signal && signal.aborted) return {}
        await ensureReady()
        if (signal && signal.aborted) return {}
        const provider = selectedProvider()
        if (!provider) return { toast: w.noSelection }
        const result = await runner.queryProvider(provider, {
          signal,
          timeoutMs: timeoutOf(state.config.settings),
          preview: true,
        })
        if (signal && signal.aborted) return {}
        const raw = redactPreview(result.rawPreview || '', provider)
        state.test = {
          id: provider.id,
          title: `${provider.name || w.untitled} · ${w.testTitle}`,
          raw: raw === '' ? w.noPreview : raw,
        }
        state.results[provider.id] = { ...result, rawPreview: null }
        await persistResults()
        updateView()
        broadcastStrips()
        return [
          { type: 'patch', data: panelData(state, { locale }) },
          toastEffect(result.ok === true ? w.testOk : w.testFailed),
        ]
      },
    }
  }

  const actions = {
    refresh: onRefresh,
    select: onSelect,
    add: onAdd,
    'choose-template': onChooseTemplate,
    edit: onEdit,
    'form-cancel': onFormCancel,
    save: onSave,
    delete: onDelete,
    test: onTest,
    'close-test': onCloseTest,
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
    go.strip(STRIP_ID, stripFeed)
    ensureReady()
  }

  return {
    state,
    actions,
    attach,
    ensureReady,
    panelView: (caps) => panelView(state, caps),
    panelData: (caps) => panelData(state, caps),
    stripData: (caps) => stripData(state, caps),
    dispose () {
      panelFeeds.clear()
      stripFeeds.clear()
      if (backgroundController) backgroundController.abort()
      backgroundController = null
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
  return store
}
