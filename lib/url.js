// URL 安全：带密钥的请求只允许 https；本机回环地址例外（手机本机引擎/本地反代用 http）。

// 只精确匹配回环地址：不再放行 *.localhost / 0.0.0.0（后者是否真的连本机取决于系统）。
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export const HTTPS_ONLY_MESSAGE = '为了不让密钥明文上网，地址请用 https（本机 localhost 可用 http）'

// WHATWG URL 解析会静默删掉字符串里的 tab/换行：`https://a.com\n@evil.com` 会变成
// `https://a.com@evil.com`，真正连的是 evil.com；`https://a.com\t/x` 也一样。地址里的
// 空白必须当错误，不能“看着是 A 家、密钥发到 B 家”。
const UNSAFE_URL_CHARS = /[\s\u0000-\u001f\u007f]/
// URL 里带 user:pass@ 时用户看不出真正的主机（fetch 也不会用它们做认证），一并拒绝。
export const URL_CHARS_MESSAGE = '地址不能含空格、换行或制表符等空白字符'
export const URL_CREDENTIALS_MESSAGE = '地址不能包含用户名或密码（user:pass@）'

export function isLoopbackHost (hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (host === '') return false
  return LOOPBACK_HOSTS.has(host)
}

/** '' when usable, otherwise the message to show for a URL field. */
export function urlSafetyError (value) {
  if (typeof value !== 'string') return URL_CHARS_MESSAGE
  if (UNSAFE_URL_CHARS.test(value)) return URL_CHARS_MESSAGE
  let url
  try {
    url = new URL(value)
  } catch {
    return ''
  }
  if (url.username !== '' || url.password !== '') return URL_CREDENTIALS_MESSAGE
  return ''
}

export function isSafeUrl (value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false
  if (urlSafetyError(value) !== '') return false
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  if (url.protocol === 'http:') return isLoopbackHost(url.hostname)
  return false
}

export function isParsableHttpUrl (value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
