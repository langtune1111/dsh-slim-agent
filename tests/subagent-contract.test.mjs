import test from 'node:test'
import assert from 'node:assert/strict'
import { detectSubagentApi } from '../preset-core.mjs'

test('detectSubagentApi: 优先识别 startActivation，其次 start，都没有则 null', () => {
  assert.equal(detectSubagentApi({ startActivation() {} }), 'activation')
  assert.equal(detectSubagentApi({ start() {}, startActivation() {} }), 'activation')
  assert.equal(detectSubagentApi({ start() {} }), 'start')
  assert.equal(detectSubagentApi({}), null)
  assert.equal(detectSubagentApi(undefined), null)
  assert.equal(detectSubagentApi(null), null)
})

test('detectSubagentApi: 非函数属性不误判', () => {
  assert.equal(detectSubagentApi({ start: 'nope' }), null)
  assert.equal(detectSubagentApi({ startActivation: 42 }), null)
})