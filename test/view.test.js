import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { configPath, resultsPath, saveConfig, saveResults, loadConfig } from '../lib/config.js'
import { getByPath } from '../lib/extract.js'
import {
  FORM_LIMITS,
  createState,
  detailTextOf,
  emptyForm,
  hasComponent,
  panelData,
  panelView,
  parseDetailText,
  providerForm,
  stripData,
  words,
} from '../lib/view.js'
import { apply } from '../lib/index.js'

const FULL_COMPONENTS = [
  'stack', 'row', 'text', 'metric', 'chart', 'compare', 'steps', 'callout', 'options', 'confirm',
  'list', 'keyValue', 'progress', 'table', 'actions', 'image',
  'textField', 'number', 'stepper', 'toggle', 'slider', 'select', 'segmented', 'chips', 'date',
  'time', 'rating', 'form', 'tabs', 'collapsible', 'accordion', 'carousel', 'timeline', 'grid',
  'badge', 'tag', 'avatar', 'codeBlock', 'divider', 'spacer', 'emptyState', 'gallery',
]
const FULL_CAPS = { protocol: 1, app: '99.0.0', locale: 'zh-CN', components: FULL_COMPONENTS }
const FIXED_NOW = new Date(2026, 10, 13, 9, 12, 0).getTime()
const INPUT_TYPES = ['textField', 'number', 'stepper', 'toggle', 'slider', 'select', 'segmented', 'chips', 'date', 'time', 'rating']

function makeProvider (overrides = {}) {
  return {
    id: 'p_abc12345',
    name: 'DeepSeek',
    preset: 'deepseek',
    url: 'https://api.example.com/balance',
    method: 'GET',
    authType: 'bearer',
    secret: 'sk-test-secret-123456',
    secretHeader: 'X-API-Key',
    secretParam: 'key',
    username: '',
    loginUrl: '',
    tokenPath: 'data.token',
    tokenHeader: 'Authorization',
    tokenPrefix: 'Bearer ',
    headersText: '',
    bodyText: '',
    balancePath: 'data.balance',
    currencyPath: '',
    detailPaths: [{ label: '充值余额', path: 'data.topped' }],
    divisor: 1,
    multiplier: 1,
    symbol: '¥',
    decimals: 2,
    enabled: true,
    ...overrides,
  }
}

function makeResult (id, overrides = {}) {
  return {
    id,
    ok: true,
    balance: 1234.5,
    currency: 'CNY',
    symbol: '¥',
    decimals: 2,
    details: [{ label: '充值余额', value: 1000 }],
    rawPreview: null,
    error: null,
    fetchedAt: FIXED_NOW,
    ...overrides,
  }
}

function freshState (overrides = {}) {
  return createState({ now: () => FIXED_NOW, ...overrides })
}

function stateWithProvider (overrides = {}) {
  const state = freshState(overrides)
  const provider = makeProvider()
  state.config.providers.push(provider)
  state.results[provider.id] = makeResult(provider.id)
  return state
}

function collectBindings (value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectBindings(item, out)
    return out
  }
  if (!value || typeof value !== 'object') return out
  if (typeof value.$ === 'string') out.push(value.$)
  if (typeof value.bind === 'string') out.push(value.bind)
  for (const item of Object.values(value)) collectBindings(item, out)
  return out
}

function collectInputs (value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectInputs(item, out)
    return out
  }
  if (!value || typeof value !== 'object') return out
  if (INPUT_TYPES.includes(value.type)) out.push(value)
  for (const item of Object.values(value)) collectInputs(item, out)
  return out
}

function viewStats (view) {
  let nodes = 0
  let depth = 0
  const walk = (value, level) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, level)
      return
    }
    if (!value || typeof value !== 'object') return
    let next = level
    if (typeof value.type === 'string') {
      nodes += 1
      next = level + 1
      if (next > depth) depth = next
    }
    for (const item of Object.values(value)) walk(item, next)
  }
  walk(view, 0)
  return { nodes, depth }
}

function findUndefined (value, trail = 'data') {
  if (value === undefined) return trail
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = findUndefined(value[index], `${trail}[${index}]`)
      if (found !== null) return found
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  for (const [key, item] of Object.entries(value)) {
    const found = findUndefined(item, `${trail}.${key}`)
    if (found !== null) return found
  }
  return null
}

function assertResolvable (view, data, label) {
  const bindings = collectBindings(view)
  assert.ok(bindings.length > 0, `${label} 至少有一条绑定`)
  for (const binding of bindings) {
    assert.ok(binding.startsWith('data.'), `${label}: 绑定必须以 data. 开头：${binding}`)
    const value = getByPath(data, binding.slice('data.'.length))
    assert.notEqual(value, undefined, `${label}: 绑定取不到值：${binding}`)
  }
}

function assertStructure (view, data, label) {
  const json = JSON.stringify(view)
  const stats = viewStats(view)
  assert.ok(Buffer.byteLength(json) <= 32768, `${label}: 视图 ${Buffer.byteLength(json)} 字节`)
  assert.ok(stats.nodes <= 120, `${label}: 节点 ${stats.nodes}`)
  assert.ok(stats.depth <= 8, `${label}: 深度 ${stats.depth}`)
  const inputs = collectInputs(view)
  assert.ok(inputs.length <= 32, `${label}: 输入 ${inputs.length} 个`)
  const binds = inputs.map((item) => item.bind).filter(Boolean)
  assert.equal(new Set(binds).size, binds.length, `${label}: 表单绑定重复`)
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (!value || typeof value !== 'object') return
    if ((value.type === 'stack' || value.type === 'row') && Array.isArray(value.children)) {
      assert.ok(value.children.length <= 32, `${label}: ${value.type} 直接孩子 ${value.children.length}`)
    }
    if (value.type === 'tabs' && Array.isArray(value.items)) {
      assert.ok(value.items.length <= 8, `${label}: tabs ${value.items.length}`)
      for (const item of value.items) walk(item)
    }
    if (value.type === 'actions' && Array.isArray(value.items)) {
      assert.ok(value.items.length <= 4, `${label}: actions ${value.items.length}`)
    }
    if (value.type === 'grid') {
      assert.ok(Number.isInteger(value.columns) && value.columns >= 1 && value.columns <= 4, `${label}: grid columns`)
      assert.ok(Array.isArray(value.children) && value.children.length <= 32, `${label}: grid children`)
    }
    for (const item of Object.values(value)) walk(item)
  }
  walk(view)
  assert.ok(Array.isArray(data.rows) && data.rows.length <= 50, `${label}: list 行数`)
  assert.ok(Array.isArray(data.detail.rows) && data.detail.rows.length <= 24, `${label}: keyValue 行数`)
  assert.equal(findUndefined(data), null, `${label}: 数据里有 undefined`)
  assert.ok(Buffer.byteLength(JSON.stringify(data)) <= 32768, `${label}: 数据超 32 KiB`)
}

function samples () {
  const empty = freshState()
  const rows = freshState()
  rows.config.providers.push(makeProvider(), makeProvider({ id: 'p_def67890', name: '中转', secret: '', secretSet: true, enabled: false }))
  rows.results.p_abc12345 = makeResult('p_abc12345')

  const errorState = freshState()
  errorState.config.providers.push(makeProvider())
  errorState.selectedId = 'p_abc12345'
  errorState.results.p_abc12345 = makeResult('p_abc12345', { ok: false, balance: null, error: '密钥或令牌无效' })

  const selected = stateWithProvider({ selectedId: 'p_abc12345' })

  const formNew = freshState({ formOpen: true, form: emptyForm() })

  const formEdit = stateWithProvider({ formOpen: true, editingId: 'p_abc12345' })
  formEdit.form = providerForm(formEdit.config.providers[0])

  const confirm = stateWithProvider({ selectedId: 'p_abc12345', confirmDelete: { id: 'p_abc12345' } })

  const tested = stateWithProvider({ selectedId: 'p_abc12345' })
  tested.test = { id: 'p_abc12345', title: 'DeepSeek · 接口原始返回（已脱敏）', raw: '{"balance":12.5}' }

  const worst = freshState({ formOpen: true, selectedId: 'p_abc12345', confirmDelete: { id: 'p_abc12345' } })
  for (let index = 0; index < 24; index++) {
    const provider = makeProvider({ id: `p_${String(index).padStart(8, '0')}`, name: `服务 ${index}` })
    worst.config.providers.push(provider)
    worst.results[provider.id] = makeResult(provider.id)
  }
  worst.form = providerForm(worst.config.providers[0])
  worst.test = { id: worst.config.providers[0].id, title: 'x'.repeat(20), raw: 'x'.repeat(8000) }
  return { empty, rows, errorState, selected, formNew, formEdit, confirm, tested, worst }
}

// ---------- 文案 ----------

function leafKeys (value, prefix = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => leafKeys(item, prefix === '' ? String(index) : `${prefix}.${index}`, out))
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      leafKeys(item, prefix === '' ? key : `${prefix}.${key}`, out)
    }
    return out
  }
  out.push(prefix)
  return out
}

test('words: 中英文案 key 齐全、值非空、长度在 UI 上限内', () => {
  const zh = words('zh-CN')
  const en = words('en-US')
  assert.deepEqual(leafKeys(zh).sort(), leafKeys(en).sort(), '中英文案 key 必须一致')
  assert.equal(words('en'), en)
  assert.equal(words('zh-Hans'), zh)
  for (const [locale, dictionary] of [['zh', zh], ['en', en]]) {
    for (const key of leafKeys(dictionary)) {
      const value = key.split('.').reduce((item, part) => (item ? item[part] : undefined), dictionary)
      if (typeof value === 'function') continue
      assert.equal(typeof value, 'string', `${locale}.${key} 不是字符串`)
      assert.ok(value.trim() !== '', `${locale}.${key} 是空串`)
    }
    assert.ok([...dictionary.refresh].length <= 24, '刷新按钮标签')
    assert.ok([...dictionary.add].length <= 24, '添加按钮标签')
    assert.ok([...dictionary.edit].length <= 24, '编辑按钮标签')
    assert.ok([...dictionary.delete].length <= 24, '删除按钮标签')
    assert.ok([...dictionary.cancel].length <= 24, '取消按钮标签')
    assert.ok([...dictionary.confirmLabel].length <= 12, '确认按钮标签')
    assert.ok([...dictionary.cancelLabel].length <= 12, '取消按钮标签')
    assert.ok([...dictionary.emptyTitle].length <= 40, '空状态标题')
    assert.ok([...dictionary.emptyMessage].length <= 120, '空状态说明')
    assert.ok([...dictionary.pendingRefresh].length <= 16, 'pending 标签')
    assert.ok([...dictionary.pendingTest].length <= 16, 'pending 标签')
    assert.ok([...dictionary.refreshed(12)].length <= 40, 'toast')
    assert.ok([...dictionary.saved].length <= 40, 'toast')
    assert.ok([...dictionary.upgradeHint].length <= 2000, '升级提示')
    for (const section of [dictionary.tabBasicLabel, dictionary.tabAuthLabel, dictionary.tabFieldsLabel]) {
      assert.ok([...section].length <= 24, '页签标签')
    }
    for (const [key, label] of Object.entries(dictionary.fields)) {
      assert.ok(label.trim() !== '', `${locale}.fields.${key} 标签为空`)
      assert.ok([...label].length <= 200, `${locale}.fields.${key} 标签过长`)
    }
    assert.deepEqual(dictionary.presets.map((item) => item.value).sort(), ['custom', 'deepseek', 'newapi'])
    assert.equal(Object.keys(dictionary.authNames).length, 6)
  }
})

// ---------- 视图结构 ----------

test('panelView: v2 根节点、无 minApp、三组页签与必填字段', () => {
  const view = panelView(freshState({ formOpen: true }), FULL_CAPS)
  assert.equal(view.v, 2)
  assert.equal(view.accent, 'app')
  assert.equal(view.type, 'stack')
  assert.equal(Object.hasOwn(view, 'minApp'), false)
  const json = JSON.stringify(view)
  assert.ok(json.includes('"form"'))
  assert.ok(json.includes('"tabs"'))
  assert.ok(json.includes('"textField"'))
  assert.ok(json.includes('data.form.secret'))
  const binds = collectInputs(view).map((item) => item.bind)
  for (const field of Object.keys(FORM_LIMITS)) {
    assert.ok(binds.includes(`data.form.${field}`), `缺少表单字段 ${field}`)
  }
  assert.equal(new Set(binds).size, binds.length, '表单字段不能重复绑定')
  assert.equal(collectInputs(view).length, 23)
})

test('panelView: 所有状态下的绑定路径都能在 panelData 找到', () => {
  for (const [name, state] of Object.entries(samples())) {
    const caps = name === 'worst' ? { ...FULL_CAPS, locale: 'en-US' } : FULL_CAPS
    assertResolvable(panelView(state, caps), panelData(state, caps), name)
  }
})

test('panelData: 行内 select action、总余额、明细、状态条', () => {
  const state = stateWithProvider({ selectedId: 'p_abc12345', busy: false })
  const data = panelData(state, FULL_CAPS)
  assert.equal(data.total.text, '¥1,234.50')
  assert.equal(data.rows.length, 1)
  assert.deepEqual(data.rows[0].action, { id: 'select', args: { id: 'p_abc12345' } })
  assert.equal(data.rows[0].tone, 'good')
  assert.ok(data.rows[0].subtitle.startsWith('成功'))
  assert.equal(Object.hasOwn(data.detail, 'title'), false, '详情不再带标题')
  assert.deepEqual(data.detail.rows, [{ label: '充值余额', value: '¥1,000.00' }])
  assert.equal(data.detail.error, '')
  assert.equal(data.formOpen, false)
  assert.equal(data.form.secret, '')
  assert.equal(data.test.raw, '')
  assert.equal(data.confirmDelete.text, '')
  assert.equal(stripData(state, FULL_CAPS).icon, 'wallet')
})

// ---------- 预算 ----------

test('预算：各状态视图 ≤32 KiB / ≤120 节点 / ≤8 层，数据 ≤32 KiB', () => {
  for (const [name, state] of Object.entries(samples())) {
    for (const caps of [FULL_CAPS, { ...FULL_CAPS, locale: 'en-US' }, {}]) {
      assertStructure(panelView(state, caps), panelData(state, caps), `${name} ${caps.locale || 'v1'}`)
    }
  }
})

test('预算：patch 数据（表单态 / 测试态）≤16 KiB', () => {
  const { formNew, tested } = samples()
  for (const state of [formNew, tested]) {
    const data = panelData(state, FULL_CAPS)
    assert.ok(Buffer.byteLength(JSON.stringify(data)) <= 16384, 'patch 数据超 16 KiB')
  }
})

test('预算：表单最坏情况提交 JSON < 4096 字节，maxLength 与 FORM_LIMITS 一致', () => {
  const view = panelView(freshState({ formOpen: true }), FULL_CAPS)
  const inputs = collectInputs(view)
  const values = {}
  for (const input of inputs) {
    assert.ok(input.bind, `${input.type} 缺少 bind`)
    assert.ok(typeof input.label === 'string' && input.label.trim() !== '', '输入缺少 label')
    const field = input.bind.slice('data.form.'.length)
    if (input.type === 'textField') {
      if (Object.hasOwn(FORM_LIMITS, field)) {
        assert.equal(input.maxLength, FORM_LIMITS[field], `${field} 的 maxLength`)
      }
      assert.ok(input.maxLength <= 2000, `${field} 超过 App 单字段上限`)
      values[input.bind] = 'x'.repeat(input.maxLength)
    } else if (input.type === 'number') {
      values[input.bind] = 0.000001
    } else if (input.type === 'stepper') {
      values[input.bind] = input.min
    } else if (input.type === 'toggle') {
      values[input.bind] = true
    } else if (input.type === 'select') {
      const first = input.options[0]
      values[input.bind] = typeof first === 'string' ? first : first.value
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(values))
  assert.ok(bytes < 4096, `最坏情况表单提交 ${bytes} 字节`)
  assert.equal(Object.keys(values).length, 23)
  for (const field of ['name', 'url', 'balancePath']) {
    const input = inputs.find((item) => item.bind === `data.form.${field}`)
    assert.equal(input.required, true, `${field} 应必填`)
  }
  const secret = inputs.find((item) => item.bind === 'data.form.secret')
  assert.equal(secret.required, true, '新建时密钥必填')
  assert.equal(secret.placeholder, words('zh').secretPlaceholderNew)
})

// ---------- 安全 ----------

test('安全：视图与数据里不出现密钥/用户名（连打码值也不放）', () => {
  const state = stateWithProvider({ selectedId: 'p_abc12345', formOpen: true })
  state.form = providerForm(state.config.providers[0])
  const secret = state.config.providers[0].secret
  state.config.providers[0].username = 'alice-user'
  const viewJson = JSON.stringify(panelView(state, FULL_CAPS))
  const dataJson = JSON.stringify(panelData(state, FULL_CAPS))
  for (const blob of [viewJson, dataJson]) {
    assert.ok(!blob.includes(secret), '包含密钥原文')
    assert.ok(!blob.includes('••••'), '包含打码值')
    assert.ok(!blob.includes('alice-user'), '包含用户名')
  }
  const data = panelData(state, FULL_CAPS)
  assert.equal(data.form.secret, '')
  assert.equal(data.form.secretSet, true)
  const secretInput = collectInputs(panelView(state, FULL_CAPS)).find((item) => item.bind === 'data.form.secret')
  assert.equal(secretInput.placeholder, words('zh').secretPlaceholder)
  assert.equal(secretInput.required, false, '编辑时密钥可留空')
})

test('安全：query 鉴权时接口 URL 里的密钥不进任何文本', () => {
  const provider = makeProvider({
    authType: 'query',
    url: 'https://api.example.com/balance?key=sk-query-secret-999',
    secret: 'sk-query-secret-999',
  })
  const state = freshState({ selectedId: provider.id })
  state.config.providers.push(provider)
  state.results[provider.id] = makeResult(provider.id, { ok: false, error: '连不上接口，检查地址或网络' })
  const viewJson = JSON.stringify(panelView(state, FULL_CAPS))
  const dataJson = JSON.stringify(panelData(state, FULL_CAPS))
  for (const blob of [viewJson, dataJson]) {
    assert.ok(!blob.includes('sk-query-secret-999'), '包含 URL query 密钥')
    assert.ok(!blob.includes('?key='), '包含 URL query')
  }
})

// ---------- 新版式（真机：actions 竖排通栏） ----------

function childrenTypes (view) {
  return view.children.map((child) => child.type)
}

function nodesOfType (value, type, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) nodesOfType(item, type, out)
    return out
  }
  if (!value || typeof value !== 'object') return out
  if (value.type === type) out.push(value)
  for (const item of Object.values(value)) nodesOfType(item, type, out)
  return out
}

function bottomActions (view) {
  const last = view.children.at(-1)
  assert.equal(last.type, 'actions', '最底部必须是 actions')
  return last
}

test('布局顺序：metric → 列表/空状态 → 详情 → 编辑/删除 → 确认 → 测试 → 表单+取消 → 底部 actions', () => {
  const empty = panelView(freshState(), FULL_CAPS)
  assert.deepEqual(childrenTypes(empty), ['metric', 'emptyState', 'actions'])
  assert.deepEqual(bottomActions(empty).items.map((item) => item.action), ['refresh', 'add'])

  const listed = stateWithProvider()
  assert.deepEqual(childrenTypes(panelView(listed, FULL_CAPS)), ['metric', 'list', 'actions'])

  const selected = stateWithProvider({ selectedId: 'p_abc12345' })
  assert.deepEqual(childrenTypes(panelView(selected, FULL_CAPS)), ['metric', 'list', 'stack', 'grid', 'actions'])

  const confirm = stateWithProvider({ selectedId: 'p_abc12345', confirmDelete: { id: 'p_abc12345' } })
  assert.deepEqual(childrenTypes(panelView(confirm, FULL_CAPS)), ['metric', 'list', 'stack', 'grid', 'stack', 'actions'])

  const tested = stateWithProvider({ selectedId: 'p_abc12345' })
  tested.test = { id: 'p_abc12345', title: '测试', raw: '{"a":1}' }
  assert.deepEqual(childrenTypes(panelView(tested, FULL_CAPS)), ['metric', 'list', 'stack', 'grid', 'stack', 'actions'])

  const form = stateWithProvider({ selectedId: 'p_abc12345', formOpen: true })
  form.form = providerForm(form.config.providers[0])
  const formView = panelView(form, FULL_CAPS)
  assert.deepEqual(childrenTypes(formView), ['metric', 'list', 'stack', 'grid', 'form', 'actions', 'actions'])
  const cancel = formView.children.at(-2)
  assert.deepEqual(cancel.items.map((item) => item.action), ['form-cancel'])
  assert.deepEqual(bottomActions(formView).items.map((item) => item.action), ['refresh', 'add'])

  const formEmpty = panelView(freshState({ formOpen: true }), FULL_CAPS)
  assert.deepEqual(childrenTypes(formEmpty), ['metric', 'emptyState', 'form', 'actions', 'actions'])
  assert.deepEqual(bottomActions(formEmpty).items.map((item) => item.action), ['refresh', 'add'])
})

test('编辑/删除：选中时是一行两个半宽小按钮（grid 两列各一个单项 actions）', () => {
  const selected = stateWithProvider({ selectedId: 'p_abc12345' })
  const view = panelView(selected, FULL_CAPS)
  const grids = nodesOfType(view, 'grid')
  assert.equal(grids.length, 1)
  const grid = grids[0]
  assert.equal(grid.columns, 2)
  assert.equal(grid.children.length, 2)
  assert.deepEqual(grid.children.map((child) => child.type), ['actions', 'actions'])
  for (const child of grid.children) assert.equal(child.items.length, 1, '每个半宽按钮单独一个 actions')
  assert.deepEqual(grid.children.map((child) => child.items[0].action), ['edit', 'delete'])
  assert.equal(grid.children[0].items[0].label, words('zh').edit)
  assert.equal(grid.children[1].items[0].label, words('zh').delete)
  // 不能再用一个通栏 actions 塞两个按钮
  for (const actions of nodesOfType(view, 'actions')) {
    const ids = actions.items.map((item) => item.action)
    if (ids.includes('edit') || ids.includes('delete')) {
      assert.equal(actions.items.length, 1, '编辑/删除不能共用一个 actions')
    }
  }

  for (const state of [freshState(), stateWithProvider()]) {
    assert.equal(nodesOfType(panelView(state, FULL_CAPS), 'grid').length, 0, '未选中时没有编辑/删除')
  }
  const formOpen = freshState({ formOpen: true })
  assert.equal(nodesOfType(panelView(formOpen, FULL_CAPS), 'grid').length, 0)
})

test('详情精简：只留 detailPaths 明细，无标题、无状态/余额/币种等行', () => {
  const state = stateWithProvider({ selectedId: 'p_abc12345' })
  state.results.p_abc12345 = makeResult('p_abc12345', {
    details: [
      { label: '充值余额', value: 1000 },
      { label: '赠送余额', value: 20 },
    ],
  })
  const data = panelData(state, FULL_CAPS)
  assert.deepEqual(data.detail.rows, [
    { label: '充值余额', value: '¥1,000.00' },
    { label: '赠送余额', value: '¥20.00' },
  ])
  const labels = data.detail.rows.map((row) => row.label)
  for (const removed of ['状态', '余额', '币种', '更新时间', '鉴权方式', '内置模板', '服务详情']) {
    assert.ok(!labels.includes(removed), `详情不应再有「${removed}」行`)
  }
  const viewJson = JSON.stringify(panelView(state, FULL_CAPS))
  assert.ok(!viewJson.includes('服务详情'), '详情卡标题应去掉')
  assert.equal(nodesOfType(panelView(state, FULL_CAPS), 'keyValue').length, 1)

  // 没有明细、没有错误：不渲染详情卡片/标题
  const plain = stateWithProvider({ selectedId: 'p_abc12345' })
  plain.results.p_abc12345 = makeResult('p_abc12345', { details: [] })
  assert.deepEqual(panelData(plain, FULL_CAPS).detail, { rows: [], error: '' })
  assert.equal(nodesOfType(panelView(plain, FULL_CAPS), 'keyValue').length, 0)
  assert.ok(!JSON.stringify(panelView(plain, FULL_CAPS)).includes('detail.rows'))
  assert.deepEqual(childrenTypes(panelView(plain, FULL_CAPS)), ['metric', 'list', 'grid', 'actions'])

  // 有错误：仍用 callout 显示 detail.error，不渲染空的 keyValue
  const failed = stateWithProvider({ selectedId: 'p_abc12345' })
  failed.results.p_abc12345 = makeResult('p_abc12345', { ok: false, balance: null, details: [], error: '密钥或令牌无效' })
  const failedData = panelData(failed, FULL_CAPS)
  assert.deepEqual(failedData.detail, { rows: [], error: '密钥或令牌无效' })
  const failedView = panelView(failed, FULL_CAPS)
  assert.equal(nodesOfType(failedView, 'keyValue').length, 0)
  assert.equal(nodesOfType(failedView, 'callout').length, 1)
  assert.ok(JSON.stringify(failedView).includes('data.detail.error'))

  // 未选中：没有详情块
  assert.equal(nodesOfType(panelView(stateWithProvider(), FULL_CAPS), 'keyValue').length, 0)
})

// ---------- 老 App 降级 ----------

test('panelView: 缺 form/textField/tabs 时退成 v1 只读摘要 + 升级提示', () => {
  const state = stateWithProvider({ selectedId: 'p_abc12345' })
  for (const caps of [{}, { components: ['form'] }, { components: ['form', 'textField'] }]) {
    assert.equal(hasComponent(caps, 'tabs'), false)
    const view = panelView(state, caps)
    assert.equal(view.v, undefined, 'v1 视图不写 v')
    const json = JSON.stringify(view)
    for (const type of ['"form"', '"tabs"', '"textField"']) assert.ok(!json.includes(type), `v1 不应包含 ${type}`)
    assert.ok(json.includes('升级 App'), '缺少升级提示')
    assertResolvable(view, panelData(state, caps), 'v1')
    assertStructure(view, panelData(state, caps), 'v1')
  }
})

// ---------- 状态条 ----------

test('stripData: ≤24 字、只读缓存、关闭或没有结果时为空串', () => {
  const state = stateWithProvider()
  const strip = stripData(state, FULL_CAPS)
  assert.equal(strip.icon, 'wallet')
  assert.ok([...strip.text].length <= 24)
  assert.ok(!strip.text.includes(state.config.providers[0].secret))

  const en = stripData(state, { ...FULL_CAPS, locale: 'en-US' })
  assert.ok(en.text.startsWith('Balance'))

  const disabled = stateWithProvider()
  disabled.config.settings.stripEnabled = false
  assert.deepEqual(stripData(disabled, FULL_CAPS), { text: '' })

  const failed = stateWithProvider()
  failed.results.p_abc12345 = makeResult('p_abc12345', { ok: false })
  assert.deepEqual(stripData(failed, FULL_CAPS), { text: '' })

  assert.deepEqual(stripData(freshState(), FULL_CAPS), { text: '' })
})

// ---------- 表单辅助 ----------

test('表单草稿：空表单默认值、编辑草稿不回填密钥、明细文本往返', () => {
  const empty = emptyForm()
  assert.equal(empty.secret, '')
  assert.equal(empty.secretSet, false)
  assert.equal(empty.authType, 'bearer')
  assert.equal(empty.symbol, '¥')
  assert.equal(empty.decimals, 2)
  assert.equal(empty.enabled, true)

  const provider = makeProvider({
    preset: 'newapi',
    detailPaths: [
      { label: '充值余额', path: 'data.topped' },
      { label: '赠送余额', path: 'data.granted' },
    ],
  })
  const form = providerForm(provider)
  assert.equal(form.secret, '')
  assert.equal(form.secretSet, true)
  assert.equal(form.preset, 'newapi')
  assert.equal(form.enabled, true)
  assert.deepEqual(parseDetailText(form.detailText), provider.detailPaths)
  assert.equal(detailTextOf(provider.detailPaths), '充值余额=data.topped\n赠送余额=data.granted')
  assert.deepEqual(parseDetailText('  标签 =  data.a  \n\n没有等号'), [
    { label: '标签', path: 'data.a' },
    { label: '', path: '没有等号' },
  ])
  assert.deepEqual(parseDetailText(undefined), [])
})

// ---------- apply 注册与动作 ----------

function fakeHost () {
  const regs = { panel: null, strip: null, refreshIds: [] }
  const dshGo = {
    panel (id, definition) { regs.panel = { id, ...definition } },
    strip (id, definition) { regs.strip = { id, definition } },
    refresh (id) { regs.refreshIds.push(id) },
  }
  const ctx = {
    inject (deps, callback) {
      assert.deepEqual(deps, ['dshGo'])
      callback({ dshGo })
    },
  }
  return { ctx, regs, dshGo }
}

async function tempHome (t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-balance-ui-'))
  t.after(async () => {
    await fs.rm(home, { recursive: true, force: true })
  })
  return home
}

function response (status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

async function waitFor (check, timeoutMs = 1500) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail('waitFor 超时')
}

function effectTypes (effects) {
  const list = Array.isArray(effects) ? effects : [effects]
  return list.map((effect) => effect && effect.type)
}

test('apply: 注册 panel/strip，加载时不联网、不写配置文件', async (t) => {
  const home = await tempHome(t)
  let fetchCalls = 0
  const { ctx, regs } = fakeHost()
  const store = apply(ctx, {
    home,
    now: () => FIXED_NOW,
    fetchImpl: async () => {
      fetchCalls += 1
      return response(200, { balance: 1 })
    },
  })
  assert.equal(regs.panel.id, 'balance')
  assert.equal(regs.strip.id, 'balance-strip')
  assert.equal(typeof regs.panel.view, 'function')
  assert.equal(typeof regs.panel.data, 'function')
  for (const action of ['refresh', 'select', 'add', 'preset', 'edit', 'form-cancel', 'save', 'delete', 'test', 'close-test']) {
    assert.equal(typeof regs.panel.actions[action], 'function', `缺少动作 ${action}`)
  }
  await store.ensureReady()
  assert.equal(fetchCalls, 0, '加载时不应联网')
  const configExists = await fs.access(configPath(home)).then(() => true, () => false)
  assert.equal(configExists, false, '加载时不应写配置文件')
  const view = regs.panel.view({}, FULL_CAPS)
  assert.equal(view.v, 2)
})

test('apply: 面板 data 首帧同步 emit 缓存，strip 只读缓存不联网', async (t) => {
  const home = await tempHome(t)
  const provider = makeProvider()
  await saveConfig({ v: 1, providers: [provider], settings: { stripEnabled: true, refreshOnOpen: false, timeoutMs: 12000 } }, configPath(home))
  await saveResults({ v: 1, results: { [provider.id]: makeResult(provider.id) } }, resultsPath(home))
  let fetchCalls = 0
  const { ctx, regs } = fakeHost()
  const store = apply(ctx, {
    home,
    now: () => FIXED_NOW,
    fetchImpl: async () => { fetchCalls += 1; return response(200, { balance: 1 }) },
  })
  const panelEmits = []
  const cancel = regs.panel.data({}, (data) => panelEmits.push(data), FULL_CAPS)
  assert.equal(panelEmits.length, 1, 'data() 必须同步 emit 首帧')
  assert.equal(typeof cancel, 'function')

  const stripEmits = []
  const stopStrip = regs.strip.definition({}, (data) => stripEmits.push(data), FULL_CAPS)
  assert.equal(stripEmits.length, 1)
  assert.equal(typeof stopStrip, 'function')

  await store.ensureReady()
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(panelEmits.length >= 2, '缓存加载后应再 emit 一次')
  assert.equal(panelEmits.at(-1).rows.length, 1)
  assert.equal(fetchCalls, 0, 'strip / 首帧都不应联网')
  cancel()
  stopStrip()
})

test('apply: 缓存超过 60 秒且 refreshOnOpen 时后台刷新', async (t) => {
  const home = await tempHome(t)
  const provider = makeProvider()
  await saveConfig({ v: 1, providers: [provider], settings: { stripEnabled: true, refreshOnOpen: true, timeoutMs: 12000 } }, configPath(home))
  await saveResults({ v: 1, results: { [provider.id]: makeResult(provider.id, { fetchedAt: FIXED_NOW - 120000 }) } }, resultsPath(home))
  let fetchCalls = 0
  const { ctx, regs } = fakeHost()
  const store = apply(ctx, {
    home,
    now: () => FIXED_NOW,
    fetchImpl: async () => {
      fetchCalls += 1
      return response(200, { data: { balance: 42 } })
    },
  })
  await store.ensureReady()
  const cancel = regs.panel.data({}, () => {}, FULL_CAPS)
  await waitFor(() => fetchCalls > 0)
  await waitFor(() => store.state.results[provider.id] && store.state.results[provider.id].balance === 42)
  cancel()
})

test('apply: 缓存还新或 refreshOnOpen=false 时不后台刷新', async (t) => {
  const home = await tempHome(t)
  const provider = makeProvider()
  await saveConfig({ v: 1, providers: [provider], settings: { stripEnabled: true, refreshOnOpen: true, timeoutMs: 12000 } }, configPath(home))
  await saveResults({ v: 1, results: { [provider.id]: makeResult(provider.id, { fetchedAt: FIXED_NOW - 1000 }) } }, resultsPath(home))
  let fetchCalls = 0
  const { ctx, regs } = fakeHost()
  const store = apply(ctx, {
    home,
    now: () => FIXED_NOW,
    fetchImpl: async () => { fetchCalls += 1; return response(200, { balance: 1 }) },
  })
  await store.ensureReady()
  const cancel = regs.panel.data({}, () => {}, FULL_CAPS)
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(fetchCalls, 0)
  cancel()

  await saveConfig({ v: 1, providers: [provider], settings: { stripEnabled: true, refreshOnOpen: false, timeoutMs: 12000 } }, configPath(home))
  await saveResults({ v: 1, results: { [provider.id]: makeResult(provider.id, { fetchedAt: FIXED_NOW - 120000 }) } }, resultsPath(home))
  const second = fakeHost()
  const store2 = apply(second.ctx, {
    home,
    now: () => FIXED_NOW,
    fetchImpl: async () => { fetchCalls += 1; return response(200, { balance: 1 }) },
  })
  await store2.ensureReady()
  const cancel2 = second.regs.panel.data({}, () => {}, FULL_CAPS)
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(fetchCalls, 0)
  cancel2()
  assert.ok(store.state.config.providers.length === 1)
})

test('actions: select/add/edit/form-cancel 返回 patch+refresh 并更新视图状态', async (t) => {
  const home = await tempHome(t)
  const { ctx, regs } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { balance: 1 }) })
  await store.ensureReady()
  store.state.config.providers.push(makeProvider())
  store.state.results.p_abc12345 = makeResult('p_abc12345')

  let effects = await store.actions.select({}, { locale: 'zh-CN', value: { id: 'p_abc12345' } })
  assert.equal(effectTypes(effects).includes('patch'), true)
  assert.equal(effectTypes(effects).includes('refresh'), true)
  assert.equal(store.state.selectedId, 'p_abc12345')
  assert.deepEqual(effects[1], { type: 'refresh', id: 'balance' })
  assert.ok(regs.refreshIds.length > 0)

  effects = await store.actions.add({}, { locale: 'zh-CN' })
  assert.equal(store.state.formOpen, true)
  assert.equal(store.state.form.secret, '')
  assert.equal(store.state.form.secretSet, false)

  effects = await store.actions.edit({}, { locale: 'zh-CN' })
  assert.equal(store.state.formOpen, true)
  assert.equal(store.state.form.secret, '')
  assert.equal(store.state.form.secretSet, true)
  assert.equal(store.state.form.name, 'DeepSeek')

  effects = await store.actions['form-cancel']({}, { locale: 'zh-CN' })
  assert.equal(store.state.formOpen, false)
  assert.equal(effectTypes(effects).includes('refresh'), true)
})

test('actions: preset 的 onChange 只返回 patch，且保留已填名称/地址', async (t) => {
  const home = await tempHome(t)
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { balance: 1 }) })
  await store.ensureReady()
  store.state.formOpen = true
  store.state.form = emptyForm()
  let effect = await store.actions.preset({}, { locale: 'zh-CN', value: { bind: 'data.form.preset', value: 'deepseek' } })
  assert.equal(effect.type, 'patch')
  assert.equal(store.state.form.balancePath, 'balance_infos[0].total_balance')
  assert.equal(store.state.form.name, 'DeepSeek')
  assert.equal(store.state.form.secret, '')

  store.state.form.name = '我的服务'
  store.state.form.url = 'https://custom.example.com/balance'
  effect = await store.actions.preset({}, { locale: 'zh-CN', value: { bind: 'data.form.preset', value: 'newapi' } })
  assert.equal(store.state.form.name, '我的服务')
  assert.equal(store.state.form.url, 'https://custom.example.com/balance')
  assert.equal(store.state.form.divisor, 500000)
  assert.equal(effect.type, 'patch')
})

test('actions: save 校验失败给人话 toast，不写文件', async (t) => {
  const home = await tempHome(t)
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { balance: 1 }) })
  await store.ensureReady()
  await store.actions.add({}, { locale: 'zh-CN' })
  const effect = await store.actions.save({}, {
    locale: 'zh-CN',
    value: {
      values: {
        'data.form.name': '',
        'data.form.url': 'https://api.example.com/balance',
        'data.form.secret': 'sk-x',
        'data.form.balancePath': 'data.balance',
      },
    },
  })
  assert.equal(effect.type, 'toast')
  assert.equal(effect.text, '请填名称')
  const configExists = await fs.access(configPath(home)).then(() => true, () => false)
  assert.equal(configExists, false)
})

test('actions: save 成功落盘、清空表单、toast 已保存', async (t) => {
  const home = await tempHome(t)
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { balance: 1 }) })
  await store.ensureReady()
  await store.actions.add({}, { locale: 'zh-CN' })
  const effects = await store.actions.save({}, {
    locale: 'zh-CN',
    value: {
      values: {
        'data.form.name': '我的服务',
        'data.form.url': 'https://api.example.com/balance',
        'data.form.authType': 'bearer',
        'data.form.secret': 'sk-test-secret-abcdef',
        'data.form.balancePath': 'data.balance',
        'data.form.divisor': '1',
        'data.form.multiplier': '500000',
        'data.form.decimals': 2,
        'data.form.enabled': true,
      },
    },
  })
  assert.equal(effectTypes(effects).includes('toast'), true)
  assert.equal(effects.at(-1).text, '已保存')
  assert.equal(store.state.formOpen, false)
  assert.equal(store.state.config.providers.length, 1)
  const saved = await loadConfig(configPath(home))
  assert.equal(saved.providers.length, 1)
  assert.equal(saved.providers[0].name, '我的服务')
  assert.equal(saved.providers[0].multiplier, 500000)
  assert.equal(saved.providers[0].secret, 'sk-test-secret-abcdef')
  assert.equal(store.state.selectedId, saved.providers[0].id)
})

test('actions: delete 先确认再删除，并清 results 缓存', async (t) => {
  const home = await tempHome(t)
  const provider = makeProvider()
  await saveConfig({ v: 1, providers: [provider], settings: { stripEnabled: true, refreshOnOpen: false, timeoutMs: 12000 } }, configPath(home))
  await saveResults({ v: 1, results: { [provider.id]: makeResult(provider.id) } }, resultsPath(home))
  const { ctx, regs } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { balance: 1 }) })
  await store.ensureReady()
  store.state.selectedId = provider.id

  let effects = await store.actions.delete({}, { locale: 'zh-CN' })
  assert.equal(effectTypes(effects).includes('refresh'), true)
  assert.deepEqual(store.state.confirmDelete, { id: provider.id })
  const patch = effects.find((effect) => effect.type === 'patch')
  assert.equal(patch.data.confirmDelete.text, '确定删除「DeepSeek」？')

  effects = await store.actions.delete({}, { locale: 'zh-CN', value: { confirmed: false } })
  assert.equal(store.state.confirmDelete, null)
  assert.equal(store.state.config.providers.length, 1)

  await store.actions.delete({}, { locale: 'zh-CN' })
  effects = await store.actions.delete({}, { locale: 'zh-CN', value: { confirmed: true } })
  assert.equal(store.state.config.providers.length, 0)
  assert.equal(store.state.selectedId, '')
  assert.equal(effects.at(-1).text, '已删除')
  assert.equal(store.state.results[provider.id], undefined)
  const saved = await loadConfig(configPath(home))
  assert.equal(saved.providers.length, 0)
})

test('actions: refresh 用 pending + patch/toast，signal 取消立即返回空', async (t) => {
  const home = await tempHome(t)
  const provider = makeProvider()
  await saveConfig({ v: 1, providers: [provider], settings: { stripEnabled: true, refreshOnOpen: false, timeoutMs: 12000 } }, configPath(home))
  let seenAuthorization = ''
  let fetchCalls = 0
  const { ctx } = fakeHost()
  const store = apply(ctx, {
    home,
    now: () => FIXED_NOW,
    fetchImpl: async (url, init) => {
      fetchCalls += 1
      seenAuthorization = init.headers.Authorization
      return response(200, { data: { balance: 12.5 } })
    },
  })
  await store.ensureReady()
  store.state.selectedId = provider.id
  store.state.config.providers = [provider]
  const handler = store.actions.refresh({}, { locale: 'zh-CN' })
  assert.equal(handler.pending.label, '正在刷新')
  assert.ok([...handler.pending.label].length <= 16)
  assert.equal(handler.pending.timeoutMs, 30000)
  assert.equal(typeof handler.result, 'function')

  const aborted = new AbortController()
  aborted.abort()
  assert.deepEqual(await handler.result(aborted.signal), {})

  const effects = await handler.result(new AbortController().signal)
  assert.equal(fetchCalls, 1)
  assert.equal(seenAuthorization, `Bearer ${provider.secret}`)
  assert.deepEqual(effectTypes(effects), ['patch', 'toast'])
  assert.equal(effects[0].data.total.text, '¥12.50')
  assert.equal(effects[1].text, '已更新 1 家')
  assert.ok(!JSON.stringify(effects).includes(provider.secret))
})

test('actions: test 用 preview 并在 patch 前脱敏密钥/用户名', async (t) => {
  const home = await tempHome(t)
  const provider = makeProvider({ secret: 'sk-super-secret-9999', username: 'alice-user' })
  await saveConfig({ v: 1, providers: [provider], settings: { stripEnabled: true, refreshOnOpen: false, timeoutMs: 12000 } }, configPath(home))
  const { ctx } = fakeHost()
  const store = apply(ctx, {
    home,
    now: () => FIXED_NOW,
    fetchImpl: async () => response(200, {
      data: { balance: 3 },
      echo_key: 'sk-super-secret-9999',
      echo_user: 'alice-user',
      authorization: 'Bearer abcdefghijklmnop',
    }),
  })
  await store.ensureReady()
  store.state.selectedId = provider.id
  store.state.config.providers = [provider]
  const handler = store.actions.test({}, { locale: 'zh-CN' })
  assert.equal(handler.pending.label, '正在测试')
  assert.equal(handler.pending.timeoutMs, 30000)
  const effects = await handler.result(new AbortController().signal)
  assert.deepEqual(effectTypes(effects), ['patch', 'toast'])
  assert.equal(effects[1].text, '测试成功')
  const raw = effects[0].data.test.raw
  assert.ok(raw.includes('••••'))
  assert.ok(!raw.includes('sk-super-secret-9999'))
  assert.ok(!raw.includes('alice-user'))
  assert.ok(!raw.includes('abcdefghijklmnop'))
  assert.equal(store.state.test.id, provider.id)
  const effectJson = JSON.stringify(effects)
  assert.ok(!effectJson.includes(provider.secret))
  assert.ok(Buffer.byteLength(effectJson) <= 16384, 'patch 数据超 16 KiB')
  assert.equal(store.state.results[provider.id].rawPreview, null, '缓存里不保留原始返回')
})

test('actions: refresh 没有服务时给 toast，测试前没选服务也给人话', async (t) => {
  const home = await tempHome(t)
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { balance: 1 }) })
  await store.ensureReady()
  const refresh = store.actions.refresh({}, { locale: 'en-US' })
  assert.deepEqual(await refresh.result(new AbortController().signal), { toast: 'No services yet' })
  const testHandler = store.actions.test({}, { locale: 'zh-CN' })
  assert.deepEqual(await testHandler.result(new AbortController().signal), { toast: '先选一个服务' })
})

test('panelView: v2 但缺 emptyState/codeBlock 时用 callout/text 兜底', () => {
  const caps = { protocol: 1, locale: 'zh-CN', components: ['stack', 'metric', 'actions', 'list', 'callout', 'text', 'form', 'tabs', 'textField', 'select', 'toggle', 'number', 'stepper', 'keyValue'] }
  const empty = panelView(freshState(), caps)
  const emptyJson = JSON.stringify(empty)
  assert.ok(emptyJson.includes('"callout"'))
  assert.ok(!emptyJson.includes('"emptyState"'))
  const tested = stateWithProvider({ selectedId: 'p_abc12345' })
  tested.test = { id: 'p_abc12345', title: '测试', raw: '{"a":1}' }
  const testedView = panelView(tested, caps)
  const testedJson = JSON.stringify(testedView)
  assert.ok(!testedJson.includes('"codeBlock"'))
  assert.ok(testedJson.includes('data.test.raw'))
  assertResolvable(testedView, panelData(tested, caps), 'fallback-text')
  assertStructure(empty, panelData(freshState(), caps), 'fallback-empty')
})
