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
