import test from 'node:test'
import assert from 'node:assert/strict'
import { getByPath, validatePath, pickNumber } from '../lib/extract.js'

test('validatePath 接受点号与下标写法', () => {
  for (const path of [
    'data.quota',
    'balance_infos[0].total_balance',
    'a[1].b',
    'a[0][1]',
    '$.data.quota',
    '$.a[0].b',
    '_private',
    '$root',
  ]) {
    assert.equal(validatePath(path), true, path)
  }
})

test('validatePath 拒绝非法写法', () => {
  for (const path of [
    '',
    ' ',
    'a.',
    '.a',
    'a..b',
    'a[',
    'a[]',
    'a[-1]',
    'a[1.2]',
    'a b',
    '0abc',
    'a-b',
    'a/b',
    'a[0]b',
    'data.quota ',
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(validatePath(path), false, String(path))
  }
})

test('validatePath 空路径与超长路径都非法', () => {
  assert.equal(validatePath('$.'), false)
  assert.equal(validatePath('a'.repeat(256)), true)
  assert.equal(validatePath('a'.repeat(257)), false)
  assert.equal(validatePath('$.a'.repeat(100)), false)
})

test('getByPath 读取嵌套对象', () => {
  const data = { data: { quota: 12.5 }, plain: 'x' }
  assert.equal(getByPath(data, 'data.quota'), 12.5)
  assert.equal(getByPath(data, '$.data.quota'), 12.5)
  assert.equal(getByPath(data, 'plain'), 'x')
})

test('getByPath 读取数组下标', () => {
  const data = { balance_infos: [{ total_balance: '9.99' }, { total_balance: '1.00' }] }
  assert.equal(getByPath(data, 'balance_infos[0].total_balance'), '9.99')
  assert.equal(getByPath(data, 'balance_infos[1].total_balance'), '1.00')
  assert.equal(getByPath(data, 'balance_infos[2].total_balance'), undefined)
})

test('getByPath 命中 null 原样返回，未命中返回 undefined', () => {
  const data = { a: null, b: { c: undefined } }
  assert.equal(getByPath(data, 'a'), null)
  assert.equal(getByPath(data, 'missing'), undefined)
  assert.equal(getByPath(data, 'b.c'), undefined)
})

test('getByPath 对非法路径与奇怪根值不抛异常', () => {
  assert.equal(getByPath({ a: 1 }, ''), undefined)
  assert.equal(getByPath({ a: 1 }, 'a b'), undefined)
  assert.equal(getByPath(null, 'a'), undefined)
  assert.equal(getByPath(undefined, 'a'), undefined)
  assert.equal(getByPath('text', 'length'), undefined)
  assert.equal(getByPath(42, 'a'), undefined)
  assert.equal(getByPath({ a: 1 }, null), undefined)
})

test('getByPath 不读取原型链属性', () => {
  assert.equal(getByPath({}, 'constructor'), undefined)
  assert.equal(getByPath({}, '__proto__'), undefined)
  assert.equal(getByPath({ a: {} }, 'a.toString'), undefined)
})

test('pickNumber 接受有限数字与数字字符串', () => {
  assert.equal(pickNumber(12.5), 12.5)
  assert.equal(pickNumber(0), 0)
  assert.equal(pickNumber(-3), -3)
  assert.equal(pickNumber(' 12.5 '), 12.5)
  assert.equal(pickNumber('1e3'), 1000)
  assert.equal(pickNumber('0'), 0)
})

test('pickNumber 拒绝非数字值', () => {
  for (const value of ['', '   ', 'abc', '12abc', null, undefined, true, {}, [], NaN, Infinity, -Infinity]) {
    assert.equal(pickNumber(value), null, String(value))
  }
})
