// 路径解析与数值提取：纯函数，不抛异常。
const MAX_PATH_LENGTH = 256
const PATH_RE = /^[A-Za-z_$][\w$]*(\[\d+\]|\.[A-Za-z_$][\w$]*)*$/
const SUM_PATH_RE = /^[A-Za-z_$][\w$]*(\[\d*\]|\.[A-Za-z_$][\w$]*)*$/
const WILDCARD = Symbol('wildcard')

function pathBody (path) {
  return path.startsWith('$.') ? path.slice(2) : path
}

function parsePath (path) {
  if (typeof path !== 'string') return null
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return null
  const body = pathBody(path)
  if (body.length === 0 || !PATH_RE.test(body)) return null
  return body
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment))
}

export function validatePath (path) {
  return parsePath(path) !== null
}

export function getByPath (obj, path) {
  const parts = parsePath(path)
  if (parts === null) return undefined
  let current = obj
  for (const key of parts) {
    if (current === null || current === undefined) return undefined
    const type = typeof current
    if ((type !== 'object' && type !== 'function') || !Object.hasOwn(current, key)) return undefined
    current = current[key]
  }
  return current
}

export function pickNumber (value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const text = value.trim()
    if (text === '') return null
    const number = Number(text)
    return Number.isFinite(number) ? number : null
  }
  return null
}

function parseSumPath (path) {
  if (typeof path !== 'string') return null
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return null
  const body = pathBody(path)
  if (body.length === 0 || !SUM_PATH_RE.test(body)) return null
  const parts = []
  const tokenRe = /[A-Za-z_$][\w$]*|\[\d*\]/g
  let match
  while ((match = tokenRe.exec(body)) !== null) {
    const token = match[0]
    if (token.startsWith('[')) {
      parts.push(token === '[]' ? WILDCARD : Number(token.slice(1, -1)))
    } else {
      parts.push(token)
    }
  }
  return parts
}

export function validateSumPath (path) {
  return parseSumPath(path) !== null
}

function collectValues (node, parts, index, out) {
  if (index >= parts.length) {
    out.push(node)
    return
  }
  if (node === null || node === undefined) return
  const part = parts[index]
  if (part === WILDCARD) {
    let items = null
    if (Array.isArray(node)) items = node
    else if (typeof node === 'object') items = Object.values(node)
    if (items === null) return
    for (const item of items) collectValues(item, parts, index + 1, out)
    return
  }
  if (typeof part === 'number') {
    if (Array.isArray(node)) {
      if (Object.hasOwn(node, part)) collectValues(node[part], parts, index + 1, out)
    } else if (typeof node === 'object' && Object.hasOwn(node, String(part))) {
      collectValues(node[String(part)], parts, index + 1, out)
    }
    return
  }
  if (typeof node === 'object' && Object.hasOwn(node, part)) {
    collectValues(node[part], parts, index + 1, out)
  }
}

// 支持 [] 通配的路径求和：命中数值（含数字字符串）累加；无命中返回 null。
export function sumByPath (obj, path) {
  const parts = parseSumPath(path)
  if (parts === null) return null
  const values = []
  collectValues(obj, parts, 0, values)
  let sum = 0
  let found = false
  for (const value of values) {
    const number = pickNumber(value)
    if (number === null) continue
    sum += number
    found = true
  }
  return found && Number.isFinite(sum) ? sum : null
}

// ---------- 算术表达式（v2.0） ----------
// 只允许「路径 + 路径 - 路径」，用于 订阅剩余 = 总量 - 已用、余额 = 现金 + 赠送。
// 路径本身不含 + / -，所以可以直接按符号切分；不使用 eval，避免注入。
const MAX_EXPRESSION_LENGTH = 512

function parseExpression (expression) {
  if (typeof expression !== 'string') return null
  const text = expression.trim()
  if (text === '' || text.length > MAX_EXPRESSION_LENGTH) return null
  const parts = []
  const ops = []
  let buffer = ''
  for (const char of text) {
    if (char === '+' || char === '-') {
      if (buffer.trim() === '') return null
      parts.push(buffer.trim())
      ops.push(char)
      buffer = ''
    } else {
      buffer += char
    }
  }
  if (buffer.trim() === '') return null
  parts.push(buffer.trim())
  return { parts, ops }
}

// 命中 + / - 的旧路径字段用这个判断走表达式分支。
export function isExpression (value) {
  return typeof value === 'string' && /[+-]/.test(value)
}

export function validateExpression (expression) {
  const parsed = parseExpression(expression)
  if (parsed === null) return false
  return parsed.parts.every((part) => validateSumPath(part))
}

// 求值：任一操作数取不到 → null（宁可该行不显示，也不显示错数）。
export function evalExpression (obj, expression) {
  const parsed = parseExpression(expression)
  if (parsed === null) return null
  for (const part of parsed.parts) {
    if (!validateSumPath(part)) return null
  }
  let total = null
  for (let index = 0; index < parsed.parts.length; index++) {
    const value = sumByPath(obj, parsed.parts[index])
    if (value === null) return null
    if (index === 0) total = value
    else total = parsed.ops[index - 1] === '+' ? total + value : total - value
  }
  return Number.isFinite(total) ? total : null
}
