import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evalExpression,
  getByPath,
  isExpression,
  pickNumber,
  validateExpression,
  validatePath,
  validateSumPath,
} from '../lib/extract.js'

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

// ---------- evalExpression 单路径 ----------

test('validateSumPath 接受 [] 通配，拒绝非法结构', () => {
  for (const path of [
    'data[].results[].amount.value',
    'data[0].results[].amount',
    'a[]',
    'data.quota',
    '$.data[].amount',
    'data[][0]',
  ]) {
    assert.equal(validateSumPath(path), true, path)
  }
  for (const path of ['', 'a[', 'a[]x', '[]', 'data[]..x', '0a', 'a[1.2]', null, 42]) {
    assert.equal(validateSumPath(path), false, String(path))
  }
})

test('evalExpression 无 [] 时等价单值', () => {
  const obj = { data: { quota: 12.5, text: '7', bad: 'x', nil: null } }
  assert.equal(evalExpression(obj, 'data.quota'), 12.5)
  assert.equal(evalExpression(obj, 'data.text'), 7)
  assert.equal(evalExpression(obj, 'data.bad'), null)
  assert.equal(evalExpression(obj, 'data.nil'), null)
  assert.equal(evalExpression(obj, 'data.missing'), null)
  assert.equal(evalExpression(obj, '$.data.quota'), 12.5)
})

test('evalExpression 支持嵌套 [] 通配求和（含数字字符串）', () => {
  const obj = {
    data: [
      { results: [{ amount: { value: 1 } }, { amount: { value: '2' } }] },
      { results: [{ amount: { value: 3.5 } }] },
      { results: [] },
    ],
  }
  assert.equal(evalExpression(obj, 'data[].results[].amount.value'), 6.5)
  assert.equal(evalExpression(obj, 'data[0].results[].amount.value'), 3)
  assert.equal(evalExpression(obj, 'data[1].results[0].amount.value'), 3.5)
})

test('evalExpression 跳过缺失/非数字项，全无数值返回 null', () => {
  const obj = {
    data: [
      { results: [{ amount: 2 }, { amount: 'abc' }, {}] },
      { results: [{ amount: '4' }] },
      {},
    ],
  }
  assert.equal(evalExpression(obj, 'data[].results[].amount'), 6)
  assert.equal(evalExpression(obj, 'data[].results[].missing'), null)
  assert.equal(evalExpression({ data: [] }, 'data[].amount'), null)
  assert.equal(evalExpression({ data: [{ amount: null }] }, 'data[].amount'), null)
})

test('内层 [] 为空数组时按 0 汇总（本月无调用），顶层空仍 null', () => {
  // 2026-11-27 全检 P2：OpenAI/Claude 花费为 0 的月份原来整行显示「—」。
  assert.equal(evalExpression({ data: [{ results: [] }] }, 'data[].results[].amount'), 0)
  assert.equal(evalExpression({ data: [{ results: [] }] }, 'data[].results[].missing'), 0)
  // 顶层就没有数据时不能冒充 0
  assert.equal(evalExpression({ data: [] }, 'data[].results[].amount'), null)
  assert.equal(evalExpression({}, 'data[].results[].amount'), null)
})

test('evalExpression 对 [] 通配对象取 values，另支持字符串键下标', () => {
  const obj = { data: { a: { v: 1 }, b: { v: 2 } } }
  assert.equal(evalExpression(obj, 'data[].v'), 3)
  assert.equal(evalExpression({ data: { 0: { v: 5 } } }, 'data[0].v'), 5)
})

test('evalExpression 空值/非法路径/异常输入不抛异常', () => {
  assert.equal(evalExpression({}, 'data[]'), null)
  assert.equal(evalExpression(null, 'a'), null)
  assert.equal(evalExpression(undefined, 'a'), null)
  assert.equal(evalExpression('text', 'a'), null)
  assert.equal(evalExpression([{ a: 1 }], 'a'), null)
  assert.equal(evalExpression({ a: 1 }, 'a b'), null)
  assert.equal(evalExpression({ a: 1 }, ''), null)
  assert.equal(evalExpression({ a: 0 }, 'a'), 0)
})

// ---------- v2.0 表达式 ----------

test('isExpression 只认带 + / - 的字段', () => {
  assert.equal(isExpression('a + b'), true)
  assert.equal(isExpression('a-b'), true)
  assert.equal(isExpression('data.balance'), false)
  assert.equal(isExpression(''), false)
  assert.equal(isExpression(undefined), false)
})

test('validateExpression 接受路径加减，拒绝乘除/空操作数', () => {
  assert.equal(validateExpression('data.a + data.b'), true)
  assert.equal(validateExpression('data.items[].total - data.items[].used'), true)
  assert.equal(validateExpression('a+b-c'), true)
  assert.equal(validateExpression('data.a'), true)
  assert.equal(validateExpression('data.a +'), false)
  assert.equal(validateExpression('+ data.a'), false)
  assert.equal(validateExpression('data.a * 2'), false)
  assert.equal(validateExpression(''), false)
  assert.equal(validateExpression('data.a b'), false)
})

test('evalExpression 求和/求差，数字字符串也认', () => {
  const obj = { data: { cash: '100.50', gift: '20', used: 5 } }
  assert.equal(evalExpression(obj, 'data.cash + data.gift'), 120.5)
  assert.equal(evalExpression(obj, 'data.cash - data.used'), 95.5)
  assert.equal(evalExpression({ subscriptions: [{ total: 100, used: 30 }, { total: 50, used: 20 }] }, 'subscriptions[].total - subscriptions[].used'), 100)
})

test('evalExpression 任一操作数取不到就给 null', () => {
  assert.equal(evalExpression({ data: { a: 1 } }, 'data.a + data.b'), null)
  assert.equal(evalExpression({ data: { a: 'x', b: 1 } }, 'data.a + data.b'), null)
  assert.equal(evalExpression({}, 'data.a - data.b'), null)
  assert.equal(evalExpression(null, 'data.a'), null)
  assert.equal(evalExpression({ data: { a: 1 } }, 'data.a * 2'), null)
})

test('evalExpression：连续 [] 通配的访问次数有预算，超了返回 null 不卡死', () => {
  // 每层 2 个元素、深 22 层：逐层展开是 2^22 ≈ 420 万次访问，预算会提前截断。
  let node = { v: 1 }
  for (let depth = 0; depth < 22; depth++) node = { left: node, right: node }
  const started = Date.now()
  assert.equal(evalExpression({ a: node }, 'a' + '[]'.repeat(22)), null)
  assert.ok(Date.now() - started < 2000, '不应耗时过久')
})

test('表达式里的多个 [] 操作数共享同一份访问预算', () => {
  const items = Array.from({ length: 60000 }, () => 1)
  const obj = { a: items }
  // 单个操作数在预算内
  assert.equal(evalExpression(obj, 'a[]'), 60000)
  // 两个操作数共享 10 万预算，总和超预算 → 整条表达式失败，不返回部分结果
  assert.equal(evalExpression(obj, 'a[] + a[]'), null)
})
