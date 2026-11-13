// 取数层：构造请求、处理鉴权/超时/取消、解析余额。
import { evalExpression, getByPath, isExpression, pickNumber } from './extract.js'
import { HTTPS_ONLY_MESSAGE, isSafeUrl } from './url.js'

const MAX_BODY = 256 * 1024
const MAX_TEXT_VALUE = 200
const MAX_CURRENCY_CHARS = 16
const MAX_SYMBOL_CHARS = 8
const MAX_USAGE_ROWS = 5000
const DEFAULT_TIMEOUT_MS = 12000

// 远端返回的字符串要收口：货币代码/符号、text/date 明细都只留短文本，避免撑大视图和缓存。
function clipText (value, max) {
  const text = String(value === undefined || value === null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '')
  return [...text].slice(0, max).join('')
}

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
    usage: [],
    extra: [],
    unit: null,
    error,
    fetchedAt,
  }
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

function buildRequest (provider, token, overrides = {}) {
  const headers = parseHeadersText(provider.headersText)
  const secret = typeof provider.secret === 'string' ? provider.secret : ''
  let url = typeof overrides.url === 'string'
    ? overrides.url
    : (typeof provider.url === 'string' ? provider.url : '')
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

  const method = overrides.method === 'POST' || (overrides.method === undefined && provider.method === 'POST')
    ? 'POST'
    : 'GET'
  const init = { method, headers }
  const bodyText = typeof overrides.bodyText === 'string'
    ? overrides.bodyText
    : (typeof provider.bodyText === 'string' ? provider.bodyText : '')
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
  return typeof value === 'string' ? clipText(value, MAX_CURRENCY_CHARS) : symbol
}

function needsAggregate (fieldPath) {
  return typeof fieldPath === 'string' && (isExpression(fieldPath) || fieldPath.includes('[]'))
}

function readFieldValue (json, fieldPath) {
  if (typeof fieldPath !== 'string' || fieldPath.trim() === '') return null
  if (needsAggregate(fieldPath)) return evalExpression(json, fieldPath)
  const raw = getByPath(json, fieldPath)
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') return clipText(raw, MAX_TEXT_VALUE)
  return null
}

function pickDetails (json, provider) {
  const source = Array.isArray(provider.detailPaths) ? provider.detailPaths.slice(0, 6) : []
  return source.map((row) => {
    const label = row && typeof row.label === 'string' ? row.label : ''
    const detailPath = row && typeof row.path === 'string' ? row.path : ''
    const value = readFieldValue(json, detailPath)
    const item = { label, value }
    const kind = row && typeof row.kind === 'string' ? row.kind : 'money'
    if (kind !== 'money') item.kind = kind
    return item
  })
}

function pickExtra (json, provider) {
  const source = Array.isArray(provider.extraFields) ? provider.extraFields.slice(0, 4) : []
  const rows = []
  for (const row of source) {
    const label = row && typeof row.label === 'string' ? row.label : ''
    const fieldPath = row && typeof row.path === 'string' ? row.path : ''
    if (label === '') continue
    const kind = row && typeof row.kind === 'string' ? row.kind : 'money'
    let value
    if (kind === 'text' || kind === 'date') {
      // text/date 只取普通路径，允许字符串/数字；对象、数组这类结构不收。
      const raw = getByPath(json, fieldPath)
      if (typeof raw === 'number') value = raw
      else if (typeof raw === 'string') value = clipText(raw, MAX_TEXT_VALUE)
      else continue
    } else {
      value = evalExpression(json, fieldPath)
    }
    if (value === null || value === undefined || value === '') continue
    rows.push({ label, value, kind })
  }
  return rows
}

function timestampOf (now) {
  const value = typeof now === 'function' ? now() : now instanceof Date ? now.getTime() : Number(now)
  return Number.isFinite(value) ? value : Date.now()
}

function localMidnight (at) {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

function localMonthStart (at) {
  const month = new Date(at)
  month.setDate(1)
  month.setHours(0, 0, 0, 0)
  return month.getTime()
}

function isoUtc (at) {
  return new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// URL 占位符：{now}/{today}/{7d}/{month_start} 为本地时区 epoch 秒；
// {now_iso}/{today_iso}/{7d_iso}/{month_start_iso} 为 RFC3339 UTC。
function resolveUrlTemplate (template, now) {
  const text = typeof template === 'string' ? template : ''
  if (text === '') return ''
  const at = timestampOf(now)
  const today = localMidnight(at)
  const monthStart = localMonthStart(at)
  const weekAgo = at - 7 * 86400 * 1000
  return text
    .replace(/\{now_iso\}/g, isoUtc(at))
    .replace(/\{today_iso\}/g, isoUtc(today))
    .replace(/\{7d_iso\}/g, isoUtc(weekAgo))
    .replace(/\{month_start_iso\}/g, isoUtc(monthStart))
    .replace(/\{now\}/g, String(Math.floor(at / 1000)))
    .replace(/\{today\}/g, String(Math.floor(today / 1000)))
    .replace(/\{7d\}/g, String(Math.floor(weekAgo / 1000)))
    .replace(/\{month_start\}/g, String(Math.floor(monthStart / 1000)))
}

export function resolveUsageUrl (provider, now) {
  const template = provider && typeof provider.usageUrl === 'string' ? provider.usageUrl.trim() : ''
  return resolveUrlTemplate(template, now)
}

function usageRows (json, arrayPath) {
  const value = getByPath(json, arrayPath)
  if (Array.isArray(value)) return value.slice(0, MAX_USAGE_ROWS)
  if (value !== null && value !== undefined && typeof value === 'object') return [value]
  return null
}

function parseUsageFromJson (json, provider) {
  const fields = Array.isArray(provider.usageFields) ? provider.usageFields.slice(0, 4) : []
  if (fields.length === 0) return []
  const arrayPath = typeof provider.usageArrayPath === 'string' ? provider.usageArrayPath.trim() : ''
  const rows = arrayPath === '' ? null : usageRows(json, arrayPath)
  if (arrayPath !== '' && rows === null) return []
  const usage = []
  for (const field of fields) {
    const label = field && typeof field.label === 'string' ? field.label : ''
    const fieldPath = field && typeof field.path === 'string' ? field.path : ''
    if (label === '' || fieldPath === '') continue
    let value = null
    if (rows === null) {
      // usageArrayPath 为空：对整份 JSON 求表达式（支持 [] 通配与 + / -）。
      value = evalExpression(json, fieldPath)
    } else {
      let sum = 0
      let found = false
      for (const row of rows) {
        const number = evalExpression(row, fieldPath)
        if (number === null) continue
        sum += number
        found = true
      }
      value = found && Number.isFinite(sum) ? sum : null
    }
    if (value !== null) usage.push({ label, value })
  }
  return usage
}

function mapFetchError (error, { timedOut, canceled, signal }) {
  if (timedOut) return new QueryError('请求超时')
  if (canceled || (signal && signal.aborted)) return new QueryError('已取消')
  if (error && (error.name === 'AbortError' || error.name === 'TimeoutError' || error.code === 'ABORT_ERR')) {
    return new QueryError('请求超时')
  }
  return new QueryError('连不上接口，检查地址或网络')
}

// 响应体按字节上限读取：流式读到超限立刻取消，避免 gzip 炸弹把宿主内存撑爆。
async function readBodyLimited (response, limit) {
  const body = response && response.body
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    const chunks = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        size += value.byteLength
        if (size > limit) {
          try {
            await reader.cancel()
          } catch {
            // 取消失败也不影响报错
          }
          throw new QueryError('响应太大')
        }
        chunks.push(Buffer.from(value))
      }
    } finally {
      try {
        if (typeof reader.releaseLock === 'function') reader.releaseLock()
      } catch {
        // 已取消/已释放
      }
    }
    return Buffer.concat(chunks, size).toString('utf8')
  }
  // 测试替身或没有流式 body 的宿主：退回 text()，按字节数兜底。
  if (typeof response.text === 'function') {
    const text = await response.text()
    if (typeof text !== 'string') return ''
    if (Buffer.byteLength(text) > limit) throw new QueryError('响应太大')
    return text
  }
  return ''
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 3

function sameOrigin (left, right) {
  try {
    const a = new URL(left)
    const b = new URL(right)
    return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
  } catch {
    return false
  }
}

function redirectTarget (currentUrl, response) {
  let location = null
  try {
    location = response && response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('location')
      : null
  } catch {
    location = null
  }
  if (typeof location !== 'string' || location.trim() === '') return null
  try {
    return new URL(location, currentUrl).toString()
  } catch {
    return null
  }
}

async function rawRequest (fetchJson, request, { signal, timeoutMs }) {
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
    // 自动跟随跳转会把自定义鉴权头带到目标站；这里手动跟随，只允许同源，
    // 跨域跳转直接停止（防密钥被跳到第三方）。
    let currentUrl = request.url
    let currentInit = { ...request.init, redirect: 'manual' }
    let response
    for (let hop = 0; ; hop++) {
      try {
        response = await fetchJson(currentUrl, { ...currentInit, signal: controller.signal })
      } catch (error) {
        throw mapFetchError(error, { timedOut, canceled, signal })
      }
      if (timedOut) throw new QueryError('请求超时')
      if (signal && signal.aborted) throw new QueryError('已取消')

      const code = Number(response && response.status)
      if (!REDIRECT_STATUSES.has(code)) break
      const target = redirectTarget(currentUrl, response)
      if (target === null) break
      if (hop >= MAX_REDIRECTS) throw new QueryError('接口跳转次数过多')
      if (!sameOrigin(currentUrl, target)) {
        throw new QueryError('接口跳转到其它域名，为防密钥泄露已停止')
      }
      if (!isSafeUrl(target)) throw new QueryError(HTTPS_ONLY_MESSAGE)
      const method = String(currentInit.method || 'GET').toUpperCase()
      const nextMethod = code === 303 || ((code === 301 || code === 302) && method === 'POST') ? 'GET' : method
      currentInit = { ...currentInit, method: nextMethod }
      if (nextMethod === 'GET') delete currentInit.body
      currentUrl = target
      try {
        if (response.body && typeof response.body.cancel === 'function') await response.body.cancel()
      } catch {
        // 3xx 的 body 丢掉即可，不读进内存
      }
    }

    try {
      const declared = Number(response && response.headers && typeof response.headers.get === 'function'
        ? response.headers.get('content-length')
        : NaN)
      if (Number.isFinite(declared) && declared > MAX_BODY) {
        // 直接拒绝时也把 body 关掉，别让连接挂着。
        try {
          if (response.body && typeof response.body.cancel === 'function') await response.body.cancel()
        } catch {
          // 取消失败不影响报错
        }
        throw new QueryError('响应太大')
      }
    } catch (error) {
      if (error instanceof QueryError) throw error
    }
    let text = ''
    try {
      text = await readBodyLimited(response, MAX_BODY)
    } catch (error) {
      if (error instanceof QueryError) throw error
      throw mapFetchError(error, { timedOut, canceled, signal })
    }
    if (timedOut) throw new QueryError('请求超时')
    if (signal && signal.aborted) throw new QueryError('已取消')

    const status = Number(response.status)
    const statusCode = Number.isFinite(status) ? status : 0
    return {
      status: statusCode,
      ok: statusCode >= 200 && statusCode < 300,
      text,
    }
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onExternalAbort)
  }
}

// ---------- 自动站点货币（v1.7） ----------

const UNIT_TTL_MS = 10 * 60 * 1000
const DEFAULT_QUOTA_PER_UNIT = 500000

function siteRoot (provider) {
  const url = provider && typeof provider.url === 'string' ? provider.url.trim() : ''
  if (url === '') return ''
  const suffix = '/api/user/self'
  let cleaned = url.split('#')[0].split('?')[0].replace(/\/+$/, '')
  if (cleaned.endsWith(suffix)) {
    cleaned = cleaned.slice(0, -suffix.length).replace(/\/+$/, '')
    return cleaned
  }
  try {
    return new URL(cleaned).origin
  } catch {
    return ''
  }
}

function tokensUnit () {
  return { divisor: 1, multiplier: 1, symbol: '', decimals: 0 }
}

function usdUnit (quotaPerUnit) {
  return { divisor: quotaPerUnit, multiplier: 1, symbol: '$', decimals: 2 }
}

function unitFromStatus (json) {
  let data = json
  if (json && typeof json === 'object' && json.data !== undefined && json.data !== null) data = json.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const displayType = typeof data.quota_display_type === 'string'
    ? data.quota_display_type.trim().toUpperCase()
    : ''
  if (displayType === 'TOKENS') return tokensUnit()
  const qpuRaw = Number(data.quota_per_unit)
  const quotaPerUnit = Number.isFinite(qpuRaw) && qpuRaw > 0 ? qpuRaw : DEFAULT_QUOTA_PER_UNIT
  if (displayType === 'USD' || displayType === 'CNY' || displayType === 'CUSTOM') {
    if (data.display_in_currency !== true) return tokensUnit()
    if (displayType === 'USD') return usdUnit(quotaPerUnit)
    if (displayType === 'CNY') {
      return {
        divisor: quotaPerUnit,
        multiplier: Number(data.usd_exchange_rate) || 1,
        symbol: '¥',
        decimals: 2,
      }
    }
    return {
      divisor: quotaPerUnit,
      multiplier: Number(data.custom_currency_exchange_rate) || 1,
      symbol: typeof data.custom_currency_symbol === 'string' ? clipText(data.custom_currency_symbol, MAX_SYMBOL_CHARS) : '',
      decimals: 2,
    }
  }
  // one-api 站：缺 quota_display_type，按 display_in_currency 兜底。
  if (data.display_in_currency === false) return tokensUnit()
  return usdUnit(quotaPerUnit)
}

function makeUnitResolver ({ sendRequest, now, cache, defaultTimeoutMs }) {
  return async function resolveUnit (provider, options = {}) {
    const opts = options && typeof options === 'object' ? options : {}
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return null
    const root = siteRoot(provider)
    if (root === '') return null
    const signal = opts.signal || null
    const timeoutMs = validTimeout(opts.timeoutMs, defaultTimeoutMs)
    const at = now()
    const cached = cache.get(root)
    if (cached && at - cached.at >= 0 && at - cached.at < UNIT_TTL_MS) return cached.unit
    if (signal && signal.aborted) return null
    const statusUrl = `${root}/api/status`
    if (!isSafeUrl(statusUrl)) return null
    try {
      const response = await sendRequest({
        url: statusUrl,
        init: { method: 'GET', headers: { Accept: 'application/json' } },
      }, { signal, timeoutMs })
      if (!response.ok) return null
      let json
      try {
        json = JSON.parse(response.text)
      } catch {
        return null
      }
      const unit = unitFromStatus(json)
      if (unit !== null) cache.set(root, { at, unit })
      return unit
    } catch {
      return null
    }
  }
}

const defaultUnitCache = new Map()

export async function resolveUnit (provider, options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : globalThis.fetch
  const now = typeof opts.now === 'function' ? opts.now : Date.now
  const timeout = validTimeout(opts.timeoutMs, DEFAULT_TIMEOUT_MS)
  const sendRequest = (request, context) => rawRequest(fetchImpl, request, context)
  return makeUnitResolver({
    sendRequest,
    now,
    cache: defaultUnitCache,
    defaultTimeoutMs: timeout,
  })(provider, opts)
}

export function createRunner ({ fetchImpl = globalThis.fetch, now = Date.now, defaultTimeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const fetchJson = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  const clock = typeof now === 'function' ? now : Date.now
  const fallbackTimeout = validTimeout(defaultTimeoutMs, DEFAULT_TIMEOUT_MS)
  const tokenCache = new Map()
  const unitCache = new Map()

  function cacheKey (provider) {
    // secret 也进 key：改密码/换账号后旧 token 不会再被复用。
    const secret = typeof provider.secret === 'string' ? provider.secret : ''
    return `${provider.id === undefined || provider.id === null ? '' : provider.id}\u0000${provider.loginUrl || ''}\u0000${provider.username || ''}\u0000${secret}`
  }

  const sendRequest = (request, context) => rawRequest(fetchJson, request, context)
  const resolveUnit = makeUnitResolver({
    sendRequest,
    now: clock,
    cache: unitCache,
    defaultTimeoutMs: fallbackTimeout,
  })

  async function loginForToken (provider, context) {
    const loginUrl = typeof provider.loginUrl === 'string' ? provider.loginUrl : ''
    if (!isSafeUrl(loginUrl)) throw new QueryError(HTTPS_ONLY_MESSAGE)
    const payload = JSON.stringify({
      username: typeof provider.username === 'string' ? provider.username : '',
      password: typeof provider.secret === 'string' ? provider.secret : '',
    })
    let response
    try {
      response = await sendRequest({
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

  // 同一个鉴权再发一次 GET/POST，返回 JSON；失败返回 null（静默）。
  async function readJsonWithAuth (provider, url, method, context) {
    let token = null
    if (provider.authType === 'login') token = await tokenFor(provider, context)
    const request = buildRequest(provider, token, { url, method, bodyText: '' })
    const response = await sendRequest(request, context)
    if (!response.ok) return null
    try {
      return JSON.parse(response.text)
    } catch {
      return null
    }
  }

  // 用量请求：失败静默返回 []，绝不污染 Result 的 error/ok。
  async function fetchUsage (provider, context) {
    const usageUrl = typeof provider.usageUrl === 'string' ? provider.usageUrl.trim() : ''
    if (usageUrl === '') return []
    if (context.signal && context.signal.aborted) return []
    const resolvedUsageUrl = resolveUsageUrl(provider, clock())
    if (!isSafeUrl(resolvedUsageUrl)) return []
    try {
      const json = await readJsonWithAuth(
        provider,
        resolvedUsageUrl,
        provider.usageMethod === 'POST' ? 'POST' : 'GET',
        context,
      )
      if (json === null) return []
      return parseUsageFromJson(json, provider)
    } catch {
      return []
    }
  }

  // 附加信息（订阅额度等）：第二次请求；失败静默返回 []。
  async function fetchExtra (provider, context) {
    const extraUrl = typeof provider.extraUrl === 'string' ? provider.extraUrl.trim() : ''
    if (extraUrl === '') return []
    if (!Array.isArray(provider.extraFields) || provider.extraFields.length === 0) return []
    if (context.signal && context.signal.aborted) return []
    const resolvedExtraUrl = resolveUrlTemplate(extraUrl, clock())
    if (!isSafeUrl(resolvedExtraUrl)) return []
    try {
      const json = await readJsonWithAuth(provider, resolvedExtraUrl, 'GET', context)
      if (json === null) return []
      return pickExtra(json, provider)
    } catch {
      return []
    }
  }

  async function queryProvider (provider, options = {}) {
    const opts = options && typeof options === 'object' ? options : {}
    const timeoutMs = validTimeout(opts.timeoutMs, fallbackTimeout)
    const signal = opts.signal || null
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
      return emptyResult(null, '服务配置有误', clock())
    }
    // 整个 provider 的多次请求共享一个总截止时间：单家最坏也就 timeoutMs，不会 3–4 段各拖满。
    const deadline = clock() + timeoutMs
    const remaining = () => Math.max(1, deadline - clock())
    const context = () => ({ signal, timeoutMs: remaining() })
    const wantUnit = provider.autoUnit === true && (provider.preset === 'newapi' || provider.preset === 'oneapi')
    const unit = wantUnit ? await resolveUnit(provider, { signal, timeoutMs: remaining() }) : null
    let balanceJson = null
    let result
    try {
      const isLogin = provider.authType === 'login'
      let token = null
      if (isLogin) token = await tokenFor(provider, context())
      const balanceUrl = resolveUrlTemplate(provider.url, clock())
      if (!isSafeUrl(balanceUrl)) throw new QueryError(HTTPS_ONLY_MESSAGE)

      let response = await sendRequest(buildRequest(provider, token, { url: balanceUrl }), context())
      if (isLogin && (response.status === 401 || response.status === 403)) {
        tokenCache.delete(cacheKey(provider))
        token = await tokenFor(provider, context())
        response = await sendRequest(buildRequest(provider, token, { url: balanceUrl }), context())
      }
      if (!response.ok) throw new QueryError(httpError(response.status))

      let json
      try {
        json = JSON.parse(response.text)
      } catch {
        throw new QueryError('返回的不是 JSON')
      }
      balanceJson = json

      // balancePath 为空 = 只用量服务，不发余额解析；balanceOptional 允许 null/缺失。
      let balance = null
      const balancePath = typeof provider.balancePath === 'string' ? provider.balancePath.trim() : ''
      if (balancePath !== '') {
        if (needsAggregate(balancePath)) {
          const computed = evalExpression(json, balancePath)
          if (computed !== null) balance = computed
          else if (provider.balanceOptional !== true) throw new QueryError('解析不到余额字段，检查取值路径')
        } else {
          const rawBalance = getByPath(json, balancePath)
          if (rawBalance === undefined) {
            if (provider.balanceOptional !== true) throw new QueryError('解析不到余额字段，检查取值路径')
          } else {
            const parsedBalance = pickNumber(rawBalance)
            if (parsedBalance !== null) balance = parsedBalance
            else if (!(provider.balanceOptional === true && rawBalance === null)) {
              throw new QueryError('余额不是数字')
            }
          }
        }
      }

      const symbol = typeof provider.symbol === 'string' ? provider.symbol : ''
      result = {
        id: String(provider.id === undefined || provider.id === null ? '' : provider.id),
        ok: true,
        balance,
        currency: pickCurrency(json, provider, symbol),
        symbol,
        decimals: normalizeDecimals(provider.decimals),
        details: pickDetails(json, provider),
        usage: [],
        extra: [],
        unit: null,
        error: null,
        fetchedAt: clock(),
      }
    } catch (error) {
      result = emptyResult(provider, errorMessage(error), clock())
    }

    // 用量：有 usageUrl 走独立请求；否则有 usageFields 时从余额响应同解析。
    const usageUrl = typeof provider.usageUrl === 'string' ? provider.usageUrl.trim() : ''
    const hasUsageFields = Array.isArray(provider.usageFields) && provider.usageFields.length > 0
    if (usageUrl !== '' && hasUsageFields) {
      result.usage = await fetchUsage(provider, context())
    } else if (hasUsageFields && balanceJson !== null) {
      result.usage = parseUsageFromJson(balanceJson, provider)
    } else {
      result.usage = []
    }
    const hasExtra = typeof provider.extraUrl === 'string' && provider.extraUrl.trim() !== '' &&
      Array.isArray(provider.extraFields) && provider.extraFields.length > 0
    if (hasExtra) result.extra = await fetchExtra(provider, context())
    result.unit = unit
    return result
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

  return { queryProvider, queryAll, clearTokenCache, resolveUnit }
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
