import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatAmount,
  formatClock,
  formatDateTime,
  formatDetailValue,
  formatNumber,
  formatStripText,
  formatUsage,
  redactPreview,
  scaledAmount,
  STRIP_MAX_CHARS,
} from '../lib/format.js'

function provider (overrides = {}) {
  return { symbol: '¥', decimals: 2, divisor: 1, multiplier: 1, ...overrides }
}

test('formatAmount: 千分位与固定小数位', () => {
  assert.equal(formatAmount(provider(), 1234.5), '¥1,234.50')
  assert.equal(formatAmount(provider(), 1234567.891), '¥1,234,567.89')
  assert.equal(formatAmount(provider({ decimals: 0 }), 1234.6), '¥1,235')
  assert.equal(formatAmount(provider({ decimals: 4 }), 1), '¥1.0000')
  assert.equal(formatAmount(provider(), 0), '¥0.00')
})

test('formatAmount: 符号、负号、空符号', () => {
  assert.equal(formatAmount(provider({ symbol: '' }), 1234.5), '1,234.50')
  assert.equal(formatAmount(provider({ symbol: '$' }), 99), '$99.00')
  assert.equal(formatAmount(provider(), -1234.5), '-¥1,234.50')
  assert.equal(formatAmount(provider({ symbol: '€', decimals: 1 }), -5), '-€5.0')
})

test('formatAmount: 非有限值统一给破折号', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, 'abc', '']) {
    assert.equal(formatAmount(provider(), value), '—')
  }
})

test('formatAmount: 按 divisor / multiplier 换算', () => {
  assert.equal(formatAmount(provider({ divisor: 500000, symbol: '' }), 1000000), '2.00')
  assert.equal(formatAmount(provider({ multiplier: 2, decimals: 2 }), 3), '¥6.00')
  assert.equal(formatAmount(provider({ divisor: 0 }), 10), '¥10.00', '非法除数按 1')
  assert.equal(scaledAmount(provider({ divisor: 500000, multiplier: 2 }), 500000), 2)
  assert.equal(scaledAmount(provider(), 'abc'), null)
})

test('formatNumber: 独立数字格式化', () => {
  assert.equal(formatNumber(1234.5, 2), '1,234.50')
  assert.equal(formatNumber(1234.5, 0), '1,235')
  assert.equal(formatNumber(999, 1), '999.0')
  assert.equal(formatNumber(NaN), '—')
})

test('formatDetailValue: 数字换算、字符串原样、空值破折号', () => {
  assert.equal(formatDetailValue(provider(), 12.3), '¥12.30')
  assert.equal(formatDetailValue(provider({ divisor: 1000 }), 5000), '¥5.00')
  assert.equal(formatDetailValue(provider(), 'CNY'), 'CNY')
  assert.equal(formatDetailValue(provider(), null), '—')
  assert.equal(formatDetailValue(provider(), undefined), '—')
})

test('时间：当天只给 HH:mm，跨天带月日', () => {
  const morning = new Date(2026, 0, 2, 9, 12, 30).getTime()
  assert.equal(formatClock(morning), '09:12')
  assert.equal(formatDateTime(morning, new Date(2026, 0, 2, 18, 0)), '09:12')
  assert.equal(formatDateTime(morning, new Date(2026, 0, 3, 0, 0)), '01-02 09:12')
  assert.equal(formatClock(0), '—')
  assert.equal(formatClock('nope'), '—')
  assert.equal(formatDateTime(null), '—')
})

test('状态条：中文 / 英文 / 上限 / 关闭 / 无结果', () => {
  const providers = [
    { id: 'a', enabled: true },
    { id: 'b', enabled: true },
    { id: 'c', enabled: false },
  ]
  const results = {
    a: { ok: true, balance: 1000, symbol: '¥', decimals: 2 },
    b: { ok: true, balance: 234, symbol: '¥', decimals: 2 },
  }
  const zh = formatStripText(providers, results, { locale: 'zh-CN' })
  assert.ok(zh.startsWith('余额 ¥'), zh)
  assert.ok(zh.includes('2 家'), zh)
  assert.ok([...zh].length <= STRIP_MAX_CHARS, zh)

  const en = formatStripText(providers, results, { locale: 'en-US' })
  assert.ok(en.startsWith('Balance ¥'), en)
  assert.ok([...en].length <= STRIP_MAX_CHARS, en)

  assert.equal(formatStripText(providers, results, { stripEnabled: false }), '')
  assert.equal(formatStripText([], results), '')
  assert.equal(formatStripText(providers, { a: { ok: false } }), '')
  assert.equal(formatStripText(providers, {}), '')
})

test('状态条：大额自动压缩，仍不超过 24 字', () => {
  const providers = [{ id: 'a', enabled: true }]
  for (const locale of ['zh-CN', 'en-US']) {
    for (const balance of [1234567890123, 999999999999999, 12345.67]) {
      const text = formatStripText(providers, {
        a: { ok: true, balance, symbol: '¥', decimals: 2 },
      }, { locale })
      assert.ok([...text].length <= STRIP_MAX_CHARS, `${locale} ${text}`)
      assert.ok(text !== '', `${locale} ${balance}`)
    }
  }
})

test('redactPreview: 密钥、用户名、Bearer 与常见字段脱敏', () => {
  const secret = 'sk-abcdef123456'
  const p = { secret, username: 'aliceuser' }
  const raw = JSON.stringify({
    key: secret,
    user: 'aliceuser',
    auth: `Bearer ${'tok'.repeat(10)}`,
    access_token: 'another-secret-value',
    ok: true,
  })
  const cleaned = redactPreview(raw, p)
  assert.ok(!cleaned.includes(secret), cleaned)
  assert.ok(!cleaned.includes('aliceuser'), cleaned)
  assert.ok(!cleaned.includes('tok'.repeat(10)), cleaned)
  assert.ok(!cleaned.includes('another-secret-value'), cleaned)
  assert.ok(cleaned.includes('••••'), cleaned)
  assert.ok(cleaned.includes('"ok":true'), cleaned)
})

test('redactPreview: 空值、非字符串、超长截断', () => {
  assert.equal(redactPreview('', { secret: 'x' }), '')
  assert.equal(redactPreview(null, { secret: 'x' }), '')
  assert.equal(redactPreview(123, { secret: 'x' }), '')
  const long = redactPreview('a'.repeat(9000), {})
  assert.equal(long.length, 8000)
  assert.equal(redactPreview('plain', { secret: '' }), 'plain')
})


test('formatUsage: 原始计数用万/亿与千分位（中文）', () => {
  const provider = { usageScale: false }
  assert.equal(formatUsage(provider, { label: '请求', value: 6837 }, 'zh-CN'), '6,837')
  assert.equal(formatUsage(provider, { label: '请求', value: 999 }), '999')
  assert.equal(formatUsage(provider, { label: '请求', value: 0 }), '0')
  assert.equal(formatUsage(provider, { label: '请求', value: 9999 }), '9,999')
  assert.equal(formatUsage(provider, { label: 'Token', value: 10000 }), '1万')
  assert.equal(formatUsage(provider, { label: 'Token', value: 12345 }), '1.2万')
  assert.equal(formatUsage(provider, { label: 'Token', value: 1234567 }), '123.5万')
  assert.equal(formatUsage(provider, { label: 'Token', value: 100000000 }), '1亿')
  assert.equal(formatUsage(provider, { label: 'Token', value: 1554060713 }), '15.5亿')
})

test('formatUsage: 英文用 B/M/K', () => {
  const provider = { usageScale: false }
  assert.equal(formatUsage(provider, { value: 6837 }, 'en-US'), '6.8K')
  assert.equal(formatUsage(provider, { value: 999 }, 'en-US'), '999')
  assert.equal(formatUsage(provider, { value: 1000 }, 'en-US'), '1K')
  assert.equal(formatUsage(provider, { value: 2000000 }, 'en-US'), '2M')
  assert.equal(formatUsage(provider, { value: 1234567 }, 'en-US'), '1.2M')
  assert.equal(formatUsage(provider, { value: 1554060713 }, 'en-US'), '1.6B')
})

test('formatUsage: usageScale 时按余额单位格式化', () => {
  const scaled = { usageScale: true, symbol: '¥', decimals: 2, divisor: 500000, multiplier: 1 }
  assert.equal(formatUsage(scaled, { label: '额度', value: 1000000 }, 'zh-CN'), '¥2.00')
  const raw = { usageScale: false, symbol: '¥', decimals: 2, divisor: 500000, multiplier: 1 }
  assert.equal(formatUsage(raw, { label: '额度', value: 1000000 }, 'zh-CN'), '100万')
  assert.equal(formatUsage({ usageScale: true, symbol: '$', decimals: 1 }, 5, 'en-US'), '$5.0')
})

test('formatUsage: 非有限值与裸数字字段', () => {
  assert.equal(formatUsage({}, { value: null }), '—')
  assert.equal(formatUsage({}, { value: 'abc' }), '—')
  assert.equal(formatUsage({}, NaN), '—')
  assert.equal(formatUsage({}, 1234), '1,234')
})
