// 存储层：配置与结果缓存的读写、provider 校验、密钥打码。
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { validatePath } from './extract.js'

export const CONFIG_VERSION = 1
export const RESULTS_VERSION = 1

const MAX_PROVIDERS = 24
const MAX_SECRET = 2048
const MAX_URL = 2048
const MAX_NAME = 24
const MAX_SYMBOL = 8
const MAX_TEXT = 4096
const ID_RE = /^p_[a-z0-9]{6,12}$/
const AUTH_TYPES = ['bearer', 'header', 'query', 'cookie', 'basic', 'login']
const PRESET_IDS = ['custom', 'deepseek', 'newapi']
const MIN_FACTOR = 0.000001
const MAX_FACTOR = 1e12
const TIMEOUT_MIN = 4000
const TIMEOUT_MAX = 30000

// ---------- 基础工具 ----------

function str (value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

function trimmed (value) {
  return str(value).trim()
}

function charLength (value) {
  return [...value].length
}

function toBool (value, fallback) {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const text = String(value).trim().toLowerCase()
  if (text === '') return fallback
  return !(text === 'false' || text === '0' || text === 'no' || text === 'off')
}

function toNumber (value) {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const text = value.trim()
    if (text === '') return NaN
    return Number(text)
  }
  return NaN
}

function isHttpUrl (value) {
  if (!/^https?:\/\//i.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function freshProviders () {
  return []
}

function freshSettings () {
  return {
    stripEnabled: true,
    refreshOnOpen: true,
    timeoutMs: 12000,
  }
}

// ---------- 路径与默认值 ----------

export function resolveHome (env = process.env) {
  const home = env && typeof env === 'object' ? env.DSH_HOME : undefined
  if (typeof home === 'string' && home.trim() !== '') return home.trim()
  return path.join(os.homedir(), '.dsh')
}

export function configDir (home = resolveHome()) {
  return path.join(home, 'cache', 'dsh-go-api-balance')
}

export function configPath (home = resolveHome()) {
  return path.join(configDir(home), 'config.json')
}

export function resultsPath (home = resolveHome()) {
  return path.join(configDir(home), 'results.json')
}

export function defaultSettings () {
  return freshSettings()
}

export function defaultConfig () {
  return { v: CONFIG_VERSION, providers: freshProviders(), settings: freshSettings() }
}

export function newProviderId (now = Date.now, rand = Math.random) {
  const at = typeof now === 'function' ? now() : Number(now)
  const random = typeof rand === 'function' ? rand() : Number(rand)
  const timePart = Math.floor(Number.isFinite(Number(at)) ? Number(at) : 0).toString(36)
  const randPart = Math.floor((Number.isFinite(Number(random)) ? Number(random) : 0) * 0x100000000).toString(36)
  const mixed = `${timePart}${randPart}`.replace(/[^a-z0-9]/g, '')
  return `p_${mixed.slice(-8).padStart(8, '0')}`
}

// ---------- 原子写 ----------

async function writeFileAtomic (file, data) {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  )
  try {
    await fs.writeFile(tmp, data, { mode: 0o600 })
    await fs.rename(tmp, file)
  } catch (error) {
    try {
      await fs.rm(tmp, { force: true })
    } catch {
      // 清理失败不影响主错误
    }
    throw error
  }
}

// ---------- 正规化（保存/读取时兜底） ----------

function normalizeDetailPaths (raw) {
  if (!Array.isArray(raw)) return []
  const rows = []
  for (const item of raw) {
    if (rows.length >= 6) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const label = trimmed(item.label)
    const detailPath = trimmed(item.path)
    if (!label || !validatePath(detailPath)) continue
    rows.push({ label: [...label].slice(0, 20).join(''), path: detailPath })
  }
  return rows
}

function normalizeFactor (raw) {
  const number = toNumber(raw)
  if (!Number.isFinite(number) || number <= 0) return 1
  if (number < MIN_FACTOR || number > MAX_FACTOR) return 1
  return number
}

function normalizeDecimals (raw, fallback = 2) {
  const number = toNumber(raw)
  if (!Number.isFinite(number)) return fallback
  const rounded = Math.round(number)
  if (rounded < 0 || rounded > 4) return fallback
  return rounded
}

function normalizeProvider (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : newProviderId()
  const authType = AUTH_TYPES.includes(raw.authType) ? raw.authType : 'bearer'
  const method = raw.method === 'POST' ? 'POST' : 'GET'
  const preset = PRESET_IDS.includes(raw.preset) ? raw.preset : 'custom'
  const name = [...trimmed(raw.name)].slice(0, MAX_NAME).join('')
  const url = trimmed(raw.url).slice(0, MAX_URL)
  const loginUrl = trimmed(raw.loginUrl).slice(0, MAX_URL)
  return {
    id,
    name,
    preset,
    url,
    method,
    authType,
    secret: str(raw.secret),
    secretHeader: trimmed(raw.secretHeader) || 'X-API-Key',
    secretParam: trimmed(raw.secretParam) || 'key',
    username: trimmed(raw.username).slice(0, 128),
    loginUrl,
    tokenPath: trimmed(raw.tokenPath) || 'data.token',
    tokenHeader: trimmed(raw.tokenHeader) || 'Authorization',
    tokenPrefix: typeof raw.tokenPrefix === 'string' ? raw.tokenPrefix : 'Bearer ',
    headersText: str(raw.headersText),
    bodyText: str(raw.bodyText),
    balancePath: trimmed(raw.balancePath),
    currencyPath: trimmed(raw.currencyPath),
    detailPaths: normalizeDetailPaths(raw.detailPaths),
    divisor: normalizeFactor(raw.divisor),
    multiplier: normalizeFactor(raw.multiplier),
    symbol: typeof raw.symbol === 'string' ? [...raw.symbol.trim()].slice(0, MAX_SYMBOL).join('') : '¥',
    decimals: normalizeDecimals(raw.decimals),
    enabled: toBool(raw.enabled, true),
  }
}

function normalizeSettings (raw) {
  const settings = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const timeout = toNumber(settings.timeoutMs)
  const timeoutMs = Number.isFinite(timeout)
    ? Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, Math.round(timeout)))
    : 12000
  return {
    stripEnabled: toBool(settings.stripEnabled, true),
    refreshOnOpen: toBool(settings.refreshOnOpen, true),
    timeoutMs,
  }
}

function normalizeConfig (raw) {
  const config = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const providers = Array.isArray(config.providers)
    ? config.providers.map(normalizeProvider).filter(Boolean).slice(0, MAX_PROVIDERS)
    : []
  return { v: CONFIG_VERSION, providers, settings: normalizeSettings(config.settings) }
}

function emptyResults () {
  return { v: RESULTS_VERSION, results: {} }
}

function normalizeResults (raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const results = {}
  const table = source.results && typeof source.results === 'object' && !Array.isArray(source.results)
    ? source.results
    : {}
  for (const [id, result] of Object.entries(table)) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) continue
    results[id] = result
  }
  return { v: RESULTS_VERSION, results }
}

// ---------- 读写 ----------

async function backupBadFile (file) {
  try {
    await fs.rename(file, `${file}.bad-${Date.now()}`)
  } catch {
    // 备份失败就保持原样，不打断 UI
  }
}

export async function loadConfig (file = configPath()) {
  let text
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    return defaultConfig()
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    await backupBadFile(file)
    return defaultConfig()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.v !== CONFIG_VERSION) {
    await backupBadFile(file)
    return defaultConfig()
  }
  return normalizeConfig(parsed)
}

export async function saveConfig (config, file = configPath()) {
  const data = normalizeConfig(config)
  await writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`)
}

export async function loadResults (file = resultsPath()) {
  let text
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    return emptyResults()
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return emptyResults()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.v !== RESULTS_VERSION) {
    return emptyResults()
  }
  const results = {}
  const table = parsed.results && typeof parsed.results === 'object' && !Array.isArray(parsed.results)
    ? parsed.results
    : {}
  for (const [id, result] of Object.entries(table)) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) continue
    if (typeof result.ok !== 'boolean') continue
    results[id] = result
  }
  return { v: RESULTS_VERSION, results }
}

export async function saveResults (results, file = resultsPath()) {
  const data = normalizeResults(results)
  try {
    await writeFileAtomic(file, JSON.stringify(data))
  } catch {
    // 缓存只是加速，写失败不打扰 UI
  }
}

// ---------- 校验 ----------

function validateFactor (form, key, label) {
  const raw = form[key]
  if (raw === undefined || raw === null || raw === '') return { value: 1 }
  const number = toNumber(raw)
  if (!Number.isFinite(number)) return { error: `${label}要是数字` }
  if (number <= 0) return { error: `${label}要大于 0` }
  if (number < MIN_FACTOR || number > MAX_FACTOR) return { error: `${label}要在 0.000001–1e12 之间` }
  return { value: number }
}

export function validateProvider (draft, { existing = null } = {}) {
  const form = draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {}
  const errors = {}
  const provider = {}

  const rawId = typeof form.id === 'string' ? form.id.trim() : ''
  if (ID_RE.test(rawId)) provider.id = rawId
  else if (existing && typeof existing.id === 'string' && ID_RE.test(existing.id)) provider.id = existing.id
  else provider.id = newProviderId()

  const name = trimmed(form.name)
  provider.name = name
  if (name === '') errors.name = '请填名称'
  else if (charLength(name) > MAX_NAME) errors.name = `名称最多 ${MAX_NAME} 个字`

  provider.preset = PRESET_IDS.includes(form.preset) ? form.preset : 'custom'

  const url = trimmed(form.url)
  provider.url = url
  if (url === '') errors.url = '请填地址'
  else if (!/^https?:\/\//i.test(url)) errors.url = '地址要以 http:// 或 https:// 开头'
  else if (url.length > MAX_URL) errors.url = `地址最多 ${MAX_URL} 个字符`
  else if (!isHttpUrl(url)) errors.url = '地址要以 http:// 或 https:// 开头'

  const method = typeof form.method === 'string' ? form.method.trim().toUpperCase() : ''
  provider.method = 'GET'
  if (method === 'GET' || method === 'POST') provider.method = method
  else if (method !== '') errors.method = '请求方法只能是 GET 或 POST'

  let authType = 'bearer'
  const rawAuth = trimmed(form.authType).toLowerCase()
  if (rawAuth === '') authType = 'bearer'
  else if (AUTH_TYPES.includes(rawAuth)) authType = rawAuth
  else errors.authType = '鉴权方式不认识'
  provider.authType = authType

  let secret = str(form.secret).trim()
  const existingSecret = str(existing && existing.secret)
  if (secret === '' && existingSecret !== '') secret = existingSecret
  provider.secret = secret
  if (secret === '') errors.secret = '请填密钥/令牌'
  else if (secret.length > MAX_SECRET) errors.secret = `密钥/令牌最多 ${MAX_SECRET} 个字符`

  const secretHeader = trimmed(form.secretHeader) || 'X-API-Key'
  provider.secretHeader = secretHeader
  if (charLength(secretHeader) > 64) errors.secretHeader = '请求头名称最多 64 个字符'

  const secretParam = trimmed(form.secretParam) || 'key'
  provider.secretParam = secretParam
  if (charLength(secretParam) > 64) errors.secretParam = '查询参数名最多 64 个字符'

  const username = trimmed(form.username)
  provider.username = username
  if (charLength(username) > 128) errors.username = '用户名最多 128 个字符'
  else if ((authType === 'basic' || authType === 'login') && username === '') errors.username = '请填用户名'

  const loginUrl = trimmed(form.loginUrl)
  provider.loginUrl = loginUrl
  if (loginUrl !== '') {
    if (loginUrl.length > MAX_URL) errors.loginUrl = `登录地址最多 ${MAX_URL} 个字符`
    else if (!isHttpUrl(loginUrl)) errors.loginUrl = '登录地址要以 http:// 或 https:// 开头'
  } else if (authType === 'login') {
    errors.loginUrl = '请填登录地址'
  }

  const tokenPath = trimmed(form.tokenPath) || 'data.token'
  provider.tokenPath = tokenPath
  if (!validatePath(tokenPath)) errors.tokenPath = '令牌字段路径不合法'

  const tokenHeader = trimmed(form.tokenHeader) || 'Authorization'
  provider.tokenHeader = tokenHeader
  if (charLength(tokenHeader) > 128) errors.tokenHeader = '令牌请求头名称最多 128 个字符'

  const tokenPrefix = typeof form.tokenPrefix === 'string' ? form.tokenPrefix : ''
  provider.tokenPrefix = tokenPrefix === '' ? 'Bearer ' : tokenPrefix
  if (charLength(provider.tokenPrefix) > 32) errors.tokenPrefix = '令牌前缀最多 32 个字符'

  let headersText = ''
  if (typeof form.headersText === 'string') headersText = form.headersText.trim()
  else if (form.headersText && typeof form.headersText === 'object') headersText = JSON.stringify(form.headersText)
  provider.headersText = headersText
  if (headersText.length > MAX_TEXT) {
    errors.headersText = `额外请求头最多 ${MAX_TEXT} 个字符`
  } else if (headersText !== '') {
    let parsed
    let ok = false
    try {
      parsed = JSON.parse(headersText)
      ok = Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed)
    } catch {
      ok = false
    }
    if (!ok) errors.headersText = '额外请求头要是 JSON 对象'
  }

  let bodyText = ''
  if (typeof form.bodyText === 'string') bodyText = form.bodyText.trim()
  else if (form.bodyText && typeof form.bodyText === 'object') bodyText = JSON.stringify(form.bodyText)
  provider.bodyText = bodyText
  if (bodyText.length > MAX_TEXT) {
    errors.bodyText = `请求体最多 ${MAX_TEXT} 个字符`
  } else if (bodyText !== '') {
    let parsed
    let ok = false
    try {
      parsed = JSON.parse(bodyText)
      ok = Boolean(parsed) && typeof parsed === 'object'
    } catch {
      ok = false
    }
    if (!ok) errors.bodyText = '请求体要是 JSON 对象或数组'
  }

  const balancePath = trimmed(form.balancePath)
  provider.balancePath = balancePath
  if (balancePath === '') errors.balancePath = '请填余额字段路径'
  else if (!validatePath(balancePath)) errors.balancePath = '余额字段路径不合法'

  const currencyPath = trimmed(form.currencyPath)
  provider.currencyPath = currencyPath
  if (currencyPath !== '' && !validatePath(currencyPath)) errors.currencyPath = '币种字段路径不合法'

  const detailPaths = []
  const rawDetails = Array.isArray(form.detailPaths) ? form.detailPaths : []
  if (rawDetails.length > 6) errors.detailPaths = '明细最多 6 条'
  for (let index = 0; index < Math.min(rawDetails.length, 6); index++) {
    const row = rawDetails[index] && typeof rawDetails[index] === 'object' ? rawDetails[index] : {}
    const label = trimmed(row.label)
    const detailPath = trimmed(row.path)
    if (label === '' && detailPath === '') continue
    if (label === '') {
      errors.detailPaths = errors.detailPaths || `明细第 ${index + 1} 行请填标签`
      continue
    }
    if (charLength(label) > 20) {
      errors.detailPaths = errors.detailPaths || `明细第 ${index + 1} 行标签最多 20 个字`
      continue
    }
    if (!validatePath(detailPath)) {
      errors.detailPaths = errors.detailPaths || `明细第 ${index + 1} 行路径不合法`
      continue
    }
    detailPaths.push({ label, path: detailPath })
  }
  provider.detailPaths = detailPaths

  const divisor = validateFactor(form, 'divisor', '除数')
  provider.divisor = 1
  if (divisor.error) errors.divisor = divisor.error
  else provider.divisor = divisor.value

  const multiplier = validateFactor(form, 'multiplier', '乘数')
  provider.multiplier = 1
  if (multiplier.error) errors.multiplier = multiplier.error
  else provider.multiplier = multiplier.value

  const symbol = form.symbol === undefined || form.symbol === null ? '¥' : trimmed(form.symbol)
  provider.symbol = symbol
  if (charLength(symbol) > MAX_SYMBOL) errors.symbol = `货币符号最多 ${MAX_SYMBOL} 个字符`

  let decimals = 2
  if (form.decimals !== undefined && form.decimals !== null && form.decimals !== '') {
    const number = toNumber(form.decimals)
    if (!Number.isFinite(number)) errors.decimals = '小数位要是 0–4 的整数'
    else {
      const rounded = Math.round(number)
      if (rounded < 0 || rounded > 4) errors.decimals = '小数位要在 0–4 之间'
      else decimals = rounded
    }
  }
  provider.decimals = decimals

  provider.enabled = toBool(form.enabled, true)

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, provider }
}

// ---------- 展示用 ----------

export function maskSecret (secret) {
  const text = typeof secret === 'string' ? secret : ''
  const chars = [...text]
  if (chars.length <= 8) return '••••'
  return `••••${chars.slice(-4).join('')}`
}

export function providerToDraft (provider) {
  const draft = {
    secret: '',
    secretSet: true,
  }
  if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
    Object.assign(draft, provider)
    draft.secret = ''
    draft.secretSet = true
    draft.detailPaths = Array.isArray(provider.detailPaths)
      ? provider.detailPaths.map((row) => ({ ...row }))
      : []
  }
  return draft
}
