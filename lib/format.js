// 展示层格式化：金额、时间、状态条文字、测试返回的脱敏。纯函数，不联网。

export const STRIP_MAX_CHARS = 24
export const PREVIEW_MAX_CHARS = 8000

function positiveFactor (value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : 1
}

function decimalsOf (value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0 || number > 4) return 2
  return number
}

function countChars (text) {
  return [...text].length
}

function pad2 (value) {
  return value < 10 ? `0${value}` : String(value)
}

function groupDigits (value, decimals) {
  const fixed = Math.abs(value).toFixed(decimals)
  const parts = fixed.split('.')
  const grouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const sign = value < 0 ? '-' : ''
  if (decimals === 0) return `${sign}${grouped}`
  return `${sign}${grouped}.${parts[1]}`
}

function asDate (value) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  const date = new Date(number)
  return Number.isNaN(date.getTime()) ? null : date
}

function referenceDate (now) {
  if (now instanceof Date) return now
  if (typeof now === 'function') {
    const value = now()
    return value instanceof Date ? value : asDate(value) || new Date()
  }
  return asDate(now) || new Date()
}

function escapeRegExp (text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 原始值按 provider 的除数/乘数换算；非法值返回 null。
export function scaledAmount (provider, value) {
  const source = provider && typeof provider === 'object' ? provider : {}
  let raw
  if (typeof value === 'number') raw = value
  else if (typeof value === 'string' && value.trim() !== '') raw = Number(value)
  else return null
  if (!Number.isFinite(raw)) return null
  const scaled = (raw / positiveFactor(source.divisor)) * positiveFactor(source.multiplier)
  return Number.isFinite(scaled) ? scaled : null
}

// 纯数字：千分位 + 固定小数位；非有限值给 '—'。
export function formatNumber (value, decimals = 2) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return '—'
  return groupDigits(number, decimalsOf(decimals))
}

// 金额：symbol + 千分位 + decimals 位小数；symbol 为空时是纯数字。
export function formatAmount (provider, value) {
  const number = scaledAmount(provider, value)
  if (number === null) return '—'
  const source = provider && typeof provider === 'object' ? provider : {}
  const symbol = typeof source.symbol === 'string' ? source.symbol : ''
  const digits = groupDigits(number, decimalsOf(source.decimals))
  // 百分比习惯后置（48%），其余货币符号仍前置。
  if (symbol === '%') return digits.startsWith('-') ? `-${digits.slice(1)}%` : `${digits}%`
  if (digits.startsWith('-')) return `-${symbol}${digits.slice(1)}`
  return `${symbol}${digits}`
}

// 已知币种代码 → 符号；不认识返回空串（表示沿用用户填的符号）。
const CURRENCY_SYMBOLS = Object.freeze({
  CNY: '¥',
  RMB: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  HKD: 'HK$',
  TWD: 'NT$',
  SGD: 'S$',
  KRW: '₩',
  INR: '₹',
  CAD: 'C$',
  AUD: 'A$',
  CHF: 'CHF',
  RUB: '₽',
  BRL: 'R$',
})

export function symbolForCurrency (value) {
  if (typeof value !== 'string') return ''
  const code = value.trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOLS, code) ? CURRENCY_SYMBOLS[code] : ''
}

// 时间戳（秒或毫秒）→ 'YYYY-MM-DD'；非法值 '—'。
export function formatDay (value) {
  let date = null
  if (typeof value === 'string') {
    const text = value.trim()
    if (text !== '') {
      const parsed = new Date(text)
      date = Number.isNaN(parsed.getTime()) ? null : parsed
    }
  } else {
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) {
      date = asDate(number > 1e12 ? number : number * 1000)
    }
  }
  if (date === null) return '—'
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

// 明细/附加信息：kind=money 金额换算；count 计数；date 日期；text 原样。
export function formatDetailValue (provider, value, kind = 'money') {
  if (kind === 'date') {
    return formatDay(value)
  }
  if (kind === 'count') {
    const number = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(number) ? groupDigits(number, 0) : '—'
  }
  if (kind === 'text') {
    return value === null || value === undefined ? '—' : String(value)
  }
  if (typeof value === 'number') return formatAmount(provider, value)
  if (typeof value === 'string') {
    const number = Number(value)
    if (value.trim() !== '' && Number.isFinite(number)) return formatAmount(provider, number)
    return value
  }
  return '—'
}

// 时间：同一天只给 HH:mm，否则 MM-DD HH:mm。
export function formatClock (value) {
  const date = asDate(value)
  if (date === null) return '—'
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function formatDateTime (value, now = Date.now()) {
  const date = asDate(value)
  if (date === null) return '—'
  const reference = referenceDate(now)
  const sameDay = date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  if (sameDay) return formatClock(value)
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function compactNumber (value, locale) {
  const english = String(locale || '').toLowerCase().startsWith('en')
  const abs = Math.abs(value)
  if (english) {
    if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`
    if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`
    if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`
    return groupDigits(value, 0)
  }
  if (abs >= 1e8) return `${(value / 1e8).toFixed(1)}亿`
  if (abs >= 1e4) return `${(value / 1e4).toFixed(1)}万`
  return groupDigits(value, 0)
}

// 用量数值：usageScale=true 按余额单位格式化；否则原始计数（万/亿、B/M/K）。
export function formatUsage (provider, field, locale = 'zh') {
  const source = provider && typeof provider === 'object' ? provider : {}
  const value = field && typeof field === 'object' ? field.value : field
  let number
  if (typeof value === 'number') number = value
  else if (typeof value === 'string' && value.trim() !== '') number = Number(value)
  else return '—'
  if (!Number.isFinite(number)) return '—'
  if (source.usageScale === true) return formatAmount(source, number)
  // 整数省掉 '.0'：100万 而不是 100.0万；有小数才保留 1 位。
  return compactNumber(number, locale).replace(/\.0(?=\D|$)/, '')
}

// 状态条：'余额 ¥1,234 · 3 家'，最多 24 字；没结果 / 关闭时给空串。
export function formatStripText (providers, results, options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  if (opts.stripEnabled === false) return ''
  const list = Array.isArray(providers) ? providers.filter((item) => item && typeof item === 'object' && item.enabled !== false) : []
  if (list.length === 0) return ''
  const table = results && typeof results === 'object' && !Array.isArray(results) ? results : {}
  const locale = typeof opts.locale === 'string' ? opts.locale : 'zh'
  const english = locale.toLowerCase().startsWith('en')
  let symbol = ''
  let decimals = 0
  const values = []
  for (const provider of list) {
    const result = table[provider.id]
    if (!result || result.ok !== true) continue
    const amount = scaledAmount(provider, result.balance)
    if (amount === null) continue
    if (values.length === 0 && typeof result.symbol === 'string') symbol = result.symbol
    decimals = Math.max(decimals, decimalsOf(result.decimals))
    values.push(amount)
  }
  if (values.length === 0) return ''
  const total = values.reduce((sum, amount) => sum + amount, 0)
  const build = (figure) => english
    ? `Balance ${symbol}${figure} · ${list.length}`
    : `余额 ${symbol}${figure} · ${list.length} 家`
  let text = build(groupDigits(total, decimals))
  if (countChars(text) > STRIP_MAX_CHARS) text = build(compactNumber(total, locale))
  if (countChars(text) > STRIP_MAX_CHARS) text = [...text].slice(0, STRIP_MAX_CHARS).join('')
  return text
}

// 测试预览脱敏：把已知密钥/用户名原文、Bearer/Basic 令牌和常见 JSON 密钥字段替换成 '••••'。
export function redactPreview (text, provider) {
  if (typeof text !== 'string' || text === '') return ''
  const source = provider && typeof provider === 'object' ? provider : {}
  let out = text
  const secrets = []
  if (typeof source.secret === 'string' && source.secret.trim() !== '') {
    secrets.push(source.secret)
    if (source.secret.trim() !== source.secret) secrets.push(source.secret.trim())
  }
  if (typeof source.username === 'string' && source.username.trim().length >= 3) {
    secrets.push(source.username.trim())
  }
  secrets.sort((a, b) => b.length - a.length)
  for (const secret of secrets) {
    if (secret === '') continue
    out = out.replace(new RegExp(escapeRegExp(secret), 'g'), '••••')
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer ••••')
  out = out.replace(/Basic\s+[A-Za-z0-9+/=]{6,}/gi, 'Basic ••••')
  out = out.replace(/("(?:token|access_token|refresh_token|api[_-]?key|apikey|key|secret|password)"\s*:\s*")[^"]*"/gi, '$1••••"')
  return out.slice(0, PREVIEW_MAX_CHARS)
}
