// URL 安全：带密钥的请求只允许 https；本机回环地址例外（手机本机引擎/本地反代用 http）。

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

export const HTTPS_ONLY_MESSAGE = '为了不让密钥明文上网，地址请用 https（本机 localhost 可用 http）'

export function isLoopbackHost (hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (host === '') return false
  if (LOOPBACK_HOSTS.has(host)) return true
  return host.endsWith('.localhost')
}

export function isSafeUrl (value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false
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
