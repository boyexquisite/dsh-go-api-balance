import test from 'node:test'
import assert from 'node:assert/strict'
import { createRunner, resolveUsageUrl, resolveUnit } from '../lib/query.js'
import { presetDraft } from '../lib/presets.js'
import { validateProvider } from '../lib/config.js'

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
    usageFields: [],
    extraUrl: '',
    extraFields: [],
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

// 会响应 abort 的延迟响应（模拟真实 fetch，测试超时/预算时不会挂住）。
function abortableDelayed (ms, response) {
  return (url, init = {}) => new Promise((resolve, reject) => {
    const signal = init && init.signal
    const timer = setTimeout(() => resolve(response), ms)
    const onAbort = () => {
      clearTimeout(timer)
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
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
  const result = await createRunner({ fetchImpl: async () => responseOf(200, {}) }).queryProvider(null)
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

test('登录失败：401/403 提示账号密码，5xx/429 保留真实 HTTP 原因', async () => {
  for (const [status, expected] of [[401, '登录失败，检查账号密码'], [403, '登录失败，检查账号密码'], [500, '对方服务出错（HTTP 500）'], [429, '请求太频繁，稍后再试']]) {
    const impl = recordingFetch((url) => {
      if (url === LOGIN_URL) return responseOf(status, {})
      return responseOf(200, { data: { balance: 1 } })
    })
    const runner = createRunner({ fetchImpl: impl })
    const result = await runner.queryProvider(makeProvider({
      authType: 'login',
      username: 'miao',
      loginUrl: LOGIN_URL,
      secret: 'pw',
    }))
    assert.equal(result.ok, false, String(status))
    assert.equal(result.error, expected, String(status))
    assert.equal(impl.calls.filter((call) => call.url !== LOGIN_URL).length, 0)
  }
})

test('登录请求遇到跨域跳转时保留防泄露提示，而不是误报账号密码', async () => {
  const impl = recordingFetch((url) => {
    if (url === LOGIN_URL) {
      return {
        status: 302,
        ok: false,
        headers: { get: (name) => (name === 'location' ? 'https://evil.example.net/steal' : null) },
        text: async () => '',
      }
    }
    return responseOf(200, { data: { balance: 1 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    authType: 'login',
    username: 'miao',
    loginUrl: LOGIN_URL,
    secret: 'pw',
  }))
  assert.equal(result.error, '接口跳转到其它域名，为防密钥泄露已停止')
  assert.equal(impl.calls.filter((call) => call.url !== LOGIN_URL && call.url.includes('evil')).length, 0)
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

test('用量 usageArrayPath 为空时对整份响应 JSON 用 evalExpression', async () => {
  const cases = [
    [{ data: [{ token_used: 7 }, { token_used: 2 }] }, 'data[].token_used', 9],
    [{ data: { buckets: [{ tokens: 1 }, { tokens: '2' }] } }, 'data.buckets[].tokens', 3],
    [{ root: 4 }, 'root', 4],
  ]
  for (const [payload, fieldPath, expected] of cases) {
    const impl = balanceAndUsageFetch(responseOf(200, payload))
    const runner = createRunner({ fetchImpl: impl })
    const result = await runner.queryProvider(usageProvider({
      usageArrayPath: '',
      usageFields: [{ label: 'Token', path: fieldPath }],
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

test('resolveUnit CNY/CUSTOM：非法汇率（0/负数/NaN/非数字）回落到 1，不把余额算成负数', async () => {
  const cases = [0, -7.2, 'nope', null, Infinity]
  for (const [index, rate] of cases.entries()) {
    const impl = statusOnlyFetch(statusBody({ quota_display_type: 'CNY', usd_exchange_rate: rate }))
    const unit = await resolveUnit(
      { url: `https://unit-cny-bad-${index}.example/api/user/self` },
      { fetchImpl: impl },
    )
    assert.deepEqual(unit, { divisor: 500000, multiplier: 1, symbol: '¥', decimals: 2 }, `CNY rate ${rate}`)
  }
  const custom = await resolveUnit(
    { url: 'https://unit-custom-bad.example/api/user/self' },
    {
      fetchImpl: statusOnlyFetch(statusBody({
        quota_display_type: 'CUSTOM',
        custom_currency_exchange_rate: -2.5,
      })),
    },
  )
  assert.equal(custom.multiplier, 1)
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

test('resolveUnit 缺/未知 display type 时按 USD 兜底（one-api）', async () => {
  const missingType = statusOnlyFetch({ display_in_currency: true, quota_per_unit: 200000 })
  assert.deepEqual(
    await resolveUnit({ url: 'https://unit-null-type.example/api/user/self' }, { fetchImpl: missingType }),
    { divisor: 200000, multiplier: 1, symbol: '$', decimals: 2 },
  )

  const unknownType = statusOnlyFetch(statusBody({ quota_display_type: 'EUR' }))
  assert.deepEqual(
    await resolveUnit({ url: 'https://unit-unknown.example/api/user/self' }, { fetchImpl: unknownType }),
    { divisor: 500000, multiplier: 1, symbol: '$', decimals: 2 },
  )
})

test('resolveUnit 缺 display type 且 display_in_currency=false → TOKENS', async () => {
  const impl = statusOnlyFetch({ display_in_currency: false, quota_per_unit: 200000 })
  assert.deepEqual(
    await resolveUnit({ url: 'https://unit-oneapi-tokens.example/api/user/self' }, { fetchImpl: impl }),
    { divisor: 1, multiplier: 1, symbol: '', decimals: 0 },
  )
})

test('resolveUnit 缺 display type 且 display_in_currency 缺失 → USD 兜底', async () => {
  const impl = statusOnlyFetch({ quota_per_unit: 100000 })
  assert.deepEqual(
    await resolveUnit({ url: 'https://unit-oneapi-undefined.example/api/user/self' }, { fetchImpl: impl }),
    { divisor: 100000, multiplier: 1, symbol: '$', decimals: 2 },
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

test('queryProvider：one-api 缺 display type 的站自动按 USD 兜底', async () => {
  const calls = []
  const impl = unitAwareFetch({ data: { display_in_currency: true, quota_per_unit: 500000 } }, calls)
  const runner = createRunner({ fetchImpl: impl, now: () => UNIT_NOW })
  const result = await runner.queryProvider(autoUnitNewApiProvider())
  assert.equal(result.ok, true)
  assert.deepEqual(result.unit, { divisor: 500000, multiplier: 1, symbol: '$', decimals: 2 })
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

// ---------- v1.9 引擎扩展 ----------

function isoOf (ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

test('resolveUsageUrl 支持 {month_start} 与 ISO 系列（本地时区 / RFC3339 UTC）', () => {
  const at = new Date(2026, 10, 13, 9, 30, 0).getTime()
  const today = new Date(2026, 10, 13, 0, 0, 0).getTime()
  const monthStart = new Date(2026, 10, 1, 0, 0, 0).getTime()
  const weekAgo = at - 7 * 86400 * 1000
  const provider = {
    usageUrl: 'https://x.example/u?n={now}&t={today}&w={7d}&m={month_start}'
      + '&ni={now_iso}&ti={today_iso}&wi={7d_iso}&mi={month_start_iso}',
  }
  const expected = 'https://x.example/u'
    + `?n=${Math.floor(at / 1000)}&t=${Math.floor(today / 1000)}&w=${Math.floor(weekAgo / 1000)}&m=${Math.floor(monthStart / 1000)}`
    + `&ni=${encodeURIComponent(isoOf(at))}&ti=${encodeURIComponent(isoOf(today))}&wi=${encodeURIComponent(isoOf(weekAgo))}&mi=${encodeURIComponent(isoOf(monthStart))}`
  const actual = resolveUsageUrl(provider, at)
  const actualUrl = new URL(actual)
  const expectedUrl = new URL(expected)
  assert.deepEqual(actualUrl.searchParams, expectedUrl.searchParams)
  assert.match(isoOf(at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
})

test('provider.url 的占位符在请求前替换（含 ISO）', async () => {
  const at = new Date(2026, 10, 13, 9, 30, 0).getTime()
  const monthStart = new Date(2026, 10, 1, 0, 0, 0).getTime()
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1, usage_daily: 0.5 } }))
  const runner = createRunner({ fetchImpl: impl, now: () => at })
  const provider = makeProvider({
    url: 'https://api.example.com/costs?start={month_start}&end={now}&iso={month_start_iso}&today={today}',
    balancePath: 'data.balance',
    usageUrl: '',
    usageArrayPath: '',
    usageFields: [{ label: '今日花费', path: 'data.usage_daily' }],
  })
  const result = await runner.queryProvider(provider)
  assert.equal(result.ok, true)
  assert.deepEqual(result.usage, [{ label: '今日花费', value: 0.5 }])
  const parsed = new URL(impl.calls[0].url)
  assert.equal(parsed.searchParams.get('start'), String(Math.floor(monthStart / 1000)))
  assert.equal(parsed.searchParams.get('end'), String(Math.floor(at / 1000)))
  assert.equal(parsed.searchParams.get('iso'), isoOf(monthStart))
  assert.equal(parsed.searchParams.get('today'), String(Math.floor(new Date(2026, 10, 13).getTime() / 1000)))
})

test('同响应用量：usageUrl 空 + usageFields 时从余额响应解析，不发第二次请求', async () => {
  const impl = recordingFetch(() => responseOf(200, {
    data: {
      balance: 12,
      usage_daily: 0.5,
      results: [{ amount: { value: 1 } }, { amount: { value: '2' } }],
    },
  }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    balancePath: 'data.balance',
    usageUrl: '',
    usageArrayPath: '',
    usageFields: [
      { label: '本月花费', path: 'data.results[].amount.value' },
      { label: '今日花费', path: 'data.usage_daily' },
    ],
    usageScale: true,
  }))
  assert.equal(result.ok, true)
  assert.equal(result.balance, 12)
  assert.deepEqual(result.usage, [
    { label: '本月花费', value: 3 },
    { label: '今日花费', value: 0.5 },
  ])
  assert.equal(impl.calls.length, 1)
})

test('同响应用量：usageArrayPath 非空时数组逐项求和、对象单对象取值', async () => {
  const arrayImpl = recordingFetch(() => responseOf(200, {
    data: { balance: 1 },
    usage: [{ tokens: 2 }, { tokens: '3' }, {}],
  }))
  const arrayRunner = createRunner({ fetchImpl: arrayImpl })
  const arrayResult = await arrayRunner.queryProvider(makeProvider({
    usageUrl: '',
    usageArrayPath: 'usage',
    usageFields: [{ label: 'Token', path: 'tokens' }],
  }))
  assert.deepEqual(arrayResult.usage, [{ label: 'Token', value: 5 }])

  const objectImpl = recordingFetch(() => responseOf(200, {
    data: { balance: 1 },
    usage: { tokens: 4 },
  }))
  const objectRunner = createRunner({ fetchImpl: objectImpl })
  const objectResult = await objectRunner.queryProvider(makeProvider({
    usageUrl: '',
    usageArrayPath: 'usage',
    usageFields: [{ label: 'Token', path: 'tokens' }],
  }))
  assert.deepEqual(objectResult.usage, [{ label: 'Token', value: 4 }])

  const missingImpl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const missingRunner = createRunner({ fetchImpl: missingImpl })
  const missingResult = await missingRunner.queryProvider(makeProvider({
    usageUrl: '',
    usageArrayPath: 'usage',
    usageFields: [{ label: 'Token', path: 'tokens' }],
  }))
  assert.deepEqual(missingResult.usage, [])
})

test('同响应用量：余额解析失败但 JSON 有效时仍解析 usage', async () => {
  const impl = recordingFetch(() => responseOf(200, {
    data: { usage_daily: 0.75 },
  }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    balancePath: 'data.missing',
    usageUrl: '',
    usageArrayPath: '',
    usageFields: [{ label: '今日花费', path: 'data.usage_daily' }],
  }))
  assert.equal(result.ok, false)
  assert.equal(result.error, '解析不到余额字段，检查取值路径')
  assert.deepEqual(result.usage, [{ label: '今日花费', value: 0.75 }])
})

test('同响应用量：HTTP 失败时 usage 为空且只发一次请求', async () => {
  const impl = recordingFetch(() => responseOf(500, {}))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    usageUrl: '',
    usageArrayPath: '',
    usageFields: [{ label: '今日花费', path: 'data.usage_daily' }],
  }))
  assert.equal(result.ok, false)
  assert.deepEqual(result.usage, [])
  assert.equal(impl.calls.length, 1)
})

test('只用量的服务：balancePath 为空时 ok=true、balance=null、usage 正常', async () => {
  const impl = recordingFetch(() => responseOf(200, {
    data: [
      { results: [{ amount: { value: 0.5 } }, { amount: { value: 1.25 } }] },
      { results: [{ amount: { value: 2 } }] },
    ],
  }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    balancePath: '',
    usageUrl: '',
    usageArrayPath: '',
    usageFields: [{ label: '本月花费', path: 'data[].results[].amount.value' }],
    usageScale: true,
  }))
  assert.equal(result.ok, true)
  assert.equal(result.balance, null)
  assert.equal(result.error, null)
  assert.deepEqual(result.usage, [{ label: '本月花费', value: 3.75 }])
  assert.equal(impl.calls.length, 1)
})

test('只用量的服务：HTTP / 非 JSON 失败照常报错，usage 为空', async () => {
  const httpRunner = createRunner({ fetchImpl: recordingFetch(() => responseOf(401, {})) })
  const httpResult = await httpRunner.queryProvider(makeProvider({ balancePath: '', usageUrl: '' }))
  assert.equal(httpResult.ok, false)
  assert.equal(httpResult.error, '密钥或令牌无效')
  assert.deepEqual(httpResult.usage, [])

  const textRunner = createRunner({ fetchImpl: recordingFetch(() => responseOf(200, 'nope')) })
  const textResult = await textRunner.queryProvider(makeProvider({ balancePath: '', usageUrl: '' }))
  assert.equal(textResult.ok, false)
  assert.equal(textResult.error, '返回的不是 JSON')
})

test('balanceOptional=true：余额为 null / 缺失时 ok=true、balance=null', async () => {
  for (const payload of [
    { data: { limit_remaining: null } },
    { data: {} },
  ]) {
    const impl = recordingFetch(() => responseOf(200, payload))
    const runner = createRunner({ fetchImpl: impl })
    const result = await runner.queryProvider(makeProvider({
      balancePath: 'data.limit_remaining',
      balanceOptional: true,
    }))
    assert.equal(result.ok, true, JSON.stringify(payload))
    assert.equal(result.balance, null)
    assert.equal(result.error, null)
  }
})

test('balanceOptional=false：余额 null/缺失仍然失败', async () => {
  const nullImpl = recordingFetch(() => responseOf(200, { data: { limit_remaining: null } }))
  const nullResult = await createRunner({ fetchImpl: nullImpl }).queryProvider(makeProvider({
    balancePath: 'data.limit_remaining',
  }))
  assert.equal(nullResult.ok, false)
  assert.equal(nullResult.error, '余额不是数字')

  const missingImpl = recordingFetch(() => responseOf(200, { data: {} }))
  const missingResult = await createRunner({ fetchImpl: missingImpl }).queryProvider(makeProvider({
    balancePath: 'data.limit_remaining',
  }))
  assert.equal(missingResult.ok, false)
  assert.equal(missingResult.error, '解析不到余额字段，检查取值路径')
})

test('balanceOptional=true 但余额是非数字字符串时仍报余额不是数字', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { limit_remaining: 'abc' } }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    balancePath: 'data.limit_remaining',
    balanceOptional: true,
  }))
  assert.equal(result.ok, false)
  assert.equal(result.error, '余额不是数字')
})

test('AIHubMix full flow: Manage Key account totals stay private', async () => {
  const provider = validateProvider({ ...presetDraft('aihubmix'), secret: 'manage-key-test' }).provider
  const impl = recordingFetch(() => responseOf(200, {
    success: true,
    data: {
      quota: 7250000,
      used_quota: 250000,
      request_count: 17,
      username: 'personal-user',
      email: 'private@example.com',
    },
  }))
  const result = await createRunner({ fetchImpl: impl }).queryProvider(provider)
  assert.equal(impl.calls.length, 1)
  assert.equal(impl.calls[0].url, 'https://miao233.top/aihubmix-balance/api/user/self')
  assert.equal(impl.calls[0].init.headers.Authorization, 'Bearer manage-key-test')
  assert.equal(result.ok, true)
  assert.equal(result.balance, 7250000)
  assert.deepEqual(result.details, [{ label: '累计已用', value: 250000 }])
  assert.deepEqual(result.usage, [{ label: '累计请求', value: 17 }])
  assert.ok(!JSON.stringify(result).includes('manage-key-test'))
  assert.ok(!JSON.stringify(result).includes('personal-user'))
  assert.ok(!JSON.stringify(result).includes('private@example.com'))
})

test('OpenRouter 全链路：limit_remaining=null 时 ok、显示花费', async () => {
  const provider = validateProvider({
    ...presetDraft('openrouter'),
    secret: 'sk-or-test',
  }).provider
  const impl = recordingFetch(() => responseOf(200, {
    data: { limit_remaining: null, usage_daily: 0.52, usage_monthly: 12.34 },
  }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(provider)
  assert.equal(result.ok, true)
  assert.equal(result.balance, null)
  assert.equal(result.symbol, '$')
  assert.deepEqual(result.usage, [
    { label: '今日花费', value: 0.52 },
    { label: '本月花费', value: 12.34 },
  ])
  assert.equal(impl.calls.length, 1)
})

test('OpenAI 花费全链路：占位符替换 + 嵌套数组求和', async () => {
  const at = new Date(2026, 10, 13, 9, 30, 0).getTime()
  const monthStart = new Date(2026, 10, 1, 0, 0, 0).getTime()
  const provider = validateProvider({
    ...presetDraft('openai-cost'),
    secret: 'sk-admin-test',
  }).provider
  const impl = recordingFetch((url) => {
    if (url.includes('/organization/usage/completions')) {
      return responseOf(200, {
        data: [
          { results: [{ input_tokens: 1000, output_tokens: 200, num_model_requests: 3 }] },
          { results: [{ input_tokens: 500, output_tokens: 100, num_model_requests: 2 }] },
        ],
      })
    }
    return responseOf(200, {
      data: [
        { results: [{ amount: { value: 0.5 } }, { amount: { value: 1.25 } }] },
        { results: [{ amount: { value: 2 } }] },
      ],
    })
  })
  const runner = createRunner({ fetchImpl: impl, now: () => at })
  const result = await runner.queryProvider(provider)
  assert.equal(result.ok, true)
  assert.equal(result.balance, null)
  assert.deepEqual(result.usage, [{ label: '本月花费', value: 3.75 }])
  // 同一个 Admin key 追加的 token 用量
  assert.deepEqual(result.extra, [
    { label: '本月输入 Token', value: 1500, kind: 'count' },
    { label: '本月输出 Token', value: 300, kind: 'count' },
    { label: '本月请求数', value: 5, kind: 'count' },
  ])
  const parsed = new URL(impl.calls[0].url)
  assert.equal(parsed.searchParams.get('start_time'), String(Math.floor(monthStart / 1000)))
  assert.equal(parsed.searchParams.get('end_time'), String(Math.floor(at / 1000)))
  assert.equal(parsed.searchParams.get('bucket_width'), '1d')
  assert.equal(impl.calls[0].init.headers.Authorization, 'Bearer sk-admin-test')
  const usageUrl = new URL(impl.calls.find((call) => call.url.includes('/organization/usage/completions')).url)
  assert.equal(usageUrl.searchParams.get('start_time'), String(Math.floor(monthStart / 1000)))
  assert.equal(usageUrl.searchParams.get('limit'), '31')
})

test('Claude 花费全链路：x-api-key + anthropic-version + ISO 月份 + 分为单位', async () => {
  const at = new Date(2026, 10, 13, 9, 30, 0).getTime()
  const monthStart = new Date(2026, 10, 1, 0, 0, 0).getTime()
  const provider = validateProvider({
    ...presetDraft('anthropic-cost'),
    secret: 'sk-ant-test',
  }).provider
  const impl = recordingFetch((url) => {
    if (url.includes('/usage_report/messages')) {
      return responseOf(200, {
        data: [
          {
            results: [{
              uncached_input_tokens: 2000,
              output_tokens: 400,
              cache_read_input_tokens: 8000,
              cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 200 },
            }],
          },
        ],
      })
    }
    return responseOf(200, {
      data: [{ results: [{ amount: 100 }, { amount: 50 }] }],
    })
  })
  const runner = createRunner({ fetchImpl: impl, now: () => at })
  const result = await runner.queryProvider(provider)
  assert.equal(result.ok, true)
  assert.equal(result.balance, null)
  assert.deepEqual(result.usage, [{ label: '本月花费', value: 150 }])
  assert.equal(provider.divisor, 100)
  assert.deepEqual(result.extra, [
    { label: '本月输入 Token', value: 2000, kind: 'count' },
    { label: '本月输出 Token', value: 400, kind: 'count' },
    { label: '缓存读 Token', value: 8000, kind: 'count' },
    { label: '缓存写 Token', value: 500, kind: 'count' },
  ])
  const parsed = new URL(impl.calls[0].url)
  assert.equal(parsed.searchParams.get('starting_at'), isoOf(monthStart))
  assert.equal(impl.calls[0].init.headers['x-api-key'], 'sk-ant-test')
  assert.equal(impl.calls[0].init.headers['anthropic-version'], '2023-06-01')
  assert.equal(impl.calls[0].init.headers.Authorization, undefined)
  const usageUrl = new URL(impl.calls.find((call) => call.url.includes('/usage_report/messages')).url)
  assert.equal(usageUrl.searchParams.get('starting_at'), isoOf(monthStart))
  assert.equal(usageUrl.searchParams.get('limit'), '31')
})

// ---------- v2.0 表达式 / 附加信息 ----------

test('balancePath 支持现金 + 赠送这类表达式', async () => {
  const runner = createRunner({
    fetchImpl: async () => responseOf(200, {
      balance_infos: [{ cash_balance: '100.50', gift_balance: '20.00', total_available: '500.50' }],
    }),
  })
  const result = await runner.queryProvider(makeProvider({
    balancePath: 'balance_infos[0].cash_balance + balance_infos[0].gift_balance',
  }))
  assert.equal(result.ok, true)
  assert.equal(result.balance, 120.5)
})

test('balancePath 表达式取不到 → 失败；balanceOptional 时允许 null', async () => {
  const runner = createRunner({ fetchImpl: async () => responseOf(200, { a: 1 }) })
  const failed = await runner.queryProvider(makeProvider({
    balancePath: 'data.credit + data.gift',
  }))
  assert.equal(failed.ok, false)
  assert.match(failed.error, /解析不到余额字段/)

  const optional = await runner.queryProvider(makeProvider({
    balancePath: 'data.credit + data.gift',
    balanceOptional: true,
  }))
  assert.equal(optional.ok, true)
  assert.equal(optional.balance, null)
})

test('附加信息：独立第二次请求，表达式算订阅剩余，失败静默', async () => {
  const impl = recordingFetch((url) => {
    if (url.endsWith('/api/subscription/self')) {
      return responseOf(200, {
        data: {
          subscriptions: [{
            subscription: { amount_total: 1000000, amount_used: 400000, end_time: 1767225600 },
          }],
        },
      })
    }
    return responseOf(200, { data: { quota: 209786194 } })
  })
  const runner = createRunner({ fetchImpl: impl, now: () => 1700000000000 })
  const provider = makeProvider({
    preset: 'newapi',
    url: 'https://relay.example.com/api/user/self',
    balancePath: 'data.quota',
    divisor: 500000,
    extraUrl: 'https://relay.example.com/api/subscription/self',
    extraFields: [
      { label: '订阅剩余', path: 'data.subscriptions[].subscription.amount_total - data.subscriptions[].subscription.amount_used' },
      { label: '订阅总量', path: 'data.subscriptions[].subscription.amount_total' },
      { label: '订阅已用', path: 'data.subscriptions[].subscription.amount_used' },
      { label: '订阅到期', path: 'data.subscriptions[0].subscription.end_time', kind: 'date' },
    ],
  })
  const result = await runner.queryProvider(provider)
  assert.equal(result.ok, true)
  assert.deepEqual(result.extra, [
    { label: '订阅剩余', value: 600000, kind: 'money' },
    { label: '订阅总量', value: 1000000, kind: 'money' },
    { label: '订阅已用', value: 400000, kind: 'money' },
    { label: '订阅到期', value: 1767225600, kind: 'date' },
  ])
  const extraCall = impl.calls.find((call) => call.url.endsWith('/api/subscription/self'))
  assert.equal(extraCall.init.method, 'GET')
  assert.equal(extraCall.init.headers.Authorization, 'Bearer sk-test-123456')
})

test('附加信息接口 404 / 无订阅时静默为空，不影响余额 ok', async () => {
  const impl = recordingFetch((url) => {
    if (url.endsWith('/api/subscription/self')) return responseOf(404, { success: false })
    return responseOf(200, { data: { quota: 100 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const provider = makeProvider({
    preset: 'newapi',
    url: 'https://relay.example.com/api/user/self',
    balancePath: 'data.quota',
    extraUrl: 'https://relay.example.com/api/subscription/self',
    extraFields: [{ label: '订阅剩余', path: 'data.subscriptions[].subscription.amount_total' }],
  })
  const result = await runner.queryProvider(provider)
  assert.equal(result.ok, true)
  assert.deepEqual(result.extra, [])
})

test('one-api 预设也走 autoUnit（/api/status），用量按 dashboard 求和', async () => {
  const impl = recordingFetch((url) => {
    if (url.endsWith('/api/status')) {
      return responseOf(200, {
        success: true,
        data: { quota_per_unit: 500000, display_in_currency: true },
      })
    }
    if (url.endsWith('/api/user/dashboard')) {
      return responseOf(200, {
        success: true,
        data: [
          { day: '2026-11-12', model_name: 'gpt-4o', request_count: 2, prompt_tokens: 100, completion_tokens: 50 },
          { day: '2026-11-13', model_name: 'gpt-4o', request_count: 3, prompt_tokens: 200, completion_tokens: 25 },
        ],
      })
    }
    return responseOf(200, { success: true, data: { quota: 1000000 } })
  })
  const runner = createRunner({ fetchImpl: impl, now: () => 1700000000000 })
  const result = await runner.queryProvider(makeProvider({
    preset: 'oneapi',
    autoUnit: true,
    url: 'https://old.example.com/api/user/self',
    balancePath: 'data.quota',
    divisor: 500000,
    usageUrl: 'https://old.example.com/api/user/dashboard',
    usageArrayPath: 'data',
    usageFields: [
      { label: '近7天 Token', path: 'prompt_tokens + completion_tokens' },
      { label: '近7天 请求', path: 'request_count' },
    ],
  }))
  assert.equal(result.ok, true)
  assert.equal(result.balance, 1000000)
  assert.deepEqual(result.unit, { divisor: 500000, multiplier: 1, symbol: '$', decimals: 2 })
  assert.deepEqual(result.usage, [
    { label: '近7天 Token', value: 375 },
    { label: '近7天 请求', value: 5 },
  ])
})

test('balancePath 也支持 [] 通配求和', async () => {
  const runner = createRunner({
    fetchImpl: async () => responseOf(200, {
      balances: [{ amount: 10 }, { amount: '2.5' }],
    }),
  })
  const result = await runner.queryProvider(makeProvider({ balancePath: 'balances[].amount' }))
  assert.equal(result.ok, true)
  assert.equal(result.balance, 12.5)
})

test('detailPaths 也支持 [] 通配求和', async () => {
  const runner = createRunner({
    fetchImpl: async () => responseOf(200, {
      data: { balance: 1, fees: [{ amount: 1 }, { amount: 2 }] },
    }),
  })
  const result = await runner.queryProvider(makeProvider({
    detailPaths: [{ label: '手续费', path: 'data.fees[].amount' }],
  }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.details, [{ label: '手续费', value: 3 }])
})

// ---------- v2.1 安全：https / 跳转防护 ----------

function redirectResponse (status, location) {
  return {
    status,
    ok: false,
    headers: { get: (name) => (String(name).toLowerCase() === 'location' ? location : null) },
    text: async () => '',
  }
}

test('明文 http 地址拒绝请求（本机回环除外）', async () => {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    return responseOf(200, { data: { balance: 1 } })
  }
  const runner = createRunner({ fetchImpl: impl })
  const blocked = await runner.queryProvider(makeProvider({ url: 'http://api.example.com/balance' }))
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /https/)
  assert.deepEqual(calls, [])

  const loopback = await runner.queryProvider(makeProvider({ url: 'http://127.0.0.1:8080/balance' }))
  assert.equal(loopback.ok, true)
  assert.deepEqual(calls, ['http://127.0.0.1:8080/balance'])
})

test('伪装地址（内嵌凭据/空白字符）在取数层也拒绝，一个请求都不发', async () => {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    return responseOf(200, { data: { balance: 1 } })
  }
  const runner = createRunner({ fetchImpl: impl })
  for (const url of [
    'https://api.example.com\n@evil.example/balance',
    'https://api.example.com\t@evil.example/balance',
    'https://user:pw@api.example.com/balance',
  ]) {
    const result = await runner.queryProvider(makeProvider({ url }))
    assert.equal(result.ok, false, `必须拒绝：${JSON.stringify(url)}`)
    assert.match(result.error, /https/)
  }
  assert.deepEqual(calls, [], '被拒绝的地址不能发出请求（密钥不能到 evil.example）')
  // 正常 https 不受影响
  const ok = await runner.queryProvider(makeProvider())
  assert.equal(ok.ok, true)
  assert.deepEqual(calls, ['https://api.example.com/balance'])
})

test('同源跳转自动跟随，鉴权头保留', async () => {
  const impl = recordingFetch((url) => {
    if (url.endsWith('/v2/balance')) return responseOf(200, { data: { balance: 7 } })
    return redirectResponse(302, '/v2/balance')
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({ url: 'https://api.example.com/balance' }))
  assert.equal(result.ok, true)
  assert.equal(result.balance, 7)
  assert.equal(impl.calls.length, 2)
  assert.equal(impl.calls[1].url, 'https://api.example.com/v2/balance')
  assert.equal(impl.calls[1].init.headers.Authorization, 'Bearer sk-test-123456')
  assert.equal(impl.calls[0].init.redirect, 'manual')
})

test('跨域跳转停止，不把密钥带到第三方', async () => {
  const impl = recordingFetch(() => redirectResponse(302, 'https://evil.example.com/steal'))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({ url: 'https://api.example.com/balance' }))
  assert.equal(result.ok, false)
  assert.match(result.error, /其它域名/)
  assert.equal(impl.calls.length, 1)
  assert.ok(!impl.calls.some((call) => String(call.url).includes('evil.example.com')))
})

test('跳转次数超限时报错', async () => {
  const impl = recordingFetch((url) => redirectResponse(302, `${new URL(url).pathname}/x`))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({ url: 'https://api.example.com/a' }))
  assert.equal(result.ok, false)
  assert.match(result.error, /跳转次数/)
})

test('不安全地址的用量/附加请求会被静默跳过', async () => {
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 } }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    url: 'https://api.example.com/balance',
    usageUrl: 'http://api.example.com/usage',
    usageFields: [{ label: '用量', path: 'data.n' }],
    extraUrl: 'http://api.example.com/extra',
    extraFields: [{ label: '订阅', path: 'data.sub' }],
  }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.usage, [])
  assert.deepEqual(result.extra, [])
  assert.equal(impl.calls.length, 1, '不应向 http 地址发请求')
})

// ---------- v0.4.0 订阅类服务（OpenCode Go / Command Code） ----------

test('opencode-go：百分比转剩余，重置时间作为日期明细', async () => {
  const impl = recordingFetch(() => responseOf(200, {
    usage: {
      rolling: { status: 'ok', percent: 52, resetsAt: '2026-11-24T03:00:00.000Z' },
      weekly: { status: 'ok', percent: 20, resetsAt: '2026-11-24T00:00:00.000Z' },
      monthly: { status: 'ok', percent: 61, resetsAt: '2026-12-01T00:00:00.000Z' },
    },
  }))
  const runner = createRunner({ fetchImpl: impl })
  const provider = validateProvider({ ...presetDraft('opencode-go'), secret: 'sk-open' }).provider
  const result = await runner.queryProvider(provider)
  assert.equal(result.ok, true)
  assert.equal(result.balance, 48)
  assert.deepEqual(result.usage, [
    { label: '本周剩余%', value: 80 },
    { label: '本月剩余%', value: 39 },
  ])
  assert.equal(result.details[0].label, '5小时重置')
  assert.equal(result.details[0].value, '2026-11-24T03:00:00.000Z')
  assert.equal(result.details[0].kind, 'date')
})

test('commandcode：月度剩余额度 + 5h/周剩余金额', async () => {
  const impl = recordingFetch(() => responseOf(200, {
    credits: {
      monthlyCredits: 63.03,
      monthlyCreditsGranted: 100,
      windowLimits: {
        fiveHour: { used: 0.59, cap: 14, resetAt: 1794000000000, exceeded: false },
        weekly: { used: 0.59, cap: 35, resetAt: 1794500000000, exceeded: false },
      },
    },
  }))
  const runner = createRunner({ fetchImpl: impl })
  const provider = validateProvider({ ...presetDraft('commandcode'), secret: 'user-key' }).provider
  const result = await runner.queryProvider(provider)
  assert.equal(result.ok, true)
  assert.equal(result.balance, 63.03)
  assert.deepEqual(result.usage, [
    { label: '5小时剩余', value: 14 - 0.59 },
    { label: '本周剩余', value: 35 - 0.59 },
  ])
  assert.deepEqual(result.details.slice(0, 3), [
    { label: '本月额度', value: 100 },
    { label: '5小时已用', value: 0.59 },
    { label: '本周已用', value: 0.59 },
  ])
  assert.equal(result.details[3].kind, 'date')
  assert.equal(result.details[4].kind, 'date')
})

// ---------- v0.6.1 审计修复 ----------

function streamResponse (status, chunks, { location = '', headers = {} } = {}) {
  let canceled = false
  const body = new ReadableStream({
    start (controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
    cancel () { canceled = true },
  })
  const map = new Headers(headers)
  if (location !== '') map.set('location', location)
  return {
    status,
    ok: status >= 200 && status < 300,
    body,
    headers: map,
    text: async () => { throw new Error('body must not be read with text()') },
    get canceled () { return canceled },
  }
}

test('响应体超限：流式读取到 256 KiB 就取消，不把整个 body 读进内存', async () => {
  let canceled = false
  let delivered = 0
  const body = new ReadableStream({
    pull (controller) {
      if (delivered >= 1024 * 1024) {
        controller.close()
        return
      }
      controller.enqueue(new Uint8Array(64 * 1024))
      delivered += 64 * 1024
    },
    cancel () { canceled = true },
  })
  const response = { status: 200, ok: true, body, headers: new Headers(), text: async () => { throw new Error('no text') } }
  const impl = async () => response
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.ok, false)
  assert.equal(result.error, '响应太大')
  assert.equal(canceled, true)
  assert.ok(delivered < 1024 * 1024, `只读到超限为止，实际 ${delivered}`)
})

test('没有流式 body 的宿主：text() 超限也报响应太大，而不是返回的不是 JSON', async () => {
  const impl = async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ data: { balance: 1, note: 'x'.repeat(300 * 1024) } }) })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.ok, false)
  assert.equal(result.error, '响应太大')
})

test('3xx 跳转不读 body：走 cancel 并继续同源跳转', async () => {
  const redirect = streamResponse(302, ['x'.repeat(50 * 1024)], { location: '/v2/balance' })
  const impl = recordingFetch((url) => (url.endsWith('/v2/balance') ? responseOf(200, { data: { balance: 7 } }) : redirect))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider())
  assert.equal(result.ok, true)
  assert.equal(result.balance, 7)
  assert.equal(redirect.canceled, true)
})

test('extraFields 支持 text/date（不再被数值表达式丢掉）', async () => {
  const impl = recordingFetch((url) => {
    if (url.includes('/extra')) {
      return responseOf(200, { data: { end: '2026-11-24T03:00:00Z', plan: 'Pro', quota: 600000 } })
    }
    return responseOf(200, { data: { balance: 1 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    extraUrl: 'https://api.example.com/extra',
    extraFields: [
      { label: '到期', path: 'data.end', kind: 'date' },
      { label: '套餐', path: 'data.plan', kind: 'text' },
      { label: '额度', path: 'data.quota' },
    ],
  }))
  assert.deepEqual(result.extra, [
    { label: '到期', value: '2026-11-24T03:00:00Z', kind: 'date' },
    { label: '套餐', value: 'Pro', kind: 'text' },
    { label: '额度', value: 600000, kind: 'money' },
  ])
})

test('登录 token 缓存按密码隔离：改密码后会重新登录', async () => {
  let logins = 0
  const impl = recordingFetch((url) => {
    if (url === LOGIN_URL) {
      logins += 1
      return responseOf(200, { data: { token: `tok-${logins}` } })
    }
    return responseOf(200, { data: { balance: 1 } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const base = makeProvider({ authType: 'login', loginUrl: LOGIN_URL, username: 'alice' })
  await runner.queryProvider({ ...base, secret: 'pw-1' })
  await runner.queryProvider({ ...base, secret: 'pw-1' })
  assert.equal(logins, 1, '同一密码复用 token')
  await runner.queryProvider({ ...base, secret: 'pw-2' })
  assert.equal(logins, 2, '改密码必须重新登录')
  runner.clearTokenCache()
  await runner.queryProvider({ ...base, secret: 'pw-2' })
  assert.equal(logins, 3, 'clearTokenCache 后重新登录')
})

test('Content-Length 声明超限：直接拒绝并取消 body，不读内容', async () => {
  let canceled = false
  let pulled = 0
  const body = new ReadableStream({
    pull (controller) {
      pulled += 1
      controller.enqueue(new Uint8Array(1024))
    },
    cancel () { canceled = true },
  })
  const response = {
    status: 200,
    ok: true,
    body,
    headers: new Headers({ 'content-length': String(4 * 1024 * 1024) }),
    text: async () => { throw new Error('no text') },
  }
  const result = await createRunner({ fetchImpl: async () => response }).queryProvider(makeProvider())
  assert.equal(result.ok, false)
  assert.equal(result.error, '响应太大')
  assert.equal(canceled, true)
  assert.ok(pulled <= 1, `body 最多预拉一次，实际 ${pulled}`)
})

test('远端字符串收口：货币符号/明细/附加文本都有长度上限', async () => {
  const long = 'x'.repeat(500)
  const impl = recordingFetch((url) => {
    if (url.endsWith('/api/status')) {
      return responseOf(200, { data: { quota_display_type: 'CUSTOM', display_in_currency: true, custom_currency_symbol: long, quota_per_unit: 500000 } })
    }
    if (url.includes('/extra')) return responseOf(200, { data: { msg: long } })
    return responseOf(200, { data: { balance: 1, note: long } })
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    preset: 'newapi',
    autoUnit: true,
    url: 'https://relay.example.com/api/user/self',
    detailPaths: [{ label: '备注', path: 'data.note', kind: 'text' }],
    extraUrl: 'https://relay.example.com/extra',
    extraFields: [{ label: '信息', path: 'data.msg', kind: 'text' }],
  }))
  assert.equal(result.ok, true)
  assert.ok([...result.unit.symbol].length <= 8, `symbol ${result.unit.symbol}`)
  assert.ok([...result.details[0].value].length <= 200)
  assert.ok([...result.extra[0].value].length <= 200)
})

test('usage 数组过大：放弃这次用量解析，而不是静默少算', async () => {
  const rows = Array.from({ length: 10000 }, () => ({ value: 1 }))
  const impl = recordingFetch(() => responseOf(200, { data: { balance: 1 }, rows }))
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    usageArrayPath: 'rows',
    usageFields: [{ label: '数量', path: 'value' }],
  }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.usage, [], '超过 5000 行不返回错误总和')
})

// ---------- v0.7.2 复审修复 ----------

test('可选的 /api/status 挂住时不能饿死余额请求', async () => {
  const impl = recordingFetch((url, init) => {
    if (url.endsWith('/api/status')) return abortableDelayed(5000, responseOf(200, { data: {} }))(url, init)
    return abortableDelayed(5, responseOf(200, { data: { balance: 42 } }))(url, init)
  })
  const runner = createRunner({ fetchImpl: impl })
  const result = await runner.queryProvider(makeProvider({
    preset: 'newapi',
    autoUnit: true,
    url: 'https://relay.example.com/api/user/self',
  }), { timeoutMs: 400 })
  assert.equal(result.ok, true, result.error)
  assert.equal(result.balance, 42)
})

test('3xx 错误分支都会取消 body：跨域 / 跳转过多 / 缺 Location', async () => {
  // 跨域
  let crossCanceled = false
  const crossBody = new ReadableStream({ pull () { }, cancel () { crossCanceled = true } })
  const crossImpl = recordingFetch(() => ({
    status: 302, ok: false, body: crossBody,
    headers: new Headers({ location: 'https://evil.example.com/x' }),
    text: async () => { throw new Error('must not read') },
  }))
  const cross = await createRunner({ fetchImpl: crossImpl }).queryProvider(makeProvider())
  assert.match(cross.error, /其它域名/)
  assert.equal(crossCanceled, true)

  // 跳转过多
  const cancels = []
  const hopImpl = recordingFetch((url) => {
    const body = new ReadableStream({ pull () { }, cancel () { cancels.push(url) } })
    return { status: 302, ok: false, body, headers: new Headers({ location: '/next' }), text: async () => { throw new Error('no') } }
  })
  const hop = await createRunner({ fetchImpl: hopImpl }).queryProvider(makeProvider({ url: 'https://api.example.com/a' }))
  assert.match(hop.error, /跳转次数/)
  assert.equal(cancels.length, 4, '4 个 3xx 都应取消 body')

  // 缺 Location
  let missingCanceled = false
  const missingBody = new ReadableStream({ pull () { }, cancel () { missingCanceled = true } })
  const missingImpl = recordingFetch(() => ({
    status: 302, ok: false, body: missingBody, headers: new Headers(),
    text: async () => { throw new Error('must not read') },
  }))
  const missing = await createRunner({ fetchImpl: missingImpl }).queryProvider(makeProvider())
  assert.match(missing.error, /HTTP 302/)
  assert.equal(missingCanceled, true)
})

test('宿主自动跟随跳转（redirected=true）会被中止', async () => {
  let canceled = false
  const body = new ReadableStream({ pull () { }, cancel () { canceled = true } })
  const impl = recordingFetch(() => ({
    status: 200, ok: true, redirected: true, url: 'https://evil.example.com/x', body,
    headers: new Headers(), text: async () => { throw new Error('no') },
  }))
  const result = await createRunner({ fetchImpl: impl }).queryProvider(makeProvider())
  assert.match(result.error, /跳转异常/)
  assert.equal(canceled, true)
})

test('queryAll 有总预算：多个慢服务不会拖过总时长', async () => {
  const delay = abortableDelayed(300, responseOf(200, { data: { balance: 1 } }))
  const impl = recordingFetch((url, init) => delay(url, init))
  const runner = createRunner({ fetchImpl: impl })
  const started = Date.now()
  const results = await runner.queryAll([
    makeProvider({ id: 'p_a', url: 'https://a.example.com/b' }),
    makeProvider({ id: 'p_b', url: 'https://b.example.com/b' }),
    makeProvider({ id: 'p_c', url: 'https://c.example.com/b' }),
  ], { timeoutMs: 5000, totalTimeoutMs: 250 })
  const elapsed = Date.now() - started
  assert.ok(elapsed < 1200, `总耗时 ${elapsed}ms`)
  for (const result of results) assert.equal(result.ok, false)
})

test('queryAll 总预算耗尽后不再对剩余服务发起请求（24 家不白建 24 个连接）', async () => {
  const impl = recordingFetch(abortableDelayed(3000, responseOf(200, { data: { balance: 1 } })))
  const runner = createRunner({ fetchImpl: impl })
  const providers = Array.from({ length: 24 }, (_, index) =>
    makeProvider({ id: `p_${index}`, url: `https://s${index}.example.com/b` }))
  const started = Date.now()
  const results = await runner.queryAll(providers, { timeoutMs: 5000, totalTimeoutMs: 120 })
  const elapsed = Date.now() - started
  // 默认并发 3：预算用完前只发起 3 个。预算临界毫秒里某个 worker 可能再发起一次（随后立刻超时），
  // 故断言上界留一个并发窗口；旧实现是 24 个「发起即取消」的连接，这条断言仍能钉住回归。
  assert.ok(impl.calls.length <= 6, `实际发起 ${impl.calls.length} 个请求`)
  assert.equal(results.length, 24)
  for (const result of results) {
    assert.equal(result.ok, false)
    assert.equal(result.error, '请求超时')
  }
  assert.ok(elapsed < 1500, `总耗时 ${elapsed}ms`)
})

test('1 字节 HTTP chunk 也只占一块预分配缓冲（结果正确且不超限）', async () => {
  const payload = JSON.stringify({ data: { balance: 7 } })
  const bytes = [...new TextEncoder().encode(payload)]
  const body = new ReadableStream({
    start (controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    },
  })
  const impl = async () => ({ status: 200, ok: true, body, headers: new Headers(), text: async () => { throw new Error('no') } })
  const result = await createRunner({ fetchImpl: impl }).queryProvider(makeProvider())
  assert.equal(result.ok, true)
  assert.equal(result.balance, 7)
})

test('/api/status 返回空/错误 JSON 时不猜测 USD 单位（避免覆盖站内货币）', async () => {
  const junk = [{}, { success: false, message: 'gateway' }, { data: {} }, { data: null }]
  for (const [index, payload] of junk.entries()) {
    const impl = recordingFetch(() => responseOf(200, payload))
    const unit = await resolveUnit(
      { url: `https://junk-${index}.example/api/user/self` },
      { fetchImpl: impl, now: () => 1 },
    )
    assert.equal(unit, null, JSON.stringify(payload))
  }
  // 有可信字段（one-api 的 quota_per_unit + display_in_currency）时 USD 兜底仍生效
  const oneapi = await resolveUnit(
    { url: 'https://oneapi-units.example/api/user/self' },
    { fetchImpl: recordingFetch(() => responseOf(200, { data: { quota_per_unit: 500000, display_in_currency: true } })), now: () => 1 },
  )
  assert.deepEqual(oneapi, { divisor: 500000, multiplier: 1, symbol: '$', decimals: 2 })
})

test('usageArrayPath 为空时兼容旧版自动找数组（顶层数组 / data 数组）', async () => {
  const cases = [
    [[{ token_used: 5 }, { token_used: 6 }], 11],
    [{ data: [{ token_used: 7 }, { token_used: '2' }] }, 9],
  ]
  for (const [payload, expected] of cases) {
    const impl = balanceAndUsageFetch(responseOf(200, payload))
    const result = await createRunner({ fetchImpl: impl }).queryProvider(
      usageProvider({ usageArrayPath: '', usageFields: [{ label: 'Token', path: 'token_used' }] }),
    )
    assert.deepEqual(result.usage, [{ label: 'Token', value: expected }], JSON.stringify(payload))
  }
})

test('非法请求头由 fetch 抛出时给出可排查的文案', async () => {
  const impl = async () => { throw new TypeError('Headers.append: "a b" is an invalid header name.') }
  const result = await createRunner({ fetchImpl: impl }).queryProvider(makeProvider())
  assert.equal(result.error, '请求头或令牌格式不合法，检查自定义请求头')
})

test('fetch 的 ByteString 错误也映射成请求头文案', async () => {
  const impl = async () => { throw new TypeError('Cannot convert argument to a ByteString because the character at index 3 has a value of 20013.') }
  const result = await createRunner({ fetchImpl: impl }).queryProvider(makeProvider())
  assert.equal(result.error, '请求头或令牌格式不合法，检查自定义请求头')
})
