// 存储层：配置与结果缓存的读写、provider 校验、密钥打码。
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { validatePath, validateExpression } from './extract.js'
import { HTTPS_ONLY_MESSAGE, isParsableHttpUrl, isSafeUrl } from './url.js'

export const CONFIG_VERSION = 1
export const RESULTS_VERSION = 1

const MAX_PROVIDERS = 24
const MAX_SECRET = 2048
const MAX_URL = 2048
const MAX_NAME = 24
const MAX_SYMBOL = 8
const MAX_TEXT = 4096
const MAX_USAGE_URL = 512
const MAX_USAGE_ARRAY_PATH = 120
const MAX_USAGE_FIELDS = 4
const MAX_EXTRA_FIELDS = 4
const FIELD_KINDS = ['money', 'count', 'text', 'date']
const ID_RE = /^p_[a-z0-9]{6,12}$/
const AUTH_TYPES = ['bearer', 'header', 'query', 'cookie', 'basic', 'login']
const PRESET_IDS = ['custom', 'deepseek', 'newapi', 'oneapi', 'kimi', 'mimo', 'openrouter', 'openai-cost', 'anthropic-cost', 'opencode-go', 'commandcode']
const MIN_FACTOR = 0.000001
const MAX_FACTOR = 1e12
const TIMEOUT_MIN = 4000
const TIMEOUT_MAX = 30000
// HTTP header names are RFC 7230 tokens; fetch silently ignores or rejects the
// hop-by-hop/automatic ones, which would leave a saved config that never works.
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const FORBIDDEN_HEADER_NAMES = new Set([
  'host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'expect', 'te', 'trailer',
])
const HEADER_VALUE_BAD_RE = /[\r\n\0]/
// fetch 的 header 值是 ByteString（可打印 ASCII + tab），中文等会直接抛 TypeError。
const HEADER_VALUE_ASCII_RE = /[^\t\x20-\x7e]/

function headerNameError (name, label) {
  if (HEADER_VALUE_BAD_RE.test(name) || !HEADER_NAME_RE.test(name)) {
    return `${label}只能包含字母、数字和 !#$%&'*+-.^_\`|~，不能含空格或换行`
  }
  if (FORBIDDEN_HEADER_NAMES.has(name.toLowerCase())) {
    return `${label}不能是 ${name}（由请求库自动管理）`
  }
  return ''
}

function headerValueError (value, label) {
  const text = String(value)
  if (HEADER_VALUE_BAD_RE.test(text)) return `${label}不能含换行或空字符`
  if (HEADER_VALUE_ASCII_RE.test(text)) return `${label}只能包含可打印 ASCII 字符（中文/emoji 请改用 URL 编码或请求体）`
  return ''
}

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

// 语法层只校验 http(s)；是否允许明文 http 由 isSafeUrl 单独判断（仅本机回环放行）。
const isHttpUrl = isParsableHttpUrl

function freshProviders () {
  return []
}

function freshSettings () {
  return {
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

async function hardenPermissions (file) {
  // 配置里可能有过期版本留下的宽权限；读到就顺手收紧（best-effort，非 root 失败也不报）。
  try {
    await fs.chmod(file, 0o600)
  } catch {
    // 只读文件系统等场景忽略
  }
  try {
    await fs.chmod(path.dirname(file), 0o700)
  } catch {
    // 同上
  }
}

async function writeFileAtomic (file, data) {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  try {
    await fs.chmod(dir, 0o700)
  } catch {
    // 目录权限收紧失败不影响写入
  }
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  )
  try {
    // 独占创建临时文件 + fsync，再 rename；掉电后尽量不丢最后一次保存。
    const handle = await fs.open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(tmp, file)
    try {
      const dirHandle = await fs.open(dir, 'r')
      try {
        await dirHandle.sync()
      } finally {
        await dirHandle.close()
      }
    } catch {
      // 有的文件系统不支持目录 fsync，忽略
    }
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

function normalizeKind (raw) {
  return FIELD_KINDS.includes(raw) ? raw : 'money'
}

function withKind (row) {
  return row.kind === 'money' ? { label: row.label, path: row.path } : row
}

function normalizeDetailPaths (raw) {
  if (!Array.isArray(raw)) return []
  const rows = []
  for (const item of raw) {
    if (rows.length >= 6) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const label = trimmed(item.label)
    const detailPath = trimmed(item.path)
    if (!label || !validateExpression(detailPath)) continue
    rows.push(withKind({
      label: [...label].slice(0, 20).join(''),
      path: detailPath,
      kind: normalizeKind(item.kind),
    }))
  }
  return rows
}

function normalizeExtraFields (raw) {
  if (!Array.isArray(raw)) return []
  const rows = []
  for (const item of raw) {
    if (rows.length >= MAX_EXTRA_FIELDS) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const label = trimmed(item.label)
    const fieldPath = trimmed(item.path)
    if (!label || !validateExpression(fieldPath)) continue
    rows.push(withKind({
      label: [...label].slice(0, 20).join(''),
      path: fieldPath,
      kind: normalizeKind(item.kind),
    }))
  }
  return rows
}

function normalizeUsageFields (raw) {
  if (!Array.isArray(raw)) return []
  const rows = []
  for (const item of raw) {
    if (rows.length >= MAX_USAGE_FIELDS) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const label = trimmed(item.label)
    const fieldPath = trimmed(item.path)
    if (!label || !validateExpression(fieldPath)) continue
    rows.push({ label: [...label].slice(0, 20).join(''), path: fieldPath })
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
    usageUrl: trimmed(raw.usageUrl).slice(0, MAX_USAGE_URL),
    usageMethod: raw.usageMethod === 'POST' ? 'POST' : 'GET',
    usageArrayPath: trimmed(raw.usageArrayPath).slice(0, MAX_USAGE_ARRAY_PATH),
    usageFields: normalizeUsageFields(raw.usageFields),
    usageScale: toBool(raw.usageScale, false),
    extraUrl: trimmed(raw.extraUrl).slice(0, MAX_URL),
    extraFields: normalizeExtraFields(raw.extraFields),
    divisor: normalizeFactor(raw.divisor),
    multiplier: normalizeFactor(raw.multiplier),
    symbol: typeof raw.symbol === 'string' ? [...raw.symbol.trim()].slice(0, MAX_SYMBOL).join('') : '¥',
    decimals: normalizeDecimals(raw.decimals),
    enabled: toBool(raw.enabled, true),
    autoUnit: toBool(raw.autoUnit, false),
    balanceOptional: toBool(raw.balanceOptional, false),
    // 已跑过一次性迁移（补明细/订阅字段等），避免每次加载把用户删掉的默认项复活。
    enriched: raw.enriched === true,
  }
}

function normalizeSettings (raw) {
  const settings = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const timeout = toNumber(settings.timeoutMs)
  const timeoutMs = Number.isFinite(timeout)
    ? Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, Math.round(timeout)))
    : 12000
  return {
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

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function normalizeResults (raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const results = {}
  const table = source.results && typeof source.results === 'object' && !Array.isArray(source.results)
    ? source.results
    : {}
  for (const [id, result] of Object.entries(table)) {
    if (UNSAFE_KEYS.has(id)) continue
    if (!result || typeof result !== 'object' || Array.isArray(result)) continue
    results[id] = result
  }
  return { v: RESULTS_VERSION, results }
}

// ---------- 读写 ----------

async function backupBadFile (file) {
  try {
    const backup = `${file}.bad-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    await fs.rename(file, backup)
    // 备份可能保留旧文件的宽权限（同步/旧版本留下的 0644），立刻收紧。
    try {
      await fs.chmod(backup, 0o600)
    } catch {
      // 只读文件系统等场景忽略
    }
    try {
      await fs.chmod(path.dirname(file), 0o700)
    } catch {
      // 同上
    }
  } catch {
    // 备份失败（例如跨设备 rename 不允许）也至少把原文件和目录收紧，不打断 UI。
    await hardenPermissions(file)
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
  await hardenPermissions(file)
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
    await hardenPermissions(file)
    return emptyResults()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.v !== RESULTS_VERSION) {
    await hardenPermissions(file)
    return emptyResults()
  }
  await hardenPermissions(file)
  const results = {}
  const table = parsed.results && typeof parsed.results === 'object' && !Array.isArray(parsed.results)
    ? parsed.results
    : {}
  for (const [id, result] of Object.entries(table)) {
    if (UNSAFE_KEYS.has(id)) continue
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

export function validateProvider (draft, { existing = null, allowSecretReuse = false } = {}) {
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
  else if (!isSafeUrl(url)) errors.url = HTTPS_ONLY_MESSAGE

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
  // 只有目标接口没换（allowSecretReuse）时才沿用旧密钥，避免把 A 家的 key 发到 B 家。
  if (secret === '' && allowSecretReuse && existingSecret !== '') secret = existingSecret
  provider.secret = secret
  if (secret === '') {
    const hadSecret = existingSecret !== ''
    errors.secret = !allowSecretReuse && hadSecret ? '换了站点或平台，请重新填密钥' : '请填密钥/令牌'
  }
  else if (secret.length > MAX_SECRET) errors.secret = `密钥/令牌最多 ${MAX_SECRET} 个字符`
  else if (HEADER_VALUE_BAD_RE.test(secret)) errors.secret = '密钥/令牌不能含换行或空字符'
  else if ((authType === 'bearer' || authType === 'header' || authType === 'cookie') &&
    HEADER_VALUE_ASCII_RE.test(secret)) {
    errors.secret = '密钥/令牌作为请求头只能包含可打印 ASCII 字符'
  }

  const secretHeader = trimmed(form.secretHeader) || 'X-API-Key'
  provider.secretHeader = secretHeader
  const secretHeaderNameError = headerNameError(secretHeader, '请求头名称')
  if (charLength(secretHeader) > 64) errors.secretHeader = '请求头名称最多 64 个字符'
  else if (secretHeaderNameError !== '') errors.secretHeader = secretHeaderNameError

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
    else if (!isSafeUrl(loginUrl)) errors.loginUrl = HTTPS_ONLY_MESSAGE
  } else if (authType === 'login') {
    errors.loginUrl = '请填登录地址'
  }

  const tokenPath = trimmed(form.tokenPath) || 'data.token'
  provider.tokenPath = tokenPath
  if (!validatePath(tokenPath)) errors.tokenPath = '令牌字段路径不合法'

  const tokenHeader = trimmed(form.tokenHeader) || 'Authorization'
  provider.tokenHeader = tokenHeader
  const tokenHeaderNameError = headerNameError(tokenHeader, '令牌请求头名称')
  if (charLength(tokenHeader) > 128) errors.tokenHeader = '令牌请求头名称最多 128 个字符'
  else if (tokenHeaderNameError !== '') errors.tokenHeader = tokenHeaderNameError

  const tokenPrefix = typeof form.tokenPrefix === 'string' ? form.tokenPrefix : ''
  provider.tokenPrefix = tokenPrefix === '' ? 'Bearer ' : tokenPrefix
  const tokenPrefixError = headerValueError(provider.tokenPrefix, '令牌前缀')
  if (charLength(provider.tokenPrefix) > 32) errors.tokenPrefix = '令牌前缀最多 32 个字符'
  else if (tokenPrefixError !== '') errors.tokenPrefix = tokenPrefixError

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
    if (ok) {
      for (const [name, value] of Object.entries(parsed)) {
        const nameError = headerNameError(name, `额外请求头「${name}」的名称`)
        if (nameError !== '') {
          errors.headersText = nameError
          break
        }
        const valueError = headerValueError(value, `额外请求头「${name}」的值`)
        if (valueError !== '') {
          errors.headersText = valueError
          break
        }
      }
    }
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
  if (balancePath !== '' && !validateExpression(balancePath)) errors.balancePath = '余额字段路径不合法'

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
    if (/[=\r\n]/.test(label)) {
      errors.detailPaths = errors.detailPaths || `明细第 ${index + 1} 行标签不能含 = 或换行`
      continue
    }
    if (!validateExpression(detailPath)) {
      errors.detailPaths = errors.detailPaths || `明细第 ${index + 1} 行路径不合法`
      continue
    }
    detailPaths.push(withKind({ label, path: detailPath, kind: normalizeKind(row.kind) }))
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
  provider.autoUnit = toBool(form.autoUnit, false)
  provider.balanceOptional = toBool(form.balanceOptional, false)

  // 用量（v1.1/v1.9：有 usageUrl 走独立请求；usageUrl 空但有 usageFields 走同响应用量）
  const usageUrl = trimmed(form.usageUrl)
  provider.usageUrl = usageUrl
  provider.usageMethod = 'GET'
  provider.usageArrayPath = ''
  provider.usageScale = toBool(form.usageScale, false)
  if (usageUrl !== '') {
    if (usageUrl.length > MAX_USAGE_URL) errors.usageUrl = `用量地址最多 ${MAX_USAGE_URL} 个字符`
    else if (!/^https?:\/\//i.test(usageUrl) || !isHttpUrl(usageUrl)) {
      errors.usageUrl = '用量地址要以 http:// 或 https:// 开头'
    } else if (!isSafeUrl(usageUrl)) {
      errors.usageUrl = HTTPS_ONLY_MESSAGE
    }
    const rawUsageMethod = typeof form.usageMethod === 'string' ? form.usageMethod.trim().toUpperCase() : ''
    if (rawUsageMethod === '' || rawUsageMethod === 'GET') provider.usageMethod = 'GET'
    else if (rawUsageMethod === 'POST') provider.usageMethod = 'POST'
    else errors.usageMethod = '用量请求方法只能是 GET 或 POST'
  }

  const usageArrayPath = trimmed(form.usageArrayPath)
  provider.usageArrayPath = usageArrayPath
  if (charLength(usageArrayPath) > MAX_USAGE_ARRAY_PATH) {
    errors.usageArrayPath = `用量数组路径最多 ${MAX_USAGE_ARRAY_PATH} 个字符`
  } else if (usageArrayPath !== '' && !validatePath(usageArrayPath)) {
    errors.usageArrayPath = '用量数组路径不合法'
  }

  const rawUsageFields = Array.isArray(form.usageFields) ? form.usageFields : []
  if (rawUsageFields.length > MAX_USAGE_FIELDS) errors.usageFields = `用量字段最多 ${MAX_USAGE_FIELDS} 条`
  const usageFields = []
  for (let index = 0; index < Math.min(rawUsageFields.length, MAX_USAGE_FIELDS); index++) {
    const row = rawUsageFields[index] && typeof rawUsageFields[index] === 'object' ? rawUsageFields[index] : {}
    const label = trimmed(row.label)
    const fieldPath = trimmed(row.path)
    if (label === '' && fieldPath === '') continue
    if (label === '') {
      errors.usageFields = errors.usageFields || `用量第 ${index + 1} 行请填标签`
      continue
    }
    if (charLength(label) > 20) {
      errors.usageFields = errors.usageFields || `用量第 ${index + 1} 行标签最多 20 个字`
      continue
    }
    if (/[=\r\n]/.test(label)) {
      errors.usageFields = errors.usageFields || `用量第 ${index + 1} 行标签不能含 = 或换行`
      continue
    }
    if (!validateExpression(fieldPath)) {
      errors.usageFields = errors.usageFields || `用量第 ${index + 1} 行路径不合法`
      continue
    }
    usageFields.push({ label, path: fieldPath })
  }
  provider.usageFields = usageFields
  if (usageUrl !== '' && usageFields.length === 0) {
    errors.usageFields = errors.usageFields || '填了用量地址就要填用量字段'
  }
  // 只用量的服务允许 balancePath 为空，但必须至少有 1 个用量字段。
  if (balancePath === '' && usageFields.length === 0) errors.balancePath = '请填余额字段路径'

  // 附加信息（v2.0）：订阅额度等独立接口，失败静默。
  const extraUrl = trimmed(form.extraUrl)
  provider.extraUrl = extraUrl
  if (extraUrl !== '') {
    if (extraUrl.length > MAX_USAGE_URL) errors.extraUrl = `附加信息地址最多 ${MAX_USAGE_URL} 个字符`
    else if (!/^https?:\/\//i.test(extraUrl) || !isHttpUrl(extraUrl)) {
      errors.extraUrl = '附加信息地址要以 http:// 或 https:// 开头'
    } else if (!isSafeUrl(extraUrl)) {
      errors.extraUrl = HTTPS_ONLY_MESSAGE
    }
  }
  const rawExtraFields = Array.isArray(form.extraFields) ? form.extraFields : []
  if (rawExtraFields.length > MAX_EXTRA_FIELDS) errors.extraFields = `附加信息最多 ${MAX_EXTRA_FIELDS} 条`
  const extraFields = []
  for (let index = 0; index < Math.min(rawExtraFields.length, MAX_EXTRA_FIELDS); index++) {
    const row = rawExtraFields[index] && typeof rawExtraFields[index] === 'object' ? rawExtraFields[index] : {}
    const label = trimmed(row.label)
    const fieldPath = trimmed(row.path)
    if (label === '' && fieldPath === '') continue
    if (label === '') {
      errors.extraFields = errors.extraFields || `附加信息第 ${index + 1} 行请填标签`
      continue
    }
    if (charLength(label) > 20) {
      errors.extraFields = errors.extraFields || `附加信息第 ${index + 1} 行标签最多 20 个字`
      continue
    }
    if (/[=\r\n]/.test(label)) {
      errors.extraFields = errors.extraFields || `附加信息第 ${index + 1} 行标签不能含 = 或换行`
      continue
    }
    if (!validateExpression(fieldPath)) {
      errors.extraFields = errors.extraFields || `附加信息第 ${index + 1} 行路径不合法`
      continue
    }
    extraFields.push(withKind({ label, path: fieldPath, kind: normalizeKind(row.kind) }))
  }
  provider.extraFields = extraFields
  if (extraUrl !== '' && extraFields.length === 0) {
    errors.extraFields = errors.extraFields || '填了附加信息地址就要填附加信息字段'
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, provider }
}
