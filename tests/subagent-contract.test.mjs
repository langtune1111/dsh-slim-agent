import test from 'node:test'
import assert from 'node:assert/strict'
import { detectSubagentApi, apply } from '../preset-core.mjs'

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

test('subagent: whenIdle 永不 resolve 时按 subagentWaitMs 放弃，不抛错也不占住信号量', async () => {
  const registered = []
  const ctx = {
    logger: { info() {}, warn() {} },
    tools: { register: (t) => { registered.push(t); return () => {} } },
    on() {},
    subagents: { startActivation: async () => ({ childId: 'child-1' }) },
    agents: { get: () => ({ whenIdle: () => new Promise(() => {}) }) }, // 永远不 idle
  }
  apply(ctx, { bash: 'off', subagentWaitMs: 80 })
  const tool = registered.find((t) => t.name === 'subagent')
  assert.ok(tool, 'subagent 必须注册')

  const guard = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('挂住了 ' + ms + 'ms')), ms))])
  const t0 = Date.now()
  const res = await guard(tool.execute({ task_description: 'a', expected_output: 'b' }, {}), 3000)
  const ms = Date.now() - t0
  assert.ok(ms < 2500, '应在 subagentWaitMs 附近返回，实测 ' + ms + 'ms')
  assert.match(String(res.report), /未在|放弃等待|超时/)

  // 信号量必须已释放：第二次调用不能因为第一次卡死而排队
  const t1 = Date.now()
  await guard(tool.execute({ task_description: 'c', expected_output: 'd' }, {}), 3000)
  assert.ok(Date.now() - t1 < 2500, '第二次调用被卡住 → 信号量没释放')
})
