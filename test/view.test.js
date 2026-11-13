import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { configPath, resultsPath, saveConfig, saveResults, loadConfig } from '../lib/config.js'
import { getByPath } from '../lib/extract.js'
import { presetDraft } from '../lib/presets.js'
import {
  FORM_LIMITS,
  createState,
  detailTextOf,
  draftForm,
  emptyForm,
  hasComponent,
  normalizeSiteBase,
  panelData,
  panelView,
  parseDetailText,
  providerForm,
  stripData,
  unitOf,
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
    usage: [],
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
  assert.ok(Array.isArray(data.cards), `${label}: 缺少 data.cards`)
  assert.ok(Array.isArray(data.rows) && data.rows.length <= 50, `${label}: v1 list 行数`)
  assert.equal(data.cards.length, data.rows.length, `${label}: cards 与 rows 同序同数`)
  for (const card of data.cards) {
    assert.equal(typeof card.name, 'string', `${label}: card.name`)
    assert.equal(typeof card.balance, 'string', `${label}: card.balance`)
    assert.equal(typeof card.status, 'string', `${label}: card.status`)
    assert.equal(typeof card.error, 'string', `${label}: card.error`)
    for (const slot of ['usage0', 'usage1']) {
      const usage = card[slot]
      if (usage !== null) {
        assert.equal(typeof usage.label, 'string', `${label}: ${slot}.label`)
        assert.equal(typeof usage.value, 'string', `${label}: ${slot}.value`)
      }
    }
    assert.equal(findUndefined(card), null, `${label}: card 里有 undefined`)
  }
  assert.equal(findUndefined(data), null, `${label}: 数据里有 undefined`)
  assert.ok(Buffer.byteLength(JSON.stringify(data)) <= 32768, `${label}: 数据超 32 KiB`)
}

function samples () {
  const empty = freshState()

  const cards = freshState()
  cards.config.providers.push(
    makeProvider(),
    makeProvider({
      id: 'p_def67890',
      name: '中转',
      preset: 'newapi',
      url: 'https://relay.example.com/api/user/self',
      usageUrl: 'https://relay.example.com/api/data/self?start_timestamp={7d}&end_timestamp={now}',
      usageArrayPath: 'data',
      usageFields: [{ label: '近7天 Token', path: 'token_used' }, { label: '近7天 请求', path: 'count' }],
      divisor: 500000,
      balancePath: 'data.quota',
      symbol: '¥',
      secret: 'sk-relay-token',
    }),
    makeProvider({ id: 'p_ghi24680', name: '自定义', preset: 'custom', symbol: '$' }),
  )
  cards.config.providers[2].enabled = false
  cards.results.p_abc12345 = makeResult('p_abc12345', {
    usage: [{ label: '近7天 Token', value: 1554060713 }, { label: '近7天 请求', value: 6837 }],
  })
  cards.results.p_def67890 = makeResult('p_def67890', {
    ok: false,
    balance: null,
    error: '密钥或令牌无效',
    details: [],
    usage: [{ label: '近7天 请求', value: 12 }],
  })

  const formNew = freshState({ formOpen: true, form: emptyForm() })

  const formEdit = freshState({ formOpen: true, editingId: 'p_abc12345' })
  formEdit.config.providers.push(makeProvider())
  formEdit.form = providerForm(formEdit.config.providers[0])

  const confirm = stateWithProvider({ confirmDelete: { id: 'p_abc12345' } })

  const tested = stateWithProvider()
  tested.test = { id: 'p_abc12345', title: 'DeepSeek · 接口原始返回（已脱敏）', raw: '{"balance":12.5}' }

  const worst = freshState({ formOpen: true, confirmDelete: { id: 'p_00000000' } })
  for (let index = 0; index < 24; index++) {
    const preset = ['deepseek', 'newapi', 'custom'][index % 3]
    const provider = makeProvider({
      id: `p_${String(index).padStart(8, '0')}`,
      name: `服务 ${index}`,
      preset,
      usageUrl: preset === 'deepseek' ? '' : 'https://relay.example.com/api/data/self',
      usageFields: preset === 'deepseek' ? [] : [{ label: '近7天 Token', path: 'token_used' }],
    })
    worst.config.providers.push(provider)
    worst.results[provider.id] = makeResult(provider.id, {
      usage: preset === 'deepseek' ? [] : [{ label: '近7天 Token', value: 1554060713 }],
    })
  }
  worst.form = providerForm(worst.config.providers[0])
  worst.test = { id: worst.config.providers[0].id, title: 'x'.repeat(20), raw: 'x'.repeat(8000) }

  const picking = freshState({ pickTemplate: true })
  const deepseekForm = freshState({ formOpen: true, form: draftForm(presetDraft('deepseek')) })
  const newapiForm = freshState({ formOpen: true, form: draftForm(presetDraft('newapi')) })
  return { empty, cards, formNew, formEdit, confirm, tested, worst, picking, deepseekForm, newapiForm }
}

// ---------- 文案 ----------// ---------- 文案 ----------

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
    assert.ok([...dictionary.deleteConfirmQuestion].length <= 24)
    assert.equal(dictionary.cancel, locale === 'zh' ? '取消' : 'Cancel')
    assert.ok([...dictionary.emptyTitle].length <= 40, '空状态标题')
    assert.ok([...dictionary.emptyMessage].length <= 120, '空状态说明')
    assert.ok([...dictionary.pendingRefresh].length <= 16, 'pending 标签')
    assert.ok([...dictionary.pendingTest].length <= 16, 'pending 标签')
    assert.ok([...dictionary.refreshed(12)].length <= 40, 'toast')
    assert.ok([...dictionary.saved].length <= 40, 'toast')
    assert.ok([...dictionary.upgradeHint].length <= 2000, '升级提示')
    for (const section of [dictionary.tabCommonLabel, dictionary.tabAdvancedLabel]) {
      assert.ok([...section].length <= 24, '页签标签')
    }
    assert.ok([...dictionary.chooseTemplate].length <= 24)
    assert.ok([...dictionary.deepseekCaption].length <= 200)
    assert.ok([...dictionary.newapiCaption].length <= 200)
    for (const [key, label] of Object.entries(dictionary.fields)) {
      assert.ok(label.trim() !== '', `${locale}.fields.${key} 标签为空`)
      assert.ok([...label].length <= 200, `${locale}.fields.${key} 标签过长`)
    }
    assert.deepEqual(dictionary.presets.map((item) => item.value).sort(), ['custom', 'deepseek', 'newapi'])
    assert.equal(Object.keys(dictionary.authNames).length, 6)
  }
})

// ---------- 视图结构 ----------

test('panelView: v2 根节点、无 minApp、自定义表单两页签与必填字段', () => {
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
  assert.ok(!json.includes('data.form.preset'), '表单里不再有 preset select')
  assert.ok(!json.includes('onChange'), '不再有 preset onChange')
  const binds = collectInputs(view).map((item) => item.bind)
  for (const field of ['name', 'url', 'method', 'authType', 'secret', 'balancePath', 'symbol', 'currencyPath', 'detailText', 'divisor', 'multiplier', 'decimals', 'headersText', 'bodyText', 'usageUrl', 'usageArrayPath', 'usageFieldsText', 'usageScale', 'enabled']) {
    assert.ok(binds.includes(`data.form.${field}`), `缺少表单字段 ${field}`)
  }
  assert.equal(new Set(binds).size, binds.length, '表单字段不能重复绑定')
  assert.equal(collectInputs(view).length, 26)
  const tabs = nodesOfType(view, 'tabs')[0]
  assert.equal(tabs.items.length, 2, '自定义表单是 常用/高级 两个页签')
  assert.deepEqual(tabs.items.map((item) => item.label), [words('zh').tabCommonLabel, words('zh').tabAdvancedLabel])
  const common = collectInputs(tabs.items[0])
  const advanced = collectInputs(tabs.items[1])
  for (const field of ['name', 'url', 'authType', 'secret', 'balancePath', 'symbol']) {
    assert.ok(common.some((input) => input.bind === `data.form.${field}`), `${field} 应在常用页签`)
  }
  for (const field of ['currencyPath', 'detailText', 'divisor', 'headersText', 'bodyText', 'usageUrl', 'usageScale']) {
    assert.ok(advanced.some((input) => input.bind === `data.form.${field}`), `${field} 应在高级页签`)
  }
  const balanceInput = collectInputs(view).find((item) => item.bind === 'data.form.balancePath')
  assert.equal(balanceInput.required, true)
  assert.equal(balanceInput.placeholder, words('zh').balancePathHint)
  assert.ok(JSON.stringify(view).includes('{7d}'), '用量地址 placeholder 带 {7d} 说明')
})

test('panelView: 添加向导先出三种服务类型（list 行内 choose-template）', () => {
  const view = panelView(freshState({ pickTemplate: true }), FULL_CAPS)
  assert.deepEqual(childrenTypes(view), ['emptyState', 'text', 'list', 'actions'])
  const list = view.children.find((child) => child.type === 'list')
  assert.equal(list.items.length, 3)
  assert.deepEqual(list.items.map((item) => item.action), [
    { id: 'choose-template', args: { preset: 'deepseek' } },
    { id: 'choose-template', args: { preset: 'newapi' } },
    { id: 'choose-template', args: { preset: 'custom' } },
  ])
  assert.deepEqual(list.items.map((item) => item.title), words('zh').presets.map((item) => item.label))
  assert.ok(!JSON.stringify(view).includes('"form"'), '选类型阶段不出表单')

  const withProvider = stateWithProvider({ pickTemplate: true })
  assert.deepEqual(childrenTypes(panelView(withProvider, FULL_CAPS)), ['stack', 'text', 'list', 'actions'])
})

test('panelView: 模板表单只显示关键字段（deepseek 2 项 / newapi autoUnit 显隐）', () => {
  const deepseek = freshState({ formOpen: true })
  deepseek.form = draftForm(presetDraft('deepseek'))
  const deepseekView = panelView(deepseek, FULL_CAPS)
  const deepseekInputs = collectInputs(deepseekView)
  assert.deepEqual(deepseekInputs.map((input) => input.bind), ['data.form.name', 'data.form.secret'])
  assert.ok(JSON.stringify(deepseekView).includes('/user/balance'))
  assert.ok(JSON.stringify(deepseekView).includes('"caption"') || JSON.stringify(deepseekView).includes('自动'))

  const newapi = freshState({ formOpen: true })
  newapi.form = draftForm(presetDraft('newapi'))
  newapi.form.autoUnit = true
  const newapiView = panelView(newapi, FULL_CAPS)
  const newapiInputs = collectInputs(newapiView)
  assert.deepEqual(newapiInputs.map((input) => input.bind), [
    'data.form.name',
    'data.form.siteBase',
    'data.form.secret',
    'data.form.autoUnit',
  ])
  const autoUnitInput = newapiInputs.find((input) => input.bind === 'data.form.autoUnit')
  assert.equal(autoUnitInput.type, 'toggle')
  assert.equal(autoUnitInput.label, words('zh').fields.autoUnit)
  assert.equal(autoUnitInput.onChange, 'auto-unit')
  const siteInput = newapiInputs.find((input) => input.bind === 'data.form.siteBase')
  assert.equal(siteInput.required, true)
  assert.equal(siteInput.maxLength, FORM_LIMITS.siteBase)
  assert.equal(siteInput.placeholder, words('zh').siteBasePlaceholder)
  assert.ok(!JSON.stringify(newapiView).includes('data.form.url'), 'newapi 不显示裸 url')
  assert.ok(JSON.stringify(newapiView).includes('OpenAI 接入地址'), 'caption 提示可以填 /v1 接入地址')
  assert.ok(JSON.stringify(newapiView).includes('会自动去掉'))
  assert.equal(nodesOfType(newapiView, 'tabs').length, 0)
  assert.ok(!JSON.stringify(newapiView).includes('data.form.symbol'), 'autoUnit 开时隐藏货币符号')
  assert.ok(!JSON.stringify(newapiView).includes('data.form.multiplier'), 'autoUnit 开时隐藏乘数')

  // 关掉 autoUnit 后显示货币符号/乘数
  const manual = freshState({ formOpen: true })
  manual.form = draftForm(presetDraft('newapi'))
  manual.form.autoUnit = false
  const manualInputs = collectInputs(panelView(manual, FULL_CAPS)).map((input) => input.bind)
  for (const bind of ['data.form.symbol', 'data.form.multiplier', 'data.form.autoUnit']) {
    assert.ok(manualInputs.includes(bind), `手动单位时应有 ${bind}`)
  }
})

test('panelView: 所有状态下的绑定路径都能在 panelData 找到', () => {
  for (const [name, state] of Object.entries(samples())) {
    const caps = name === 'worst' ? { ...FULL_CAPS, locale: 'en-US' } : FULL_CAPS
    assertResolvable(panelView(state, caps), panelData(state, caps), name)
  }
})

test('panelData: cards 与 providers 同序，含名称/余额/用量/状态/错误', () => {
  const state = stateWithProvider()
  state.config.providers[0].usageUrl = 'https://relay.example.com/api/data/self'
  state.config.providers[0].usageFields = [
    { label: '近7天 Token', path: 'token_used' },
    { label: '近7天 请求', path: 'count' },
  ]
  state.results.p_abc12345 = makeResult('p_abc12345', {
    usage: [{ label: '近7天 Token', value: 1554060713 }, { label: '近7天 请求', value: 6837 }],
  })
  const data = panelData(state, FULL_CAPS)
  assert.equal(Object.hasOwn(data, 'total'), false, '不再有总余额')
  assert.equal(Object.hasOwn(data, 'detail'), false, '不再有选中详情')
  assert.equal(Object.hasOwn(data, 'confirmDelete'), false)
  assert.equal(data.cards.length, 1)
  assert.deepEqual(Object.keys(data.cards[0]).sort(), ['balance', 'error', 'name', 'status', 'usage0', 'usage1'])
  assert.equal(data.cards[0].name, 'DeepSeek')
  assert.equal(data.cards[0].balance, '¥1,234.50')
  assert.deepEqual(data.cards[0].usage0, { label: '近7天 Token', value: '15.5亿' })
  assert.deepEqual(data.cards[0].usage1, { label: '近7天 请求', value: '6,837' })
  assert.equal(data.cards[0].status, '成功 · 09:12')
  assert.equal(data.cards[0].error, '')
  assert.equal(Object.hasOwn(data, 'cardChoice0'), false, 'chips 数据已移除')
  assert.equal(Object.hasOwn(data, 'cardConfirm0'), false)
  assert.equal(Object.hasOwn(data, 'test'), false, '测试结果块数据已移除')
  assert.equal(data.rows.length, 1, 'v1 仍用列表摘要')

  state.results.p_abc12345 = makeResult('p_abc12345', { ok: false, balance: null, error: '密钥或令牌无效' })
  const failedCard = panelData(state, FULL_CAPS).cards[0]
  assert.equal(failedCard.balance, '—')
  assert.equal(failedCard.error, '密钥或令牌无效')
  assert.ok(failedCard.status.startsWith('失败'), failedCard.status)

  const never = freshState()
  never.config.providers.push(makeProvider())
  const neverCard = panelData(never, FULL_CAPS).cards[0]
  assert.equal(neverCard.balance, '—')
  assert.equal(neverCard.status, '还没查过')
  assert.equal(neverCard.usage0, null)
  assert.equal(neverCard.usage1, null)
  assert.deepEqual(stripData(state, FULL_CAPS), { text: '' })
})

test('列表副标题：拼最多 2 项用量，整行 ≤60 字，无用量保持原样', () => {
  const base = stateWithProvider()
  const row = panelData(base, FULL_CAPS).rows[0]
  assert.equal(row.subtitle, '成功 · 09:12')
  assert.ok(!row.subtitle.includes('· ·'))

  const withUsage = stateWithProvider()
  withUsage.results.p_abc12345 = makeResult('p_abc12345', {
    usage: [
      { label: '近7天 Token', value: 1554060713 },
      { label: '近7天 请求', value: 6837 },
      { label: '第三项', value: 1 },
    ],
  })
  const usageRow = panelData(withUsage, FULL_CAPS).rows[0]
  assert.ok(usageRow.subtitle.startsWith('成功 · '), usageRow.subtitle)
  assert.ok(usageRow.subtitle.includes('近7天 Token 15.5亿'), usageRow.subtitle)
  assert.ok(usageRow.subtitle.includes('近7天 请求 6,837'), usageRow.subtitle)
  assert.ok(!usageRow.subtitle.includes('第三项'), '最多拼 2 项')
  assert.ok([...usageRow.subtitle].length <= 60, '副标题整行 ≤60 字')

  const english = panelData(withUsage, { ...FULL_CAPS, locale: 'en-US' }).rows[0]
  assert.ok(english.subtitle.includes('1.6B'), english.subtitle)
  assert.ok(english.subtitle.includes('6.8K'), english.subtitle)

  const scaled = stateWithProvider()
  scaled.config.providers[0].usageScale = true
  scaled.config.providers[0].divisor = 500000
  scaled.results.p_abc12345 = makeResult('p_abc12345', { usage: [{ label: '额度', value: 1000000 }] })
  assert.ok(panelData(scaled, FULL_CAPS).rows[0].subtitle.includes('额度 ¥2.00'))

  const failed = stateWithProvider()
  failed.results.p_abc12345 = makeResult('p_abc12345', {
    ok: false, balance: null, details: [],
    usage: [{ label: '近7天 请求', value: 6837 }],
  })
  assert.ok(panelData(failed, FULL_CAPS).rows[0].subtitle.includes('6,837'))

  const longLabel = stateWithProvider()
  longLabel.results.p_abc12345 = makeResult('p_abc12345', {
    usage: [
      { label: '很长的用量标签'.repeat(3), value: 1554060713 },
      { label: '另一个很长的用量标签'.repeat(3), value: 6837 },
    ],
  })
  const longSubtitle = panelData(longLabel, FULL_CAPS).rows[0].subtitle
  assert.equal([...longSubtitle].length, 60, longSubtitle)
  assert.ok(longSubtitle.endsWith('…'), longSubtitle)

  const disabled = stateWithProvider()
  disabled.config.providers[0].enabled = false
  disabled.results.p_abc12345 = makeResult('p_abc12345', { usage: [{ label: '请求', value: 9 }] })
  assert.equal(panelData(disabled, FULL_CAPS).rows[0].subtitle, '已停用')
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
  assert.equal(Object.keys(values).length, 26)
  for (const field of ['name', 'url', 'balancePath']) {
    const input = inputs.find((item) => item.bind === `data.form.${field}`)
    assert.equal(input.required, true, `${field} 应必填`)
  }
  const secret = inputs.find((item) => item.bind === 'data.form.secret')
  assert.equal(secret.required, true, '新建时密钥必填')
  assert.equal(secret.placeholder, words('zh').secretPlaceholderNew)
})

test('FORM_LIMITS: 按 spec §11.4 收紧，含用量字段', () => {
  assert.deepEqual(FORM_LIMITS, {
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
  const view = panelView(freshState({ formOpen: true }), FULL_CAPS)
  for (const input of collectInputs(view)) {
    const field = input.bind.slice('data.form.'.length)
    if (Object.hasOwn(FORM_LIMITS, field)) assert.equal(input.maxLength, FORM_LIMITS[field], field)
  }
})

// ---------- 安全 ----------

test('安全：视图与数据里不出现密钥/用户名（连打码值也不放）', () => {
  const state = stateWithProvider({ formOpen: true })
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
  const state = freshState()
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

test('布局顺序：空状态/卡片 → 测试结果 → 向导/表单 → 底部 actions（无总余额/列表）', () => {
  const empty = panelView(freshState(), FULL_CAPS)
  assert.deepEqual(childrenTypes(empty), ['emptyState', 'actions'])
  assert.ok(!JSON.stringify(empty).includes('"metric"'))
  assert.ok(!JSON.stringify(empty).includes('"list"'))
  assert.deepEqual(bottomActions(empty).items.map((item) => item.action), ['refresh', 'add'])

  const one = stateWithProvider()
  assert.deepEqual(childrenTypes(panelView(one, FULL_CAPS)), ['stack', 'actions'])

  const two = stateWithProvider()
  two.config.providers.push(makeProvider({ id: 'p_def67890', name: '第二家' }))
  assert.deepEqual(childrenTypes(panelView(two, FULL_CAPS)), ['stack', 'stack', 'actions'])

  const tested = stateWithProvider()
  tested.test = { id: 'p_abc12345', title: '测试', raw: '{"a":1}' }
  assert.deepEqual(childrenTypes(panelView(tested, FULL_CAPS)), ['stack', 'actions'], '测试结果块已移除')

  const picking = stateWithProvider({ pickTemplate: true })
  assert.deepEqual(childrenTypes(panelView(picking, FULL_CAPS)), ['stack', 'text', 'list', 'actions'])

  const form = stateWithProvider({ formOpen: true })
  form.form = providerForm(form.config.providers[0])
  const formView = panelView(form, FULL_CAPS)
  assert.deepEqual(childrenTypes(formView), ['stack', 'text', 'form', 'actions', 'actions'])
  assert.deepEqual(formView.children.at(-2).items.map((item) => item.action), ['form-cancel'])
  assert.deepEqual(bottomActions(formView).items.map((item) => item.action), ['refresh', 'add'])

  const formEmpty = panelView(freshState({ formOpen: true }), FULL_CAPS)
  assert.deepEqual(childrenTypes(formEmpty), ['emptyState', 'form', 'actions', 'actions'])
  assert.deepEqual(bottomActions(formEmpty).items.map((item) => item.action), ['refresh', 'add'])
})

test('卡片标题行：list 单行 title=服务名、action card-menu（右侧只有系统箭头）', () => {
  const view = panelView(stateWithProvider(), FULL_CAPS)
  const card = view.children[0]
  assert.equal(nodesOfType(card, 'chips').length, 0, '不再用 chips')
  assert.equal(nodesOfType(card, 'actions').length, 0)
  assert.equal(nodesOfType(card, 'grid').length, 0)
  const titleList = nodesOfType(card, 'list')[0]
  assert.ok(titleList, '缺少标题 list')
  assert.equal(titleList.items.length, 1)
  assert.deepEqual(titleList.items[0], {
    title: 'DeepSeek',
    action: { id: 'card-menu', args: { id: 'p_abc12345' } },
  })
  assert.equal(collectInputs(view).length, 0, '卡片不再产生 input')

  // 两家卡片 title/args 各自对齐
  const two = stateWithProvider()
  two.config.providers.push(makeProvider({ id: 'p_def67890', name: '第二家' }))
  const twoView = panelView(two, FULL_CAPS)
  const titles = twoView.children.filter((child) => child.type === 'stack').map((child) => nodesOfType(child, 'list')[0].items[0])
  assert.deepEqual(titles.map((item) => item.title), ['DeepSeek', '第二家'])
  assert.deepEqual(titles.map((item) => item.action.args.id), ['p_abc12345', 'p_def67890'])

  // 表单打开时标题行不可点
  const form = stateWithProvider({ formOpen: true })
  form.form = providerForm(form.config.providers[0])
  const formView = panelView(form, FULL_CAPS)
  const cardInForm = formView.children.find((child) => child.type === 'stack')
  const titleInForm = nodesOfType(cardInForm, 'list')[0].items[0]
  assert.equal(Object.hasOwn(titleInForm, 'action'), false)
  assert.equal(titleInForm.trailing, undefined)
})

test('卡片菜单：menuId 时 list 行 [编辑][删除 tone bad]', () => {
  const state = stateWithProvider({ menuId: 'p_abc12345' })
  const card = panelView(state, FULL_CAPS).children[0]
  const lists = nodesOfType(card, 'list')
  assert.equal(lists.length, 2, '标题行 + 菜单 list')
  assert.deepEqual(lists[1].items, [
    { title: words('zh').edit, action: { id: 'card-edit', args: { id: 'p_abc12345' } } },
    { title: words('zh').delete, tone: 'bad', action: { id: 'card-delete', args: { id: 'p_abc12345' } } },
  ])
  const other = stateWithProvider()
  other.config.providers.push(makeProvider({ id: 'p_def67890', name: '第二家' }))
  const otherView = panelView(other, FULL_CAPS)
  for (const child of otherView.children.filter((item) => item.type === 'stack')) {
    assert.equal(nodesOfType(child, 'list').length, 1, '只有被打开菜单的卡片才多一个 list')
  }
})

test('删除确认在卡片里：菜单换成确认 list，不再用 callout/confirm 组件', () => {
  const state = stateWithProvider({ confirmDelete: { id: 'p_abc12345' } })
  const card = panelView(state, FULL_CAPS).children[0]
  assert.equal(nodesOfType(card, 'confirm').length, 0)
  assert.equal(nodesOfType(card, 'chips').length, 0)
  const lists = nodesOfType(card, 'list')
  assert.equal(lists.length, 2)
  assert.deepEqual(lists[1].items, [
    { title: words('zh').deleteConfirmQuestion, tone: 'bad', action: { id: 'card-delete-confirm', args: { id: 'p_abc12345' } } },
    { title: words('zh').cancel, action: { id: 'card-delete-cancel', args: { id: 'p_abc12345' } } },
  ])
})

test('卡片内容：名称/余额/用量/状态；失败 callout；不再有 keyValue 详情', () => {
  const state = stateWithProvider()
  state.config.providers[0].usageUrl = 'https://relay.example.com/api/data/self'
  state.config.providers[0].usageFields = [
    { label: '近7天 Token', path: 'token_used' },
    { label: '近7天 请求', path: 'count' },
  ]
  state.results.p_abc12345 = makeResult('p_abc12345', {
    usage: [{ label: '近7天 Token', value: 1554060713 }, { label: '近7天 请求', value: 6837 }],
  })
  const view = panelView(state, FULL_CAPS)
  const json = JSON.stringify(view)
  assert.ok(!json.includes('"keyValue"'), '卡片里不再有 keyValue 详情')
  assert.ok(!json.includes('服务详情'))
  const card = view.children[0]
  const titleRow = nodesOfType(card, 'list')[0].items[0]
  assert.equal(titleRow.title, 'DeepSeek')
  const texts = nodesOfType(card, 'text')
  assert.equal(texts.length, 2, '余额 / 状态')
  assert.equal(texts[0].text.$, 'data.cards[0].balance')
  assert.equal(texts[1].text.$, 'data.cards[0].status')
  assert.equal(texts[0].style.weight, 'bold')
  const metrics = nodesOfType(card, 'metric')
  assert.equal(metrics.length, 2, '两个用量 metric 并排')
  assert.deepEqual(metrics.map((metric) => metric.label.$), [
    'data.cards[0].usage0.label',
    'data.cards[0].usage1.label',
  ])
  assert.deepEqual(metrics.map((metric) => metric.value.$), [
    'data.cards[0].usage0.value',
    'data.cards[0].usage1.value',
  ])
  const row = nodesOfType(card, 'row')[0]
  assert.equal(row.style.columns, 'equal')
  assert.deepEqual(row.children.map((child) => child.type), ['metric', 'metric'])

  // 只配置 1 个用量字段时单个 metric，不套 row
  const oneUsage = stateWithProvider()
  oneUsage.config.providers[0].usageUrl = 'https://relay.example.com/api/data/self'
  oneUsage.config.providers[0].usageFields = [{ label: '近7天 Token', path: 'token_used' }]
  oneUsage.results.p_abc12345 = makeResult('p_abc12345', { usage: [{ label: '近7天 Token', value: 1554060713 }] })
  const oneCard = panelView(oneUsage, FULL_CAPS).children[0]
  assert.equal(nodesOfType(oneCard, 'metric').length, 1)
  assert.equal(nodesOfType(oneCard, 'row').length, 0)

  const noUsage = stateWithProvider()
  assert.equal(nodesOfType(panelView(noUsage, FULL_CAPS).children[0], 'metric').length, 0, '没配用量就不显示 metric')

  const failed = stateWithProvider()
  failed.results.p_abc12345 = makeResult('p_abc12345', { ok: false, balance: null, error: '密钥或令牌无效' })
  const failedView = panelView(failed, FULL_CAPS)
  const callout = nodesOfType(failedView.children[0], 'callout')[0]
  assert.equal(callout.tone, 'bad')
  assert.equal(callout.text.$, 'data.cards[0].error')

  const disabled = stateWithProvider()
  disabled.config.providers[0].enabled = false
  assert.equal(panelData(disabled, FULL_CAPS).cards[0].status, '已停用')
})

test('panelView: 缺 form/textField/tabs 时退成 v1 只读列表摘要 + 升级提示', () => {
  const state = stateWithProvider()
  for (const caps of [{}, { components: ['form'] }, { components: ['form', 'textField'] }]) {
    assert.equal(hasComponent(caps, 'tabs'), false)
    const view = panelView(state, caps)
    assert.equal(view.v, undefined, 'v1 视图不写 v')
    const json = JSON.stringify(view)
    for (const type of ['"form"', '"tabs"', '"textField"', '"metric"', '"grid"']) {
      assert.ok(!json.includes(type), `v1 不应包含 ${type}`)
    }
    assert.ok(json.includes('"list"'))
    assert.ok(json.includes('升级 App'), '缺少升级提示')
    assertResolvable(view, panelData(state, caps), 'v1')
    assertStructure(view, panelData(state, caps), 'v1')
  }
})

test('stripData: 不再显示总余额，始终返回空串（不联网）', () => {
  const withResult = stateWithProvider()
  assert.deepEqual(stripData(withResult, FULL_CAPS), { text: '' })
  assert.deepEqual(stripData(withResult, { ...FULL_CAPS, locale: 'en-US' }), { text: '' })
  assert.deepEqual(stripData(freshState(), FULL_CAPS), { text: '' })

  const failed = stateWithProvider()
  failed.results.p_abc12345 = makeResult('p_abc12345', { ok: false })
  assert.deepEqual(stripData(failed, FULL_CAPS), { text: '' })

  assert.equal(Object.hasOwn(stripData(withResult, FULL_CAPS), 'icon'), false)
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

test('表单草稿：usage 字段默认值与 newapi 反解成文本', () => {
  const empty = emptyForm()
  assert.equal(empty.usageUrl, '')
  assert.equal(empty.usageMethod, 'GET')
  assert.equal(empty.usageArrayPath, '')
  assert.equal(empty.usageFieldsText, '')
  assert.equal(empty.usageScale, false)

  const provider = makeProvider({
    usageUrl: 'https://relay.example.com/api/data/self?start_timestamp={7d}&end_timestamp={now}',
    usageMethod: 'GET',
    usageArrayPath: 'data',
    usageFields: [
      { label: '近7天 Token', path: 'token_used' },
      { label: '近7天 请求', path: 'count' },
    ],
    usageScale: false,
  })
  const form = providerForm(provider)
  assert.equal(form.usageUrl, provider.usageUrl)
  assert.equal(form.usageArrayPath, 'data')
  assert.equal(form.usageScale, false)
  assert.equal(form.usageFieldsText, '近7天 Token=token_used\n近7天 请求=count')
  assert.deepEqual(parseDetailText(form.usageFieldsText), provider.usageFields)
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
  for (const action of ['refresh', 'add', 'choose-template', 'form-cancel', 'save', 'card-menu', 'card-edit', 'card-delete', 'card-delete-confirm', 'card-delete-cancel']) {
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

test('actions: card-menu 切换菜单、card-edit 开表单、add/form-cancel 更新视图', async (t) => {
  const home = await tempHome(t)
  const { ctx, regs } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { data: { balance: 1 } }) })
  await store.ensureReady()
  store.state.config.providers.push(makeProvider())
  store.state.results.p_abc12345 = makeResult('p_abc12345')

  let effects = await store.actions['card-menu']({}, { locale: 'zh-CN', value: { id: 'p_abc12345' } })
  assert.equal(store.state.menuId, 'p_abc12345')
  assert.equal(effectTypes(effects).includes('patch'), true)
  assert.equal(effectTypes(effects).includes('refresh'), true)
  effects = await store.actions['card-menu']({}, { locale: 'zh-CN', value: { id: 'p_abc12345' } })
  assert.equal(store.state.menuId, '', '再点一次关闭菜单')

  effects = await store.actions['card-edit']({}, { locale: 'zh-CN', value: { id: 'p_abc12345' } })
  assert.equal(store.state.menuId, '')
  assert.equal(effectTypes(effects).includes('refresh'), true)
  assert.equal(store.state.formOpen, true)
  assert.equal(store.state.editingId, 'p_abc12345')
  assert.equal(store.state.form.secret, '')
  assert.equal(store.state.form.secretSet, true)
  assert.equal(store.state.form.name, 'DeepSeek')
  assert.deepEqual(effects[1], { type: 'refresh', id: 'balance' })
  assert.ok(regs.refreshIds.length > 0)

  effects = await store.actions.add({}, { locale: 'zh-CN' })
  assert.equal(store.state.pickTemplate, true, '添加先选服务类型')
  assert.equal(store.state.formOpen, false)
  assert.equal(effectTypes(effects).includes('refresh'), true)

  effects = await store.actions['choose-template']({}, { locale: 'zh-CN', value: { preset: 'deepseek' } })
  assert.equal(store.state.pickTemplate, false)
  assert.equal(store.state.formOpen, true)
  assert.equal(store.state.form.preset, 'deepseek')
  assert.equal(store.state.form.secret, '')
  assert.equal(store.state.form.secretSet, false)
  assert.equal(effectTypes(effects).includes('refresh'), true)

  effects = await store.actions['form-cancel']({}, { locale: 'zh-CN' })
  assert.equal(store.state.formOpen, false)
  assert.equal(store.state.pickTemplate, false)
  assert.equal(effectTypes(effects).includes('refresh'), true)
})

test('actions: choose-template 按类型生成模板表单，form-cancel 清状态', async (t) => {
  const home = await tempHome(t)
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { data: { balance: 1 } }) })
  await store.ensureReady()

  let effects = await store.actions.add({}, { locale: 'zh-CN' })
  assert.equal(store.state.pickTemplate, true)
  assert.equal(store.state.formOpen, false)

  effects = await store.actions['choose-template']({}, { locale: 'zh-CN', value: { preset: 'newapi' } })
  assert.equal(effectTypes(effects).includes('refresh'), true)
  assert.equal(store.state.pickTemplate, false)
  assert.equal(store.state.formOpen, true)
  assert.equal(store.state.form.preset, 'newapi')
  assert.equal(store.state.form.siteBase, '')
  assert.equal(store.state.form.balancePath, 'data.quota')
  assert.equal(store.state.form.divisor, 500000)
  assert.equal(store.state.form.usageArrayPath, 'data')
  assert.equal(store.state.form.usageFieldsText, '近7天 Token=token_used\n近7天 请求=count')
  assert.equal(store.state.form.symbol, '¥')
  assert.equal(store.state.form.multiplier, 1)

  effects = await store.actions['choose-template']({}, { locale: 'zh-CN', value: { preset: 'deepseek' } })
  assert.equal(store.state.form.preset, 'deepseek')
  assert.equal(store.state.form.name, 'DeepSeek')
  assert.equal(store.state.form.url, 'https://api.deepseek.com/user/balance')
  assert.equal(store.state.form.balancePath, 'balance_infos[0].total_balance')
  assert.equal(store.state.form.detailText, '充值余额=balance_infos[0].topped_up_balance\n赠送余额=balance_infos[0].granted_balance')

  effects = await store.actions['choose-template']({}, { locale: 'zh-CN', value: { preset: 'custom' } })
  assert.equal(store.state.form.preset, 'custom')
  assert.equal(store.state.form.name, '')
  assert.equal(store.state.form.usageUrl, '')

  effects = await store.actions['form-cancel']({}, { locale: 'zh-CN' })
  assert.equal(store.state.pickTemplate, false)
  assert.equal(store.state.formOpen, false)
  assert.equal(effectTypes(effects).includes('refresh'), true)
})

test('actions: save 校验失败给人话 toast，不写文件', async (t) => {
  const home = await tempHome(t)
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { balance: 1 }) })
  await store.ensureReady()
  await store.actions.add({}, { locale: 'zh-CN' })
  await store.actions['choose-template']({}, { locale: 'zh-CN', value: { preset: 'custom' } })
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
  await store.actions['choose-template']({}, { locale: 'zh-CN', value: { preset: 'custom' } })
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
  assert.equal(store.state.formOpen, false)
  const patch = effects.find((effect) => effect.type === 'patch')
  assert.equal(patch.data.cards.length, 1)
  assert.equal(patch.data.cards[0].name, '我的服务')
})

test('actions: save 解析 usageFieldsText、透传 usage 字段并落盘', async (t) => {
  const home = await tempHome(t)
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { data: { balance: 1 } }) })
  await store.ensureReady()
  await store.actions.add({}, { locale: 'zh-CN' })
  const usageUrl = 'https://relay.example.com/api/data/self?start_timestamp={7d}&end_timestamp={now}'
  const effects = await store.actions.save({}, {
    locale: 'zh-CN',
    value: {
      values: {
        'data.form.name': '中转',
        'data.form.url': 'https://relay.example.com/api/user/self',
        'data.form.secret': 'sk-relay-secret',
        'data.form.balancePath': 'data.quota',
        'data.form.usageUrl': usageUrl,
        'data.form.usageArrayPath': 'data',
        'data.form.usageFieldsText': '近7天 Token=token_used\n近7天 请求=count',
        'data.form.usageScale': true,
      },
    },
  })
  assert.equal(effectTypes(effects).includes('toast'), true)
  assert.equal(effects.at(-1).text, '已保存')
  const saved = (await loadConfig(configPath(home))).providers[0]
  assert.equal(saved.usageUrl, usageUrl)
  assert.equal(saved.usageMethod, 'GET')
  assert.equal(saved.usageArrayPath, 'data')
  assert.equal(saved.usageScale, true)
  assert.deepEqual(saved.usageFields, [
    { label: '近7天 Token', path: 'token_used' },
    { label: '近7天 请求', path: 'count' },
  ])
  assert.equal(Object.hasOwn(saved, 'usageFieldsText'), false, 'usageFieldsText 不落盘')
})

test('actions: save 填了用量地址但没填用量字段时给人话报错', async (t) => {
  const home = await tempHome(t)
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { data: { balance: 1 } }) })
  await store.ensureReady()
  await store.actions.add({}, { locale: 'zh-CN' })
  await store.actions['choose-template']({}, { locale: 'zh-CN', value: { preset: 'custom' } })
  const effect = await store.actions.save({}, {
    locale: 'zh-CN',
    value: {
      values: {
        'data.form.name': '中转',
        'data.form.url': 'https://relay.example.com/api/user/self',
        'data.form.secret': 'sk-relay-secret',
        'data.form.balancePath': 'data.quota',
        'data.form.usageUrl': 'https://relay.example.com/api/data/self',
      },
    },
  })
  assert.equal(effect.type, 'toast')
  assert.equal(effect.text, '填了用量地址就要填用量字段')
})

test('actions: card-delete 出确认、card-delete-cancel/confirm 分别取消/删除', async (t) => {
  const home = await tempHome(t)
  const provider = makeProvider()
  await saveConfig({ v: 1, providers: [provider], settings: { stripEnabled: true, refreshOnOpen: false, timeoutMs: 12000 } }, configPath(home))
  await saveResults({ v: 1, results: { [provider.id]: makeResult(provider.id) } }, resultsPath(home))
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { data: { balance: 1 } }) })
  await store.ensureReady()

  let effects = await store.actions['card-menu']({}, { locale: 'zh-CN', value: { id: provider.id } })
  assert.equal(store.state.menuId, provider.id)
  effects = await store.actions['card-delete']({}, { locale: 'zh-CN', value: { id: provider.id } })
  assert.equal(effectTypes(effects).includes('refresh'), true)
  assert.deepEqual(store.state.confirmDelete, { id: provider.id })
  assert.equal(store.state.menuId, '', '删除确认时收起菜单')
  const confirmView = store.panelView(FULL_CAPS)
  const confirmList = nodesOfType(confirmView, 'list').at(-1)
  assert.equal(confirmList.items[0].action.id, 'card-delete-confirm')

  effects = await store.actions['card-delete-cancel']({}, { locale: 'zh-CN', value: { id: provider.id } })
  assert.equal(store.state.confirmDelete, null)
  assert.equal(store.state.config.providers.length, 1)

  await store.actions['card-delete']({}, { locale: 'zh-CN', value: { id: provider.id } })
  effects = await store.actions['card-delete-confirm']({}, { locale: 'zh-CN', value: { id: provider.id } })
  assert.equal(store.state.config.providers.length, 0)
  assert.equal(store.state.confirmDelete, null)
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
  assert.equal(effects[0].data.cards[0].balance, '¥12.50')
  assert.equal(effects[0].data.cards[0].status, '成功 · 09:12')
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
  store.state.config.providers = [provider]
  const handler = store.actions.test({}, { locale: 'zh-CN', value: { id: provider.id } })
  assert.equal(handler.pending.label, '正在测试')
  assert.equal(handler.pending.timeoutMs, 30000)
  const effects = await handler.result(new AbortController().signal)
  assert.deepEqual(effectTypes(effects), ['patch', 'toast'])
  assert.equal(effects[1].text, '测试成功')
  const raw = store.state.test.raw
  assert.ok(raw.includes('••••'))
  assert.ok(!raw.includes('sk-super-secret-9999'))
  assert.ok(!raw.includes('alice-user'))
  assert.ok(!raw.includes('abcdefghijklmnop'))
  assert.equal(store.state.test.id, provider.id)
  assert.equal(Object.hasOwn(effects[0].data, 'test'), false, '视图不再有测试结果块')
  assert.equal(effects[0].data.cards[0].balance, '¥3.00')
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
  const withCard = stateWithProvider()
  const cardView = panelView(withCard, caps)
  assertResolvable(cardView, panelData(withCard, caps), 'fallback-card')
  assertStructure(empty, panelData(freshState(), caps), 'fallback-empty')
  assertStructure(cardView, panelData(withCard, caps), 'fallback-card')
})


// ---------- 模板向导：保存分支与自动刷新 ----------

test('表单草稿：providerForm 从 newapi url 反推 siteBase', () => {
  const provider = makeProvider({
    preset: 'newapi',
    url: 'https://relay.example.com/api/user/self',
    authType: 'bearer',
  })
  assert.equal(providerForm(provider).siteBase, 'https://relay.example.com')
  const broken = makeProvider({
    preset: 'newapi',
    url: 'https://sta1n.ai/v1/api/user/self',
    authType: 'bearer',
  })
  assert.equal(providerForm(broken).siteBase, 'https://sta1n.ai', '旧数据 /v1 打开编辑显示根地址')
  const usageUrlOnly = makeProvider({
    preset: 'newapi',
    url: 'https://sta1n.ai/api/data/self',
    authType: 'bearer',
  })
  assert.equal(providerForm(usageUrlOnly).siteBase, 'https://sta1n.ai')
  const custom = makeProvider({ url: 'https://relay.example.com/custom/balance' })
  assert.equal(providerForm(custom).siteBase, 'https://relay.example.com/custom/balance')
  const deepseek = providerForm(makeProvider({ preset: 'deepseek', url: 'https://api.deepseek.com/user/balance' }))
  assert.equal(deepseek.preset, 'deepseek')
  assert.equal(deepseek.secret, '')
  assert.equal(deepseek.secretSet, true)
})

test('actions: save deepseek 只收名称+密钥，自动组装固定字段并在保存后刷新', async (t) => {
  const home = await tempHome(t)
  let fetchCalls = 0
  const { ctx } = fakeHost()
  const store = apply(ctx, {
    home,
    now: () => FIXED_NOW,
    fetchImpl: async () => {
      fetchCalls += 1
      return response(200, { balance_infos: [{ total_balance: 12.5, currency: 'CNY' }] })
    },
  })
  await store.ensureReady()
  await store.actions.add({}, { locale: 'zh-CN' })
  await store.actions['choose-template']({}, { locale: 'zh-CN', value: { preset: 'deepseek' } })
  const effects = await store.actions.save({}, {
    locale: 'zh-CN',
    value: {
      values: {
        'data.form.name': '',
        'data.form.secret': 'sk-deepseek-key',
      },
    },
  })
  assert.equal(effects.at(-1).text, '已保存')
  const saved = (await loadConfig(configPath(home))).providers[0]
  assert.equal(saved.name, 'DeepSeek', '名称为空用默认名')
  assert.equal(saved.preset, 'deepseek')
  assert.equal(saved.url, 'https://api.deepseek.com/user/balance')
  assert.equal(saved.balancePath, 'balance_infos[0].total_balance')
  assert.equal(saved.currencyPath, 'balance_infos[0].currency')
  assert.deepEqual(saved.detailPaths, [
    { label: '充值余额', path: 'balance_infos[0].topped_up_balance' },
    { label: '赠送余额', path: 'balance_infos[0].granted_balance' },
  ])
  assert.deepEqual(saved.usageFields, [])
  assert.equal(saved.secret, 'sk-deepseek-key')
  // 保存成功后自动后台刷新，无需再点刷新
  await waitFor(() => fetchCalls > 0)
  await waitFor(() => store.state.results[saved.id] && store.state.results[saved.id].ok === true)
})

test('actions: save newapi 由 siteBase 组装 url/usage，名称为空用默认名', async (t) => {
  const home = await tempHome(t)
  const { ctx } = fakeHost()
  const store = apply(ctx, {
    home,
    now: () => FIXED_NOW,
    fetchImpl: async () => response(200, { data: { balance: 500000 } }),
  })
  await store.ensureReady()
  await store.actions.add({}, { locale: 'zh-CN' })
  await store.actions['choose-template']({}, { locale: 'zh-CN', value: { preset: 'newapi' } })
  const effects = await store.actions.save({}, {
    locale: 'zh-CN',
    value: {
      values: {
        'data.form.name': '',
        'data.form.siteBase': 'https://sta1n.ai/v1',
        'data.form.secret': 'sk-relay-token',
        'data.form.symbol': '$',
        'data.form.multiplier': 2,
      },
    },
  })
  assert.equal(effects.at(-1).text, '已保存')
  const saved = (await loadConfig(configPath(home))).providers[0]
  assert.equal(saved.name, 'new-api 中转')
  assert.equal(saved.preset, 'newapi')
  assert.equal(saved.url, 'https://sta1n.ai/api/user/self', '/v1 必须自动去掉')
  assert.equal(
    saved.usageUrl,
    'https://sta1n.ai/api/data/self?start_timestamp={7d}&end_timestamp={now}&default_time=day',
  )
  assert.equal(saved.usageArrayPath, 'data')
  assert.equal(saved.usageScale, false)
  assert.equal(saved.usageMethod, 'GET')
  assert.deepEqual(saved.usageFields, [
    { label: '近7天 Token', path: 'token_used' },
    { label: '近7天 请求', path: 'count' },
  ])
  assert.equal(saved.divisor, 500000)
  assert.equal(saved.multiplier, 2)
  assert.equal(saved.symbol, '$')
  assert.equal(saved.autoUnit, true, 'autoUnit 默认开并落盘')
  assert.equal(Object.hasOwn(saved, 'siteBase'), false, 'siteBase 是表单专用字段，不落盘')
})

test('actions: newapi 站点地址为空或非 http(s) 时给人话 toast，不写文件', async (t) => {
  const home = await tempHome(t)
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { data: { balance: 1 } }) })
  await store.ensureReady()
  const baseValues = {
    'data.form.name': '中转',
    'data.form.secret': 'sk-relay-token',
    'data.form.symbol': '¥',
    'data.form.multiplier': 1,
  }
  await store.actions.add({}, { locale: 'zh-CN' })
  await store.actions['choose-template']({}, { locale: 'zh-CN', value: { preset: 'newapi' } })
  let effect = await store.actions.save({}, {
    locale: 'zh-CN',
    value: { values: { ...baseValues, 'data.form.siteBase': '' } },
  })
  assert.equal(effect.type, 'toast')
  assert.equal(effect.text, '请填站点地址')

  effect = await store.actions.save({}, {
    locale: 'zh-CN',
    value: { values: { ...baseValues, 'data.form.siteBase': 'relay.example.com' } },
  })
  assert.equal(effect.type, 'toast')
  assert.equal(effect.text, '站点地址要以 http:// 或 https:// 开头')
  const configExists = await fs.access(configPath(home)).then(() => true, () => false)
  assert.equal(configExists, false)
})

test('actions: save custom 名称必填仍走原校验', async (t) => {
  const home = await tempHome(t)
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { data: { balance: 1 } }) })
  await store.ensureReady()
  await store.actions.add({}, { locale: 'zh-CN' })
  await store.actions['choose-template']({}, { locale: 'zh-CN', value: { preset: 'custom' } })
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
})


// ---------- v1.3：站点地址容错 ----------

test('normalizeSiteBase: 去尾斜杠、剥已知后台路径、剥 /v1、保留反代子路径', () => {
  const cases = [
    ['https://sta1n.ai', 'https://sta1n.ai'],
    ['  https://sta1n.ai/  ', 'https://sta1n.ai'],
    ['https://sta1n.ai//', 'https://sta1n.ai'],
    ['https://sta1n.ai/v1', 'https://sta1n.ai'],
    ['https://sta1n.ai/v1/', 'https://sta1n.ai'],
    ['https://sta1n.ai/V1', 'https://sta1n.ai'],
    ['https://sta1n.ai/v1/chat/completions', 'https://sta1n.ai'],
    ['https://sta1n.ai/api/user/self', 'https://sta1n.ai'],
    ['https://sta1n.ai/api/data/self', 'https://sta1n.ai'],
    ['https://sta1n.ai/v1/api/user/self', 'https://sta1n.ai'],
    ['https://sta1n.ai/api/user/self/v1', 'https://sta1n.ai'],
    ['https://sta1n.ai/newapi', 'https://sta1n.ai/newapi'],
    ['https://sta1n.ai/newapi/', 'https://sta1n.ai/newapi'],
    ['https://sta1n.ai/newapi/v1', 'https://sta1n.ai/newapi'],
    ['http://host:3000/v1/', 'http://host:3000'],
    ['sta1n.ai/v1', 'sta1n.ai/v1'],
    ['', ''],
  ]
  for (const [input, expected] of cases) {
    assert.equal(normalizeSiteBase(input), expected, JSON.stringify(input))
  }
  assert.equal(normalizeSiteBase(null), '')
  assert.equal(normalizeSiteBase(123), '')
  assert.doesNotThrow(() => normalizeSiteBase('not a url'))
})

test('actions: 编辑旧 newapi（url 带 /v1）反推根地址，保存即修正', async (t) => {
  const home = await tempHome(t)
  const broken = makeProvider({
    preset: 'newapi',
    url: 'https://sta1n.ai/v1/api/user/self',
    balancePath: 'data.quota',
  })
  await saveConfig({ v: 1, providers: [broken], settings: { stripEnabled: true, refreshOnOpen: false, timeoutMs: 12000 } }, configPath(home))
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { data: { balance: 1 } }) })
  await store.ensureReady()
  await store.actions['card-edit']({}, { locale: 'zh-CN', value: { id: broken.id } })
  assert.equal(store.state.form.siteBase, 'https://sta1n.ai')
  await store.actions.save({}, {
    locale: 'zh-CN',
    value: {
      values: {
        'data.form.name': broken.name,
        'data.form.siteBase': store.state.form.siteBase,
        'data.form.secret': '', // 留空 = 沿用已保存密钥
        'data.form.symbol': '¥',
        'data.form.multiplier': 1,
      },
    },
  })
  const saved = (await loadConfig(configPath(home))).providers[0]
  assert.equal(saved.url, 'https://sta1n.ai/api/user/self')
  assert.equal(
    saved.usageUrl,
    'https://sta1n.ai/api/data/self?start_timestamp={7d}&end_timestamp={now}&default_time=day',
  )
  assert.equal(saved.secret, broken.secret, '编辑留空沿用原密钥')
  assert.equal(saved.autoUnit, false, '旧配置缺 autoUnit 按 false')
})


// ---------- v1.4：卡片预算 ----------

test('卡片预算：服务很多时按节点预算截断并给提示，data.cards 仍与 providers 同序', () => {
  const state = freshState()
  for (let index = 0; index < 24; index++) {
    state.config.providers.push(makeProvider({
      id: `p_${String(index).padStart(8, '0')}`,
      name: `服务 ${index}`,
      preset: 'custom',
      usageUrl: 'https://relay.example.com/api/data/self',
    }))
    state.results[state.config.providers[index].id] = makeResult(state.config.providers[index].id, {
      usage: [{ label: '近7天 Token', value: 1554060713 }],
    })
  }
  const data = panelData(state, FULL_CAPS)
  assert.equal(data.cards.length, 24)
  assert.deepEqual(data.cards.map((card) => card.name), state.config.providers.map((provider) => provider.name))
  const view = panelView(state, FULL_CAPS)
  const stats = viewStats(view)
  assert.ok(stats.nodes <= 120, `节点 ${stats.nodes}`)
  assert.ok(Buffer.byteLength(JSON.stringify(view)) <= 32768)
  const cardCount = view.children.filter((child) => child.type === 'stack' && child.style && child.style.card === 'surface').length
  assert.ok(cardCount > 0 && cardCount <= 24, `显示 ${cardCount} 张卡片`)
  const last = view.children.at(-1)
  assert.equal(last.type, 'actions')
  const hint = view.children.find((child) => child.type === 'text' && typeof child.text === 'string' && child.text.includes('未显示'))
  if (cardCount < 24) {
    assert.ok(hint, '隐藏的服务要给一行提示')
    assert.ok(hint.text.includes(String(24 - cardCount)))
  } else {
    assert.equal(hint, undefined)
  }
  assertResolvable(view, data, 'many-cards')
})


// ---------- v1.5：chips 动作/确认 ----------

test('actions: 菜单动作缺 id、无确认态时都不误删', async (t) => {
  const home = await tempHome(t)
  const provider = makeProvider()
  await saveConfig({ v: 1, providers: [provider], settings: { stripEnabled: true, refreshOnOpen: false, timeoutMs: 12000 } }, configPath(home))
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { data: { balance: 1 } }) })
  await store.ensureReady()

  const noId = await store.actions['card-menu']({}, { locale: 'zh-CN', value: {} })
  assert.equal(noId.type, 'toast')
  assert.equal(store.state.menuId, '')

  const effects = await store.actions['card-delete-confirm']({}, { locale: 'zh-CN', value: { id: provider.id } })
  assert.equal(store.state.config.providers.length, 1, '没有确认态时不会误删')
  assert.equal(effectTypes(effects).includes('refresh'), true)
  assert.equal(store.state.confirmDelete, null)
})

test('卡片不再产生 input；多服务仍按节点预算截断并给提示', () => {
  const state = freshState()
  for (let index = 0; index < 24; index++) {
    state.config.providers.push(makeProvider({
      id: `p_${String(index).padStart(8, '0')}`,
      name: `服务 ${index}`,
      usageUrl: 'https://h/u',
      usageFields: [{ label: '近7天 Token', path: 'token_used' }],
    }))
    state.results[state.config.providers[index].id] = makeResult(state.config.providers[index].id, {
      usage: [{ label: '近7天 Token', value: 1554060713 }],
    })
  }
  const data = panelData(state, FULL_CAPS)
  for (let index = 0; index < 24; index++) assert.equal(Object.hasOwn(data, `cardChoice${index}`), false)
  const view = panelView(state, FULL_CAPS)
  assert.equal(collectInputs(view).length, 0, '卡片标题/菜单都不是 input')
  const stats = viewStats(view)
  assert.ok(stats.nodes <= 120, `节点 ${stats.nodes}`)
  const cardCount = view.children.filter((child) => child.type === 'stack' && child.style && child.style.card === 'surface').length
  assert.ok(cardCount > 0 && cardCount < 24)
  const titles = view.children.filter((child) => child.type === 'stack').map((child) => nodesOfType(child, 'list')[0].items[0])
  assert.deepEqual(titles.map((item) => item.title), state.config.providers.slice(0, cardCount).map((provider) => provider.name))
  const hint = view.children.find((child) => child.type === 'text' && typeof child.text === 'string' && child.text.includes('未显示'))
  assert.ok(hint)
  assert.ok(hint.text.includes(String(24 - cardCount)))
})


// ---------- v1.7：自动单位 + 大号用量 metric ----------

test('unitOf: result.unit 优先，缺失/缺字段回落 provider', () => {
  const provider = makeProvider({ symbol: '¥', divisor: 500000, multiplier: 2, decimals: 2, usageScale: false })
  assert.deepEqual(unitOf(provider, null), {
    divisor: 500000,
    multiplier: 2,
    symbol: '¥',
    decimals: 2,
    usageScale: false,
  })
  assert.deepEqual(unitOf(provider, { unit: { divisor: 1, multiplier: 1, symbol: '🍪', decimals: 2 } }), {
    divisor: 1,
    multiplier: 1,
    symbol: '🍪',
    decimals: 2,
    usageScale: false,
  })
  assert.equal(unitOf(provider, { unit: { symbol: '$' } }).divisor, 500000, 'unit 缺字段回落 provider')
  assert.equal(unitOf(provider, { unit: { symbol: '$' } }).symbol, '$')
  assert.equal(unitOf(provider, { unit: null }).symbol, '¥')
})

test('卡片/列表用有效单位格式化余额（STA1N 显示 🍪）', () => {
  const state = stateWithProvider()
  state.config.providers[0].symbol = '¥'
  state.config.providers[0].divisor = 500000
  state.results.p_abc12345 = makeResult('p_abc12345', {
    unit: { divisor: 1, multiplier: 1, symbol: '🍪', decimals: 2 },
    balance: 12.5,
  })
  const data = panelData(state, FULL_CAPS)
  assert.equal(data.cards[0].balance, '🍪12.50')
  assert.equal(data.rows[0].trailing, '🍪12.50', 'v1 列表同样用有效单位')

  // 没有 unit 时走 provider 的换算
  state.results.p_abc12345 = makeResult('p_abc12345', { balance: 1000000 })
  assert.equal(panelData(state, FULL_CAPS).cards[0].balance, '¥2.00')
})

test('用量 metric：usageScale 时用有效单位换算，否则原始计数', () => {
  const state = stateWithProvider()
  state.config.providers[0].usageUrl = 'https://h/u'
  state.config.providers[0].usageFields = [{ label: '额度', path: 'q' }]
  state.config.providers[0].usageScale = true
  state.results.p_abc12345 = makeResult('p_abc12345', {
    unit: { divisor: 1, multiplier: 1, symbol: '🍪', decimals: 2 },
    usage: [{ label: '额度', value: 2 }],
  })
  assert.deepEqual(panelData(state, FULL_CAPS).cards[0].usage0, { label: '额度', value: '🍪2.00' })

  const raw = stateWithProvider()
  raw.config.providers[0].usageUrl = 'https://h/u'
  raw.config.providers[0].usageFields = [{ label: '近7天 Token', path: 't' }]
  raw.config.providers[0].usageScale = false
  raw.results.p_abc12345 = makeResult('p_abc12345', {
    unit: { divisor: 1, multiplier: 1, symbol: '🍪', decimals: 2 },
    usage: [{ label: '近7天 Token', value: 1554060713 }],
  })
  assert.deepEqual(panelData(raw, FULL_CAPS).cards[0].usage0, { label: '近7天 Token', value: '15.5亿' })
})

test('actions: auto-unit 翻转 autoUnit 并重建表单（patch+refresh）', async (t) => {
  const home = await tempHome(t)
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { data: { balance: 1 } }) })
  await store.ensureReady()
  await store.actions.add({}, { locale: 'zh-CN' })
  await store.actions['choose-template']({}, { locale: 'zh-CN', value: { preset: 'newapi' } })
  store.state.form.autoUnit = true
  const before = collectInputs(panelView(store.state, FULL_CAPS)).map((input) => input.bind)
  assert.ok(before.includes('data.form.autoUnit'))
  assert.ok(!before.includes('data.form.symbol'))

  const effects = await store.actions['auto-unit']({}, { locale: 'zh-CN' })
  assert.equal(store.state.form.autoUnit, false)
  assert.deepEqual(effectTypes(effects).slice(0, 2), ['patch', 'refresh'])
  const after = collectInputs(panelView(store.state, FULL_CAPS)).map((input) => input.bind)
  for (const bind of ['data.form.autoUnit', 'data.form.symbol', 'data.form.multiplier']) {
    assert.ok(after.includes(bind), `关掉自动单位后应显示 ${bind}`)
  }
  assert.ok(after.length <= 32)

  await store.actions['auto-unit']({}, { locale: 'zh-CN' })
  assert.equal(store.state.form.autoUnit, true)
})

test('actions: newapi 表单可关掉 autoUnit 并落盘', async (t) => {
  const home = await tempHome(t)
  const { ctx } = fakeHost()
  const store = apply(ctx, { home, now: () => FIXED_NOW, fetchImpl: async () => response(200, { data: { balance: 1 } }) })
  await store.ensureReady()
  await store.actions.add({}, { locale: 'zh-CN' })
  await store.actions['choose-template']({}, { locale: 'zh-CN', value: { preset: 'newapi' } })
  const effects = await store.actions.save({}, {
    locale: 'zh-CN',
    value: {
      values: {
        'data.form.siteBase': 'https://sta1n.ai',
        'data.form.secret': 'sk-relay-token',
        'data.form.autoUnit': false,
        'data.form.symbol': '¥',
        'data.form.multiplier': 2,
        'data.form.name': 'STA1N',
      },
    },
  })
  assert.equal(effects.at(-1).text, '已保存')
  const saved = (await loadConfig(configPath(home))).providers[0]
  assert.equal(saved.autoUnit, false)
  assert.equal(saved.url, 'https://sta1n.ai/api/user/self')
})
