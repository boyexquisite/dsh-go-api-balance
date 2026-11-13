import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  CONFIG_VERSION,
  RESULTS_VERSION,
  resolveHome,
  configDir,
  configPath,
  resultsPath,
  defaultConfig,
  defaultSettings,
  newProviderId,
  loadConfig,
  saveConfig,
  loadResults,
  saveResults,
  validateProvider,
} from '../lib/config.js'

async function tempHome (t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-balance-'))
  t.after(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })
  return home
}

function validDraft (overrides = {}) {
  return {
    name: '主力服务',
    url: 'https://api.example.com/balance',
    authType: 'bearer',
    secret: 'sk-1234567890',
    balancePath: 'data.balance',
    ...overrides,
  }
}

function expectError (draft, field, pattern, options) {
  const result = validateProvider(draft, options)
  assert.equal(result.ok, false, `${field} 应当校验失败`)
  assert.match(result.errors[field], pattern)
}

// ---------- 路径 ----------

test('resolveHome 优先用 DSH_HOME，空值回落到 ~/.dsh', () => {
  assert.equal(resolveHome({ DSH_HOME: '/opt/custom' }), '/opt/custom')
  assert.equal(resolveHome({ DSH_HOME: '  /opt/custom  ' }), '/opt/custom')
  assert.equal(resolveHome({ DSH_HOME: '' }), path.join(os.homedir(), '.dsh'))
  assert.equal(resolveHome({ DSH_HOME: '   ' }), path.join(os.homedir(), '.dsh'))
  assert.equal(resolveHome({}), path.join(os.homedir(), '.dsh'))
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = '/tmp/dsh-home-test'
  try {
    assert.equal(resolveHome(), '/tmp/dsh-home-test')
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  }
})

test('configDir / configPath / resultsPath 拼接符合约定', () => {
  const home = '/tmp/home-x'
  assert.equal(configDir(home), '/tmp/home-x/cache/dsh-go-api-balance')
  assert.equal(configPath(home), '/tmp/home-x/cache/dsh-go-api-balance/config.json')
  assert.equal(resultsPath(home), '/tmp/home-x/cache/dsh-go-api-balance/results.json')
  assert.equal(configPath('/h'), configPath('/h', undefined))
})

test('defaultConfig / defaultSettings 结构正确且每次新建', () => {
  assert.equal(CONFIG_VERSION, 1)
  assert.equal(RESULTS_VERSION, 1)
  const a = defaultConfig()
  const b = defaultConfig()
  assert.deepEqual(a, {
    v: 1,
    providers: [],
    settings: { refreshOnOpen: true, timeoutMs: 12000 },
  })
  assert.notEqual(a.providers, b.providers)
  assert.notEqual(a.settings, b.settings)
  assert.deepEqual(defaultSettings(), a.settings)
  a.providers.push('x')
  assert.equal(defaultConfig().providers.length, 0)
})

test('newProviderId 生成 p_ 加 8 位 base36', () => {
  const id = newProviderId()
  assert.match(id, /^p_[a-z0-9]{6,12}$/)
  assert.equal(id.length, 10)
  assert.equal(newProviderId(() => 0, () => 0), 'p_00000000')
  assert.notEqual(newProviderId(() => 1700000000000, () => 0.1), newProviderId(() => 1700000000000, () => 0.9))
  assert.match(newProviderId(() => 1700000000000, () => 0), /^p_[a-z0-9]{8}$/)
})

// ---------- provider 校验：合法输入 ----------

test('validateProvider 接受完整合法草稿并补齐默认值', () => {
  const result = validateProvider(validDraft())
  assert.equal(result.ok, true)
  const provider = result.provider
  assert.match(provider.id, /^p_[a-z0-9]{6,12}$/)
  assert.deepEqual(Object.keys(provider).sort(), [
    'authType', 'autoUnit', 'balanceOptional', 'balancePath', 'bodyText', 'currencyPath', 'decimals', 'detailPaths',
    'divisor', 'enabled', 'extraFields', 'extraUrl', 'headersText', 'id', 'loginUrl', 'method', 'multiplier',
    'name', 'preset', 'secret', 'secretHeader', 'secretParam', 'symbol', 'tokenHeader',
    'tokenPath', 'tokenPrefix', 'url', 'usageArrayPath', 'usageFields', 'usageMethod',
    'usageScale', 'usageUrl', 'username',
  ])
  assert.equal(provider.name, '主力服务')
  assert.equal(provider.preset, 'custom')
  assert.equal(provider.method, 'GET')
  assert.equal(provider.authType, 'bearer')
  assert.equal(provider.secret, 'sk-1234567890')
  assert.equal(provider.secretHeader, 'X-API-Key')
  assert.equal(provider.secretParam, 'key')
  assert.equal(provider.username, '')
  assert.equal(provider.loginUrl, '')
  assert.equal(provider.tokenPath, 'data.token')
  assert.equal(provider.tokenHeader, 'Authorization')
  assert.equal(provider.tokenPrefix, 'Bearer ')
  assert.equal(provider.headersText, '')
  assert.equal(provider.bodyText, '')
  assert.equal(provider.currencyPath, '')
  assert.equal(provider.divisor, 1)
  assert.equal(provider.multiplier, 1)
  assert.equal(provider.symbol, '¥')
  assert.equal(provider.decimals, 2)
  assert.equal(provider.enabled, true)
  assert.equal(provider.usageUrl, '')
  assert.equal(provider.usageMethod, 'GET')
  assert.equal(provider.usageArrayPath, '')
  assert.deepEqual(provider.usageFields, [])
  assert.equal(provider.usageScale, false)
  assert.equal(provider.autoUnit, false)
  assert.equal(provider.extraUrl, '')
  assert.deepEqual(provider.extraFields, [])
})

test('validateProvider 丢弃未知字段、数字字符串转数字、decimals 取整', () => {
  const result = validateProvider(validDraft({
    evil: true,
    divisor: '500000',
    multiplier: '0.5',
    decimals: '2.7',
    enabled: 'false',
  }))
  assert.equal(result.ok, true)
  assert.equal('evil' in result.provider, false)
  assert.equal(result.provider.divisor, 500000)
  assert.equal(result.provider.multiplier, 0.5)
  assert.equal(result.provider.decimals, 3)
  assert.equal(result.provider.enabled, false)
})

test('validateProvider 保留合法 id 与 existing id，非法 id 重新生成', () => {
  assert.equal(validateProvider(validDraft({ id: 'p_abc123def' })).provider.id, 'p_abc123def')
  assert.equal(validateProvider(validDraft({ id: 'bad-id' })).provider.id.length, 10)
  const existing = { id: 'p_existing1', secret: 'old-secret' }
  assert.equal(validateProvider(validDraft({ secret: '' }), { existing, allowSecretReuse: true }).provider.id, 'p_existing1')
})

test('validateProvider 不把空密钥写进结果，编辑时沿用 existing.secret', () => {
  const existing = { id: 'p_keep12345', secret: 'old-secret' }
  const reused = validateProvider(validDraft({ secret: '' }), { existing, allowSecretReuse: true })
  assert.equal(reused.ok, true)
  assert.equal(reused.provider.secret, 'old-secret')
  expectError(validDraft({ secret: '' }), 'secret', /请填密钥/)
})

test('validateProvider cookie 密钥只 trim 两端、保留分号等字符', () => {
  const result = validateProvider(validDraft({ authType: 'cookie', secret: '  a=1; b=2  ' }))
  assert.equal(result.ok, true)
  assert.equal(result.provider.secret, 'a=1; b=2')
})

test('validateProvider basic / login 要求用户名与登录地址', () => {
  expectError(validDraft({ authType: 'basic' }), 'username', /请填用户名/)
  const basic = validateProvider(validDraft({
    authType: 'basic',
    username: 'miao',
    secret: 'pa:ss',
  }))
  assert.equal(basic.ok, true)
  assert.equal(basic.provider.username, 'miao')

  const noLoginUrl = validateProvider(validDraft({ authType: 'login', username: 'miao' }))
  assert.equal(noLoginUrl.ok, false)
  assert.match(noLoginUrl.errors.loginUrl, /请填登录地址/)

  const login = validateProvider(validDraft({
    authType: 'login',
    username: 'miao',
    loginUrl: 'https://api.example.com/login',
    secret: 'pw',
    tokenPath: 'result.access_token',
    tokenPrefix: 'Token ',
  }))
  assert.equal(login.ok, true)
  assert.equal(login.provider.tokenPath, 'result.access_token')
  assert.equal(login.provider.tokenPrefix, 'Token ')
})

// ---------- provider 校验：逐字段非法 ----------

test('validateProvider 名称必填且有长度上限', () => {
  expectError(validDraft({ name: '' }), 'name', /请填名称/)
  expectError(validDraft({ name: '   ' }), 'name', /请填名称/)
  expectError(validDraft({ name: '名'.repeat(25) }), 'name', /最多 24/)
  assert.equal(validateProvider(validDraft({ name: '名'.repeat(24) })).ok, true)
})

test('validateProvider 地址校验', () => {
  expectError(validDraft({ url: '' }), 'url', /请填地址/)
  expectError(validDraft({ url: 'ftp://api.example.com' }), 'url', /http:\/\/ 或 https:\/\//)
  expectError(validDraft({ url: 'api.example.com/x' }), 'url', /http:\/\/ 或 https:\/\//)
  expectError(validDraft({ url: 'https://' }), 'url', /http:\/\/ 或 https:\/\//)
  expectError(validDraft({ url: `https://example.com/${'a'.repeat(2030)}` }), 'url', /最多 2048/)
  assert.equal(validateProvider(validDraft({ url: 'http://127.0.0.1:8080/balance' })).ok, true)
})

test('validateProvider 方法与鉴权方式校验', () => {
  expectError(validDraft({ method: 'PUT' }), 'method', /GET 或 POST/)
  expectError(validDraft({ authType: 'oauth' }), 'authType', /鉴权方式/)
  assert.equal(validateProvider(validDraft({ method: 'post', authType: 'header' })).provider.method, 'POST')
})

test('validateProvider 密钥长度与请求头/参数名边界', () => {
  expectError(validDraft({ secret: 'k'.repeat(2049) }), 'secret', /最多 2048/)
  expectError(validDraft({ secretHeader: 'H'.repeat(65) }), 'secretHeader', /最多 64/)
  expectError(validDraft({ secretParam: 'p'.repeat(65) }), 'secretParam', /最多 64/)
  assert.equal(validateProvider(validDraft({ secret: 'k'.repeat(2048) })).ok, true)
})

test('validateProvider 余额/币种/令牌路径校验', () => {
  expectError(validDraft({ balancePath: '' }), 'balancePath', /请填余额字段路径/)
  expectError(validDraft({ balancePath: 'a b' }), 'balancePath', /余额字段路径不合法/)
  expectError(validDraft({ currencyPath: 'a b' }), 'currencyPath', /币种字段路径不合法/)
  assert.equal(validateProvider(validDraft({ currencyPath: 'data.currency' })).ok, true)
  expectError(validDraft({ tokenPath: 'a b' }), 'tokenPath', /令牌字段路径不合法/)
})

test('validateProvider 明细路径逐行校验与上限', () => {
  const seven = Array.from({ length: 7 }, (_, i) => ({ label: `l${i}`, path: `data.v${i}` }))
  expectError(validDraft({ detailPaths: seven }), 'detailPaths', /最多 6 条/)
  expectError(validDraft({ detailPaths: [{ label: '', path: 'data.a' }] }), 'detailPaths', /请填标签/)
  expectError(validDraft({ detailPaths: [{ label: '标签', path: 'a b' }] }), 'detailPaths', /路径不合法/)
  expectError(validDraft({ detailPaths: [{ label: '标'.repeat(21), path: 'data.a' }] }), 'detailPaths', /最多 20/)
  const ok = validateProvider(validDraft({
    detailPaths: [
      { label: '充值余额', path: 'data.a' },
      { label: '', path: '' },
      { label: '已用', path: 'data.b' },
    ],
  }))
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.provider.detailPaths, [
    { label: '充值余额', path: 'data.a' },
    { label: '已用', path: 'data.b' },
  ])
})

test('validateProvider 额外请求头必须是 JSON 对象', () => {
  expectError(validDraft({ headersText: '[]' }), 'headersText', /JSON 对象/)
  expectError(validDraft({ headersText: 'null' }), 'headersText', /JSON 对象/)
  expectError(validDraft({ headersText: 'X-A: 1' }), 'headersText', /JSON 对象/)
  expectError(validDraft({ headersText: `{"x":"${'a'.repeat(4100)}"}` }), 'headersText', /最多 4096/)
  assert.equal(validateProvider(validDraft({ headersText: '{"X-A":"1"}' })).ok, true)
})

test('validateProvider 请求体必须是 JSON 对象或数组', () => {
  expectError(validDraft({ bodyText: '123' }), 'bodyText', /JSON 对象或数组/)
  expectError(validDraft({ bodyText: 'null' }), 'bodyText', /JSON 对象或数组/)
  expectError(validDraft({ bodyText: '{bad' }), 'bodyText', /JSON 对象或数组/)
  expectError(validDraft({ bodyText: `{"x":"${'a'.repeat(4100)}"}` }), 'bodyText', /最多 4096/)
  assert.equal(validateProvider(validDraft({ bodyText: '{"model":"x"}' })).ok, true)
  assert.equal(validateProvider(validDraft({ bodyText: '[1,2]' })).ok, true)
})

test('validateProvider 除数/乘数边界', () => {
  for (const key of ['divisor', 'multiplier']) {
    expectError(validDraft({ [key]: 0 }), key, /大于 0/)
    expectError(validDraft({ [key]: -2 }), key, /大于 0/)
    expectError(validDraft({ [key]: 'abc' }), key, /要是数字/)
    expectError(validDraft({ [key]: 0.0000001 }), key, /0\.000001–1e12/)
    expectError(validDraft({ [key]: 1e13 }), key, /0\.000001–1e12/)
    assert.equal(validateProvider(validDraft({ [key]: 0.000001 })).ok, true)
    assert.equal(validateProvider(validDraft({ [key]: 1e12 })).ok, true)
  }
})

test('validateProvider 符号与小数位边界', () => {
  expectError(validDraft({ symbol: 'abcdefghi' }), 'symbol', /最多 8/)
  assert.equal(validateProvider(validDraft({ symbol: '' })).provider.symbol, '')
  assert.equal(validateProvider(validDraft({ symbol: 'US$' })).provider.symbol, 'US$')
  expectError(validDraft({ decimals: 5 }), 'decimals', /0–4/)
  expectError(validDraft({ decimals: -1 }), 'decimals', /0–4/)
  expectError(validDraft({ decimals: 'abc' }), 'decimals', /0–4 的整数/)
  assert.equal(validateProvider(validDraft({ decimals: '0' })).provider.decimals, 0)
  assert.equal(validateProvider(validDraft({ decimals: 4 })).provider.decimals, 4)
})

test('validateProvider 多个错误一次性返回中文键值', () => {
  const result = validateProvider({ name: '', url: 'ftp://x', balancePath: 'a b' })
  assert.equal(result.ok, false)
  assert.deepEqual(Object.keys(result.errors), ['name', 'url', 'secret', 'balancePath'])
  for (const message of Object.values(result.errors)) assert.match(message, /[\u4e00-\u9fa5]/)
})

// ---------- usage 字段（v1.1） ----------

function usageOverrides (overrides = {}) {
  return {
    usageUrl: 'https://api.example.com/usage?start={7d}&end={now}&today={today}',
    usageMethod: 'GET',
    usageArrayPath: 'data',
    usageFields: [
      { label: '近7天 Token', path: 'token_used' },
      { label: '近7天 请求', path: 'count' },
    ],
    usageScale: false,
    ...overrides,
  }
}

test('validateProvider 接受完整 usage 配置并原样存入', () => {
  const result = validateProvider(validDraft(usageOverrides({
    usageScale: 'true',
    usageMethod: 'post',
  })))
  assert.equal(result.ok, true)
  const provider = result.provider
  assert.equal(provider.usageUrl, 'https://api.example.com/usage?start={7d}&end={now}&today={today}')
  assert.equal(provider.usageMethod, 'POST')
  assert.equal(provider.usageArrayPath, 'data')
  assert.deepEqual(provider.usageFields, [
    { label: '近7天 Token', path: 'token_used' },
    { label: '近7天 请求', path: 'count' },
  ])
  assert.equal(provider.usageScale, true)
})

test('填了 usageUrl 就必须至少 1 个 usageFields', () => {
  expectError(validDraft(usageOverrides({ usageFields: [] })), 'usageFields', /填了用量地址就要填用量字段/)
  expectError(
    validDraft(usageOverrides({ usageFields: [{ label: '', path: '' }] })),
    'usageFields',
    /填了用量地址就要填用量字段/,
  )
})

test('usageUrl 非 http(s) 或超长时报错', () => {
  expectError(validDraft(usageOverrides({ usageUrl: 'ftp://api.example.com/usage' })), 'usageUrl', /http:\/\/ 或 https:\/\//)
  expectError(validDraft(usageOverrides({ usageUrl: 'api.example.com/usage' })), 'usageUrl', /http:\/\/ 或 https:\/\//)
  expectError(validDraft(usageOverrides({ usageUrl: `https://e.com/${'a'.repeat(500)}` })), 'usageUrl', /最多 512/)
})

test('usageMethod 与 usageArrayPath 边界', () => {
  expectError(validDraft(usageOverrides({ usageMethod: 'PUT' })), 'usageMethod', /GET 或 POST/)
  expectError(validDraft(usageOverrides({ usageArrayPath: 'a b' })), 'usageArrayPath', /用量数组路径不合法/)
  expectError(validDraft(usageOverrides({ usageArrayPath: 'a'.repeat(121) })), 'usageArrayPath', /最多 120/)
  assert.equal(validateProvider(validDraft(usageOverrides({ usageArrayPath: '' }))).ok, true)
  assert.equal(validateProvider(validDraft(usageOverrides({ usageMethod: 'post' }))).provider.usageMethod, 'POST')
})

test('usageFields 逐行校验与上限', () => {
  const five = Array.from({ length: 5 }, (_, index) => ({ label: `字段${index}`, path: `p${index}` }))
  expectError(validDraft(usageOverrides({ usageFields: five })), 'usageFields', /最多 4 条/)
  expectError(
    validDraft(usageOverrides({ usageFields: [{ label: '', path: 'token_used' }] })),
    'usageFields',
    /第 1 行请填标签/,
  )
  expectError(
    validDraft(usageOverrides({ usageFields: [{ label: '标'.repeat(21), path: 'token_used' }] })),
    'usageFields',
    /第 1 行标签最多 20/,
  )
  expectError(
    validDraft(usageOverrides({ usageFields: [{ label: 'Token', path: 'a b' }] })),
    'usageFields',
    /第 1 行路径不合法/,
  )
  const ok = validateProvider(validDraft(usageOverrides({
    usageFields: [
      { label: 'Token', path: 'token_used' },
      { label: '', path: '' },
      { label: '请求', path: 'count' },
    ],
  })))
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.provider.usageFields, [
    { label: 'Token', path: 'token_used' },
    { label: '请求', path: 'count' },
  ])
})

test('未填 usageUrl 但填了 usageFields 时按同响应用量保留', () => {
  const result = validateProvider(validDraft({
    usageUrl: '',
    usageMethod: 'PUT',
    usageArrayPath: 'data.buckets',
    usageFields: [{ label: '本月花费', path: 'data[].results[].amount.value' }],
    usageScale: true,
  }))
  assert.equal(result.ok, true)
  assert.equal(result.provider.usageUrl, '')
  assert.equal(result.provider.usageMethod, 'GET')
  assert.equal(result.provider.usageArrayPath, 'data.buckets')
  assert.deepEqual(result.provider.usageFields, [{ label: '本月花费', path: 'data[].results[].amount.value' }])
  assert.equal(result.provider.usageScale, true)
})

test('既没 usageUrl 也没 usageFields 时 usage 字段保持默认', () => {
  const result = validateProvider(validDraft({ usageUrl: '', usageFields: [] }))
  assert.equal(result.ok, true)
  assert.equal(result.provider.usageUrl, '')
  assert.equal(result.provider.usageMethod, 'GET')
  assert.equal(result.provider.usageArrayPath, '')
  assert.deepEqual(result.provider.usageFields, [])
  assert.equal(result.provider.usageScale, false)
})

test('balanceOptional 默认 false，可开启并随草稿带出', () => {
  assert.equal(validateProvider(validDraft()).provider.balanceOptional, false)
  const optional = validateProvider(validDraft({ balanceOptional: true }))
  assert.equal(optional.ok, true)
  assert.equal(optional.provider.balanceOptional, true)
  assert.equal(validateProvider(validDraft({ balanceOptional: 'true' })).provider.balanceOptional, true)
})

test('balancePath 可为空但必须至少 1 个 usageFields（只用量的服务）', () => {
  const onlyUsage = validateProvider(validDraft({
    balancePath: '',
    usageUrl: '',
    usageFields: [{ label: '本月花费', path: 'data[].results[].amount.value' }],
  }))
  assert.equal(onlyUsage.ok, true)
  assert.equal(onlyUsage.provider.balancePath, '')
  assert.equal(onlyUsage.provider.usageFields.length, 1)

  const withUsageUrl = validateProvider(validDraft({
    balancePath: '',
    usageUrl: 'https://api.example.com/usage',
    usageFields: [{ label: '请求', path: 'count' }],
  }))
  assert.equal(withUsageUrl.ok, true)

  expectError(validDraft({ balancePath: '', usageUrl: '', usageFields: [] }), 'balancePath', /请填余额字段路径/)
})

test('usageFields 支持 [] 嵌套通配路径', () => {
  const result = validateProvider(validDraft({
    usageUrl: '',
    usageFields: [
      { label: '本月花费', path: 'data[].results[].amount.value' },
      { label: '今日', path: 'data[0].usage_daily' },
    ],
  }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.provider.usageFields, [
    { label: '本月花费', path: 'data[].results[].amount.value' },
    { label: '今日', path: 'data[0].usage_daily' },
  ])
  expectError(
    validDraft({ usageUrl: '', usageFields: [{ label: '错', path: 'data[.x' }] }),
    'usageFields',
    /路径不合法/,
  )
})

test('配置读写保留 balanceOptional / usage 同响应字段', async (t) => {
  const home = await tempHome(t)
  const provider = validateProvider(validDraft({
    balanceOptional: true,
    usageUrl: '',
    usageFields: [{ label: '本月花费', path: 'data[].results[].amount.value' }],
    usageScale: true,
  })).provider
  await saveConfig({ v: 1, providers: [provider], settings: defaultSettings() }, configPath(home))
  const loaded = await loadConfig(configPath(home))
  assert.equal(loaded.providers[0].balanceOptional, true)
  assert.deepEqual(loaded.providers[0].usageFields, provider.usageFields)
  assert.equal(loaded.providers[0].usageUrl, '')
  assert.equal(loaded.providers[0].usageScale, true)
})

// ---------- 配置读写 ----------

test('saveConfig 创建 0700 目录、0600 文件并原子替换', async (t) => {
  const home = await tempHome(t)
  const first = { v: 1, providers: [validateProvider(validDraft()).provider], settings: defaultSettings() }
  await saveConfig(first, configPath(home))
  const dirStat = await fs.stat(configDir(home))
  assert.equal(dirStat.mode & 0o777, 0o700)
  const fileStat = await fs.stat(configPath(home))
  assert.equal(fileStat.mode & 0o777, 0o600)
  assert.deepEqual(await fs.readdir(configDir(home)), ['config.json'])

  const second = { v: 1, providers: [validateProvider(validDraft({ name: '第二版' })).provider], settings: defaultSettings() }
  await saveConfig(second, configPath(home))
  assert.deepEqual(await fs.readdir(configDir(home)), ['config.json'])
  const loaded = await loadConfig(configPath(home))
  assert.equal(loaded.providers.length, 1)
  assert.equal(loaded.providers[0].name, '第二版')
})

test('saveConfig 写前 normalize（版本、设置范围、providers 上限）', async (t) => {
  const home = await tempHome(t)
  const providers = Array.from({ length: 30 }, (_, index) => ({
    id: `p_${String(index).padStart(8, '0')}`,
    name: `服务${index}`,
    url: 'https://api.example.com/balance',
    authType: 'bearer',
    secret: 'k',
    balancePath: 'data.balance',
  }))
  await saveConfig({
    v: 99,
    providers: [null, 'x', ...providers],
    settings: { refreshOnOpen: 0, timeoutMs: 1 },
  }, configPath(home))
  const loaded = await loadConfig(configPath(home))
  assert.equal(loaded.v, 1)
  assert.equal(loaded.providers.length, 24)
  assert.deepEqual(loaded.settings, { refreshOnOpen: false, timeoutMs: 4000 })
})

test('loadConfig 文件不存在时返回默认配置且不创建文件', async (t) => {
  const home = await tempHome(t)
  const loaded = await loadConfig(configPath(home))
  assert.deepEqual(loaded, defaultConfig())
  await assert.rejects(fs.stat(configPath(home)))
})

test('loadConfig 遇到坏 JSON 备份为 .bad-<时间戳> 并返回默认配置', async (t) => {
  const home = await tempHome(t)
  await fs.mkdir(configDir(home), { recursive: true })
  await fs.writeFile(configPath(home), '{not json', 'utf8')
  const loaded = await loadConfig(configPath(home))
  assert.deepEqual(loaded, defaultConfig())
  const files = await fs.readdir(configDir(home))
  assert.equal(files.length, 1)
  assert.match(files[0], /^config\.json\.bad-\d+-[a-z0-9]+$/)
})

test('loadConfig 遇到不认识的版本同样备份并回落默认', async (t) => {
  const home = await tempHome(t)
  await fs.mkdir(configDir(home), { recursive: true })
  await fs.writeFile(configPath(home), JSON.stringify({ v: 2, providers: [] }), 'utf8')
  const loaded = await loadConfig(configPath(home))
  assert.equal(loaded.v, 1)
  const files = await fs.readdir(configDir(home))
  assert.equal(files.length, 1)
  assert.match(files[0], /^config\.json\.bad-\d+-[a-z0-9]+$/)
})

test('loadConfig 对缺失字段的 provider 补齐默认值', async (t) => {
  const home = await tempHome(t)
  await fs.mkdir(configDir(home), { recursive: true })
  const stored = {
    v: 1,
    providers: [{
      id: 'p_abc12345',
      name: '旧版',
      url: 'https://api.example.com/balance',
      authType: 'bearer',
      secret: 'old',
      balancePath: 'data.balance',
    }],
    settings: { timeoutMs: 20000 },
  }
  await fs.writeFile(configPath(home), JSON.stringify(stored), 'utf8')
  const loaded = await loadConfig(configPath(home))
  const provider = loaded.providers[0]
  assert.equal(provider.method, 'GET')
  assert.equal(provider.preset, 'custom')
  assert.equal(provider.decimals, 2)
  assert.equal(provider.divisor, 1)
  assert.equal(provider.enabled, true)
  assert.equal(loaded.settings.timeoutMs, 20000)
  assert.equal(Object.hasOwn(loaded.settings, 'stripEnabled'), false, '状态条字段已移除')
})

// ---------- results 缓存 ----------

test('results 缓存读写往返，缺失文件返回空缓存', async (t) => {
  const home = await tempHome(t)
  assert.deepEqual(await loadResults(resultsPath(home)), { v: 1, results: {} })
  await saveResults({
    v: 1,
    results: {
      p_abc12345: {
        id: 'p_abc12345',
        ok: true,
        balance: 12,
        currency: 'CNY',
        symbol: '¥',
        decimals: 2,
        details: [],
        error: null,
        fetchedAt: 1700000000000,
      },
    },
  }, resultsPath(home))
  const loaded = await loadResults(resultsPath(home))
  assert.equal(loaded.results.p_abc12345.balance, 12)
  const stat = await fs.stat(resultsPath(home))
  assert.equal(stat.mode & 0o777, 0o600)
})

test('loadResults 丢弃坏项与不认识版本', async (t) => {
  const home = await tempHome(t)
  await fs.mkdir(configDir(home), { recursive: true })
  await fs.writeFile(resultsPath(home), JSON.stringify({
    v: 1,
    results: {
      good: { ok: true, balance: 1 },
      wrongOk: { ok: 'yes', balance: 1 },
      nullItem: null,
      stringItem: 'x',
      noOk: { balance: 1 },
    },
  }), 'utf8')
  const loaded = await loadResults(resultsPath(home))
  assert.deepEqual(Object.keys(loaded.results), ['good'])

  await fs.writeFile(resultsPath(home), JSON.stringify({ v: 2, results: { a: { ok: true } } }), 'utf8')
  assert.deepEqual(await loadResults(resultsPath(home)), { v: 1, results: {} })

  await fs.writeFile(resultsPath(home), 'not json', 'utf8')
  assert.deepEqual(await loadResults(resultsPath(home)), { v: 1, results: {} })
})

test('saveResults 写失败不抛给 UI', async (t) => {
  const home = await tempHome(t)
  const blocker = path.join(home, 'blocker')
  await fs.writeFile(blocker, 'x', 'utf8')
  await assert.doesNotReject(saveResults({ v: 1, results: {} }, path.join(blocker, 'results.json')))
})

// ---------- 打码与草稿 ----------

// ---------- v2.1 安全：https 限制 / 权限自愈 ----------

test('validateProvider 拒绝非本机的明文 http 地址（余额/登录/用量/附加）', () => {
  const message = /https/
  expectError(validDraft({ url: 'http://api.example.com/balance' }), 'url', message)
  expectError(validDraft({ authType: 'login', username: 'u', loginUrl: 'http://api.example.com/login' }), 'loginUrl', message)
  expectError(validDraft({ usageUrl: 'http://api.example.com/usage', usageFields: [{ label: 'a', path: 'x' }] }), 'usageUrl', message)
  expectError(validDraft({
    extraUrl: 'http://api.example.com/sub',
    extraFields: [{ label: 'a', path: 'x' }],
  }), 'extraUrl', message)
  // 本机回环仍允许 http（手机本机引擎 / 本地反代）
  assert.equal(validateProvider(validDraft({ url: 'http://127.0.0.1:8080/balance' })).ok, true)
  assert.equal(validateProvider(validDraft({ url: 'http://localhost:8080/balance' })).ok, true)
  assert.equal(validateProvider(validDraft({ url: 'https://api.example.com/balance' })).ok, true)
})

test('loadConfig / loadResults 读到宽权限文件会自动收紧为 0600（目录 0700）', async (t) => {
  if (process.platform === 'win32') return
  const home = await tempHome(t)
  const dir = configDir(home)
  await fs.mkdir(dir, { recursive: true, mode: 0o755 })
  await fs.chmod(dir, 0o755)
  await fs.writeFile(configPath(home), JSON.stringify(defaultConfig()), 'utf8')
  await fs.chmod(configPath(home), 0o644)
  await loadConfig(configPath(home))
  assert.equal((await fs.stat(configPath(home))).mode & 0o777, 0o600)
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700)

  await fs.writeFile(resultsPath(home), JSON.stringify({ v: RESULTS_VERSION, results: {} }), 'utf8')
  await fs.chmod(resultsPath(home), 0o644)
  await loadResults(resultsPath(home))
  assert.equal((await fs.stat(resultsPath(home))).mode & 0o777, 0o600)
})

test('坏配置备份：rename 后收紧到 0600，目录收紧到 0700', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-balance-bad-'))
  t.after(async () => { await fs.rm(home, { recursive: true, force: true }) })
  const dir = configDir(home)
  await fs.mkdir(dir, { recursive: true, mode: 0o755 })
  await fs.chmod(dir, 0o755)
  const bad = '{"v":1,"providers":[{"id":"p_x","secret":"sk-BACKUP-LEAK"'
  await fs.writeFile(configPath(home), bad, { mode: 0o644 })
  await fs.chmod(configPath(home), 0o644)
  const loaded = await loadConfig(configPath(home))
  assert.equal(loaded.providers.length, 0)
  const files = await fs.readdir(dir)
  const backup = files.find((name) => name.includes('.bad-'))
  assert.ok(backup, '坏配置应被备份')
  const stat = await fs.stat(path.join(dir, backup))
  assert.equal(stat.mode & 0o777, 0o600, '备份文件不能留宽权限')
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700, '目录要收紧')
  assert.ok((await fs.readFile(path.join(dir, backup), 'utf8')).includes('sk-BACKUP-LEAK'), '备份内容留给用户排查')
})

// ---------- v0.7.2 复审修复 ----------

test('allowSecretReuse 默认拒绝：没显式放行就不复用旧密钥', () => {
  const existing = { id: 'p_keep12345', secret: 'old-secret' }
  const result = validateProvider(validDraft({ secret: '' }), { existing })
  assert.equal(result.ok, false)
  assert.match(result.errors.secret, /重新填密钥/)
  const allowed = validateProvider(validDraft({ secret: '' }), { existing, allowSecretReuse: true })
  assert.equal(allowed.provider.secret, 'old-secret')
})

test('明细/用量/附加信息标签不能含 = 或换行（保证表单往返）', () => {
  for (const key of ['detailPaths', 'usageFields', 'extraFields']) {
    const result = validateProvider(validDraft({
      [key]: [{ label: 'a=b', path: 'data.x' }],
    }))
    assert.equal(result.ok, false, key)
    assert.match(String(result.errors[key]), /不能含 = 或换行/, key)
  }
})

test('enriched 标记会落盘，之后不再复活用户删掉的默认明细', async (t) => {
  const home = await tempHome(t)
  const provider = validateProvider(validDraft({
    preset: 'newapi',
    url: 'https://relay.example.com/api/user/self',
    balancePath: 'data.quota',
    detailPaths: [{ label: '已用额度', path: 'data.used_quota' }],
  })).provider
  await saveConfig({ v: 1, providers: [{ ...provider, enriched: true }], settings: defaultSettings() }, configPath(home))
  const loaded = await loadConfig(configPath(home))
  assert.equal(loaded.providers[0].enriched, true)
  assert.deepEqual(loaded.providers[0].detailPaths.map((row) => row.label), ['已用额度'], '不能自动加回默认明细')
  // 没带标记的旧配置仍会跑一次迁移，并在内存里标记为已迁移
  const { createStore } = await import('../lib/index.js')
  await saveConfig({
    v: 1,
    providers: [{ ...provider, enriched: false }],
    settings: defaultSettings(),
  }, configPath(home))
  const store = createStore({ home })
  await store.ensureReady()
  assert.equal(store.state.config.providers[0].enriched, true)
  assert.ok(store.state.config.providers[0].detailPaths.some((row) => row.label === '累计请求'))
})

test('loadResults 忽略 __proto__ 等危险 id', async (t) => {
  const home = await tempHome(t)
  const dir = path.dirname(resultsPath(home))
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(resultsPath(home), JSON.stringify({
    v: RESULTS_VERSION,
    results: {
      __proto__: { ok: true, balance: 1 },
      constructor: { ok: true, balance: 2 },
      p_ok000001: { id: 'p_ok000001', ok: true, balance: 3 },
    },
  }), 'utf8')
  const loaded = await loadResults(resultsPath(home))
  assert.equal(Object.hasOwn(loaded.results, '__proto__'), false)
  assert.equal(Object.hasOwn(loaded.results, 'constructor'), false)
  assert.equal(Object.keys(loaded.results).length, 1)
  assert.equal(loaded.results.p_ok000001.balance, 3)
})

// ---------- 请求头校验（v0.7.3 审计补丁） ----------

test('请求头名称/值做字符集校验：拒绝空格、换行和请求库自管头', () => {
  expectError(validDraft({ secretHeader: 'X Evil' }), 'secretHeader', /请求头名称/)
  expectError(validDraft({ secretHeader: 'Host' }), 'secretHeader', /不能是 Host/)
  expectError(validDraft({ authType: 'login', username: 'u', loginUrl: 'https://api.example.com/login', tokenHeader: 'Content-Length' }), 'tokenHeader', /不能是 Content-Length/)
  expectError(validDraft({ authType: 'login', username: 'u', loginUrl: 'https://api.example.com/login', tokenPrefix: 'Bearer\r\nX-Evil: 1' }), 'tokenPrefix', /令牌前缀/)
  expectError(validDraft({ secret: 'sk-abc\nX-Evil: 1' }), 'secret', /不能含换行/)
  expectError(validDraft({ headersText: '{"X-Test":"a\\rb"}' }), 'headersText', /不能含换行/)
  expectError(validDraft({ headersText: '{"Bad Name":"x"}' }), 'headersText', /名称/)
  expectError(validDraft({ headersText: '{"Host":"evil"}' }), 'headersText', /不能是 Host/)
  // 正常的自定义头（new-api 常见的 New-Api-User）仍然允许
  const ok = validateProvider(validDraft({
    secretHeader: 'X-Api-Key',
    headersText: '{"New-Api-User":"42","X-Trace-Id":"a-b_c.d"}',
  }))
  assert.equal(ok.ok, true, JSON.stringify(ok.errors))
})

test('请求头值只接受可打印 ASCII：中文/emoji 提前拒绝，Basic/query 不受影响', () => {
  expectError(validDraft({ headersText: '{"X-Note":"中文"}' }), 'headersText', /ASCII/)
  expectError(validDraft({ tokenPrefix: 'Bearer 中文' }), 'tokenPrefix', /ASCII/)
  expectError(validDraft({ secret: 'sk-中文' }), 'secret', /ASCII/)
  const basic = validateProvider(validDraft({ authType: 'basic', username: '用户', secret: '密码' }))
  assert.equal(basic.ok, true, JSON.stringify(basic.errors))
  const query = validateProvider(validDraft({ authType: 'query', secret: 'sk-中文' }))
  assert.equal(query.ok, true, JSON.stringify(query.errors))
})
