// 安全基线：用测试锁住「零依赖 / 无安装脚本 / 无遥测 / 不读对话」这些承诺。
// 改 package.json 或插件清单时如果破坏承诺，这里会失败。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

async function readJson (name) {
  return JSON.parse(await fs.readFile(path.join(root, name), 'utf8'))
}

async function sourceFiles (dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await sourceFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

test('安全基线：零运行时依赖、无安装/发布脚本', async () => {
  const pkg = await readJson('package.json')
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    const value = pkg[field]
    assert.ok(value === undefined || Object.keys(value).length === 0, `${field} 必须为空`)
  }
  const scripts = pkg.scripts || {}
  // npm 会在安装/打包时自动执行这些钩子；本插件只允许显式运行的普通脚本。
  const installHooks = new Set([
    'preinstall', 'install', 'postinstall',
    'prepack', 'postpack', 'prepare',
    'prepublish', 'publish', 'postpublish',
    'preversion', 'version', 'postversion',
  ])
  for (const name of Object.keys(scripts)) {
    assert.ok(!installHooks.has(name), `不允许安装/发布钩子：${name}`)
  }
  assert.equal(scripts.test, 'node --test test/*.test.js')
})

test('安全基线：插件清单不申请对话/剪贴板等权限', async () => {
  const pkg = await readJson('package.json')
  const wants = pkg.dshGo && pkg.dshGo.wants
  assert.ok(wants === undefined || (Array.isArray(wants) && wants.length === 0), 'dshGo.wants 必须为空')
  assert.equal(pkg.license, 'MIT')
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('lib'), 'files 里必须有 lib')
  assert.ok(pkg.files.includes('SECURITY.md'), 'files 里必须带 SECURITY.md')
})

test('安全基线：源码里没有日志/子进程/eval/遥测', async () => {
  const files = await sourceFiles(path.join(root, 'lib'))
  assert.ok(files.length >= 8)
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8')
    const name = path.basename(file)
    assert.ok(!/\bconsole\s*\./.test(text), `${name} 不应有 console 日志`)
    assert.ok(!/child_process/.test(text), `${name} 不应启动子进程`)
    assert.ok(!/\beval\s*\(/.test(text), `${name} 不应使用 eval`)
    assert.ok(!/new\s+Function\s*\(/.test(text), `${name} 不应使用 new Function`)
    for (const marker of ['sentry', 'posthog', 'analytics', 'telemetry', 'umami', 'gtag']) {
      assert.ok(!text.toLowerCase().includes(marker), `${name} 不应包含 ${marker}`)
    }
  }
})

test('安全基线：取数层不硬编码任何地址，只请求调用方给的 URL', async () => {
  const text = await fs.readFile(path.join(root, 'lib', 'query.js'), 'utf8')
  assert.ok(text.includes('globalThis.fetch'))
  assert.ok(!/https?:\/\//.test(text), 'query.js 不应硬编码地址')
})

test('安全基线：文档里有安全说明与可验证的数据流向', async () => {
  const security = await fs.readFile(path.join(root, 'SECURITY.md'), 'utf8')
  for (const keyword of ['https', '跳转', '权限', '主机', '供应链']) {
    assert.ok(security.includes(keyword), `SECURITY.md 缺少「${keyword}」说明`)
  }
  const pkg = await readJson('package.json')
  assert.match(pkg.repository.url, /^https:\/\//)
})

test('https 强制的回环白名单只认精确本机地址', async () => {
  const { isSafeUrl, isLoopbackHost } = await import('../lib/url.js')
  assert.equal(isSafeUrl('https://api.example.com/x'), true)
  assert.equal(isSafeUrl('http://localhost:8080/x'), true)
  assert.equal(isSafeUrl('http://127.0.0.1:8080/x'), true)
  assert.equal(isSafeUrl('http://[::1]:8080/x'), true)
  // 不能把 *.localhost / 0.0.0.0 当成本机（是否真连本机取决于系统 resolver）
  assert.equal(isLoopbackHost('foo.localhost'), false)
  assert.equal(isSafeUrl('http://foo.localhost/x'), false)
  assert.equal(isLoopbackHost('0.0.0.0'), false)
  assert.equal(isSafeUrl('http://0.0.0.0/x'), false)
  assert.equal(isSafeUrl('http://localhost.evil.com/x'), false)
})

test('地址里的空白字符与内嵌凭据不能把请求伪装到别的域名', async () => {
  const { isSafeUrl, urlSafetyError, URL_CHARS_MESSAGE, URL_CREDENTIALS_MESSAGE } = await import('../lib/url.js')
  // WHATWG URL 会静默删掉 tab/换行，`https://a.com\n@evil.com` 真正连的是 evil.com。
  for (const disguised of [
    'https://a.com\n@evil.com',
    'https://a.com\r@evil.com',
    'https://a.com\t@evil.com',
    'https://a.com @evil.com',
    'https://a.com\u0000@evil.com',
  ]) {
    assert.equal(isSafeUrl(disguised), false, `必须拒绝：${JSON.stringify(disguised)}`)
    assert.equal(urlSafetyError(disguised), URL_CHARS_MESSAGE)
  }
  assert.equal(isSafeUrl('https://user:pw@a.com/x'), false)
  assert.equal(urlSafetyError('https://user:pw@a.com/x'), URL_CREDENTIALS_MESSAGE)
  // 正常地址与 URL 里的百分号编码不受影响
  assert.equal(urlSafetyError('https://a.com/x?q=a%20b'), '')
  assert.equal(isSafeUrl('https://a.com/x?q=a%20b'), true)
  assert.equal(isSafeUrl('http://127.0.0.1:8080/x'), true)
})
