import test from 'node:test'
import assert from 'node:assert/strict'
import { createRunner, queryProvider, queryAll, resolveUsageUrl, resolveUnit } from '../lib/query.js'

const LOGIN_URL = 'https://api.example.com/login'

function makeProvider (overrides = {}) {
  return {
    id: 'p_test1234',
    name: '测试服务',
    preset: 'custom',
    url: 'https://api.example.com/balance',
    method: 'GET',
    authType: 'bearer',
    secret: 'sk-test-123456',
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
    detailPaths: [],
    divisor: 1,
    multiplier: 1,
    symbol: '¥',
    decimals: 2,
    enabled: true,
    ...overrides,
  }
}

function responseOf (status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { status, ok: status >= 200 && status < 300, text: async () => text }
}

function recordingFetch (handler) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url, init })
    return handler(url, init, calls.length)
  }
  impl.calls = calls
  return impl
}

function delayed (ms, response) {
  return new Promise((resolve) => setTimeout(() => resolve(response), ms))
}

function hangingFetch () {
  return (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    })
  })
}

// ---------- 基本结果 ----------

test('createRunner 返回三个函数', () => {
  const runner = createRunner({ fetchImpl: async () => responseOf(200, {}) })
  assert.equal(typeof runner.queryProvider, 'function')
  assert.equal(typeof runner.queryAll, 'function')
  assert.equal(typeof runner.clearTokenCache, 'function')
})

test('queryProvider 成功时返回完整 Result', async () => {
  const impl = recordingFetch(() => responseOf(200, {
    data: { balance: 12.5, currency: 'CNY' },
  }))
  const runner = createRunner({ fetchImpl: impl, now: () => 1700000000000 })
  const result = await runner.queryProvider(makeProvider({
    currencyPath: 'data.currency',
    detailPaths: [{ label: '充值余额', path: 'data.balance' }, { label: '没有的', path: 'data.missing' }],
    decimals: 3,
  }))
  assert.equal(result.ok, true)
  assert.equal(result.error, null)
  assert.equal(result.id, 'p_test1234')
  assert.equal(result.balance, 12.5)
  assert.equal(result.currency, 'CNY')
  assert.equal(result.symbol, '¥')
  assert.equal(result.decimals, 3)
  assert.deepEqual(result.details, [
    { label: '充值余额', value: 12.5 },
    { label: '没有的', value: null },
  ])
  assert.equal(result.rawPreview, null)
  assert.equal(result.fetchedAt, 1700000000000)
})

test('currency 未命中或不是字符串时回落 provider.symbol', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1, currency: 42 } }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({ currencyPath: 'data.currency', symbol: 'US$' }))
  assert.equal(result.ok, true)
  assert.equal(result.currency, 'US$')
})

test('余额是数字字符串时照常解析', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: ' 99.5 ' } }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.ok, true)
  assert.equal(result.balance, 99.5)
})

// ---------- 6 种鉴权 ----------

test('鉴权 bearer 走 Authorization: Bearer', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  await runner.queryProvider(makeProvider({ authType: 'bearer' }))
  const { init, url } = impl.calls[0]
  assert.equal(url, 'https://api.example.com/balance')
  assert.equal(init.headers.Authorization, 'Bearer sk-test-123456')
  assert.equal(init.headers.Accept, 'application/json')
  assert.equal(init.method, 'GET')
})

test('鉴权 header 用 secretHeader 指定请求头', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  await runner.queryProvider(makeProvider({ authType: 'header', secretHeader: 'X-Custom-Key' }))
  assert.equal(impl.calls[0].init.headers['X-Custom-Key'], 'sk-test-123456')
  assert.equal('Authorization' in impl.calls[0].init.headers, false)
})

test('鉴权 query 合并已有 query 参数', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  await runner.queryProvider(makeProvider({
    authType: 'query',
    url: 'https://api.example.com/balance?foo=bar&key=old',
    secretParam: 'key',
  }))
  const parsed = new URL(impl.calls[0].url)
  assert.equal(parsed.searchParams.get('foo'), 'bar')
  assert.equal(parsed.searchParams.get('key'), 'sk-test-123456')
})

test('鉴权 cookie 原样放进 Cookie 头', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  await runner.queryProvider(makeProvider({ authType: 'cookie', secret: 'a=1; b=2' }))
  assert.equal(impl.calls[0].init.headers.Cookie, 'a=1; b=2')
})

test('鉴权 basic 用 UTF-8 安全的 base64', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  await runner.queryProvider(makeProvider({ authType: 'basic', username: '喵miao', secret: 'pä:ss' }))
  const expected = Buffer.from('喵miao:pä:ss', 'utf8').toString('base64')
  assert.equal(impl.calls[0].init.headers.Authorization, `Basic ${expected}`)
})

test('鉴权 login 先登录换 token 再带 token 请求', async () => {
  const impl = recordingFetch((url) => {
    if (url === LOGIN_URL) return responseOf(200, { data: { token: 'tok-1' } })
    return responseOf(200, { data: { balance: 8 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    authType: 'login',
    username: 'miao',
    loginUrl: LOGIN_URL,
    secret: 'pw',
  }))
  assert.equal(result.ok, true)
  const loginCall = impl.calls.find((call) => call.url === LOGIN_URL)
  assert.equal(loginCall.init.method, 'POST')
  assert.equal(loginCall.init.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(loginCall.init.body), { username: 'miao', password: 'pw' })
  const mainCall = impl.calls.find((call) => call.url !== LOGIN_URL)
  assert.equal(mainCall.init.headers.Authorization, 'Bearer tok-1')
})

test('login 支持自定义 tokenPath / tokenHeader / tokenPrefix', async () => {
  const impl = recordingFetch((url) => {
    if (url === LOGIN_URL) return responseOf(200, { result: { access_token: 'abc' } })
    return responseOf(200, { data: { balance: 1 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    authType: 'login',
    username: 'miao',
    loginUrl: LOGIN_URL,
    secret: 'pw',
    tokenPath: 'result.access_token',
    tokenHeader: 'X-Token',
    tokenPrefix: 'Token ',
  }))
  assert.equal(result.ok, true)
  const mainCall = impl.calls.find((call) => call.url !== LOGIN_URL)
  assert.equal(mainCall.init.headers['X-Token'], 'Token abc')
})

// ---------- 请求构造细节 ----------

test('额外请求头先铺、鉴权头覆盖同名项', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  await runner.queryProvider(makeProvider({
    headersText: JSON.stringify({ 'X-Extra': '1', Authorization: 'old', accept: 'text/plain' }),
  }))
  const headers = impl.calls[0].init.headers
  assert.equal(headers['X-Extra'], '1')
  assert.equal(headers.Authorization, 'Bearer sk-test-123456')
  assert.equal(headers.accept, 'text/plain')
  assert.equal('Accept' in headers, false)
})

test('POST 带 JSON 请求体，默认 Content-Type 为 application/json', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  await runner.queryProvider(makeProvider({ method: 'POST', bodyText: '{"model":"x"}' }))
  const { init } = impl.calls[0]
  assert.equal(init.method, 'POST')
  assert.equal(init.body, '{"model":"x"}')
  assert.equal(init.headers['Content-Type'], 'application/json')
})

test('用户显式 Content-Type 优先，GET 不发送请求体', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  await runner.queryProvider(makeProvider({
    method: 'POST',
    bodyText: '{"a":1}',
    headersText: JSON.stringify({ 'Content-Type': 'application/vnd.api+json' }),
  }))
  assert.equal(impl.calls[0].init.headers['Content-Type'], 'application/vnd.api+json')

  await runner.queryProvider(makeProvider({ method: 'GET', bodyText: '{"a":1}' }))
  assert.equal('body' in impl.calls[1].init, false)
})

// ---------- 失败映射 ----------

const HTTP_CASES = [
  [401, /密钥或令牌无效/],
  [403, /没有权限访问这个接口/],
  [404, /接口不存在，检查地址/],
  [429, /请求太频繁，稍后再试/],
  [500, /对方服务出错（HTTP 500）/],
  [502, /对方服务出错（HTTP 502）/],
  [418, /接口返回异常（HTTP 418）/],
]

for (const [status, pattern] of HTTP_CASES) {
  test(`HTTP ${status} 映射成中文错误且不抛异常`, async () => {
    const impl = recordingFetch(() => responseOf(status, { error: 'x' }))
    const runner = createRunner({ fetchImpl: impl })
    const result = await runner.queryProvider(makeProvider())
    assert.equal(result.ok, false)
    assert.match(result.error, pattern)
    assert.equal(result.balance, null)
    assert.equal(impl.calls.length, 1)
  })
}

test('返回不是 JSON 时给出中文错误', async () => {
  const impl = recordingFetch(() => responseOf(200, '<html>oops</html>'))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.ok, false)
  assert.equal(result.error, '返回的不是 JSON')
})

test('余额字段路径取不到时提示检查取值路径', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: {} }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.ok, false)
  assert.equal(result.error, '解析不到余额字段，检查取值路径')
})

test('余额不是数字时给出中文错误', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 'abc' } }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.ok, false)
  assert.equal(result.error, '余额不是数字')
})

test('网络异常映射为连不上接口', async () => {
  const impl = async () => {
    throw new TypeError('fetch failed')
  }
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.ok, false)
  assert.equal(result.error, '连不上接口，检查地址或网络')
})

test('queryProvider 对空服务配置不抛异常', async () => {
  const result = await queryProvider(null)
  assert.equal(result.ok, false)
  assert.equal(result.error, '服务配置有误')
  const runner = createRunner({ fetchImpl: async () => responseOf(200, {}) })
  const weird = await runner.queryProvider([])
  assert.equal(weird.ok, false)
  assert.equal(weird.error, '服务配置有误')
})

// ---------- 超时与取消 ----------

test('请求超时映射为请求超时并清理定时器', async () => {
  const runner = createRunner({ fetchImpl: hangingFetch(), defaultTimeoutMs: 10 })
  const started = Date.now()
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.ok, false)
  assert.equal(result.error, '请求超时')
  assert.ok(Date.now() - started < 2000)
})

test('queryProvider 的 timeoutMs 覆盖 runner 默认值', async () => {
  const runner = createRunner({ fetchImpl: hangingFetch(), defaultTimeoutMs: 60000 })
  const started = Date.now()
  const result = await runner.queryProvider(makeProvider(), { timeoutMs: 10 })
  assert.equal(result.error, '请求超时')
  assert.ok(Date.now() - started < 2000)
})

test('外部 signal 预先取消时不发请求', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  const controller = new AbortController()
  controller.abort()
  const result = await runner.queryProvider(makeProvider(), { signal: controller.signal })
  assert.equal(result.ok, false)
  assert.equal(result.error, '已取消')
  assert.equal(impl.calls.length, 0)
})

test('请求途中被外部取消时映射为已取消', async () => {
  const runner = createRunner({ fetchImpl: hangingFetch() })
  const controller = new AbortController()
  const pending = runner.queryProvider(makeProvider(), { signal: controller.signal })
  setTimeout(() => controller.abort(), 10)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error, '已取消')
})

// ---------- 登录缓存与 401 重试 ----------

test('login token 在 runner 内缓存，不重复登录', async () => {
  const impl = recordingFetch((url) => {
    if (url === LOGIN_URL) return responseOf(200, { data: { token: 'cached-token' } })
    return responseOf(200, { data: { balance: 1 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const provider = makeProvider({ authType: 'login', username: 'miao', loginUrl: LOGIN_URL, secret: 'pw' })
  const first = await runner.queryProvider(provider)
  const second = await runner.queryProvider(provider)
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(impl.calls.filter((call) => call.url === LOGIN_URL).length, 1)
})

test('clearTokenCache 后重新登录', async () => {
  const impl = recordingFetch((url) => {
    if (url === LOGIN_URL) return responseOf(200, { data: { token: 'cached-token' } })
    return responseOf(200, { data: { balance: 1 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const provider = makeProvider({ authType: 'login', username: 'miao', loginUrl: LOGIN_URL, secret: 'pw' })
  await runner.queryProvider(provider)
  runner.clearTokenCache()
  await runner.queryProvider(provider)
  assert.equal(impl.calls.filter((call) => call.url === LOGIN_URL).length, 2)
})

test('主请求 401 时清缓存重登并重试一次', async () => {
  let loginCount = 0
  let mainCount = 0
  const impl = recordingFetch((url) => {
    if (url === LOGIN_URL) {
      loginCount += 1
      return responseOf(200, { data: { token: `tok-${loginCount}` } })
    }
    mainCount += 1
    if (mainCount === 1) return responseOf(401, {})
    return responseOf(200, { data: { balance: 6 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    authType: 'login',
    username: 'miao',
    loginUrl: LOGIN_URL,
    secret: 'pw',
  }))
  assert.equal(result.ok, true)
  assert.equal(result.balance, 6)
  assert.equal(loginCount, 2)
  assert.equal(mainCount, 2)
  const mainCalls = impl.calls.filter((call) => call.url !== LOGIN_URL)
  assert.equal(mainCalls[0].init.headers.Authorization, 'Bearer tok-1')
  assert.equal(mainCalls[1].init.headers.Authorization, 'Bearer tok-2')
})

test('主请求 403 也触发重登重试', async () => {
  let mainCount = 0
  const impl = recordingFetch((url) => {
    if (url === LOGIN_URL) return responseOf(200, { data: { token: 'tok' } })
    mainCount += 1
    return mainCount === 1 ? responseOf(403, {}) : responseOf(200, { data: { balance: 2 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    authType: 'login',
    username: 'miao',
    loginUrl: LOGIN_URL,
    secret: 'pw',
  }))
  assert.equal(result.ok, true)
  assert.equal(mainCount, 2)
})

test('重试后仍 401 返回密钥或令牌无效，只重试一次', async () => {
  let loginCount = 0
  let mainCount = 0
  const impl = recordingFetch((url) => {
    if (url === LOGIN_URL) {
      loginCount += 1
      return responseOf(200, { data: { token: 'tok' } })
    }
    mainCount += 1
    return responseOf(401, {})
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    authType: 'login',
    username: 'miao',
    loginUrl: LOGIN_URL,
    secret: 'pw',
  }))
  assert.equal(result.ok, false)
  assert.equal(result.error, '密钥或令牌无效')
  assert.equal(mainCount, 2)
  assert.equal(loginCount, 2)
})

test('非 login 鉴权遇到 401 不重试', async () => {
  const impl = recordingFetch(() => responseOf(401, {}))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.error, '密钥或令牌无效')
  assert.equal(impl.calls.length, 1)
})

test('登录失败（非 2xx）返回登录失败文案', async () => {
  const impl = recordingFetch((url) => {
    if (url === LOGIN_URL) return responseOf(500, {})
    return responseOf(200, { data: { balance: 1 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    authType: 'login',
    username: 'miao',
    loginUrl: LOGIN_URL,
    secret: 'pw',
  }))
  assert.equal(result.ok, false)
  assert.equal(result.error, '登录失败，检查账号密码')
  assert.equal(impl.calls.filter((call) => call.url !== LOGIN_URL).length, 0)
})

test('登录响应取不到 token 时返回登录失败文案', async () => {
  const impl = recordingFetch((url) => {
    if (url === LOGIN_URL) return responseOf(200, { data: { token: '' } })
    return responseOf(200, { data: { balance: 1 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    authType: 'login',
    username: 'miao',
    loginUrl: LOGIN_URL,
    secret: 'pw',
  }))
  assert.equal(result.error, '登录失败，检查账号密码')

  const badJson = createRunner({
    fetchImpl: recordingFetch(() => responseOf(200, 'not json')),
  })
  const result2 = await badJson.queryProvider(makeProvider({
    authType: 'login',
    username: 'miao',
    loginUrl: LOGIN_URL,
    secret: 'pw',
  }))
  assert.equal(result2.error, '登录失败，检查账号密码')
})

// ---------- 预览 ----------

test('preview=false 时 rawPreview 为 null', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.rawPreview, null)
})

test('preview=true 时给 JSON 文本预览', async () => {
  const payload = { data: { balance: 1.5, currency: 'CNY' } }
  const impl = recordingFetch(() => responseOf(200, payload))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider(), { preview: true })
  assert.equal(result.rawPreview, JSON.stringify(payload))
})

test('预览截断到 8192 字符', async () => {
  const payload = { data: { balance: 1, padding: 'x'.repeat(20000) } }
  const impl = recordingFetch(() => responseOf(200, payload))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider(), { preview: true })
  assert.equal(result.rawPreview.length, 8192)
  assert.equal(result.rawPreview, JSON.stringify(payload).slice(0, 8192))
})

test('preview 时取值路径不存在仍回显原始 JSON 供修正路径', async () => {
  const payload = { data: { other: 1 }, code: 0 }
  const impl = recordingFetch(() => responseOf(200, payload))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider(), { preview: true })
  assert.equal(result.ok, false)
  assert.equal(result.error, '解析不到余额字段，检查取值路径')
  assert.equal(result.rawPreview, JSON.stringify(payload))
})

test('preview 时余额不是数字仍回显原始 JSON', async () => {
  const payload = { data: { balance: 'abc' } }
  const impl = recordingFetch(() => responseOf(200, payload))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider(), { preview: true })
  assert.equal(result.ok, false)
  assert.equal(result.error, '余额不是数字')
  assert.equal(result.rawPreview, JSON.stringify(payload))
})

test('preview 时余额路径命中 null 也回显原始 JSON', async () => {
  const payload = { data: { balance: null } }
  const impl = recordingFetch(() => responseOf(200, payload))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider(), { preview: true })
  assert.equal(result.ok, false)
  assert.equal(result.error, '余额不是数字')
  assert.equal(result.rawPreview, JSON.stringify(payload))
})

test('HTTP 失败时 preview 为 null', async () => {
  const impl = recordingFetch(() => responseOf(500, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider(), { preview: true })
  assert.equal(result.ok, false)
  assert.match(result.error, /对方服务出错/)
  assert.equal(result.rawPreview, null)
})

test('非 JSON 响应时 preview 为 null', async () => {
  const impl = recordingFetch(() => responseOf(200, '<html>oops</html>'))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider(), { preview: true })
  assert.equal(result.error, '返回的不是 JSON')
  assert.equal(result.rawPreview, null)
})

test('preview=false 时余额解析失败不会漏出 rawPreview', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: {} }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.ok, false)
  assert.equal(result.rawPreview, null)
})

// ---------- queryAll ----------

test('queryAll 按传入顺序返回并隔离单家失败', async () => {
  const impl = recordingFetch((url) => {
    if (url.includes('bad')) throw new Error('network down')
    if (url.includes('one')) return delayed(20, responseOf(200, { data: { balance: 1 } }))
    return delayed(2, responseOf(200, { data: { balance: 2 } }))
  })
  const runner = createRunner({ fetchImpl: impl })
  const providers = [
    makeProvider({ id: 'p_slow0001', url: 'https://api.example.com/one' }),
    makeProvider({ id: 'p_bad00001', url: 'https://api.example.com/bad' }),
    makeProvider({ id: 'p_fast0001', url: 'https://api.example.com/two' }),
  ]
  const results = await runner.queryAll(providers)
  assert.deepEqual(results.map((result) => result.id), ['p_slow0001', 'p_bad00001', 'p_fast0001'])
  assert.equal(results[0].balance, 1)
  assert.equal(results[1].ok, false)
  assert.equal(results[1].error, '连不上接口，检查地址或网络')
  assert.equal(results[2].balance, 2)
})

test('queryAll 并发不超过 limit', async () => {
  let active = 0
  let maxActive = 0
  const impl = recordingFetch(async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 15))
    active -= 1
    return responseOf(200, { data: { balance: 1 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const providers = Array.from({ length: 5 }, (_, index) => makeProvider({
    id: `p_limit${String(index).padStart(3, '0')}`,
    url: `https://api.example.com/${index}`,
  }))
  const results = await runner.queryAll(providers, { limit: 2 })
  assert.equal(results.length, 5)
  assert.ok(maxActive <= 2, `并发 ${maxActive} 超过 2`)
  assert.equal(maxActive, 2)
})

test('queryAll 默认并发 3，空列表返回空数组', async () => {
  let active = 0
  let maxActive = 0
  const impl = recordingFetch(async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 10))
    active -= 1
    return responseOf(200, { data: { balance: 1 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const providers = Array.from({ length: 6 }, (_, index) => makeProvider({
    id: `p_default${String(index).padStart(2, '0')}`,
    url: `https://api.example.com/${index}`,
  }))
  await runner.queryAll(providers)
  assert.equal(maxActive, 3)
  assert.deepEqual(await runner.queryAll([]), [])
})

test('queryAll 收到已取消的 signal 时全部返回已取消且不发请求', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  const controller = new AbortController()
  controller.abort()
  const results = await runner.queryAll(
    [makeProvider(), makeProvider({ id: 'p_other123' })],
    { signal: controller.signal },
  )
  assert.equal(results.length, 2)
  for (const result of results) {
    assert.equal(result.ok, false)
    assert.equal(result.error, '已取消')
  }
  assert.equal(impl.calls.length, 0)
})

test('queryAll 透传 preview 与 timeoutMs', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  const results = await runner.queryAll([makeProvider()], { preview: true })
  assert.equal(typeof results[0].rawPreview, 'string')
})

// ---------- v1.1 用量 ----------

function usageProvider (overrides = {}) {
  return makeProvider({
    usageUrl: 'https://api.example.com/usage?start={7d}&end={now}&today={today}',
    usageMethod: 'GET',
    usageArrayPath: '',
    usageFields: [
      { label: '近7天 Token', path: 'token_used' },
      { label: '近7天 请求', path: 'count' },
    ],
    usageScale: false,
    ...overrides,
  })
}

function balanceAndUsageFetch (usageResponse, onUsage) {
  return recordingFetch((url, init) => {
    if (url.includes('/usage')) {
      if (onUsage) onUsage(url, init)
      return typeof usageResponse === 'function' ? usageResponse(url, init) : usageResponse
    }
    return responseOf(200, { data: { balance: 12 } })
  })
}

test('resolveUsageUrl 替换 {now}/{today}/{7d}（本地时区、epoch 秒）', () => {
  const at = new Date(2026, 10, 13, 9, 30, 0).getTime()
  const today = new Date(2026, 10, 13, 0, 0, 0).getTime()
  const provider = { usageUrl: 'https://x.example/u?now={now}&today={today}&week={7d}' }
  assert.equal(
    resolveUsageUrl(provider, at),
    `https://x.example/u?now=${Math.floor(at / 1000)}&today=${Math.floor(today / 1000)}&week=${Math.floor((at - 7 * 86400 * 1000) / 1000)}`,
  )
})

test('resolveUsageUrl 无占位符/无 usageUrl/now 类型兜底', () => {
  assert.equal(resolveUsageUrl({ usageUrl: 'https://x.example/u' }, 0), 'https://x.example/u')
  assert.equal(resolveUsageUrl({ usageUrl: '' }, 0), '')
  assert.equal(resolveUsageUrl({}, 0), '')
  assert.equal(resolveUsageUrl(null, 0), '')
  const at = new Date(2026, 10, 13, 9, 30, 0)
  const expected = String(Math.floor(at.getTime() / 1000))
  assert.equal(resolveUsageUrl({ usageUrl: 'https://x.example/u?at={now}' }, at), `https://x.example/u?at=${expected}`)
  assert.equal(resolveUsageUrl({ usageUrl: 'https://x.example/u?at={now}' }, () => at.getTime()), `https://x.example/u?at=${expected}`)
})

test('余额请求后追加用量请求并按数组逐项求和', async () => {
  const at = new Date(2026, 10, 13, 9, 30, 0).getTime()
  const impl = balanceAndUsageFetch(responseOf(200, {
    data: [
      { token_used: 100, count: 2 },
      { token_used: 250, count: 3 },
      { token_used: '50.5', count: '1' },
    ],
  }))
  const runner = createRunner({ fetchImpl: impl, now: () => at })
  const result = await runner.queryProvider(usageProvider({ usageArrayPath: 'data' }))
  assert.equal(result.ok, true)
  assert.equal(result.balance, 12)
  assert.deepEqual(result.usage, [
    { label: '近7天 Token', value: 400.5 },
    { label: '近7天 请求', value: 6 },
  ])
  assert.equal(impl.calls.length, 2)
  const usageCall = impl.calls.find((call) => call.url.includes('/usage'))
  const parsed = new URL(usageCall.url)
  assert.equal(parsed.searchParams.get('start'), String(Math.floor((at - 7 * 86400 * 1000) / 1000)))
  assert.equal(parsed.searchParams.get('end'), String(Math.floor(at / 1000)))
  assert.equal(parsed.searchParams.get('today'), String(Math.floor(new Date(2026, 10, 13).getTime() / 1000)))
})

test('用量请求复用余额鉴权（bearer / cookie）', async () => {
  const bearerImpl = balanceAndUsageFetch(responseOf(200, { data: [{ token_used: 1 }] }))
  const bearerRunner = createRunner({ fetchImpl: bearerImpl })
  await bearerRunner.queryProvider(usageProvider({ usageArrayPath: 'data' }))
  const bearerUsage = bearerImpl.calls.find((call) => call.url.includes('/usage'))
  assert.equal(bearerUsage.init.headers.Authorization, 'Bearer sk-test-123456')

  const cookieImpl = balanceAndUsageFetch(responseOf(200, { data: [{ count: 1 }] }))
  const cookieRunner = createRunner({ fetchImpl: cookieImpl })
  await cookieRunner.queryProvider(usageProvider({
    authType: 'cookie',
    secret: 'a=1; b=2',
    usageArrayPath: 'data',
    usageFields: [{ label: '请求', path: 'count' }],
  }))
  const cookieUsage = cookieImpl.calls.find((call) => call.url.includes('/usage'))
  assert.equal(cookieUsage.init.headers.Cookie, 'a=1; b=2')
})

test('login 鉴权时用量请求复用 token 缓存，不重复登录', async () => {
  const impl = recordingFetch((url) => {
    if (url === LOGIN_URL) return responseOf(200, { data: { token: 'tok-1' } })
    if (url.includes('/usage')) return responseOf(200, { data: [{ count: 3 }] })
    return responseOf(200, { data: { balance: 5 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    authType: 'login',
    username: 'miao',
    loginUrl: LOGIN_URL,
    secret: 'pw',
    usageUrl: 'https://api.example.com/usage',
    usageArrayPath: 'data',
    usageFields: [{ label: '请求', path: 'count' }],
  }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.usage, [{ label: '请求', value: 3 }])
  assert.equal(impl.calls.filter((call) => call.url === LOGIN_URL).length, 1)
  const usageCall = impl.calls.find((call) => call.url.includes('/usage'))
  assert.equal(usageCall.init.headers.Authorization, 'Bearer tok-1')
})

test('用量自动取数组：响应数组 → data 数组 → 第一个数组', async () => {
  const cases = [
    [[{ token_used: 7 }], 7],
    [{ data: [{ token_used: 8 }] }, 8],
    [{ code: 0, list: [{ token_used: 9 }] }, 9],
  ]
  for (const [payload, expected] of cases) {
    const impl = balanceAndUsageFetch(responseOf(200, payload))
    const runner = createRunner({ fetchImpl: impl })
    const result = await runner.queryProvider(usageProvider({
      usageArrayPath: '',
      usageFields: [{ label: 'Token', path: 'token_used' }],
    }))
    assert.deepEqual(result.usage, [{ label: 'Token', value: expected }], JSON.stringify(payload))
  }
})

test('用量没有数组可取时为空数组', async () => {
  const impl = balanceAndUsageFetch(responseOf(200, { code: 0, message: 'ok' }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(usageProvider())
  assert.equal(result.ok, true)
  assert.deepEqual(result.usage, [])
})

test('usageArrayPath 指向对象时按单行处理', async () => {
  const impl = balanceAndUsageFetch(responseOf(200, { data: { token_used: 42, count: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(usageProvider({ usageArrayPath: 'data' }))
  assert.deepEqual(result.usage, [
    { label: '近7天 Token', value: 42 },
    { label: '近7天 请求', value: 1 },
  ])
})

test('用量字段取不到或非数字时省略该字段', async () => {
  const impl = balanceAndUsageFetch(responseOf(200, {
    data: [
      { token_used: 10 },
      { token_used: 'abc', count: 'x' },
      { count: 4 },
    ],
  }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(usageProvider({ usageArrayPath: 'data' }))
  assert.deepEqual(result.usage, [
    { label: '近7天 Token', value: 10 },
    { label: '近7天 请求', value: 4 },
  ])
})

test('用量请求 POST 与额外请求头', async () => {
  let usageInit = null
  const impl = balanceAndUsageFetch(
    responseOf(200, { data: [{ count: 2 }] }),
    (url, init) => { usageInit = init },
  )
  const runner = createRunner({ fetchImpl: impl })
  await runner.queryProvider(usageProvider({
    usageMethod: 'POST',
    usageArrayPath: 'data',
    usageFields: [{ label: '请求', path: 'count' }],
    headersText: JSON.stringify({ 'X-Extra': '1' }),
  }))
  assert.equal(usageInit.method, 'POST')
  assert.equal(usageInit.headers['X-Extra'], '1')
  assert.equal('body' in usageInit, false)
})

test('用量请求的 query 鉴权追加 secretParam', async () => {
  const impl = balanceAndUsageFetch(responseOf(200, { data: [{ count: 2 }] }))
  const runner = createRunner({ fetchImpl: impl })
  await runner.queryProvider(usageProvider({
    authType: 'query',
    secretParam: 'key',
    usageArrayPath: 'data',
    usageFields: [{ label: '请求', path: 'count' }],
  }))
  const usageCall = impl.calls.find((call) => call.url.includes('/usage'))
  assert.equal(new URL(usageCall.url).searchParams.get('key'), 'sk-test-123456')
})

test('余额失败但用量成功：usage 保留，error 不被污染', async () => {
  const impl = recordingFetch((url) => {
    if (url.includes('/usage')) return responseOf(200, { data: [{ token_used: 6 }] })
    return responseOf(500, {})
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(usageProvider({ usageArrayPath: 'data' }))
  assert.equal(result.ok, false)
  assert.match(result.error, /对方服务出错/)
  assert.deepEqual(result.usage, [{ label: '近7天 Token', value: 6 }])
})

test('余额字段解析失败但用量成功：usage 保留、error 照旧', async () => {
  const impl = recordingFetch((url) => {
    if (url.includes('/usage')) return responseOf(200, { data: [{ count: 2 }] })
    return responseOf(200, { data: {} })
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(usageProvider({ usageArrayPath: 'data' }))
  assert.equal(result.ok, false)
  assert.equal(result.error, '解析不到余额字段，检查取值路径')
  assert.deepEqual(result.usage, [{ label: '近7天 请求', value: 2 }])
})

test('用量失败静默：HTTP / 非 JSON / 网络异常都不写 error', async () => {
  const failures = [
    () => responseOf(500, {}),
    () => responseOf(200, 'not json'),
    () => { throw new Error('network broke') },
  ]
  for (const failure of failures) {
    const impl = balanceAndUsageFetch(failure)
    const runner = createRunner({ fetchImpl: impl })
    const result = await runner.queryProvider(usageProvider())
    assert.equal(result.ok, true)
    assert.equal(result.error, null)
    assert.deepEqual(result.usage, [])
  }
})

test('用量请求超时静默，不影响余额结果', async () => {
  const impl = recordingFetch((url, init) => {
    if (!url.includes('/usage')) return responseOf(200, { data: { balance: 3 } })
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      })
    })
  })
  const runner = createRunner({ fetchImpl: impl, defaultTimeoutMs: 15 })
  const started = Date.now()
  const result = await runner.queryProvider(usageProvider())
  assert.equal(result.ok, true)
  assert.equal(result.balance, 3)
  assert.deepEqual(result.usage, [])
  assert.ok(Date.now() - started < 2000)
})

test('用量请求被取消时静默，余额结果保留', async () => {
  const impl = recordingFetch((url, init) => {
    if (!url.includes('/usage')) return responseOf(200, { data: { balance: 3 } })
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      })
    })
  })
  const runner = createRunner({ fetchImpl: impl })
  const controller = new AbortController()
  const pending = runner.queryProvider(usageProvider(), { signal: controller.signal })
  setTimeout(() => controller.abort(), 15)
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(result.balance, 3)
  assert.deepEqual(result.usage, [])
})

test('外部 signal 预先取消时不发任何请求且 usage 为空', async () => {
  const impl = balanceAndUsageFetch(responseOf(200, { data: [{ count: 1 }] }))
  const runner = createRunner({ fetchImpl: impl })
  const controller = new AbortController()
  controller.abort()
  const result = await runner.queryProvider(usageProvider(), { signal: controller.signal })
  assert.equal(result.error, '已取消')
  assert.deepEqual(result.usage, [])
  assert.equal(impl.calls.length, 0)
})

test('没有 usageUrl 时不发额外请求，usage 为空数组', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.ok, true)
  assert.deepEqual(result.usage, [])
  assert.equal(impl.calls.length, 1)
})

test('usageScale 不影响 query 返回的原始数值', async () => {
  const impl = balanceAndUsageFetch(responseOf(200, { data: [{ token_used: 1234567 }] }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(usageProvider({ usageArrayPath: 'data', usageScale: true }))
  assert.deepEqual(result.usage, [{ label: '近7天 Token', value: 1234567 }])
})

test('用量数组路径非法（绕过校验）时静默为空', async () => {
  const impl = balanceAndUsageFetch(responseOf(200, { data: [{ token_used: 1 }] }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(usageProvider({ usageArrayPath: 'a b' }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.usage, [])
})

test('用量字段最多取 4 项', async () => {
  const impl = balanceAndUsageFetch(responseOf(200, { data: [{ a: 1, b: 2, c: 3, d: 4, e: 5 }] }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(usageProvider({
    usageArrayPath: 'data',
    usageFields: [
      { label: 'a', path: 'a' },
      { label: 'b', path: 'b' },
      { label: 'c', path: 'c' },
      { label: 'd', path: 'd' },
      { label: 'e', path: 'e' },
    ],
  }))
  assert.equal(result.usage.length, 4)
  assert.deepEqual(result.usage.map((item) => item.label), ['a', 'b', 'c', 'd'])
})

test('preview 与 usage 共存：rawPreview 只含余额响应', async () => {
  const balancePayload = { data: { balance: 12 } }
  const impl = balanceAndUsageFetch(responseOf(200, { data: [{ count: 2 }] }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(usageProvider({
    usageArrayPath: 'data',
    usageFields: [{ label: '请求', path: 'count' }],
  }), { preview: true })
  assert.equal(result.rawPreview, JSON.stringify(balancePayload))
  assert.deepEqual(result.usage, [{ label: '请求', value: 2 }])
})

test('queryAll 的每个 Result 都带 usage 数组', async () => {
  const impl = recordingFetch((url) => {
    if (url.includes('/usage')) return responseOf(200, { data: [{ count: 2 }] })
    return responseOf(200, { data: { balance: 1 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const providers = [
    usageProvider({ id: 'p_usage001', usageArrayPath: 'data', usageFields: [{ label: '请求', path: 'count' }] }),
    makeProvider({ id: 'p_usage002' }),
  ]
  const results = await runner.queryAll(providers)
  assert.deepEqual(results[0].usage, [{ label: '请求', value: 2 }])
  assert.deepEqual(results[1].usage, [])
})

// ---------- v1.7 自动站点货币 ----------

const UNIT_NOW = 1700000000000

function statusBody (extra = {}) {
  return {
    data: {
      display_in_currency: true,
      quota_display_type: 'USD',
      quota_per_unit: 500000,
      usd_exchange_rate: 7.2,
      custom_currency_symbol: '🍪',
      custom_currency_exchange_rate: 3,
      ...extra,
    },
  }
}

function statusResponse (body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { status: 200, ok: true, text: async () => text }
}

function statusOnlyFetch (body) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url, init })
    return statusResponse(body)
  }
  impl.calls = calls
  return impl
}

test('resolveUnit USD：qpu 作除数、$ 美元', async () => {
  const impl = statusOnlyFetch(statusBody({ quota_display_type: 'USD' }))
  const unit = await resolveUnit(
    { url: 'https://unit-usd.example/api/user/self' },
    { fetchImpl: impl },
  )
  assert.deepEqual(unit, { divisor: 500000, multiplier: 1, symbol: '$', decimals: 2 })
  assert.equal(impl.calls.length, 1)
  assert.equal(impl.calls[0].url, 'https://unit-usd.example/api/status')
  assert.equal(impl.calls[0].init.method, 'GET')
  assert.equal(impl.calls[0].init.headers.Accept, 'application/json')
  assert.equal(impl.calls[0].init.headers.Authorization, undefined)
})

test('resolveUnit CNY：usd_exchange_rate 作乘数、¥', async () => {
  const impl = statusOnlyFetch(statusBody({ quota_display_type: 'CNY', usd_exchange_rate: 7.2 }))
  const unit = await resolveUnit(
    { url: 'https://unit-cny.example/api/user/self' },
    { fetchImpl: impl },
  )
  assert.deepEqual(unit, { divisor: 500000, multiplier: 7.2, symbol: '¥', decimals: 2 })
})

test('resolveUnit CUSTOM：自定义符号与汇率（🍪）', async () => {
  const impl = statusOnlyFetch(statusBody({
    quota_display_type: 'CUSTOM',
    quota_per_unit: 200000,
    custom_currency_symbol: '🍪',
    custom_currency_exchange_rate: 2.5,
  }))
  const unit = await resolveUnit(
    { url: 'https://unit-custom.example/api/user/self' },
    { fetchImpl: impl },
  )
  assert.deepEqual(unit, { divisor: 200000, multiplier: 2.5, symbol: '🍪', decimals: 2 })
})

test('resolveUnit TOKENS：不换算、无符号', async () => {
  const impl = statusOnlyFetch(statusBody({ quota_display_type: 'TOKENS' }))
  const unit = await resolveUnit(
    { url: 'https://unit-tokens.example/api/user/self' },
    { fetchImpl: impl },
  )
  assert.deepEqual(unit, { divisor: 1, multiplier: 1, symbol: '', decimals: 0 })
})

test('resolveUnit display_in_currency=false 按 TOKENS 处理', async () => {
  const impl = statusOnlyFetch(statusBody({ display_in_currency: false, quota_display_type: 'USD' }))
  const unit = await resolveUnit(
    { url: 'https://unit-tokens-false.example/api/user/self' },
    { fetchImpl: impl },
  )
  assert.deepEqual(unit, { divisor: 1, multiplier: 1, symbol: '', decimals: 0 })
})

test('resolveUnit 缺字段回退：qpu 500000、汇率 1、空符号、支持根级 data', async () => {
  const missingQpu = statusOnlyFetch({ display_in_currency: true, quota_display_type: 'CUSTOM' })
  assert.deepEqual(
    await resolveUnit({ url: 'https://unit-missing-qpu.example/api/user/self' }, { fetchImpl: missingQpu }),
    { divisor: 500000, multiplier: 1, symbol: '', decimals: 2 },
  )

  const noRate = statusOnlyFetch({ display_in_currency: true, quota_display_type: 'CNY', quota_per_unit: 'abc' })
  assert.deepEqual(
    await resolveUnit({ url: 'https://unit-missing-rate.example/api/user/self' }, { fetchImpl: noRate }),
    { divisor: 500000, multiplier: 1, symbol: '¥', decimals: 2 },
  )

  const customFallback = statusOnlyFetch({ display_in_currency: true, quota_display_type: 'CUSTOM', custom_currency_symbol: '🍪' })
  assert.deepEqual(
    await resolveUnit({ url: 'https://unit-custom-fallback.example/api/user/self' }, { fetchImpl: customFallback }),
    { divisor: 500000, multiplier: 1, symbol: '🍪', decimals: 2 },
  )
})

test('resolveUnit 未知 display type 返回 null', async () => {
  const impl = statusOnlyFetch(statusBody({ quota_display_type: 'EUR' }))
  assert.equal(
    await resolveUnit({ url: 'https://unit-unknown.example/api/user/self' }, { fetchImpl: impl }),
    null,
  )
  const missingType = statusOnlyFetch({ display_in_currency: true })
  assert.equal(
    await resolveUnit({ url: 'https://unit-null-type.example/api/user/self' }, { fetchImpl: missingType }),
    null,
  )
})

test('resolveUnit 站点根：无 /api/user/self 时取 origin', async () => {
  const impl = statusOnlyFetch(statusBody())
  await resolveUnit({ url: 'https://unit-nosuffix.example/some/path' }, { fetchImpl: impl })
  assert.equal(impl.calls[0].url, 'https://unit-nosuffix.example/api/status')

  const trailing = statusOnlyFetch(statusBody())
  await resolveUnit({ url: 'https://unit-trailing.example/api/user/self/' }, { fetchImpl: trailing })
  assert.equal(trailing.calls[0].url, 'https://unit-trailing.example/api/status')
})

test('resolveUnit 失败静默：HTTP / 非 JSON / 网络异常 / 非法 provider', async () => {
  const http500 = async () => ({ status: 500, ok: false, text: async () => '{}' })
  assert.equal(await resolveUnit({ url: 'https://unit-500.example/api/user/self' }, { fetchImpl: http500, now: () => UNIT_NOW }), null)

  const notJson = async () => statusResponse('<html>')
  assert.equal(await resolveUnit({ url: 'https://unit-notjson.example/api/user/self' }, { fetchImpl: notJson, now: () => UNIT_NOW }), null)

  const network = async () => { throw new TypeError('fetch failed') }
  assert.equal(await resolveUnit({ url: 'https://unit-network.example/api/user/self' }, { fetchImpl: network, now: () => UNIT_NOW }), null)

  assert.equal(await resolveUnit(null, { fetchImpl: http500 }), null)
  assert.equal(await resolveUnit({ url: '' }, { fetchImpl: http500 }), null)
})

test('resolveUnit 超时/取消静默且不留 timer', async () => {
  const hanging = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    })
  })
  const started = Date.now()
  assert.equal(
    await resolveUnit({ url: 'https://unit-timeout.example/api/user/self' }, { fetchImpl: hanging, timeoutMs: 10 }),
    null,
  )
  assert.ok(Date.now() - started < 2000)

  const neverCalled = statusOnlyFetch(statusBody())
  const controller = new AbortController()
  controller.abort()
  assert.equal(
    await resolveUnit(
      { url: 'https://unit-cancel.example/api/user/self' },
      { fetchImpl: neverCalled, signal: controller.signal },
    ),
    null,
  )
  assert.equal(neverCalled.calls.length, 0)
})

test('resolveUnit 同站点根 10 分钟内只请求一次，过期后重取', async () => {
  let calls = 0
  const impl = async () => {
    calls += 1
    return statusResponse(statusBody({ quota_display_type: 'USD' }))
  }
  const provider = { url: 'https://unit-cache.example/api/user/self' }
  let nowMs = UNIT_NOW
  const now = () => nowMs
  const expected = { divisor: 500000, multiplier: 1, symbol: '$', decimals: 2 }
  assert.deepEqual(await resolveUnit(provider, { fetchImpl: impl, now }), expected)
  nowMs += 9 * 60 * 1000
  assert.deepEqual(await resolveUnit(provider, { fetchImpl: impl, now }), expected)
  assert.equal(calls, 1)
  nowMs += 2 * 60 * 1000
  assert.deepEqual(await resolveUnit(provider, { fetchImpl: impl, now }), expected)
  assert.equal(calls, 2)
})

test('resolveUnit 失败结果不缓存', async () => {
  let calls = 0
  const impl = async () => {
    calls += 1
    return calls === 1
      ? { status: 500, ok: false, text: async () => '{}' }
      : statusResponse(statusBody())
  }
  const provider = { url: 'https://unit-nocache.example/api/user/self' }
  const now = () => UNIT_NOW
  assert.equal(await resolveUnit(provider, { fetchImpl: impl, now }), null)
  assert.deepEqual(
    await resolveUnit(provider, { fetchImpl: impl, now }),
    { divisor: 500000, multiplier: 1, symbol: '$', decimals: 2 },
  )
  assert.equal(calls, 2)
})

function autoUnitNewApiProvider (overrides = {}) {
  return makeProvider({
    preset: 'newapi',
    autoUnit: true,
    url: 'https://unit-qp.example/api/user/self',
    ...overrides,
  })
}

function unitAwareFetch (status, calls) {
  const impl = async (url, init = {}) => {
    calls.push({ url, init })
    if (url.includes('/api/status')) {
      return typeof status === 'function' ? status(url, init) : statusResponse(status)
    }
    return responseOf(200, { data: { balance: 7 } })
  }
  return impl
}

test('queryProvider：newapi + autoUnit 附 Result.unit，balance 保持原始值', async () => {
  const calls = []
  const impl = unitAwareFetch(statusBody({
    quota_display_type: 'CUSTOM',
    custom_currency_symbol: '🍪',
    custom_currency_exchange_rate: 2.5,
  }), calls)
  const runner = createRunner({ fetchImpl: impl, now: () => UNIT_NOW })
  const result = await runner.queryProvider(autoUnitNewApiProvider())
  assert.equal(result.ok, true)
  assert.equal(result.balance, 7)
  assert.equal(result.error, null)
  assert.deepEqual(result.unit, { divisor: 500000, multiplier: 2.5, symbol: '🍪', decimals: 2 })
  assert.equal(calls.length, 2)
  const statusCall = calls.find((call) => call.url.includes('/api/status'))
  assert.equal(statusCall.url, 'https://unit-qp.example/api/status')
  assert.equal(statusCall.init.headers.Authorization, undefined)
})

test('queryProvider：autoUnit=false 或非 newapi 不请求 /api/status，unit 为 null', async () => {
  for (const provider of [
    autoUnitNewApiProvider({ autoUnit: false }),
    autoUnitNewApiProvider({ preset: 'custom' }),
    autoUnitNewApiProvider({ preset: 'deepseek' }),
  ]) {
    const calls = []
    const impl = unitAwareFetch(statusBody(), calls)
    const runner = createRunner({ fetchImpl: impl, now: () => UNIT_NOW })
    const result = await runner.queryProvider(provider)
    assert.equal(result.unit, null)
    assert.equal(calls.some((call) => call.url.includes('/api/status')), false)
  }
})

test('queryProvider：status 失败静默，不影响余额/错误', async () => {
  const calls = []
  const impl = unitAwareFetch(() => ({ status: 500, ok: false, text: async () => '{}' }), calls)
  const runner = createRunner({ fetchImpl: impl, now: () => UNIT_NOW })
  const result = await runner.queryProvider(autoUnitNewApiProvider())
  assert.equal(result.ok, true)
  assert.equal(result.balance, 7)
  assert.equal(result.error, null)
  assert.equal(result.unit, null)
})

test('queryProvider：余额失败时 unit 仍附上，error 不被污染', async () => {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url, init })
    if (url.includes('/api/status')) return statusResponse(statusBody({ quota_display_type: 'USD' }))
    return responseOf(500, {})
  }
  const runner = createRunner({ fetchImpl: impl, now: () => UNIT_NOW })
  const result = await runner.queryProvider(autoUnitNewApiProvider())
  assert.equal(result.ok, false)
  assert.match(result.error, /对方服务出错/)
  assert.deepEqual(result.unit, { divisor: 500000, multiplier: 1, symbol: '$', decimals: 2 })
})

test('queryProvider：同一个 runner 内 status 结果缓存 10 分钟', async () => {
  const calls = []
  const impl = unitAwareFetch(statusBody(), calls)
  let nowMs = UNIT_NOW
  const runner = createRunner({ fetchImpl: impl, now: () => nowMs })
  const provider = autoUnitNewApiProvider()
  const first = await runner.queryProvider(provider)
  nowMs += 5 * 60 * 1000
  const second = await runner.queryProvider(provider)
  assert.deepEqual(first.unit, second.unit)
  assert.equal(calls.filter((call) => call.url.includes('/api/status')).length, 1)
})

test('queryProvider：status 超时静默，余额照常返回', async () => {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url, init })
    if (url.includes('/api/status')) {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })
    }
    return responseOf(200, { data: { balance: 7 } })
  }
  const runner = createRunner({ fetchImpl: impl, now: () => UNIT_NOW, defaultTimeoutMs: 15 })
  const started = Date.now()
  const result = await runner.queryProvider(autoUnitNewApiProvider())
  assert.equal(result.ok, true)
  assert.equal(result.balance, 7)
  assert.equal(result.unit, null)
  assert.ok(Date.now() - started < 2000)
})

test('queryProvider：status 阶段被取消时 unit 静默，余额记为已取消', async () => {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url, init })
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      })
    })
  }
  const runner = createRunner({ fetchImpl: impl, now: () => UNIT_NOW })
  const controller = new AbortController()
  const pending = runner.queryProvider(autoUnitNewApiProvider(), { signal: controller.signal })
  setTimeout(() => controller.abort(), 15)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error, '已取消')
  assert.equal(result.unit, null)
  assert.equal(calls.length, 1)
})

test('queryProvider：非 autoUnit 的 Result.unit 恒为 null', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.unit, null)
  assert.equal(result.ok, true)
})

test('queryAll：autoUnit newapi 的 Result 各自带 unit', async () => {
  const calls = []
  const impl = unitAwareFetch(statusBody({ quota_display_type: 'TOKENS' }), calls)
  const runner = createRunner({ fetchImpl: impl, now: () => UNIT_NOW })
  const results = await runner.queryAll([
    autoUnitNewApiProvider({ id: 'p_unit0001' }),
    autoUnitNewApiProvider({ id: 'p_unit0002', autoUnit: false }),
  ])
  assert.deepEqual(results[0].unit, { divisor: 1, multiplier: 1, symbol: '', decimals: 0 })
  assert.equal(results[1].unit, null)
})
