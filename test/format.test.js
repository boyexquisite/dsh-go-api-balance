import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatAmount,
  formatClock,
  formatDateTime,
  formatDay,
  formatDetailValue,
  formatNumber,
  formatUsage,
  scaledAmount,
  symbolForCurrency,
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

// ---------- v2.0 币种 / 日期 / 明细 kind ----------

test('symbolForCurrency 映射常见币种，未知返回空串', () => {
  assert.equal(symbolForCurrency('CNY'), '¥')
  assert.equal(symbolForCurrency(' usd '), '$')
  assert.equal(symbolForCurrency('HKD'), 'HK$')
  assert.equal(symbolForCurrency('XYZ'), '')
  assert.equal(symbolForCurrency(''), '')
  assert.equal(symbolForCurrency(null), '')
})

test('formatDay 接受秒/毫秒，非法给 —', () => {
  const ms = new Date(2026, 0, 1, 8, 0, 0).getTime()
  assert.equal(formatDay(ms), '2026-01-01')
  assert.equal(formatDay(Math.floor(ms / 1000)), '2026-01-01')
  assert.equal(formatDay(0), '—')
  assert.equal(formatDay('abc'), '—')
})

test('formatDetailValue 按 kind 区分金额/计数/日期/文本', () => {
  const unit = { symbol: '¥', divisor: 1, multiplier: 1, decimals: 2 }
  assert.equal(formatDetailValue(unit, 1234.5, 'money'), '¥1,234.50')
  assert.equal(formatDetailValue({ ...unit, symbol: '' }, 1234.5, 'count'), '1,235')
  assert.equal(formatDetailValue(unit, 1767225600, 'date'), '2026-01-01')
  assert.equal(formatDetailValue(unit, 'pending', 'text'), 'pending')
  assert.equal(formatDetailValue(unit, null), '—')
  assert.equal(formatDetailValue(unit, '0.5'), '¥0.50')
})

test('formatDay 接受 ISO 字符串（订阅接口的 resetsAt）', () => {
  assert.equal(formatDay('2026-11-24T03:00:00.000Z'), '2026-11-24')
  assert.equal(formatDetailValue({ symbol: '%', divisor: 1, multiplier: 1, decimals: 0 }, '2026-11-24T03:00:00.000Z', 'date'), '2026-11-24')
  assert.equal(formatDay('not-a-date'), '—')
})

test('formatAmount：百分比符号后置', () => {
  assert.equal(formatAmount({ symbol: '%', decimals: 0, divisor: 1, multiplier: 1 }, 48), '48%')
  assert.equal(formatAmount({ symbol: '%', decimals: 1, divisor: 1, multiplier: 1 }, -3.25), '-3.3%')
})

test('formatNumber/formatAmount：>=1e21 不出 undefined，负零归一', () => {
  assert.equal(formatNumber(1e21, 2), '1.00e+21')
  assert.equal(formatNumber(-0.001, 2), '0.00')
  assert.equal(formatNumber(-0.004, 2), '0.00')
  assert.equal(formatAmount(provider(), 1e21), '¥1.00e+21')
  assert.equal(formatAmount(provider(), -0.001), '¥0.00')
  assert.equal(formatNumber(-1e21, 1), '-1.0e+21')
})

test('formatDay 认数字字符串 epoch（秒/毫秒）', () => {
  const at = new Date(2026, 10, 13, 9, 0, 0)
  assert.equal(formatDay(String(Math.floor(at.getTime() / 1000))), '2026-11-13')
  assert.equal(formatDay(String(at.getTime())), '2026-11-13')
  assert.equal(formatDay('2026-11-13T09:00:00+08:00'), '2026-11-13')
})
