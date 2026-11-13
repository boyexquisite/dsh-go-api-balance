// 面板展示层：中英文案、视图 v2/v1、面板数据。纯函数。
import {
  formatAmount,
  formatClock,
  formatDateTime,
  formatDetailValue,
  formatUsage,
  symbolForCurrency,
} from './format.js'

// 表单字段的视图上限（App 单次提交 ≤4 KiB，长文本字段收紧过，见报告）。
export const FORM_LIMITS = Object.freeze({
  url: 380,
  loginUrl: 260,
  secret: 600,
  username: 80,
  tokenPath: 80,
  tokenHeader: 48,
  tokenPrefix: 24,
  secretHeader: 48,
  secretParam: 48,
  balancePath: 100,
  currencyPath: 80,
  headersText: 180,
  bodyText: 180,
  detailText: 280,
  usageUrl: 280,
  usageArrayPath: 40,
  usageFieldsText: 120,
  extraUrl: 240,
  extraFieldsText: 100,
  siteBase: 300,
  name: 24,
  symbol: 8,
})

const AUTH_ORDER = ['bearer', 'header', 'query', 'cookie', 'basic', 'login']
const PRESET_VALUES = ['custom', 'deepseek', 'newapi', 'oneapi', 'kimi', 'mimo', 'openrouter', 'openai-cost', 'anthropic-cost', 'opencode-go', 'commandcode']
const MAX_DETAILS = 6
const MAX_ROWS = 24

const ZH = {
  title: 'API 余额',
  refresh: '刷新',
  add: '添加服务',
  edit: '编辑',
  delete: '删除',
  save: '保存',
  cancel: '取消',
  emptyTitle: '还没有服务',
  emptyMessage: '添加一个接口地址和密钥，就能在这里看余额。',
  noServices: '还没有服务',
  noSelection: '先选一个服务',
  notFetched: '还没查过',
  disabled: '已停用',
  ok: '成功',
  fail: '失败',
  deleteConfirmQuestion: '确认删除？',
  untitled: '未命名服务',
  hiddenCards: (n) => `还有 ${n} 家服务未显示（面板空间有限）`,
  tabCommonLabel: '常用',
  tabAdvancedLabel: '高级',
  chooseTemplate: '选择服务类型',
  templateDeepseekSub: '只填 API Key，余额自动读',
  templateRelaySub: 'new-api 或 one-api 旧站；填站点地址 + 令牌，余额/用量自动读',
  templateOpenrouterSub: '只填 API Key，显示余额和今日/本月花费',
  templateCostSub: 'OpenAI 或 Claude；要组织 Admin key，只显示本月花费',
  templateCodingSub: 'OpenCode Go 或 Command Code；只填 API Key，显示订阅剩余',
  templateCustomSub: '自己的接口，需要填地址和字段路径',
  kimiCaption: '自动：/v1/users/me/balance · 区域决定国内 .cn / 海外 .ai',
  mimoCaption: '自动：/v1/platform/balance',
  openrouterCaption: '自动：/api/v1/key · 显示今日/本月花费',
  costCaption: '要组织 Admin key · 只显示本月花费，不是余额；选 OpenAI 或 Claude',
  codingCaption: '自动读订阅额度/剩余百分比和重置日期（编码 Agent 订阅，不是余额）',
  deepseekCaption: '自动：/user/balance · 只显示余额',
  relayCaption: '填站点根地址或 OpenAI 接入地址（含 /v1 会自动去掉）；new-api 用 /api/data/self 看近 7 天用量，one-api 旧站用 /api/user/dashboard',
  relayKindLabel: '站点类型',
  presetLabel: '平台',
  relayNewapiLabel: 'new-api（推荐）',
  relayOneapiLabel: 'one-api（旧站）',
  costOpenaiLabel: 'OpenAI',
  costClaudeLabel: 'Claude',
  codingOpencodeLabel: 'OpenCode Go',
  codingCommandLabel: 'Command Code',
  siteRequired: '请填站点地址',
  siteInvalid: '站点地址要以 http:// 或 https:// 开头',
  balancePathHint: '点保存后可回来改；或按原始 JSON 对照',
  refreshFailed: '刷新失败，稍后再试',
  authNames: {
    bearer: 'Bearer 令牌',
    header: '自定义请求头',
    query: '查询参数',
    cookie: 'Cookie',
    basic: '账号密码（Basic）',
    login: '先登录取令牌',
  },
  presets: [
    { label: 'DeepSeek 官方', value: 'deepseek' },
    { label: 'new-api / one-api 中转', value: 'newapi' },
    { label: 'OpenRouter', value: 'openrouter' },
    { label: 'OpenAI / Claude 花费', value: 'openai-cost' },
    { label: 'OpenCode Go / Command Code', value: 'opencode-go' },
    { label: '自定义', value: 'custom' },
  ],
  fields: {
    name: '名称',
    url: '接口地址',
    method: '请求方法',
    authType: '鉴权方式',
    secret: '密钥 / 令牌',
    secretHeader: '密钥请求头',
    secretParam: '密钥参数名',
    username: '用户名',
    loginUrl: '登录地址',
    tokenPath: '令牌字段路径',
    tokenHeader: '令牌请求头',
    tokenPrefix: '令牌前缀',
    balancePath: '余额字段路径',
    currencyPath: '币种字段路径',
    detailText: '明细字段（每行 标签=路径）',
    divisor: '除数',
    multiplier: '乘数',
    symbol: '货币符号',
    decimals: '小数位',
    headersText: '额外请求头（JSON）',
    bodyText: '请求体（JSON）',
    enabled: '启用',
    usageUrl: '用量接口地址（支持 {7d} / {now}）',
    usageArrayPath: '用量数组路径',
    usageFieldsText: '用量字段（每行 标签=路径）',
    usageScale: '用量按余额单位换算',
    extraUrl: '附加信息地址（可选，订阅等）',
    extraFieldsText: '附加信息字段（每行 标签=路径）',
    siteBase: '站点地址',
    region: '区域',
    autoUnit: '自动识别站点货币（推荐）',
  },
  secretPlaceholder: '已保存，留空不改',
  secretPlaceholderNew: '填密钥或令牌',
  detailPlaceholder: '充值余额=balance_infos[0].topped_up_balance',
  usageUrlPlaceholder: 'https://…/api/data/self?start_timestamp={7d}&end_timestamp={now}',
  usageArrayPathPlaceholder: 'data',
  usageFieldsPlaceholder: '标签=路径，每行一条，最多 4 条',
  extraUrlPlaceholder: 'https://…/api/subscription/self',
  extraFieldsPlaceholder: '订阅剩余=a - b，每行一条，最多 4 条',
  siteBasePlaceholder: 'https://sta1n.ai',
  upgradeHint: '当前 App 版本较旧，只能查看余额。升级 App 后可编辑服务。',
  pendingRefresh: '正在刷新',
  refreshed: (n) => `已更新 ${n} 家`,
  saved: '已保存',
  deleted: '已删除',
  saveFailed: '保存失败，检查主机存储',
  secretRequired: '换了站点或平台，请重新填密钥',
  formClipWarn: '有旧字段超过表单长度上限，已截断显示；保存前请检查（或直接改主机上的 config.json）。',
  tooMany: '最多 24 家服务',
  confirmDelete: (name) => `确定删除「${name || ''}」？`,
}

const EN = {
  title: 'API balance',
  refresh: 'Refresh',
  add: 'Add service',
  edit: 'Edit',
  delete: 'Delete',
  save: 'Save',
  cancel: 'Cancel',
  emptyTitle: 'No services yet',
  emptyMessage: 'Add an endpoint and a key to see balances here.',
  noServices: 'No services yet',
  noSelection: 'Pick a service first',
  notFetched: 'Not fetched',
  disabled: 'Disabled',
  ok: 'OK',
  fail: 'Failed',
  deleteConfirmQuestion: 'Delete?',
  untitled: 'Untitled service',
  hiddenCards: (n) => `${n} more services hidden (panel space limit)`,
  tabCommonLabel: 'Common',
  tabAdvancedLabel: 'Advanced',
  chooseTemplate: 'Choose a service type',
  templateDeepseekSub: 'Just the API key; balance loads automatically',
  templateRelaySub: 'new-api or an older one-api site; site URL and token load balance and usage',
  templateOpenrouterSub: 'Just the API key; balance plus today and month spend',
  templateCostSub: 'OpenAI or Claude; needs an organization Admin key, monthly spend only',
  templateCodingSub: 'OpenCode Go or Command Code; just the API key, subscription left',
  templateCustomSub: 'Your own endpoint; fill the URL and field paths',
  kimiCaption: 'Automatic: /v1/users/me/balance · region picks .cn or .ai',
  mimoCaption: 'Automatic: /v1/platform/balance',
  openrouterCaption: 'Automatic: /api/v1/key · today and month spend',
  costCaption: 'Organization Admin key needed · monthly spend only, not a balance; pick OpenAI or Claude',
  codingCaption: 'Reads subscription quota/remaining percentages and reset dates (coding-agent subscription, not a balance)',
  deepseekCaption: 'Automatic: /user/balance · balance only',
  relayCaption: 'Site root or OpenAI base URL (/v1 is removed automatically); new-api usage comes from /api/data/self, older one-api from /api/user/dashboard',
  relayKindLabel: 'Site type',
  presetLabel: 'Platform',
  relayNewapiLabel: 'new-api (recommended)',
  relayOneapiLabel: 'one-api (legacy)',
  costOpenaiLabel: 'OpenAI',
  costClaudeLabel: 'Claude',
  codingOpencodeLabel: 'OpenCode Go',
  codingCommandLabel: 'Command Code',
  siteRequired: 'Enter the site URL',
  siteInvalid: 'Site URL must start with http:// or https://',
  balancePathHint: 'You can come back after saving, or compare with the raw JSON',
  refreshFailed: 'Refresh failed, try again later',
  authNames: {
    bearer: 'Bearer token',
    header: 'Custom header',
    query: 'Query parameter',
    cookie: 'Cookie',
    basic: 'Username / password (Basic)',
    login: 'Login for a token',
  },
  presets: [
    { label: 'DeepSeek official', value: 'deepseek' },
    { label: 'new-api / one-api relay', value: 'newapi' },
    { label: 'OpenRouter', value: 'openrouter' },
    { label: 'OpenAI / Claude spend', value: 'openai-cost' },
    { label: 'OpenCode Go / Command Code', value: 'opencode-go' },
    { label: 'Custom', value: 'custom' },
  ],
  fields: {
    name: 'Name',
    url: 'Endpoint URL',
    method: 'Method',
    authType: 'Auth',
    secret: 'Key / token',
    secretHeader: 'Key header',
    secretParam: 'Key parameter',
    username: 'Username',
    loginUrl: 'Login URL',
    tokenPath: 'Token path',
    tokenHeader: 'Token header',
    tokenPrefix: 'Token prefix',
    balancePath: 'Balance path',
    currencyPath: 'Currency path',
    detailText: 'Detail fields (label=path per line)',
    divisor: 'Divisor',
    multiplier: 'Multiplier',
    symbol: 'Currency symbol',
    decimals: 'Decimals',
    headersText: 'Extra headers (JSON)',
    bodyText: 'Request body (JSON)',
    enabled: 'Enabled',
    usageUrl: 'Usage URL (supports {7d} / {now})',
    usageArrayPath: 'Usage array path',
    usageFieldsText: 'Usage fields (label=path per line)',
    usageScale: 'Usage uses balance units',
    extraUrl: 'Extra info URL (optional, e.g. subscription)',
    extraFieldsText: 'Extra info fields (label=path per line)',
    siteBase: 'Site URL',
    region: 'Region',
    autoUnit: 'Detect site currency (recommended)',
  },
  secretPlaceholder: 'Saved, leave blank to keep',
  secretPlaceholderNew: 'Enter key or token',
  detailPlaceholder: 'topped_up=balance_infos[0].topped_up_balance',
  usageUrlPlaceholder: 'https://…/api/data/self?start_timestamp={7d}&end_timestamp={now}',
  usageArrayPathPlaceholder: 'data',
  usageFieldsPlaceholder: 'label=path, one per line, at most 4',
  extraUrlPlaceholder: 'https://…/api/subscription/self',
  extraFieldsPlaceholder: 'remaining=a - b, one per line, at most 4',
  siteBasePlaceholder: 'https://sta1n.ai',
  upgradeHint: 'This app is older and can only show balances. Update the app to edit services.',
  pendingRefresh: 'Refreshing',
  refreshed: (n) => `Updated ${n} services`,
  saved: 'Saved',
  deleted: 'Deleted',
  saveFailed: 'Save failed, check host storage',
  secretRequired: 'Site or platform changed — enter the key again',
  formClipWarn: 'Some existing values exceeded the form limits and were truncated; check them before saving (or edit config.json on the host).',
  tooMany: 'At most 24 services',
  confirmDelete: (name) => `Delete "${name || ''}"?`,
}

export function words (locale) {
  return String(locale || 'zh').toLowerCase().startsWith('en') ? EN : ZH
}

export function hasComponent (caps, name) {
  return Boolean(caps && Array.isArray(caps.components) && caps.components.includes(name))
}

export function emptyForm () {
  return {
    preset: 'custom',
    name: '',
    url: '',
    method: 'GET',
    authType: 'bearer',
    secret: '',
    secretSet: false,
    secretHeader: 'X-API-Key',
    secretParam: 'key',
    username: '',
    loginUrl: '',
    tokenPath: 'data.token',
    tokenHeader: 'Authorization',
    tokenPrefix: 'Bearer ',
    headersText: '',
    bodyText: '',
    balancePath: '',
    currencyPath: '',
    detailText: '',
    divisor: 1,
    multiplier: 1,
    symbol: '¥',
    decimals: 2,
    enabled: true,
    usageUrl: '',
    usageMethod: 'GET',
    usageArrayPath: '',
    usageFieldsText: '',
    usageScale: false,
    extraUrl: '',
    extraFieldsText: '',
    siteBase: '',
    region: 'cn',
    autoUnit: true,
    // 编辑时若有旧值超过表单上限被截断，置 true 让视图给出提示。
    clipped: false,
  }
}

function text (value) {
  return typeof value === 'string' ? value : ''
}

function detailTextOf (rows) {
  if (!Array.isArray(rows)) return ''
  return rows
    .slice(0, MAX_DETAILS)
    .filter((row) => row && typeof row === 'object')
    .map((row) => `${text(row.label)}=${text(row.path)}`)
    .join('\n')
}

export { detailTextOf }

// '标签=路径' 多行文本 -> detailPaths（交给 core 校验，这里只拆分）。
export function parseDetailText (value) {
  if (typeof value !== 'string') return []
  const rows = []
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const index = line.indexOf('=')
    if (index < 0) {
      rows.push({ label: '', path: line })
      continue
    }
    rows.push({ label: line.slice(0, index).trim(), path: line.slice(index + 1).trim() })
  }
  return rows
}

// 已保存的 provider -> 表单草稿：密钥一律不带出，只标记 secretSet。
export function providerForm (provider) {
  const source = provider && typeof provider === 'object' ? provider : {}
  const form = emptyForm()
  for (const key of Object.keys(form)) {
    if (key === 'secret' || key === 'secretSet' || key === 'detailText') continue
    if (source[key] !== undefined && source[key] !== null) form[key] = source[key]
  }
  form.preset = PRESET_VALUES.includes(source.preset) ? source.preset : 'custom'
  form.secret = ''
  form.secretSet = true
  form.detailText = detailTextOf(source.detailPaths)
  form.usageFieldsText = detailTextOf(source.usageFields)
  form.extraFieldsText = detailTextOf(source.extraFields)
  form.siteBase = siteBaseOf(source.url)
  form.region = typeof source.url === 'string' && source.url.includes('moonshot.ai') ? 'global' : 'cn'
  form.autoUnit = source.autoUnit === true
  form.enabled = source.enabled !== false
  // 老配置里的值可能超过当前 maxLength：预填时按上限截断，避免 App 拒提交/静默截断。
  form.clipped = false
  for (const [key, max] of Object.entries(FORM_LIMITS)) {
    if (typeof form[key] === 'string' && [...form[key]].length > max) {
      form[key] = [...form[key]].slice(0, max).join('')
      form.clipped = true
    }
  }
  return form
}

const SITE_SUFFIXES = ['/api/user/self', '/api/data/self']

// new-api 站点地址归一化：剥掉已知后台路径与 OpenAI 接入地址的 /v1，保留反代子路径。
export function normalizeSiteBase (input) {
  let value = typeof input === 'string' ? input.trim() : ''
  if (value === '') return ''
  value = value.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(value)) return value
  let url
  try {
    url = new URL(value)
  } catch {
    return value
  }
  let path = url.pathname.replace(/\/+$/, '')
  const stripSuffix = () => {
    const lower = path.toLowerCase()
    for (const suffix of SITE_SUFFIXES) {
      if (lower.endsWith(suffix)) {
        path = path.slice(0, -suffix.length).replace(/\/+$/, '')
        return true
      }
    }
    return false
  }
  stripSuffix()
  path = path.replace(/\/v1(?:\/.*)?$/i, '')
  path = path.replace(/\/+$/, '')
  stripSuffix()
  return `${url.protocol}//${url.host}${path}`
}

// 编辑反推：先剥已知后台后缀，再走归一化（旧数据里带 /v1 的地址也能修回根地址）。
function siteBaseOf (url) {
  let value = typeof url === 'string' ? url.trim() : ''
  if (value === '') return ''
  const lower = value.toLowerCase()
  for (const suffix of SITE_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      value = value.slice(0, -suffix.length)
      break
    }
  }
  return normalizeSiteBase(value)
}

// 模板草稿（presetDraft 的输出）-> 表单值：数组拼文本、siteBase 留空等用户填。
export function draftForm (draft) {
  const source = draft && typeof draft === 'object' ? draft : {}
  const form = emptyForm()
  for (const key of Object.keys(form)) {
    if (key === 'secret' || key === 'secretSet' || key === 'detailText' || key === 'usageFieldsText' || key === 'extraFieldsText' || key === 'siteBase') continue
    if (source[key] !== undefined && source[key] !== null) form[key] = source[key]
  }
  form.preset = PRESET_VALUES.includes(source.preset) ? source.preset : 'custom'
  form.secret = typeof source.secret === 'string' ? source.secret : ''
  form.secretSet = false
  form.detailText = detailTextOf(source.detailPaths)
  form.usageFieldsText = detailTextOf(source.usageFields)
  form.extraFieldsText = detailTextOf(source.extraFields)
  form.siteBase = ''
  form.region = source.region === 'global' ? 'global' : 'cn'
  form.autoUnit = source.autoUnit === true
  return form
}

export function createState (overrides = {}) {
  const state = {
    config: {
      v: 1,
      providers: [],
      settings: { refreshOnOpen: true, timeoutMs: 12000 },
    },
    results: {},
    formOpen: false,
    pickTemplate: false,
    editingId: '',
    // 打开表单时的模板（切换平台下拉时不变），保存时用来判断默认名/符号要不要跟着换。
    presetOrigin: '',
    form: emptyForm(),
    menuId: '',
    confirmDelete: null,
    busy: false,
    locale: 'zh-CN',
    now: null,
    viewServed: false,
    // true = 现代 App（有 form/textField/tabs），panelData 不再生成 v1 用的 rows。
    v2: false,
    ...(overrides && typeof overrides === 'object' ? overrides : {}),
  }
  return state
}

function bind (path) {
  return { $: `data.${path}` }
}

function providerList (state) {
  const providers = state && state.config && Array.isArray(state.config.providers) ? state.config.providers : []
  return providers.slice(0, MAX_ROWS)
}

function resultOf (state, provider) {
  if (!state || !state.results || typeof state.results !== 'object') return null
  const result = state.results[provider.id]
  return result && typeof result === 'object' ? result : null
}

function clockNow (state) {
  const now = state && state.now
  if (typeof now === 'function') {
    const value = now()
    return Number.isFinite(Number(value)) ? Number(value) : Date.now()
  }
  return Number.isFinite(Number(now)) && Number(now) > 0 ? Number(now) : Date.now()
}

// 有效单位：自动识别的 result.unit 优先，否则用 provider 自己的换算/符号/小数位。
export function unitOf (provider, result) {
  const source = provider && typeof provider === 'object' ? provider : {}
  const unit = result && result.unit && typeof result.unit === 'object' ? result.unit : null
  const pick = (key) => (unit && unit[key] !== undefined && unit[key] !== null ? unit[key] : source[key])
  // 配了 currencyPath 的服务按接口返回的币种代码选符号（DeepSeek 国际账号 USD 等）。
  const currencySymbol = source.currencyPath && result && typeof result.currency === 'string'
    ? symbolForCurrency(result.currency)
    : ''
  const symbol = unit && unit.symbol !== undefined && unit.symbol !== null
    ? unit.symbol
    : (currencySymbol || source.symbol)
  return {
    divisor: pick('divisor'),
    multiplier: pick('multiplier'),
    symbol,
    decimals: pick('decimals'),
    usageScale: source.usageScale === true,
  }
}

function usageSubtitle (provider, result, locale) {
  if (!result || !Array.isArray(result.usage)) return ''
  const unit = unitOf(provider, result)
  const parts = []
  for (const item of result.usage.slice(0, 2)) {
    if (!item || typeof item !== 'object') continue
    const figure = formatUsage(unit, item, locale)
    const label = text(item.label)
    parts.push(label === '' ? figure : `${label} ${figure}`)
  }
  return parts.join(' · ')
}

function clipSubtitle (value) {
  const chars = [...value]
  if (chars.length <= 60) return value
  return `${chars.slice(0, 59).join('')}…`
}

function rowOf (provider, result, w, now, locale) {
  const enabled = provider.enabled !== false
  const unit = unitOf(provider, result)
  let subtitle = w.notFetched
  let trailing = '—'
  let tone = 'muted'
  if (result) {
    subtitle = `${result.ok === true ? w.ok : w.fail} · ${formatDateTime(result.fetchedAt, now)}`
    const usage = usageSubtitle(provider, result, locale)
    if (usage !== '') subtitle = `${subtitle} · ${usage}`
    if (result.ok === true) {
      trailing = formatAmount(unit, result.balance)
      tone = 'good'
    } else {
      tone = 'bad'
    }
  }
  if (!enabled) {
    subtitle = w.disabled
    trailing = '—'
    tone = 'muted'
  }
  return {
    title: text(provider.name) || w.untitled,
    subtitle: clipSubtitle(subtitle),
    trailing,
    tone,
  }
}

function cardOf (provider, result, w, now, locale) {
  const enabled = provider.enabled !== false
  const unit = unitOf(provider, result)
  let status
  if (!enabled) status = w.disabled
  else if (!result) status = w.notFetched
  else status = `${result.ok === true ? w.ok : w.fail} · ${formatClock(result.fetchedAt)}`
  const slots = []
  if (enabled && result && Array.isArray(result.usage)) {
    for (const item of result.usage.slice(0, 2)) {
      if (!item || typeof item !== 'object') continue
      slots.push({ label: text(item.label), value: formatUsage(unit, item, locale) })
    }
  }
  return {
    name: text(provider.name) || w.untitled,
    // 停用的服务不展示旧余额/旧错误，避免误以为还在用。
    balance: enabled && result && result.ok === true ? formatAmount(unit, result.balance) : '—',
    usage0: slots[0] || null,
    usage1: slots[1] || null,
    status,
    error: enabled && result && result.ok === false ? text(result.error) || w.fail : '',
  }
}

// 面板数据模型：cards 与 providers 同序；密钥永不出现。
export function panelData (state, caps = {}) {
  const current = state && typeof state === 'object' ? state : createState()
  const w = words(caps && caps.locale ? caps.locale : current.locale)
  const locale = caps && caps.locale ? caps.locale : current.locale
  const now = clockNow(current)
  const providers = providerList(current)
  const data = {
    cards: providers.map((provider) => cardOf(provider, resultOf(current, provider), w, now, locale)),
    formOpen: current.formOpen === true,
    form: current.form && typeof current.form === 'object' ? current.form : emptyForm(),
  }
  // v1 老 App 的只读列表才需要 rows；v2 不生成，避免 24 家时 patch 超 16 KiB。
  if (current.v2 !== true) {
    data.rows = providers.map((provider) => rowOf(provider, resultOf(current, provider), w, now, locale))
  }
  return data
}

function textField (w, key, maxLength, extra = {}) {
  return {
    type: 'textField',
    label: w.fields[key],
    bind: `data.form.${key}`,
    maxLength,
    ...extra,
  }
}

function selectField (w, key, options, extra = {}) {
  return {
    type: 'select',
    label: w.fields[key],
    bind: `data.form.${key}`,
    options,
    ...extra,
  }
}

function numberField (w, key, extra = {}) {
  return {
    type: 'number',
    label: w.fields[key],
    bind: `data.form.${key}`,
    min: 0.000001,
    max: 1e12,
    ...extra,
  }
}

function authChoices (w) {
  return AUTH_ORDER.map((value) => ({ label: w.authNames[value], value }))
}

function secretField (w, form) {
  return textField(w, 'secret', FORM_LIMITS.secret, {
    required: form.secretSet !== true,
    placeholder: form.secretSet === true ? w.secretPlaceholder : w.secretPlaceholderNew,
  })
}

function nameField (w, required) {
  return textField(w, 'name', FORM_LIMITS.name, { required })
}

function formNode (w, fields) {
  return { type: 'form', submit: 'save', submitLabel: w.save, children: fields }
}

// 自定义服务：常用 / 高级两个页签。
function customFieldTabs (w, form) {
  const commonFields = [
    nameField(w, true),
    textField(w, 'url', FORM_LIMITS.url, { required: true }),
    selectField(w, 'method', ['GET', 'POST']),
    selectField(w, 'authType', authChoices(w)),
    secretField(w, form),
    textField(w, 'secretHeader', FORM_LIMITS.secretHeader),
    textField(w, 'secretParam', FORM_LIMITS.secretParam),
    textField(w, 'username', FORM_LIMITS.username),
    textField(w, 'loginUrl', FORM_LIMITS.loginUrl),
    textField(w, 'balancePath', FORM_LIMITS.balancePath, {
      required: true,
      placeholder: w.balancePathHint,
    }),
    textField(w, 'symbol', FORM_LIMITS.symbol),
  ]
  const advancedFields = [
    textField(w, 'tokenPath', FORM_LIMITS.tokenPath),
    textField(w, 'tokenHeader', FORM_LIMITS.tokenHeader),
    textField(w, 'tokenPrefix', FORM_LIMITS.tokenPrefix),
    textField(w, 'currencyPath', FORM_LIMITS.currencyPath),
    textField(w, 'detailText', FORM_LIMITS.detailText, {
      multiline: true,
      maxLines: 6,
      placeholder: w.detailPlaceholder,
    }),
    numberField(w, 'divisor'),
    numberField(w, 'multiplier'),
    { type: 'stepper', label: w.fields.decimals, bind: 'data.form.decimals', min: 0, max: 4, step: 1 },
    textField(w, 'headersText', FORM_LIMITS.headersText, { multiline: true, maxLines: 4 }),
    textField(w, 'bodyText', FORM_LIMITS.bodyText, { multiline: true, maxLines: 4 }),
    textField(w, 'usageUrl', FORM_LIMITS.usageUrl, { placeholder: w.usageUrlPlaceholder }),
    textField(w, 'usageArrayPath', FORM_LIMITS.usageArrayPath, { placeholder: w.usageArrayPathPlaceholder }),
    textField(w, 'usageFieldsText', FORM_LIMITS.usageFieldsText, {
      multiline: true,
      maxLines: 4,
      placeholder: w.usageFieldsPlaceholder,
    }),
    { type: 'toggle', label: w.fields.usageScale, bind: 'data.form.usageScale' },
    textField(w, 'extraUrl', FORM_LIMITS.extraUrl, { placeholder: w.extraUrlPlaceholder }),
    textField(w, 'extraFieldsText', FORM_LIMITS.extraFieldsText, {
      multiline: true,
      maxLines: 4,
      placeholder: w.extraFieldsPlaceholder,
    }),
    { type: 'toggle', label: w.fields.enabled, bind: 'data.form.enabled' },
  ]
  return [{
    type: 'tabs',
    items: [
      { label: w.tabCommonLabel, children: commonFields },
      { label: w.tabAdvancedLabel, children: advancedFields },
    ],
  }]
}

// 按 preset 只显示关键字段；模板上方给一行 caption 说明自动化了什么。
function formViews (state, w) {
  const form = state.form && typeof state.form === 'object' ? state.form : emptyForm()
  switch (form.preset) {
    case 'deepseek':
      return [
        { type: 'text', text: w.deepseekCaption, style: { size: 'caption', color: 'gray' } },
        formNode(w, [nameField(w, false), secretField(w, form)]),
      ]
    case 'kimi':
      return [
        { type: 'text', text: w.kimiCaption, style: { size: 'caption', color: 'gray' } },
        formNode(w, [
          nameField(w, false),
          selectField(w, 'region', [
            { label: '国内 (.cn)', value: 'cn' },
            { label: '海外 (.ai)', value: 'global' },
          ]),
          secretField(w, form),
        ]),
      ]
    case 'mimo':
      return [
        { type: 'text', text: w.mimoCaption, style: { size: 'caption', color: 'gray' } },
        formNode(w, [nameField(w, false), secretField(w, form)]),
      ]
    case 'openrouter':
      return [
        { type: 'text', text: w.openrouterCaption, style: { size: 'caption', color: 'gray' } },
        formNode(w, [nameField(w, false), secretField(w, form)]),
      ]
    case 'openai-cost':
    case 'anthropic-cost':
      return [
        { type: 'text', text: w.costCaption, style: { size: 'caption', color: 'gray' } },
        formNode(w, [
          nameField(w, false),
          selectField(w, 'preset', [
            { label: w.costOpenaiLabel, value: 'openai-cost' },
            { label: w.costClaudeLabel, value: 'anthropic-cost' },
          ], { label: w.presetLabel, onChange: 'preset-change' }),
          secretField(w, form),
        ]),
      ]
    case 'opencode-go':
    case 'commandcode':
      return [
        { type: 'text', text: w.codingCaption, style: { size: 'caption', color: 'gray' } },
        formNode(w, [
          nameField(w, false),
          selectField(w, 'preset', [
            { label: w.codingOpencodeLabel, value: 'opencode-go' },
            { label: w.codingCommandLabel, value: 'commandcode' },
          ], { label: w.presetLabel, onChange: 'preset-change' }),
          secretField(w, form),
        ]),
      ]
    case 'newapi':
    case 'oneapi': {
      const fields = [
        nameField(w, false),
        selectField(w, 'preset', [
          { label: w.relayNewapiLabel, value: 'newapi' },
          { label: w.relayOneapiLabel, value: 'oneapi' },
        ], { label: w.relayKindLabel, onChange: 'preset-change' }),
        textField(w, 'siteBase', FORM_LIMITS.siteBase, {
          required: true,
          placeholder: w.siteBasePlaceholder,
        }),
        secretField(w, form),
        {
          type: 'toggle',
          label: w.fields.autoUnit,
          bind: 'data.form.autoUnit',
          onChange: 'auto-unit',
        },
      ]
      // 自动识别货币时不需要手填；关掉后符号/除数/乘数都可改（站点改过 quota_per_unit 也能对）。
      if (form.autoUnit !== true) {
        fields.push(textField(w, 'symbol', FORM_LIMITS.symbol))
        fields.push(numberField(w, 'divisor'))
        fields.push(numberField(w, 'multiplier'))
      }
      return [
        { type: 'text', text: w.relayCaption, style: { size: 'caption', color: 'gray' } },
        formNode(w, fields),
      ]
    }
    default:
      return [formNode(w, customFieldTabs(w, form))]
  }
}

// 「添加服务」第一步：选服务类型。
function templatePickerView (state, w) {
  if (state.pickTemplate !== true) return []
  const subtitles = {
    deepseek: w.templateDeepseekSub,
    newapi: w.templateRelaySub,
    openrouter: w.templateOpenrouterSub,
    'openai-cost': w.templateCostSub,
    'opencode-go': w.templateCodingSub,
    custom: w.templateCustomSub,
  }
  return [
    { type: 'text', text: w.chooseTemplate, style: { size: 'title', weight: 'semibold' } },
    {
      type: 'list',
      items: w.presets.map((preset) => ({
        title: preset.label,
        subtitle: subtitles[preset.value],
        action: { id: 'choose-template', args: { preset: preset.value } },
      })),
    },
    // 类型列表必须能收起：只给列表不给出口的话，面板一打开就挂着一长列模板。
    { type: 'actions', items: [{ label: w.cancel, icon: 'clear', action: 'form-cancel' }] },
  ]
}

// 卡片名称用浅亮紫 + 加粗；列表行的 title 不能上色，所以名称单独用文本节点，
// 菜单触发改挂到状态行（右侧箭头），点状态行展开「编辑 / 删除」。
const CARD_NAME_COLOR = '#8B5CF6'

function cardView (provider, index, state, w) {
  const card = `cards[${index}]`
  const result = resultOf(state, provider)
  const unit = unitOf(provider, result)
  // 卡片上最多显示 2 条附加信息：先放订阅/附加请求（extra），再补明细（details）。
  // 只用 key/令牌就能拿到的额外字段（充值、请求数、token、重置日期等）一眼能看到，完整列表在菜单里。
  const extraLine = (() => {
    if (!result || provider.enabled === false) return ''
    const items = []
    const push = (list) => {
      if (!Array.isArray(list)) return
      for (const item of list) {
        if (items.length >= 2) return
        if (!item || typeof item !== 'object') continue
        const label = text(item.label)
        const value = item.value
        if (label === '' || value === null || value === undefined || value === '') continue
        items.push(`${label} ${formatDetailValue(unit, value, item.kind)}`)
      }
    }
    push(result.extra)
    push(result.details)
    return items.join(' · ')
  })()
  const statusItem = { title: bind(`${card}.status`) }
  // 表单打开时状态行不可点（省得叠一个菜单）。
  if (state.formOpen !== true) statusItem.action = { id: 'card-menu', args: { id: provider.id } }
  const children = [
    {
      type: 'text',
      text: text(provider.name) || w.untitled,
      style: { size: 'subtitle', weight: 'bold', color: CARD_NAME_COLOR },
    },
    { type: 'list', items: [statusItem] },
    { type: 'text', text: bind(`${card}.balance`), style: { size: 'title', weight: 'bold' } },
  ]
  // 用量用大号 metric（参考 Token 用量插件）：配置的 usageFields 有几个就预留几个槽位，
  // 实际渲染取「配置数」与「本次取到的 usage 项数」的较小值（取不到的不画空指标）。
  const configured = Array.isArray(provider.usageFields) ? provider.usageFields.length : 0
  const available = result && Array.isArray(result.usage) ? result.usage.length : 0
  const usageCount = Math.min(configured, available, 2)
  if (usageCount > 0) {
    const metrics = []
    for (let slot = 0; slot < usageCount; slot++) {
      metrics.push({
        type: 'metric',
        label: bind(`${card}.usage${slot}.label`),
        value: bind(`${card}.usage${slot}.value`),
      })
    }
    if (metrics.length === 1) children.push(metrics[0])
    else children.push({ type: 'row', style: { columns: 'equal' }, children: metrics })
  }
  if (extraLine !== '') {
    children.push({ type: 'text', text: extraLine, style: { size: 'caption' } })
  }
  if (provider.enabled !== false && result && result.ok === false) {
    children.push({ type: 'callout', tone: 'bad', text: bind(`${card}.error`) })
  }
  const confirming = state.confirmDelete && typeof state.confirmDelete === 'object' &&
    state.confirmDelete.id === provider.id
  const menuOpen = state.menuId === provider.id
  if (state.formOpen !== true && confirming) {
    children.push({
      type: 'list',
      items: [
        { title: w.deleteConfirmQuestion, tone: 'bad', action: { id: 'card-delete-confirm', args: { id: provider.id } } },
        { title: w.cancel, action: { id: 'card-delete-cancel', args: { id: provider.id } } },
      ],
    })
  } else if (state.formOpen !== true && menuOpen) {
    const infoRows = []
    if (result && Array.isArray(result.details)) {
      for (const item of result.details) {
        if (!item || typeof item !== 'object') continue
        const label = text(item.label)
        const value = item.value
        if (label === '' || value === null || value === undefined || value === '') continue
        infoRows.push({ title: label, trailing: formatDetailValue(unit, value, item.kind) })
      }
    }
    if (result && Array.isArray(result.extra)) {
      for (const item of result.extra) {
        if (!item || typeof item !== 'object') continue
        const label = text(item.label)
        if (label === '') continue
        infoRows.push({ title: label, trailing: formatDetailValue(unit, item.value, item.kind) })
      }
    }
    children.push({
      type: 'list',
      items: [
        ...infoRows,
        { title: w.edit, action: { id: 'card-edit', args: { id: provider.id } } },
        { title: w.delete, tone: 'bad', action: { id: 'card-delete', args: { id: provider.id } } },
      ],
    })
  }
  return { type: 'stack', style: { card: 'surface', padding: 'M', gap: 'S' }, children }
}

function countNodes (value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countNodes(item), 0)
  if (!value || typeof value !== 'object') return 0
  let count = typeof value.type === 'string' ? 1 : 0
  for (const item of Object.values(value)) count += countNodes(item)
  return count
}

function emptyView (w, caps) {
  if (hasComponent(caps, 'emptyState')) {
    return {
      type: 'emptyState',
      title: w.emptyTitle,
      message: w.emptyMessage,
      icon: 'wallet',
      action: { label: w.add, icon: 'add', action: 'add' },
    }
  }
  return { type: 'callout', tone: 'info', text: w.emptyMessage }
}

// 视图节点预算（App 上限 120，留出 tabs 等解析余量）。
const VIEW_NODE_BUDGET = 112

function panelViewV2 (state, w, caps) {
  const providers = providerList(state)
  const tail = [...templatePickerView(state, w)]
  if (state.formOpen === true) {
    if (state.form && typeof state.form === 'object' && state.form.clipped === true) {
      tail.push({ type: 'text', text: w.formClipWarn, style: { size: 'caption', color: 'orange' } })
    }
    tail.push(...formViews(state, w))
    tail.push({ type: 'actions', items: [{ label: w.cancel, icon: 'clear', action: 'form-cancel' }] })
  }
  // 底部固定入口：App 的 actions 竖排，所以刷新/添加始终放在最下面。
  tail.push({
    type: 'actions',
    items: [
      { label: w.refresh, icon: 'refresh', action: 'refresh' },
      { label: w.add, icon: 'add', action: 'add' },
    ],
  })
  // 一张卡片约 7–10 个节点；按预算尽量多显示，其余给一行提示。
  let budget = VIEW_NODE_BUDGET - 1 - countNodes(tail) - 1
  const cards = []
  let hidden = 0
  for (let index = 0; index < providers.length; index++) {
    const card = cardView(providers[index], index, state, w)
    const cost = countNodes(card)
    if (budget - cost < 0) {
      hidden = providers.length - index
      break
    }
    cards.push(card)
    budget -= cost
  }
  const children = []
  if (providers.length === 0) {
    children.push(emptyView(w, caps))
  } else {
    children.push(...cards)
    if (hidden > 0) {
      children.push({ type: 'text', text: w.hiddenCards(hidden), style: { size: 'caption', color: 'gray' } })
    }
  }
  children.push(...tail)
  return {
    v: 2,
    accent: 'app',
    type: 'stack',
    style: { gap: 'M' },
    children,
  }
}

// 老 App（缺 form/textField/tabs）退成 v1 只读列表摘要 + 升级提示。
function panelViewV1 (state, w) {
  const providers = providerList(state)
  const children = [{
    type: 'actions',
    items: [{ label: w.refresh, icon: 'refresh', action: 'refresh' }],
  }]
  if (providers.length === 0) {
    children.push({ type: 'callout', tone: 'info', text: w.emptyMessage })
  } else {
    children.push({ type: 'list', items: bind('rows') })
  }
  children.push({ type: 'callout', tone: 'info', text: w.upgradeHint })
  return { type: 'stack', children }
}

export function panelView (state, caps = {}) {
  const current = state && typeof state === 'object' ? state : createState()
  const w = words(caps && caps.locale ? caps.locale : current.locale)
  const editable = hasComponent(caps, 'form') && hasComponent(caps, 'textField') && hasComponent(caps, 'tabs')
  return editable ? panelViewV2(current, w, caps) : panelViewV1(current, w)
}
