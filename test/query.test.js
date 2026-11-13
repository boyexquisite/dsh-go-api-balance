import test from 'node:test'
import assert from 'node:assert/strict'
import { createRunner, queryProvider, queryAll } from '../lib/query.js'

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
