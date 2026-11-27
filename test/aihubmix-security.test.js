import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStore } from '../lib/index.js'
import { configPath, loadConfig, saveConfig, saveResults, loadResults, resultsPath } from '../lib/config.js'
import { presetDraft } from '../lib/presets.js'
import { providerForm, FORM_LIMITS } from '../lib/view.js'

async function homeFor (t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'balance-isolated-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  return home
}
const event = (values) => ({ locale: 'zh-CN', value: { values } })
const response = () => new Response(JSON.stringify({ success: true, data: { quota: 1, used_quota: 0, request_count: 0 } }), { status: 200 })

test('AIHubMix saves and refreshes only the chosen proxy, and protects key on new origin', async (t) => {
  const home = await homeFor(t)
  const calls = []
  const store = createStore({ home, fetchImpl: async (url, init) => { calls.push({ url, init }); return response() } })
  await store.ensureReady()
  await store.actions.add({}, {})
  await store.actions['choose-template']({}, { value: { preset: 'aihubmix' } })
  let effects = await store.actions.save({}, event({ 'data.form.url': 'https://proxy-a.example.test/precise', 'data.form.secret': 'FAKE-key-A' }))
  assert.equal(effects.at(-1).text, '已保存')
  let saved = (await loadConfig(configPath(home))).providers[0]
  assert.equal(saved.url, 'https://proxy-a.example.test/precise')
  await store.actions.refresh({}, {}).result(new AbortController().signal)
  assert.ok(calls.length > 0)
  assert.ok(calls.every(({ url }) => url === 'https://proxy-a.example.test/precise'))
  await store.actions['card-edit']({}, { value: { id: saved.id } })
  effects = await store.actions.save({}, event({ 'data.form.url': 'https://proxy-b.example.test/precise', 'data.form.secret': '' }))
  assert.equal(effects.at(-1).text, '换了站点或平台，请重新填密钥')
  assert.equal((await loadConfig(configPath(home))).providers[0].url, saved.url)
  effects = await store.actions.save({}, event({ 'data.form.url': 'https://proxy-b.example.test/precise', 'data.form.secret': 'FAKE-key-B' }))
  assert.equal(effects.at(-1).text, '已保存')
  saved = (await loadConfig(configPath(home))).providers[0]
  assert.equal(saved.url, 'https://proxy-b.example.test/precise')
  assert.equal(saved.secret, 'FAKE-key-B')
  await store.actions.refresh({}, {}).result(new AbortController().signal)
  const newCalls = calls.filter(({ url }) => url.includes('proxy-b'))
  assert.ok(newCalls.length > 0)
  assert.ok(newCalls.every(({ init }) => JSON.stringify(init).includes('FAKE-key-B') && !JSON.stringify(init).includes('FAKE-key-A')))
})

test('AIHubMix edit warns when the visible URL is clipped', () => {
  const url = `https://proxy.example.test/${'a'.repeat(FORM_LIMITS.url + 10)}`
  const form = providerForm({ ...presetDraft('aihubmix'), url })
  assert.equal([...form.url].length, FORM_LIMITS.url)
  assert.equal(form.clipped, true)
})

test('AIHubMix empty or invalid URL cannot silently fall back', async (t) => {
  const home = await homeFor(t)
  const calls = []
  const store = createStore({ home, fetchImpl: async (url) => { calls.push(url); return response() } })
  await store.ensureReady()
  await store.actions.add({}, {})
  await store.actions['choose-template']({}, { value: { preset: 'aihubmix' } })
  for (const url of ['', 'not-a-url', 'http://remote.example.test/path']) {
    const effects = await store.actions.save({}, event({ 'data.form.url': url, 'data.form.secret': 'FAKE-key' }))
    assert.notEqual(Array.isArray(effects) ? effects.at(-1).text : effects.text, '已保存')
  }
  assert.equal((await loadConfig(configPath(home))).providers.length, 0)
  assert.deepEqual(calls, [])
})

test('pending old result write cannot overwrite save invalidation', async (t) => {
  const home = await homeFor(t)
  const provider = { ...presetDraft('aihubmix'), id: 'p_testabcd', secret: 'FAKE-old', enriched: true }
  await saveConfig({ v: 1, providers: [provider], settings: { refreshOnOpen: false, timeoutMs: 12000 } }, configPath(home))
  let releaseWrite, signalStarted
  const blocked = new Promise((resolve) => { releaseWrite = resolve })
  const started = new Promise((resolve) => { signalStarted = resolve })
  let writes = 0
  const store = createStore({ home, fetchImpl: async () => response(), writeResults: async (data, file) => {
    if (++writes === 1) { signalStarted(); await blocked }
    await saveResults(data, file)
  } })
  await store.ensureReady()
  const refresh = store.actions.refresh({}, {}).result(new AbortController().signal)
  await started
  await store.actions['card-edit']({}, { value: { id: provider.id } })
  const saving = store.actions.save({}, event({ 'data.form.enabled': false }))
  releaseWrite()
  await Promise.all([refresh, saving])
  const results = await loadResults(resultsPath(home))
  assert.equal(results.results[provider.id], undefined)
  assert.ok(writes >= 2)
})

test('extra GET origin cannot authorize moving a secret POST body there', async (t) => {
  const home = await homeFor(t)
  const provider = { ...presetDraft('deepseek'), id: 'p_testabcd', preset: 'custom', url: 'https://a.example.test/balance', method: 'POST', secret: 'FAKE-old', bodyText: '{"password":"FAKE-body"}', extraUrl: 'https://b.example.test/extra', extraFields: [{ label: 'extra', path: 'data.value' }], enriched: true }
  await saveConfig({ v: 1, providers: [provider], settings: { refreshOnOpen: false, timeoutMs: 12000 } }, configPath(home))
  const calls = []
  const store = createStore({ home, fetchImpl: async (url, init) => { calls.push({ url, init }); return response() } })
  await store.ensureReady()
  await store.actions['card-edit']({}, { value: { id: provider.id } })
  const changes = { 'data.form.url': 'https://b.example.test/balance', 'data.form.extraUrl': '', 'data.form.extraFieldsText': '', 'data.form.secret': 'FAKE-new' }
  let effects = await store.actions.save({}, event(changes))
  assert.match(effects.at(-1).text, /清空/)
  assert.equal((await loadConfig(configPath(home))).providers[0].url, provider.url)
  effects = await store.actions.save({}, event({ ...changes, 'data.form.bodyText': '' }))
  assert.equal(effects.at(-1).text, '已保存')
  await store.actions.refresh({}, {}).result(new AbortController().signal)
  const newCalls = calls.filter(({ url }) => url === 'https://b.example.test/balance')
  assert.ok(newCalls.length > 0)
  assert.ok(newCalls.every(({ init }) => !JSON.stringify(init).includes('FAKE-body')))
})

test('enabling POST cannot send a previously unused stored body implicitly', async (t) => {
  const home = await homeFor(t)
  const provider = { ...presetDraft('deepseek'), id: 'p_testabcd', preset: 'custom', url: 'https://a.example.test/balance', method: 'GET', secret: 'FAKE-old', bodyText: '{"password":"FAKE-body"}', enriched: true }
  await saveConfig({ v: 1, providers: [provider], settings: { refreshOnOpen: false, timeoutMs: 12000 } }, configPath(home))
  const store = createStore({ home, fetchImpl: async () => response() })
  await store.ensureReady()
  await store.actions['card-edit']({}, { value: { id: provider.id } })
  const effects = await store.actions.save({}, event({ 'data.form.method': 'POST' }))
  assert.match(effects.at(-1).text, /清空/)
  assert.equal((await loadConfig(configPath(home))).providers[0].method, 'GET')
})

test('custom headers and body cannot follow a new origin even with a new secret', async (t) => {
  const home = await homeFor(t)
  const provider = { ...presetDraft('deepseek'), id: 'p_testabcd', preset: 'custom', url: 'https://old.example.test/balance', secret: 'FAKE-old', headersText: '{"X-Key":"FAKE-header"}', bodyText: '{"key":"FAKE-body"}', enriched: true }
  await saveConfig({ v: 1, providers: [provider], settings: { refreshOnOpen: false, timeoutMs: 12000 } }, configPath(home))
  const calls = []
  const store = createStore({ home, fetchImpl: async (url, init) => { calls.push({ url, init }); return response() } })
  await store.ensureReady()
  await store.actions['card-edit']({}, { value: { id: provider.id } })
  let effects = await store.actions.save({}, event({ 'data.form.url': 'https://new.example.test/balance', 'data.form.secret': 'FAKE-new' }))
  assert.match(effects.at(-1).text, /清空/)
  assert.equal(store.state.form.secret, '', 'rejected input must not remain in form state')
  assert.equal((await loadConfig(configPath(home))).providers[0].url, provider.url)
  effects = await store.actions.save({}, event({ 'data.form.url': 'https://new.example.test/balance', 'data.form.secret': 'FAKE-new', 'data.form.headersText': '', 'data.form.bodyText': '' }))
  assert.equal(effects.at(-1).text, '已保存')
  const saved = (await loadConfig(configPath(home))).providers[0]
  assert.equal(saved.headersText, '')
  assert.equal(saved.bodyText, '')
  await store.actions.refresh({}, {}).result(new AbortController().signal)
  const newCalls = calls.filter(({ url }) => url.includes('new.example.test'))
  assert.ok(newCalls.length > 0)
  assert.ok(newCalls.every(({ init }) => !/FAKE-header|FAKE-body|FAKE-old/.test(JSON.stringify(init))))
})
