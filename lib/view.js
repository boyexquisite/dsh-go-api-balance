// 面板展示层：中英文案、视图 v2/v1、面板数据、状态条数据。纯函数。
import {
  formatAmount,
  formatDateTime,
  formatDetailValue,
  formatStripText,
  scaledAmount,
} from './format.js'

// 表单字段的视图上限（App 单次提交 ≤4 KiB，长文本字段收紧过，见报告）。
export const FORM_LIMITS = Object.freeze({
  url: 512,
  secret: 768,
  headersText: 256,
  bodyText: 256,
  detailText: 384,
  loginUrl: 512,
  balancePath: 120,
  currencyPath: 120,
  name: 24,
  username: 100,
  tokenPath: 120,
  tokenHeader: 64,
  tokenPrefix: 32,
  secretHeader: 64,
  secretParam: 64,
  symbol: 8,
})

const AUTH_ORDER = ['bearer', 'header', 'query', 'cookie', 'basic', 'login']
const MAX_DETAILS = 6
const MAX_ROWS = 24

const ZH = {
  title: 'API 余额',
  totalLabel: '总余额',
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
  detail: '明细',
  available: '家可用',
  mixedCurrency: '币种不一致，无法合计',
  refreshing: '更新中…',
  untitled: '未命名服务',
  tabBasicLabel: '基本信息',
  tabAuthLabel: '鉴权',
  tabFieldsLabel: '字段与显示',
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
    preset: '模板',
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
  },
  secretPlaceholder: '已保存，留空不改',
  secretPlaceholderNew: '填密钥或令牌',
  detailPlaceholder: '充值余额=balance_infos[0].topped_up_balance',
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
  totalLabel: 'Total balance',
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
  detail: 'Detail',
  available: 'available',
  mixedCurrency: 'Mixed currencies, cannot total',
  refreshing: 'Updating…',
  untitled: 'Untitled service',
  tabBasicLabel: 'Basics',
  tabAuthLabel: 'Auth',
  tabFieldsLabel: 'Fields & display',
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
    preset: 'Template',
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
  },
  secretPlaceholder: 'Saved, leave blank to keep',
  secretPlaceholderNew: 'Enter key or token',
  detailPlaceholder: 'topped_up=balance_infos[0].topped_up_balance',
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
  form.enabled = source.enabled !== false
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
    selectedId: '',
    formOpen: false,
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

function selectedProvider (state) {
  if (!state || typeof state.selectedId !== 'string' || state.selectedId === '') return null
  return providerList(state).find((provider) => provider.id === state.selectedId) || null
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

function rowOf (provider, result, w, now) {
  const enabled = provider.enabled !== false
  let subtitle = w.notFetched
  let trailing = '—'
  let tone = 'muted'
  if (result) {
    subtitle = `${result.ok === true ? w.ok : w.fail} · ${formatDateTime(result.fetchedAt, now)}`
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
    subtitle,
    trailing,
    tone,
    action: { id: 'select', args: { id: text(provider.id) } },
  }
}

function totalOf (state, providers, w) {
  const results = []
  let symbol = ''
  let decimals = 0
  let mixed = false
  let okCount = 0
  for (const provider of providers) {
    const result = resultOf(state, provider)
    if (!result || result.ok !== true) continue
    const amount = scaledAmount(provider, result.balance)
    if (amount === null) continue
    const current = typeof result.symbol === 'string' ? result.symbol : text(provider.symbol)
    if (results.length === 0) symbol = current
    else if (current !== symbol) mixed = true
    decimals = Math.max(decimals, Number.isInteger(result.decimals) ? result.decimals : 2)
    results.push(amount)
    okCount += 1
  }
  const caption = providers.length === 0
    ? w.noServices
    : state.busy === true
      ? w.refreshing
      : `${okCount}/${providers.length} ${w.available}`
  if (results.length === 0) return { text: '—', caption }
  if (mixed) return { text: '—', caption: w.mixedCurrency }
  const total = results.reduce((sum, amount) => sum + amount, 0)
  return {
    text: formatAmount({ symbol, decimals, divisor: 1, multiplier: 1 }, total),
    caption,
  }
}

// 详情只保留 detailPaths 取到的明细行；错误单独给 callout。
function detailOf (state, w) {
  const provider = selectedProvider(state)
  if (!provider) return { rows: [], error: '' }
  const result = resultOf(state, provider)
  const error = result && result.ok === false ? text(result.error) || w.fail : ''
  const rows = []
  if (result && Array.isArray(result.details)) {
    for (const item of result.details.slice(0, MAX_DETAILS)) {
      if (!item || typeof item !== 'object') continue
      rows.push({
        label: text(item.label) || w.detail,
        value: formatDetailValue(provider, item.value),
      })
    }
  }
  return { rows, error }
}

// 面板数据模型：行内带 select action；密钥永不出现（连打码值都不放）。
export function panelData (state, caps = {}) {
  const current = state && typeof state === 'object' ? state : createState()
  const w = words(caps && caps.locale ? caps.locale : current.locale)
  const now = clockNow(current)
  const providers = providerList(current)
  const rows = providers.map((provider) => rowOf(provider, resultOf(current, provider), w, now))
  const detail = detailOf(current, w)
  const test = current.test && typeof current.test === 'object'
    ? { title: text(current.test.title), raw: text(current.test.raw) }
    : { title: '', raw: '' }
  const confirmTarget = current.confirmDelete && typeof current.confirmDelete === 'object'
    ? providers.find((provider) => provider.id === current.confirmDelete.id) || null
    : null
  const confirmDelete = {
    text: confirmTarget ? w.confirmDelete(text(confirmTarget.name)) : '',
  }
  return {
    total: totalOf(current, providers, w),
    rows,
    detail,
    test,
    formOpen: current.formOpen === true,
    confirmDelete,
    form: current.form && typeof current.form === 'object' ? current.form : emptyForm(),
  }
}

// 状态条数据：只读缓存，绝不联网；≤24 字，空串表示不显示。
export function stripData (state, caps = {}) {
  const current = state && typeof state === 'object' ? state : createState()
  const settings = current.config && current.config.settings && typeof current.config.settings === 'object'
    ? current.config.settings
    : {}
  if (settings.stripEnabled === false) return { text: '' }
  const text = formatStripText(providerList(current), current.results || {}, {
    locale: (caps && caps.locale) || current.locale,
    stripEnabled: true,
  })
  if (text === '') return { text: '' }
  return { text, icon: 'wallet' }
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

function presetChoices (w) {
  return w.presets.map((item) => ({ label: item.label, value: item.value }))
}

function authChoices (w) {
  return AUTH_ORDER.map((value) => ({ label: w.authNames[value], value }))
}

function formView (state, w) {
  const form = state.form && typeof state.form === 'object' ? state.form : emptyForm()
  const basicFields = [
    selectField(w, 'preset', presetChoices(w), { onChange: 'preset' }),
    textField(w, 'name', FORM_LIMITS.name, { required: true }),
    textField(w, 'url', FORM_LIMITS.url, { required: true }),
    selectField(w, 'method', ['GET', 'POST']),
    selectField(w, 'authType', authChoices(w)),
    { type: 'toggle', label: w.fields.enabled, bind: 'data.form.enabled' },
  ]
  const authFields = [
    textField(w, 'secret', FORM_LIMITS.secret, {
      required: form.secretSet !== true,
      placeholder: form.secretSet === true ? w.secretPlaceholder : w.secretPlaceholderNew,
    }),
    textField(w, 'secretHeader', FORM_LIMITS.secretHeader),
    textField(w, 'secretParam', FORM_LIMITS.secretParam),
    textField(w, 'username', FORM_LIMITS.username),
    textField(w, 'loginUrl', FORM_LIMITS.loginUrl),
    textField(w, 'tokenPath', FORM_LIMITS.tokenPath),
    textField(w, 'tokenHeader', FORM_LIMITS.tokenHeader),
    textField(w, 'tokenPrefix', FORM_LIMITS.tokenPrefix),
  ]
  const fieldFields = [
    textField(w, 'balancePath', FORM_LIMITS.balancePath, { required: true }),
    textField(w, 'currencyPath', FORM_LIMITS.currencyPath),
    textField(w, 'detailText', FORM_LIMITS.detailText, {
      multiline: true,
      maxLines: 6,
      placeholder: w.detailPlaceholder,
    }),
    numberField(w, 'divisor'),
    numberField(w, 'multiplier'),
    textField(w, 'symbol', FORM_LIMITS.symbol),
    { type: 'stepper', label: w.fields.decimals, bind: 'data.form.decimals', min: 0, max: 4, step: 1 },
    textField(w, 'headersText', FORM_LIMITS.headersText, { multiline: true, maxLines: 4 }),
    textField(w, 'bodyText', FORM_LIMITS.bodyText, { multiline: true, maxLines: 4 }),
  ]
  return {
    type: 'form',
    submit: 'save',
    submitLabel: w.save,
    children: [
      {
        type: 'tabs',
        items: [
          { label: w.tabBasicLabel, children: basicFields },
          { label: w.tabAuthLabel, children: authFields },
          { label: w.tabFieldsLabel, children: fieldFields },
        ],
      },
    ],
  }
}

function detailView (state, w) {
  if (!selectedProvider(state)) return []
  const detail = detailOf(state, w)
  if (detail.rows.length === 0 && detail.error === '') return []
  const children = []
  if (detail.rows.length > 0) children.push({ type: 'keyValue', items: bind('detail.rows') })
  if (detail.error !== '') children.push({ type: 'callout', tone: 'bad', text: bind('detail.error') })
  return [{ type: 'stack', style: { card: 'surface', padding: 'M', gap: 'S' }, children }]
}

// App 的 actions 是竖排通栏，一行两个小按钮用 grid 两列各放一个单项 actions。
function editDeleteView (state, w) {
  if (!selectedProvider(state)) return []
  return [{
    type: 'grid',
    columns: 2,
    children: [
      { type: 'actions', items: [{ label: w.edit, icon: 'edit', action: 'edit' }] },
      { type: 'actions', items: [{ label: w.delete, icon: 'delete', action: 'delete' }] },
    ],
  }]
}

function confirmView (state, w) {
  if (!state.confirmDelete || typeof state.confirmDelete !== 'object') return []
  return [{
    type: 'stack',
    style: { card: 'outlined', padding: 'M', gap: 'S' },
    children: [
      { type: 'callout', tone: 'warn', text: bind('confirmDelete.text') },
      { type: 'confirm', id: 'delete', confirmLabel: w.confirmLabel, cancelLabel: w.cancelLabel },
    ],
  }]
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

function panelViewV2 (state, w, caps) {
  const providers = providerList(state)
  const children = [
    {
      type: 'metric',
      label: w.totalLabel,
      value: bind('total.text'),
      caption: bind('total.caption'),
    },
  ]
  if (providers.length === 0) {
    children.push(emptyView(w, caps))
  } else {
    children.push({ type: 'list', items: bind('rows') })
  }
  children.push(...detailView(state, w))
  children.push(...editDeleteView(state, w))
  children.push(...confirmView(state, w))
  children.push(...testView(state, w, caps))
  if (state.formOpen === true) {
    children.push(formView(state, w))
    children.push({
      type: 'actions',
      items: [{ label: w.cancel, icon: 'clear', action: 'form-cancel' }],
    })
  }
  // 底部固定入口：App 的 actions 竖排，所以刷新/添加始终放在最下面。
  children.push({
    type: 'actions',
    items: [
      { label: w.refresh, icon: 'refresh', action: 'refresh' },
      { label: w.add, icon: 'add', action: 'add' },
    ],
  })
  return {
    v: 2,
    accent: 'app',
    type: 'stack',
    style: { gap: 'M' },
    children,
  }
}

// 老 App（缺 form/textField/tabs）退成 v1 只读摘要 + 升级提示。
function panelViewV1 (state, w) {
  const providers = providerList(state)
  const selected = selectedProvider(state)
  const children = [
    { type: 'metric', label: w.totalLabel, value: bind('total.text'), caption: bind('total.caption') },
    {
      type: 'actions',
      items: [{ label: w.refresh, icon: 'refresh', action: 'refresh' }],
    },
  ]
  if (providers.length === 0) {
    children.push({ type: 'callout', tone: 'info', text: w.emptyMessage })
  } else {
    children.push({ type: 'list', items: bind('rows') })
  }
  if (selected) {
    const detail = detailOf(state, w)
    if (detail.rows.length > 0) children.push({ type: 'keyValue', items: bind('detail.rows') })
    if (detail.error !== '') children.push({ type: 'callout', tone: 'bad', text: bind('detail.error') })
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
