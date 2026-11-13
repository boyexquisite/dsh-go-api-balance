// 取数层：构造请求、处理鉴权/超时/取消、解析余额。
import { getByPath, pickNumber } from './extract.js'

const MAX_BODY = 256 * 1024
const MAX_PREVIEW = 8192
const DEFAULT_TIMEOUT_MS = 12000

class QueryError extends Error {}

function validTimeout (value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function normalizeDecimals (value) {
  if (Number.isInteger(value) && value >= 0 && value <= 4) return value
  return 2
}

function httpError (status) {
  if (status === 401) return '密钥或令牌无效'
  if (status === 403) return '没有权限访问这个接口'
  if (status === 404) return '接口不存在，检查地址'
  if (status === 429) return '请求太频繁，稍后再试'
  if (status >= 500 && status <= 599) return `对方服务出错（HTTP ${status}）`
  return `接口返回异常（HTTP ${status}）`
}

function errorMessage (error) {
  if (error instanceof QueryError) return error.message
  if (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR')) return '已取消'
  return '查询失败，稍后再试'
}

function emptyResult (provider, error, fetchedAt) {
  const symbol = provider && typeof provider.symbol === 'string' ? provider.symbol : ''
  return {
    id: provider && provider.id !== undefined && provider.id !== null ? String(provider.id) : '',
    ok: false,
    balance: null,
    currency: symbol,
    symbol,
    decimals: normalizeDecimals(provider ? provider.decimals : undefined),
    details: [],
    rawPreview: null,
    error,
    fetchedAt,
  }
}

function previewOf (json) {
  let text
  try {
    text = JSON.stringify(json)
  } catch {
    text = ''
  }
  return typeof text === 'string' ? text.slice(0, MAX_PREVIEW) : ''
}

function parseHeadersText (text) {
  if (typeof text !== 'string' || text.trim() === '') return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const headers = {}
  for (const [name, value] of Object.entries(parsed)) {
    if (name.trim() === '') continue
    headers[name] = typeof value === 'string' ? value : String(value)
  }
  return headers
}

function headerName (value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function hasHeader (headers, name) {
  const target = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === target)
}

function setHeader (headers, name, value) {
  const target = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) delete headers[key]
  }
  headers[name] = value
}

function appendQuery (url, name, value) {
  try {
    const target = new URL(url)
    target.searchParams.set(name, value)
    return target.toString()
  } catch {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}${encodeURIComponent(name)}=${encodeURIComponent(value)}`
  }
}

function buildRequest (provider, token) {
  const headers = parseHeadersText(provider.headersText)
  const secret = typeof provider.secret === 'string' ? provider.secret : ''
  let url = typeof provider.url === 'string' ? provider.url : ''
  const authType = typeof provider.authType === 'string' ? provider.authType : 'bearer'

  switch (authType) {
    case 'header':
      setHeader(headers, headerName(provider.secretHeader, 'X-API-Key'), secret)
      break
    case 'query':
      url = appendQuery(url, headerName(provider.secretParam, 'key'), secret)
      break
    case 'cookie':
      setHeader(headers, 'Cookie', secret)
      break
    case 'basic': {
      const username = typeof provider.username === 'string' ? provider.username : ''
      const encoded = Buffer.from(`${username}:${secret}`, 'utf8').toString('base64')
      setHeader(headers, 'Authorization', `Basic ${encoded}`)
      break
    }
    case 'login': {
      const prefix = typeof provider.tokenPrefix === 'string' ? provider.tokenPrefix : 'Bearer '
      const value = `${prefix}${token === null || token === undefined ? '' : token}`
      setHeader(headers, headerName(provider.tokenHeader, 'Authorization'), value)
      break
    }
    case 'bearer':
    default:
      setHeader(headers, 'Authorization', `Bearer ${secret}`)
      break
  }

  if (!hasHeader(headers, 'accept')) setHeader(headers, 'Accept', 'application/json')

  const method = provider.method === 'POST' ? 'POST' : 'GET'
  const init = { method, headers }
  const bodyText = typeof provider.bodyText === 'string' ? provider.bodyText : ''
  if (method === 'POST' && bodyText.trim() !== '') {
    init.body = bodyText
    if (!hasHeader(headers, 'content-type')) setHeader(headers, 'Content-Type', 'application/json')
  }
  return { url, init }
}

function pickCurrency (json, provider, symbol) {
  const currencyPath = typeof provider.currencyPath === 'string' ? provider.currencyPath : ''
  if (currencyPath === '') return symbol
  const value = getByPath(json, currencyPath)
  return typeof value === 'string' ? value : symbol
}

function pickDetails (json, provider) {
  const source = Array.isArray(provider.detailPaths) ? provider.detailPaths.slice(0, 6) : []
  return source.map((row) => {
    const label = row && typeof row.label === 'string' ? row.label : ''
    const detailPath = row && typeof row.path === 'string' ? row.path : ''
    const raw = detailPath === '' ? undefined : getByPath(json, detailPath)
    let value = null
    if (raw !== undefined && raw !== null) {
      if (typeof raw === 'number' || typeof raw === 'string') value = raw
    }
    return { label, value }
  })
}

export function createRunner ({ fetchImpl = globalThis.fetch, now = Date.now, defaultTimeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const fetchJson = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  const clock = typeof now === 'function' ? now : Date.now
  const fallbackTimeout = validTimeout(defaultTimeoutMs, DEFAULT_TIMEOUT_MS)
  const tokenCache = new Map()

  function cacheKey (provider) {
    return `${provider.id === undefined || provider.id === null ? '' : provider.id}\u0000${provider.loginUrl || ''}\u0000${provider.username || ''}`
  }

  function mapFetchError (error, { timedOut, canceled, signal }) {
    if (timedOut) return new QueryError('请求超时')
    if (canceled || (signal && signal.aborted)) return new QueryError('已取消')
    if (error && (error.name === 'AbortError' || error.name === 'TimeoutError' || error.code === 'ABORT_ERR')) {
      return new QueryError('请求超时')
    }
    return new QueryError('连不上接口，检查地址或网络')
  }

  async function rawRequest (request, { signal, timeoutMs }) {
    if (signal && signal.aborted) throw new QueryError('已取消')
    const controller = new AbortController()
    let timedOut = false
    let canceled = false
    const onExternalAbort = () => {
      canceled = true
      controller.abort()
    }
    if (signal) signal.addEventListener('abort', onExternalAbort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    try {
      let response
      try {
        response = await fetchJson(request.url, { ...request.init, signal: controller.signal })
      } catch (error) {
        throw mapFetchError(error, { timedOut, canceled, signal })
      }
      if (timedOut) throw new QueryError('请求超时')
      if (signal && signal.aborted) throw new QueryError('已取消')

      let text = ''
      try {
        text = typeof response.text === 'function' ? await response.text() : ''
      } catch (error) {
        throw mapFetchError(error, { timedOut, canceled, signal })
      }
      if (timedOut) throw new QueryError('请求超时')
      if (signal && signal.aborted) throw new QueryError('已取消')

      const status = Number(response.status)
      const statusCode = Number.isFinite(status) ? status : 0
      return {
        status: statusCode,
        ok: statusCode >= 200 && statusCode < 300,
        text: typeof text === 'string' ? text.slice(0, MAX_BODY) : '',
      }
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onExternalAbort)
    }
  }

  async function loginForToken (provider, context) {
    const loginUrl = typeof provider.loginUrl === 'string' ? provider.loginUrl : ''
    const payload = JSON.stringify({
      username: typeof provider.username === 'string' ? provider.username : '',
      password: typeof provider.secret === 'string' ? provider.secret : '',
    })
    let response
    try {
      response = await rawRequest({
        url: loginUrl,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: payload,
        },
      }, context)
    } catch (error) {
      if (error instanceof QueryError && ['已取消', '请求超时', '连不上接口，检查地址或网络'].includes(error.message)) {
        throw error
      }
      throw new QueryError('登录失败，检查账号密码')
    }
    if (!response.ok) throw new QueryError('登录失败，检查账号密码')

    let json
    try {
      json = JSON.parse(response.text)
    } catch {
      throw new QueryError('登录失败，检查账号密码')
    }
    const tokenPath = typeof provider.tokenPath === 'string' && provider.tokenPath !== '' ? provider.tokenPath : 'data.token'
    const token = getByPath(json, tokenPath)
    if (typeof token !== 'string' || token.trim() === '') throw new QueryError('登录失败，检查账号密码')
    return token.trim()
  }

  async function tokenFor (provider, context) {
    const key = cacheKey(provider)
    const cached = tokenCache.get(key)
    if (typeof cached === 'string' && cached !== '') return cached
    const token = await loginForToken(provider, context)
    tokenCache.set(key, token)
    return token
  }

  async function queryProvider (provider, options = {}) {
    const opts = options && typeof options === 'object' ? options : {}
    const timeoutMs = validTimeout(opts.timeoutMs, fallbackTimeout)
    const signal = opts.signal || null
    const preview = opts.preview === true
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
      return emptyResult(null, '服务配置有误', clock())
    }
    const context = { signal, timeoutMs }
    let jsonReady = false
    let rawPreview = null
    try {
      const isLogin = provider.authType === 'login'
      let token = null
      if (isLogin) token = await tokenFor(provider, context)

      let response = await rawRequest(buildRequest(provider, token), context)
      if (isLogin && (response.status === 401 || response.status === 403)) {
        tokenCache.delete(cacheKey(provider))
        token = await tokenFor(provider, context)
        response = await rawRequest(buildRequest(provider, token), context)
      }
      if (!response.ok) throw new QueryError(httpError(response.status))

      let json
      try {
        json = JSON.parse(response.text)
      } catch {
        throw new QueryError('返回的不是 JSON')
      }
      jsonReady = true
      rawPreview = preview ? previewOf(json) : null

      const rawBalance = getByPath(json, provider.balancePath)
      if (rawBalance === undefined) throw new QueryError('解析不到余额字段，检查取值路径')
      const balance = pickNumber(rawBalance)
      if (balance === null) throw new QueryError('余额不是数字')

      const symbol = typeof provider.symbol === 'string' ? provider.symbol : ''
      return {
        id: String(provider.id === undefined || provider.id === null ? '' : provider.id),
        ok: true,
        balance,
        currency: pickCurrency(json, provider, symbol),
        symbol,
        decimals: normalizeDecimals(provider.decimals),
        details: pickDetails(json, provider),
        rawPreview,
        error: null,
        fetchedAt: clock(),
      }
    } catch (error) {
      const result = emptyResult(provider, errorMessage(error), clock())
      // JSON 已解析成功时，即使余额解析失败也回显原始 JSON 供用户对照取值路径。
      result.rawPreview = jsonReady ? rawPreview : null
      return result
    }
  }

  async function queryAll (providers, options = {}) {
    const opts = options && typeof options === 'object' ? options : {}
    const list = Array.isArray(providers) ? providers.slice() : []
    const rawLimit = Number(opts.limit)
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.floor(rawLimit) : 3
    const results = new Array(list.length)
    if (list.length === 0) return results

    let cursor = 0
    const worker = async () => {
      while (cursor < list.length) {
        const index = cursor
        cursor += 1
        results[index] = await queryProvider(list[index], opts)
      }
    }
    const workers = []
    for (let index = 0; index < Math.min(limit, list.length); index++) workers.push(worker())
    await Promise.all(workers)
    return results
  }

  function clearTokenCache () {
    tokenCache.clear()
  }

  return { queryProvider, queryAll, clearTokenCache }
}

let defaultRunner = null

function runner () {
  if (defaultRunner === null) defaultRunner = createRunner()
  return defaultRunner
}

export async function queryProvider (provider, options = {}) {
  return runner().queryProvider(provider, options)
}

export async function queryAll (providers, options = {}) {
  return runner().queryAll(providers, options)
}
