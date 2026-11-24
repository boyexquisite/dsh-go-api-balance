import test from 'node:test'
import assert from 'node:assert/strict'
import { presetDraft } from '../lib/presets.js'
import { validateProvider } from '../lib/config.js'

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

test('acedata 模板：邮箱登录、积分余额与近 7 天用量', () => {
  const draft = presetDraft('acedata')
  assert.equal(draft.preset, 'acedata')
  assert.equal(draft.name, 'Ace Data Cloud（积分）')
  assert.equal(draft.authType, 'login')
  assert.equal(draft.loginUserField, 'email')
  assert.equal(draft.loginUrl, 'https://auth.acedata.cloud/api/v1/auth/login/')
  assert.equal(draft.url, 'https://platform.acedata.cloud/api/v1/applications/?type=Usage&limit=100')
  assert.equal(draft.tokenPath, 'access_token')
  assert.equal(draft.balancePath, 'items[].remaining_amount')
  assert.deepEqual(draft.detailPaths, [
    { label: '累计消耗', path: 'items[].used_amount' },
    { label: '账户数', path: 'count', kind: 'count' },
  ])
  assert.deepEqual(draft.usageFields, [
    { label: '近7天调用', path: 'requests' },
    { label: '近7天消耗', path: 'total' },
  ])
  assert.equal(draft.symbol, '')
  assert.equal(draft.decimals, 2)
  assert.match(draft.usageUrl, /created_at_from=\{7d_iso\}/)
  assert.match(draft.usageUrl, /timezone=Asia%2FShanghai/)

  const result = validateProvider({ ...draft, username: 'me@example.com', secret: 'pw' })
  assert.equal(result.ok, true)
  assert.equal(result.provider.preset, 'acedata')
  assert.equal(result.provider.loginUserField, 'email')
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
  assert.deepEqual(draft.detailPaths, [
    { label: '已用额度', path: 'data.used_quota' },
    { label: '累计请求', path: 'data.request_count', kind: 'count' },
    { label: '用户组', path: 'data.group', kind: 'text' },
  ])
  assert.equal(draft.extraUrl, '')
  assert.deepEqual(draft.extraFields, [])
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

// ---------- v1.8 Kimi / MiMo ----------

test('kimi 预设国内区域：moonshot.cn、¥ 与明细字段', () => {
  const draft = presetDraft('kimi')
  assert.equal(draft.preset, 'kimi')
  assert.equal(draft.region, 'cn')
  assert.equal(draft.name, 'Kimi')
  assert.equal(draft.url, 'https://api.moonshot.cn/v1/users/me/balance')
  assert.equal(draft.method, 'GET')
  assert.equal(draft.authType, 'bearer')
  assert.equal(draft.balancePath, 'data.available_balance')
  assert.equal(draft.currencyPath, '')
  assert.deepEqual(draft.detailPaths, [
    { label: '代金券', path: 'data.voucher_balance' },
    { label: '现金', path: 'data.cash_balance' },
  ])
  assert.equal(draft.divisor, 1)
  assert.equal(draft.multiplier, 1)
  assert.equal(draft.symbol, '¥')
  assert.equal(draft.decimals, 2)
  assert.equal(draft.autoUnit, false)
  assert.equal(draft.usageUrl, '')
})

test('kimi 预设海外区域：moonshot.ai 与 $', () => {
  const draft = presetDraft('kimi', { region: 'global' })
  assert.equal(draft.region, 'global')
  assert.equal(draft.url, 'https://api.moonshot.ai/v1/users/me/balance')
  assert.equal(draft.symbol, '$')
  assert.equal(draft.balancePath, 'data.available_balance')
  assert.equal(presetDraft('kimi', { region: 'bogus' }).region, 'cn')
  assert.equal(presetDraft('kimi', { region: 'bogus' }).url, 'https://api.moonshot.cn/v1/users/me/balance')
})

test('kimi 草稿填密钥后可通过校验，region 不落盘', () => {
  const draft = { ...presetDraft('kimi', { region: 'global' }), secret: 'sk-test-123456' }
  const result = validateProvider(draft)
  assert.equal(result.ok, true)
  assert.equal(result.provider.preset, 'kimi')
  assert.equal('region' in result.provider, false)
  assert.equal(result.provider.symbol, '$')
})

test('mimo 预设字段严格符合 spec', () => {
  const draft = presetDraft('mimo')
  assert.equal(draft.preset, 'mimo')
  assert.equal(draft.name, '小米 MiMo')
  assert.equal(draft.url, 'https://api.xiaomimimo.com/v1/platform/balance')
  assert.equal(draft.method, 'GET')
  assert.equal(draft.authType, 'bearer')
  assert.equal(draft.balancePath, 'balance_infos[0].cash_balance + balance_infos[0].gift_balance')
  assert.equal(draft.currencyPath, 'balance_infos[0].currency')
  assert.deepEqual(draft.detailPaths, [
    { label: '现金', path: 'balance_infos[0].cash_balance' },
    { label: '赠送', path: 'balance_infos[0].gift_balance' },
    { label: '冻结', path: 'balance_infos[0].frozen_balance' },
    { label: '授信可用', path: 'balance_infos[0].credit_available' },
  ])
  assert.equal(draft.symbol, '¥')
  assert.equal(draft.divisor, 1)
  assert.equal(draft.multiplier, 1)
  assert.equal(draft.decimals, 2)
  assert.equal(draft.autoUnit, false)
})

test('mimo 草稿填密钥后可通过校验', () => {
  const draft = { ...presetDraft('mimo'), secret: 'sk-test-123456' }
  const result = validateProvider(draft)
  assert.equal(result.ok, true)
  assert.equal(result.provider.preset, 'mimo')
  assert.equal(result.provider.balancePath, 'balance_infos[0].cash_balance + balance_infos[0].gift_balance')
})

test('kimi / mimo 草稿每次返回新对象', () => {
  const first = presetDraft('mimo')
  first.detailPaths[0].label = '改了'
  assert.equal(presetDraft('mimo').detailPaths[0].label, '现金')
})

// ---------- AIHubMix account balance preset ----------

test('aihubmix 预设：Manage Key 账户余额、累计消费与请求', () => {
  const draft = presetDraft('aihubmix')
  assert.equal(draft.preset, 'aihubmix')
  assert.equal(draft.name, 'AIHubMix')
  assert.equal(draft.url, 'https://miao233.top/aihubmix-balance/api/user/self')
  assert.equal(draft.authType, 'bearer')
  assert.equal(draft.balancePath, 'data.quota')
  assert.equal(draft.divisor, 500000)
  assert.equal(draft.symbol, '$')
  assert.deepEqual(draft.detailPaths, [{ label: '累计已用', path: 'data.used_quota' }])
  assert.deepEqual(draft.usageFields, [{ label: '累计请求', path: 'data.request_count' }])
  assert.equal(draft.usageScale, false)
  assert.equal(validateProvider({ ...draft, secret: 'manage-key-test' }).ok, true)
})

// ---------- v1.9 OpenRouter / 花费预设 ----------

test('newapi 预设订阅走独立接口 /api/subscription/self（v2.0 修正）', () => {
  const draft = presetDraft('newapi', { base: 'https://relay.example.com' })
  assert.deepEqual(draft.detailPaths.map((row) => row.label), ['已用额度', '累计请求', '用户组'])
  assert.equal(draft.extraUrl, 'https://relay.example.com/api/subscription/self')
  assert.deepEqual(draft.extraFields, [
    {
      label: '订阅剩余',
      path: 'data.subscriptions[].subscription.amount_total - data.subscriptions[].subscription.amount_used',
    },
    { label: '订阅到期', path: 'data.subscriptions[0].subscription.end_time', kind: 'date' },
    { label: '订阅总量', path: 'data.subscriptions[].subscription.amount_total' },
    { label: '订阅已用', path: 'data.subscriptions[].subscription.amount_used' },
  ])
})

test('oneapi 预设：旧站余额 + /api/user/dashboard 近 7 天用量', () => {
  const draft = presetDraft('oneapi', { base: 'https://old.example.com' })
  assert.equal(draft.preset, 'oneapi')
  assert.equal(draft.name, 'one-api 中转')
  assert.equal(draft.url, 'https://old.example.com/api/user/self')
  assert.equal(draft.balancePath, 'data.quota')
  assert.deepEqual(draft.detailPaths.map((row) => row.label), ['已用额度', '累计请求', '用户组'])
  assert.equal(draft.usageUrl, 'https://old.example.com/api/user/dashboard')
  assert.equal(draft.usageArrayPath, 'data')
  assert.deepEqual(draft.usageFields, [
    { label: '近7天 Token', path: 'prompt_tokens + completion_tokens' },
    { label: '近7天 请求', path: 'request_count' },
  ])
  assert.equal(draft.autoUnit, true)
  const result = validateProvider({ ...draft, secret: 'token-123456' })
  assert.equal(result.ok, true)
  assert.equal(result.provider.preset, 'oneapi')
  assert.equal(result.provider.usageFields[0].path, 'prompt_tokens + completion_tokens')
})

test('openrouter 预设字段严格符合 spec', () => {
  const draft = presetDraft('openrouter')
  assert.equal(draft.preset, 'openrouter')
  assert.equal(draft.name, 'OpenRouter')
  assert.equal(draft.url, 'https://openrouter.ai/api/v1/key')
  assert.equal(draft.method, 'GET')
  assert.equal(draft.authType, 'bearer')
  assert.equal(draft.balancePath, 'data.limit_remaining')
  assert.equal(draft.balanceOptional, true)
  assert.equal(draft.usageUrl, '')
  assert.equal(draft.usageArrayPath, '')
  assert.deepEqual(draft.usageFields, [
    { label: '今日花费', path: 'data.usage_daily' },
    { label: '本月花费', path: 'data.usage_monthly' },
  ])
  assert.equal(draft.usageScale, true)
  assert.deepEqual(draft.detailPaths.map((row) => row.label), ['本周花费', '累计花费', '消费限额', '限额重置周期'])
  assert.equal(draft.detailPaths[3].kind, 'text', 'limit_reset 是 daily/weekly/monthly 周期枚举，不是日期')
  assert.equal(draft.divisor, 1)
  assert.equal(draft.multiplier, 1)
  assert.equal(draft.symbol, '$')
  assert.equal(draft.decimals, 2)
  assert.equal(draft.autoUnit, false)
})

test('openrouter 草稿填密钥后可通过校验', () => {
  const result = validateProvider({ ...presetDraft('openrouter'), secret: 'sk-or-test' })
  assert.equal(result.ok, true)
  assert.equal(result.provider.balanceOptional, true)
  assert.equal(result.provider.usageFields.length, 2)
})

test('openai-cost 预设：只用量 + 本月时间占位符 + 嵌套求和路径', () => {
  const draft = presetDraft('openai-cost')
  assert.equal(draft.preset, 'openai-cost')
  assert.equal(draft.name, 'OpenAI 花费')
  assert.equal(
    draft.url,
    'https://api.openai.com/v1/organization/costs?start_time={month_start}&end_time={now}&bucket_width=1d&limit=31',
  )
  assert.equal(draft.authType, 'bearer')
  assert.equal(draft.balancePath, '')
  assert.equal(draft.usageUrl, '')
  assert.equal(draft.usageArrayPath, '')
  assert.deepEqual(draft.usageFields, [{ label: '本月花费', path: 'data[].results[].amount.value' }])
  assert.equal(draft.usageScale, true)
  assert.equal(draft.divisor, 1)
  assert.equal(draft.symbol, '$')
  assert.equal(draft.decimals, 2)
})

test('openai-cost 草稿（无余额）可通过校验', () => {
  const result = validateProvider({ ...presetDraft('openai-cost'), secret: 'sk-admin-test' })
  assert.equal(result.ok, true)
  assert.equal(result.provider.balancePath, '')
  assert.equal(result.provider.usageFields[0].path, 'data[].results[].amount.value')
})

test('anthropic-cost 预设：header 鉴权 + ISO 占位符 + 分→元 divisor 100', () => {
  const draft = presetDraft('anthropic-cost')
  assert.equal(draft.preset, 'anthropic-cost')
  assert.equal(draft.name, 'Claude 花费')
  assert.equal(
    draft.url,
    'https://api.anthropic.com/v1/organizations/cost_report?starting_at={month_start_iso}&ending_at={now_iso}&bucket_width=1d&limit=31',
  )
  assert.equal(draft.authType, 'header')
  assert.equal(draft.secretHeader, 'x-api-key')
  assert.deepEqual(JSON.parse(draft.headersText), { 'anthropic-version': '2023-06-01' })
  assert.equal(draft.balancePath, '')
  assert.deepEqual(draft.usageFields, [{ label: '本月花费', path: 'data[].results[].amount' }])
  assert.equal(draft.usageScale, true)
  assert.equal(draft.divisor, 100)
  assert.equal(draft.symbol, '$')
  // 官方 usage_report/messages 的输入字段是 uncached_input_tokens；缓存写要算 5m+1h 两档。
  assert.equal(draft.extraFields[0].path, 'data[].results[].uncached_input_tokens')
  assert.equal(
    draft.extraFields[3].path,
    'data[].results[].cache_creation.ephemeral_5m_input_tokens + data[].results[].cache_creation.ephemeral_1h_input_tokens',
  )
  const checked = validateProvider({ ...draft, secret: 'sk-ant-admin-test' })
  assert.equal(checked.ok, true, JSON.stringify(checked.errors))
})

test('anthropic-cost 草稿可通过校验', () => {
  const result = validateProvider({ ...presetDraft('anthropic-cost'), secret: 'sk-ant-test' })
  assert.equal(result.ok, true)
  assert.equal(result.provider.authType, 'header')
  assert.equal(result.provider.secretHeader, 'x-api-key')
  assert.equal(result.provider.headersText, '{"anthropic-version":"2023-06-01"}')
  assert.equal(result.provider.divisor, 100)
})

// ---------- v0.4.0 订阅类预设 ----------

test('opencode-go 预设：订阅窗口百分比，卡片显示滚动剩余', () => {
  const draft = presetDraft('opencode-go')
  assert.equal(draft.preset, 'opencode-go')
  assert.equal(draft.name, 'OpenCode Go')
  assert.equal(draft.url, 'https://opencode.ai/zen/go/v1/usage')
  assert.equal(draft.authType, 'bearer')
  assert.equal(draft.balancePath, '100 - usage.rolling.percent')
  assert.deepEqual(draft.usageFields, [
    { label: '本周剩余%', path: '100 - usage.weekly.percent' },
    { label: '本月剩余%', path: '100 - usage.monthly.percent' },
  ])
  assert.equal(draft.symbol, '%')
  assert.equal(draft.decimals, 0)
  assert.equal(draft.usageScale, false)
  assert.equal(draft.detailPaths[0].kind, 'date')
  assert.equal(draft.detailPaths[0].path, 'usage.rolling.resetsAt')
  const result = validateProvider({ ...draft, secret: 'sk-test' })
  assert.equal(result.ok, true)
  assert.equal(result.provider.decimals, 0)
  assert.equal(result.provider.detailPaths[0].kind, 'date')
})

test('commandcode 预设：月度剩余额度 + 5h/周剩余金额', () => {
  const draft = presetDraft('commandcode')
  assert.equal(draft.preset, 'commandcode')
  assert.equal(draft.name, 'Command Code')
  assert.equal(draft.url, 'https://api.commandcode.ai/alpha/billing/credits')
  assert.equal(draft.balancePath, 'credits.monthlyCredits')
  assert.equal(draft.usageFields[0].path, 'credits.windowLimits.fiveHour.cap - credits.windowLimits.fiveHour.used')
  assert.equal(draft.usageFields[1].path, 'credits.windowLimits.weekly.cap - credits.windowLimits.weekly.used')
  assert.equal(draft.usageScale, true)
  assert.equal(draft.symbol, '$')
  assert.equal(draft.decimals, 2)
  assert.deepEqual(draft.detailPaths.map((row) => row.label), ['本月额度', '5小时已用', '本周已用', '5小时重置', '本周重置'])
  assert.equal(draft.detailPaths[3].kind, 'date')
  assert.equal(draft.detailPaths[4].kind, 'date')
  const result = validateProvider({ ...draft, secret: 'user-test' })
  assert.equal(result.ok, true)
  assert.equal(result.provider.usageFields[0].path, draft.usageFields[0].path)
})
