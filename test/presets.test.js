import test from 'node:test'
import assert from 'node:assert/strict'
import { PRESETS, presetDraft, presetOptions } from '../lib/presets.js'
import { validateProvider } from '../lib/config.js'

test('PRESETS 只包含两个内置模板，文案符合 spec', () => {
  assert.deepEqual(PRESETS, [
    { id: 'deepseek', label: 'DeepSeek 官方' },
    { id: 'newapi', label: 'new-api / one-api 中转' },
  ])
})

test('presetOptions 含自定义，label/value 成对且每次新建', () => {
  const options = presetOptions()
  assert.deepEqual(options, [
    { label: 'DeepSeek 官方', value: 'deepseek' },
    { label: 'new-api / one-api 中转', value: 'newapi' },
    { label: '自定义', value: 'custom' },
  ])
  options.pop()
  assert.equal(presetOptions().length, 3)
})

test('deepseek 模板字段严格符合 spec', () => {
  const draft = presetDraft('deepseek')
  assert.equal(draft.preset, 'deepseek')
  assert.equal(draft.name, 'DeepSeek')
  assert.equal(draft.url, 'https://api.deepseek.com/user/balance')
  assert.equal(draft.method, 'GET')
  assert.equal(draft.authType, 'bearer')
  assert.equal(draft.balancePath, 'balance_infos[0].total_balance')
  assert.equal(draft.currencyPath, 'balance_infos[0].currency')
  assert.deepEqual(draft.detailPaths, [
    { label: '充值余额', path: 'balance_infos[0].topped_up_balance' },
    { label: '赠送余额', path: 'balance_infos[0].granted_balance' },
  ])
  assert.equal(draft.divisor, 1)
  assert.equal(draft.multiplier, 1)
  assert.equal(draft.symbol, '¥')
  assert.equal(draft.decimals, 2)
})

test('deepseek 模板可以直接通过 validateProvider 校验', () => {
  const draft = { ...presetDraft('deepseek'), secret: 'sk-test-123456' }
  const result = validateProvider(draft)
  assert.equal(result.ok, true)
  assert.equal(result.provider.preset, 'deepseek')
})

test('newapi 模板空 base 留空地址', () => {
  const draft = presetDraft('newapi')
  assert.equal(draft.preset, 'newapi')
  assert.equal(draft.name, 'new-api 中转')
  assert.equal(draft.url, '')
  assert.equal(draft.method, 'GET')
  assert.equal(draft.authType, 'bearer')
  assert.equal(draft.balancePath, 'data.quota')
  assert.equal(draft.divisor, 500000)
  assert.equal(draft.multiplier, 1)
  assert.equal(draft.symbol, '¥')
  assert.equal(draft.decimals, 2)
  assert.deepEqual(draft.detailPaths, [{ label: '已用额度', path: 'data.used_quota' }])
})

test('newapi 模板拼接 base 并去掉多余斜杠与空白', () => {
  assert.equal(presetDraft('newapi', { base: 'https://api.example.com/' }).url, 'https://api.example.com/api/user/self')
  assert.equal(presetDraft('newapi', { base: 'https://api.example.com///' }).url, 'https://api.example.com/api/user/self')
  assert.equal(presetDraft('newapi', { base: '  https://api.example.com  ' }).url, 'https://api.example.com/api/user/self')
  assert.equal(presetDraft('newapi', { base: 'https://api.example.com/v1' }).url, 'https://api.example.com/v1/api/user/self')
})

test('newapi 模板乘数用 rate，非法 rate 回落 1', () => {
  assert.equal(presetDraft('newapi', { rate: 2.5 }).multiplier, 2.5)
  assert.equal(presetDraft('newapi', { rate: '3' }).multiplier, 3)
  assert.equal(presetDraft('newapi', { rate: 0 }).multiplier, 1)
  assert.equal(presetDraft('newapi', { rate: -1 }).multiplier, 1)
  assert.equal(presetDraft('newapi', { rate: 'abc' }).multiplier, 1)
  assert.equal(presetDraft('newapi', { rate: Infinity }).multiplier, 1)
})

test('newapi 模板填好 base 与密钥后可通过校验', () => {
  const draft = {
    ...presetDraft('newapi', { base: 'https://api.example.com', rate: 2 }),
    secret: 'sk-test-123456',
  }
  const result = validateProvider(draft)
  assert.equal(result.ok, true)
  assert.equal(result.provider.url, 'https://api.example.com/api/user/self')
  assert.equal(result.provider.multiplier, 2)
  assert.equal(result.provider.divisor, 500000)
})

test('custom 模板是全空白草稿且带表单默认值', () => {
  const draft = presetDraft('custom')
  assert.equal(draft.preset, 'custom')
  assert.equal(draft.name, '')
  assert.equal(draft.url, '')
  assert.equal(draft.balancePath, '')
  assert.equal(draft.secret, '')
  assert.equal(draft.username, '')
  assert.equal(draft.currencyPath, '')
  assert.deepEqual(draft.detailPaths, [])
  assert.equal(draft.divisor, 1)
  assert.equal(draft.multiplier, 1)
  assert.equal(draft.symbol, '¥')
  assert.equal(draft.decimals, 2)
  assert.equal(draft.method, 'GET')
  assert.equal(draft.authType, 'bearer')
  assert.equal(draft.tokenPath, 'data.token')
  assert.equal(draft.tokenHeader, 'Authorization')
  assert.equal(draft.tokenPrefix, 'Bearer ')
  assert.equal(draft.secretHeader, 'X-API-Key')
  assert.equal(draft.secretParam, 'key')
  assert.equal(draft.headersText, '')
  assert.equal(draft.bodyText, '')
})

test('未知模板 id 回落为自定义草稿', () => {
  assert.equal(presetDraft('nope').preset, 'custom')
  assert.equal(presetDraft(undefined).preset, 'custom')
})

test('token 参数只写进 secret，不污染其它字段', () => {
  assert.equal(presetDraft('deepseek', { token: 'sk-abc' }).secret, 'sk-abc')
  assert.equal(presetDraft('newapi', { token: 'sk-abc' }).secret, 'sk-abc')
  assert.equal(presetDraft('custom', { token: 'sk-abc' }).secret, 'sk-abc')
  assert.equal(presetDraft('deepseek').secret, '')
  assert.equal(presetDraft('deepseek', { token: 42 }).secret, '')
})

test('每次调用返回新对象，修改草稿不影响下一次', () => {
  const a = presetDraft('deepseek')
  a.detailPaths[0].label = '被改了'
  a.name = '改了'
  const b = presetDraft('deepseek')
  assert.equal(b.detailPaths[0].label, '充值余额')
  assert.equal(b.name, 'DeepSeek')
  assert.notEqual(presetDraft('newapi').detailPaths, presetDraft('newapi').detailPaths)
})

// ---------- v1.1 用量 ----------

test('deepseek / custom 预设不填用量', () => {
  for (const id of ['deepseek', 'custom']) {
    const draft = presetDraft(id)
    assert.equal(draft.usageUrl, '')
    assert.equal(draft.usageMethod, 'GET')
    assert.equal(draft.usageArrayPath, '')
    assert.deepEqual(draft.usageFields, [])
    assert.equal(draft.usageScale, false)
  }
})

test('newapi 预设按 spec §11.3 填用量查询', () => {
  const draft = presetDraft('newapi', { base: 'https://relay.example.com/' })
  assert.equal(
    draft.usageUrl,
    'https://relay.example.com/api/data/self?start_timestamp={7d}&end_timestamp={now}&default_time=day',
  )
  assert.equal(draft.usageMethod, 'GET')
  assert.equal(draft.usageArrayPath, 'data')
  assert.deepEqual(draft.usageFields, [
    { label: '近7天 Token', path: 'token_used' },
    { label: '近7天 请求', path: 'count' },
  ])
  assert.equal(draft.usageScale, false)
})

test('newapi 预设 base 为空时用量地址也留空', () => {
  const draft = presetDraft('newapi')
  assert.equal(draft.url, '')
  assert.equal(draft.usageUrl, '')
})

test('newapi 预设带用量字段可通过 validateProvider 校验', () => {
  const draft = {
    ...presetDraft('newapi', { base: 'https://relay.example.com' }),
    secret: 'sk-test-123456',
  }
  const result = validateProvider(draft)
  assert.equal(result.ok, true)
  assert.equal(result.provider.usageArrayPath, 'data')
  assert.equal(result.provider.usageFields.length, 2)
  assert.equal(result.provider.usageScale, false)
})

test('newapi 用量草稿每次新建且数组可安全修改', () => {
  const a = presetDraft('newapi', { base: 'https://relay.example.com' })
  a.usageFields[0].label = '改了'
  const b = presetDraft('newapi', { base: 'https://relay.example.com' })
  assert.equal(b.usageFields[0].label, '近7天 Token')
  assert.notEqual(a.usageFields, b.usageFields)
})

// ---------- v1.7 autoUnit ----------

test('newapi 预设默认开 autoUnit，deepseek / custom 默认关', () => {
  assert.equal(presetDraft('newapi', { base: 'https://relay.example.com' }).autoUnit, true)
  assert.equal(presetDraft('newapi').autoUnit, true)
  assert.equal(presetDraft('deepseek').autoUnit, false)
  assert.equal(presetDraft('custom').autoUnit, false)
})

test('newapi 预设 autoUnit 可通过 validateProvider 校验', () => {
  const draft = {
    ...presetDraft('newapi', { base: 'https://relay.example.com' }),
    secret: 'sk-test-123456',
  }
  const result = validateProvider(draft)
  assert.equal(result.ok, true)
  assert.equal(result.provider.autoUnit, true)
  assert.equal(result.provider.preset, 'newapi')
})
