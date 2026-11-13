// 路径解析与数值提取：纯函数，不抛异常。
const MAX_PATH_LENGTH = 256
const PATH_RE = /^[A-Za-z_$][\w$]*(\[\d+\]|\.[A-Za-z_$][\w$]*)*$/

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
