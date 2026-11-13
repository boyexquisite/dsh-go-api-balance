// 面板展示层：中英文案、视图 v2/v1、面板数据、状态条数据。纯函数。
import {
  formatAmount,
  formatClock,
  formatDateTime,
  formatUsage,
} from './format.js'

// 表单字段的视图上限（App 单次提交 ≤4 KiB，长文本字段收紧过，见报告）。
export const FORM_LIMITS = Object.freeze({
  url: 400,
  loginUrl: 300,
  secret: 600,
  username: 80,
  tokenPath: 80,
  tokenHeader: 48,
  tokenPrefix: 24,
  secretHeader: 48,
  secretParam: 48,
  balancePath: 100,
  currencyPath: 80,
  headersText: 200,
  bodyText: 200,
  detailText: 300,
  usageUrl: 300,
  usageArrayPath: 40,
  usageFieldsText: 120,
  siteBase: 300,
  name: 24,
  symbol: 8,
})

const AUTH_ORDER = ['bearer', 'header', 'query', 'cookie', 'basic', 'login']
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
  close: '关闭',
  emptyTitle: '还没有服务',
  emptyMessage: '添加一个接口地址和密钥，就能在这里看余额。',
  noServices: '还没有服务',
  noSelection: '先选一个服务',
  notFetched: '还没查过',
  disabled: '已停用',
  ok: '成功',
  fail: '失败',
  test: '测试',
  untitled: '未命名服务',
  hiddenCards: (n) => `还有 ${n} 家服务未显示（面板空间有限）`,
  tabCommonLabel: '常用',
  tabAdvancedLabel: '高级',
  chooseTemplate: '选择服务类型',
  templateDeepseekSub: '只填 API Key，余额自动读',
  templateNewapiSub: '填站点地址和访问令牌，余额/用量自动读',
  templateCustomSub: '自己的接口，需要填地址和字段路径',
  deepseekCaption: '自动：/user/balance · 只显示余额',
  newapiCaption: '填站点根地址，或 OpenAI 接入地址（含 /v1 也行，会自动去掉）',
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
    siteBase: '站点地址',
  },
  secretPlaceholder: '已保存，留空不改',
  secretPlaceholderNew: '填密钥或令牌',
  detailPlaceholder: '充值余额=balance_infos[0].topped_up_balance',
  usageUrlPlaceholder: 'https://…/api/data/self?start_timestamp={7d}&end_timestamp={now}',
  usageArrayPathPlaceholder: 'data',
  usageFieldsPlaceholder: '标签=路径，每行一条，最多 4 条',
  siteBasePlaceholder: 'https://sta1n.ai',
  upgradeHint: '当前 App 版本较旧，只能查看余额。升级 App 后可编辑服务。',
  testTitle: '接口原始返回（已脱敏）',
  noPreview: '没有可预览的返回内容',
  testOk: '测试成功',
  testFailed: '测试失败，详情见下方',
  pendingRefresh: '正在刷新',
  pendingTest: '正在测试',
  refreshed: (n) => `已更新 ${n} 家`,
  saved: '已保存',
  deleted: '已删除',
  saveFailed: '保存失败，检查主机存储',
  tooMany: '最多 24 家服务',
  confirmDelete: (name) => `确定删除「${name || ''}」？`,
  confirmLabel: '确认删除',
  cancelLabel: '取消',
}

const EN = {
  title: 'API balance',
  refresh: 'Refresh',
  add: 'Add service',
  edit: 'Edit',
  delete: 'Delete',
  save: 'Save',
  cancel: 'Cancel',
  close: 'Close',
  emptyTitle: 'No services yet',
  emptyMessage: 'Add an endpoint and a key to see balances here.',
  noServices: 'No services yet',
  noSelection: 'Pick a service first',
  notFetched: 'Not fetched',
  disabled: 'Disabled',
  ok: 'OK',
  fail: 'Failed',
  test: 'Test',
  untitled: 'Untitled service',
  hiddenCards: (n) => `${n} more services hidden (panel space limit)`,
  tabCommonLabel: 'Common',
  tabAdvancedLabel: 'Advanced',
  chooseTemplate: 'Choose a service type',
  templateDeepseekSub: 'Just the API key; balance loads automatically',
  templateNewapiSub: 'Site URL and token; balance and usage load automatically',
  templateCustomSub: 'Your own endpoint; fill the URL and field paths',
  deepseekCaption: 'Automatic: /user/balance · balance only',
  newapiCaption: 'Site root or OpenAI base URL (/v1 is fine, it is removed automatically)',
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
    siteBase: 'Site URL',
  },
  secretPlaceholder: 'Saved, leave blank to keep',
  secretPlaceholderNew: 'Enter key or token',
  detailPlaceholder: 'topped_up=balance_infos[0].topped_up_balance',
  usageUrlPlaceholder: 'https://…/api/data/self?start_timestamp={7d}&end_timestamp={now}',
  usageArrayPathPlaceholder: 'data',
  usageFieldsPlaceholder: 'label=path, one per line, at most 4',
  siteBasePlaceholder: 'https://sta1n.ai',
  upgradeHint: 'This app is older and can only show balances. Update the app to edit services.',
  testTitle: 'Raw response (redacted)',
  noPreview: 'Nothing to preview',
  testOk: 'Test succeeded',
  testFailed: 'Test failed, see below',
  pendingRefresh: 'Refreshing',
  pendingTest: 'Testing',
  refreshed: (n) => `Updated ${n} services`,
  saved: 'Saved',
  deleted: 'Deleted',
  saveFailed: 'Save failed, check host storage',
  tooMany: 'At most 24 services',
  confirmDelete: (name) => `Delete "${name || ''}"?`,
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
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
    siteBase: '',
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
  form.preset = ['custom', 'deepseek', 'newapi'].includes(source.preset) ? source.preset : 'custom'
  form.secret = ''
  form.secretSet = true
  form.detailText = detailTextOf(source.detailPaths)
  form.usageFieldsText = detailTextOf(source.usageFields)
  form.siteBase = siteBaseOf(source.url)
  form.enabled = source.enabled !== false
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
    if (key === 'secret' || key === 'secretSet' || key === 'detailText' || key === 'usageFieldsText' || key === 'siteBase') continue
    if (source[key] !== undefined && source[key] !== null) form[key] = source[key]
  }
  form.preset = ['custom', 'deepseek', 'newapi'].includes(source.preset) ? source.preset : 'custom'
  form.secret = typeof source.secret === 'string' ? source.secret : ''
  form.secretSet = false
  form.detailText = detailTextOf(source.detailPaths)
  form.usageFieldsText = detailTextOf(source.usageFields)
  form.siteBase = ''
  return form
}

export function createState (overrides = {}) {
  const state = {
    config: {
      v: 1,
      providers: [],
      settings: { stripEnabled: true, refreshOnOpen: true, timeoutMs: 12000 },
    },
    results: {},
    formOpen: false,
    pickTemplate: false,
    editingId: '',
    form: emptyForm(),
    test: null,
    confirmDelete: null,
    busy: false,
    locale: 'zh-CN',
    now: null,
    viewServed: false,
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

function usageSubtitle (provider, result, locale) {
  if (!result || !Array.isArray(result.usage)) return ''
  const parts = []
  for (const item of result.usage.slice(0, 2)) {
    if (!item || typeof item !== 'object') continue
    const figure = formatUsage(provider, item, locale)
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
  let subtitle = w.notFetched
  let trailing = '—'
  let tone = 'muted'
  if (result) {
    subtitle = `${result.ok === true ? w.ok : w.fail} · ${formatDateTime(result.fetchedAt, now)}`
    const usage = usageSubtitle(provider, result, locale)
    if (usage !== '') subtitle = `${subtitle} · ${usage}`
    if (result.ok === true) {
      trailing = formatAmount(provider, result.balance)
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
    action: { id: 'select', args: { id: text(provider.id) } },
  }
}

function cardOf (provider, result, w, now, locale) {
  const enabled = provider.enabled !== false
  let status
  if (!enabled) status = w.disabled
  else if (!result) status = w.notFetched
  else status = `${result.ok === true ? w.ok : w.fail} · ${formatClock(result.fetchedAt)}`
  return {
    name: text(provider.name) || w.untitled,
    balance: result && result.ok === true ? formatAmount(provider, result.balance) : '—',
    usage: clipSubtitle(usageSubtitle(provider, result, locale)),
    status,
    error: result && result.ok === false ? text(result.error) || w.fail : '',
  }
}

// 面板数据模型：cards 与 providers 同序；密钥永不出现。
export function panelData (state, caps = {}) {
  const current = state && typeof state === 'object' ? state : createState()
  const w = words(caps && caps.locale ? caps.locale : current.locale)
  const locale = caps && caps.locale ? caps.locale : current.locale
  const now = clockNow(current)
  const providers = providerList(current)
  const test = current.test && typeof current.test === 'object'
    ? { title: text(current.test.title), raw: text(current.test.raw) }
    : { title: '', raw: '' }
  return {
    cards: providers.map((provider) => cardOf(provider, resultOf(current, provider), w, now, locale)),
    // v1 降级仍用列表摘要
    rows: providers.map((provider) => rowOf(provider, resultOf(current, provider), w, now, locale)),
    test,
    formOpen: current.formOpen === true,
    form: current.form && typeof current.form === 'object' ? current.form : emptyForm(),
  }
}

// 状态条不再显示总余额（不同站货币不能相加）。
export function stripData (state, caps = {}) {
  return { text: '' }
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
    case 'newapi':
      return [
        { type: 'text', text: w.newapiCaption, style: { size: 'caption', color: 'gray' } },
        formNode(w, [
          nameField(w, false),
          textField(w, 'siteBase', FORM_LIMITS.siteBase, {
            required: true,
            placeholder: w.siteBasePlaceholder,
          }),
          secretField(w, form),
          textField(w, 'symbol', FORM_LIMITS.symbol),
          numberField(w, 'multiplier'),
        ]),
      ]
    default:
      return [formNode(w, customFieldTabs(w, form))]
  }
}

// 「添加服务」第一步：选服务类型。
function templatePickerView (state, w) {
  if (state.pickTemplate !== true) return []
  const [, newapi, custom] = w.presets
  return [
    { type: 'text', text: w.chooseTemplate, style: { size: 'title', weight: 'semibold' } },
    {
      type: 'list',
      items: [
        {
          title: w.presets[0].label,
          subtitle: w.templateDeepseekSub,
          action: { id: 'choose-template', args: { preset: 'deepseek' } },
        },
        {
          title: newapi.label,
          subtitle: w.templateNewapiSub,
          action: { id: 'choose-template', args: { preset: 'newapi' } },
        },
        {
          title: custom.label,
          subtitle: w.templateCustomSub,
          action: { id: 'choose-template', args: { preset: 'custom' } },
        },
      ],
    },
  ]
}

function actionGrid (buttons) {
  return {
    type: 'grid',
    columns: buttons.length,
    children: buttons.map((button) => ({ type: 'actions', items: [button] })),
  }
}

function cardView (provider, index, state, w) {
  const card = `cards[${index}]`
  const result = resultOf(state, provider)
  const children = [
    { type: 'text', text: bind(`${card}.name`), style: { size: 'subtitle', weight: 'semibold' } },
    { type: 'text', text: bind(`${card}.balance`), style: { size: 'title', weight: 'bold' } },
  ]
  if (typeof provider.usageUrl === 'string' && provider.usageUrl.trim() !== '') {
    children.push({ type: 'text', text: bind(`${card}.usage`), style: { size: 'caption', color: 'gray' } })
  }
  children.push({ type: 'text', text: bind(`${card}.status`), style: { size: 'caption' } })
  if (result && result.ok === false) {
    children.push({ type: 'callout', tone: 'bad', text: bind(`${card}.error`) })
  }
  const confirming = state.confirmDelete && typeof state.confirmDelete === 'object' &&
    state.confirmDelete.id === provider.id
  if (confirming) {
    children.push({ type: 'callout', tone: 'warn', text: w.confirmDelete(text(provider.name) || w.untitled) })
    children.push(actionGrid([
      { label: w.confirmLabel, icon: 'delete', action: { id: 'delete', args: { id: provider.id, confirm: true } } },
      { label: w.cancelLabel, icon: 'clear', action: { id: 'delete-cancel', args: { id: provider.id } } },
    ]))
  } else {
    const buttons = [{ label: w.edit, icon: 'edit', action: { id: 'edit', args: { id: provider.id } } }]
    if (provider.preset === 'custom') {
      buttons.push({ label: w.test, icon: 'play', action: { id: 'test', args: { id: provider.id } } })
    }
    buttons.push({ label: w.delete, icon: 'delete', action: { id: 'delete', args: { id: provider.id } } })
    children.push(actionGrid(buttons))
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

function testView (state, w, caps) {
  if (!state.test || typeof state.test !== 'object') return []
  const children = [
    { type: 'text', text: bind('test.title'), style: { size: 'caption', color: 'gray' } },
  ]
  if (hasComponent(caps, 'codeBlock')) {
    children.push({ type: 'codeBlock', language: 'json', code: bind('test.raw') })
  } else {
    children.push({ type: 'text', text: bind('test.raw') })
  }
  children.push({ type: 'actions', items: [{ label: w.close, icon: 'clear', action: 'close-test' }] })
  return [{ type: 'stack', style: { card: 'plain', gap: 'S' }, children }]
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
  const tail = [
    ...testView(state, w, caps),
    ...templatePickerView(state, w),
  ]
  if (state.formOpen === true) {
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
