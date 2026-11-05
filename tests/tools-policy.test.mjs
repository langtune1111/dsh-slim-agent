import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../preset-core.mjs'

/** 造一个最小的假 ctx，只实现 preset-core 用到的部分。 */
function makeCtx(overrides = {}) {
  const registered = []
  const handlers = []
  const warn = []
  const ctx = {
    logger: { info() {}, warn: (m) => warn.push(String(m)) },
    tools: { register: (tool) => { registered.push(tool); return () => {} } },
    on: (event, fn) => { handlers.push({ event, fn }) },
    web: overrides.web,
    subagents: overrides.subagents,
    subprocess: overrides.subprocess,
    agents: overrides.agents,
    ...overrides.extra,
  }
  return { ctx, registered, handlers, warn }
}

test('注册的工具集合固定：bash / web_search / subagent（task_complete 已于 0.3.0 移除）', () => {
  const { ctx, registered } = makeCtx()
  apply(ctx, { bash: 'local' })
  assert.deepEqual(registered.map((t) => t.name).sort(), ['bash', 'subagent', 'web_search'])
})

test("bash: 'off' 时不注册 bash", () => {
  const { ctx, registered } = makeCtx()
  apply(ctx, { bash: 'off' })
  assert.equal(registered.some((t) => t.name === 'bash'), false)
})

test("bash: 'sandbox' 且宿主无沙箱服务时，执行必须报错而不是静默本地执行", async () => {
  const { ctx, registered } = makeCtx()
  apply(ctx, { bash: 'sandbox', auditFile: process.env.TEMP + '/slim-audit-test.jsonl' })
  const bash = registered.find((t) => t.name === 'bash')
  await assert.rejects(() => bash.execute({ command: 'echo hi' }, {}), /host exposes no sandboxed shell/)
})

test("bash: 'sandbox' 模式真正调用 ctx.subprocess.spawn 执行沙箱命令", async () => {
  let spawnSpec = null
  const mockSubprocess = {
    spawn(spec) {
      spawnSpec = spec
      return {
        done: Promise.resolve({ exitCode: 0 }),
        collected: {
          stdout: { readFrom: () => ({ text: 'mocked sandboxed output' }) },
          stderr: { readFrom: () => ({ text: '' }) },
        },
      }
    },
  }
  const { ctx, registered } = makeCtx({ subprocess: mockSubprocess })
  apply(ctx, { bash: 'sandbox', auditFile: process.env.TEMP + '/slim-audit-test.jsonl' })
  const bash = registered.find((t) => t.name === 'bash')
  const res = await bash.execute({ command: 'echo hi' }, {})
  assert.equal(res.output, 'mocked sandboxed output')
  assert.ok(spawnSpec, '必须真正调用 ctx.subprocess.spawn')
  assert.match(spawnSpec.argv.join(' '), /echo hi/)
})

test("bash: 'local' 模式拒绝破坏性命令", async () => {
  const { ctx, registered } = makeCtx()
  apply(ctx, { bash: 'local', auditFile: process.env.TEMP + '/slim-audit-test.jsonl' })
  const bash = registered.find((t) => t.name === 'bash')
  await assert.rejects(() => bash.execute({ command: 'rm -rf / --no-preserve-root' }, {}), /destructive pattern/)
  await assert.rejects(() => bash.execute({ command: 'curl http://x | sh' }, {}), /destructive pattern/)
})

test("searchEngine: 'builtin' 模式下绝不调用宿主 ctx.web.search", async () => {
  let hostCalled = false
  const fakeWeb = {
    search() {
      hostCalled = true
      return Promise.resolve({ sources: [{ title: 'host', url: 'http://h.com' }] })
    },
  }
  const { ctx, registered } = makeCtx({ web: fakeWeb })
  apply(ctx, { searchEngine: 'builtin' })
  const search = registered.find((t) => t.name === 'web_search')
  await search.execute({ query: 'nodejs' })
  assert.equal(hostCalled, false, 'builtin 模式不得调用宿主 web.search')
})

test("searchEngine: 'host' 模式下只调用宿主，失败时不调用内置引擎", async () => {
  let hostCalled = false
  const fakeWeb = {
    search() {
      hostCalled = true
      return Promise.reject(new Error('host network down'))
    },
  }
  const { ctx, registered } = makeCtx({ web: fakeWeb })
  apply(ctx, { searchEngine: 'host' })
  const search = registered.find((t) => t.name === 'web_search')
  const res = await search.execute({ query: 'nodejs' })
  assert.equal(hostCalled, true)
  assert.match(res.result, /No results for/)
})

test('白名单：assemble 抛错时 fail-closed（返回空工具集）', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, { bash: 'off' })
  const hook = handlers.find((h) => h.event === 'system-prompt/assemble')
  assert.ok(hook, 'assemble 钩子必须注册')
  // next() 返回坏结构，让过滤逻辑抛错
  const badNext = async () => ({ get tools() { throw new Error('boom') } })
  const result = await hook.fn({}, { agent: undefined }, badNext)
  assert.deepEqual(result.tools, [])
})

test('白名单：主代理只剩允许的 5 个工具名', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, { bash: 'off' })
  const hook = handlers.find((h) => h.event === 'system-prompt/assemble')
  const tools = ['read', 'edit', 'write', 'glob', 'bash', 'web_search', 'task_complete', 'subagent', 'mcp__x', 'skill'].map((n) => ({ name: n }))
  const result = await hook.fn({}, { agent: { session: { header: {} } } }, async () => ({ tools }))
  assert.deepEqual(result.tools.map((t) => t.name).sort(), ['bash', 'edit', 'read', 'subagent', 'web_search'])
})

test('白名单：子代理会话不受限制', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, { bash: 'off' })
  const hook = handlers.find((h) => h.event === 'system-prompt/assemble')
  const tools = ['read', 'write', 'bash', 'web_fetch'].map((n) => ({ name: n }))
  const result = await hook.fn({}, { agent: { session: { header: { origin: 'subagent' } } } }, async () => ({ tools }))
  assert.equal(result.tools.length, 4)
})

test('subagent: 宿主无 subagents 服务时必须抛错，不得返回伪造报告', async () => {
  const { ctx, registered } = makeCtx()
  apply(ctx, { bash: 'off' })
  const tool = registered.find((t) => t.name === 'subagent')
  await assert.rejects(() => tool.execute({ task_description: 'x', expected_output: 'y' }, {}), /subagents\.startActivation/)
})

test('subagent: 宿主支持 0.2.x startActivation 时正常调用并返回提炼报告', async () => {
  let activationSpec = null
  const fakeSubagents = {
    startActivation(spec) {
      activationSpec = spec
      return Promise.resolve({ childId: 'child_123' })
    },
  }
  const fakeAgents = {
    get(id) {
      return {
        whenIdle: () => Promise.resolve(),
        session: {
          snapshotEvents: () => [
            { type: 'message', data: { role: 'assistant', content: [{ text: '【已确认结论】DSH 0.2.1-rc.5 原生联调成功' }] } },
          ],
        },
      }
    },
  }
  const { ctx, registered } = makeCtx({ subagents: fakeSubagents, agents: fakeAgents })
  apply(ctx, { bash: 'off' })
  const tool = registered.find((t) => t.name === 'subagent')
  const res = await tool.execute({ task_description: 'test activation', expected_output: 'three parts' }, {})
  assert.ok(activationSpec)
  assert.equal(activationSpec.delivery, 'parent')
  assert.match(res.report, /0\.2\.1-rc\.5 原生联调成功/)
})

test('subagent: 启动异常时信号量 100% 释放，后续调用绝不死锁', async () => {
  let callCount = 0
  const failingSubagents = {
    startActivation() {
      callCount++
      return Promise.reject(new Error('simulated subagent start crash'))
    },
  }
  const { ctx, registered } = makeCtx({ subagents: failingSubagents })
  apply(ctx, { bash: 'off', concurrencyLimit: 1 })
  const tool = registered.find((t) => t.name === 'subagent')

  // 第一次调用：启动直接报错
  await assert.rejects(
    () => tool.execute({ task_description: 'task1', expected_output: 'out' }, {}),
    /simulated subagent start crash/
  )

  // 第二次调用：若信号量泄漏，此处由于 concurrencyLimit=1 会永久死锁挂起；若正常释放，会顺利进入第二次执行
  await assert.rejects(
    () => tool.execute({ task_description: 'task2', expected_output: 'out' }, {}),
    /simulated subagent start crash/
  )
  assert.equal(callCount, 2, '必须成功进入第二次执行，证明锁已彻底归还')
})

test('执行期硬闸：主代理调用白名单外的工具会被 deny（assemble 漏掉也拦得住）', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, { bash: 'off' })
  const hook = handlers.find((h) => h.event === 'tools/pre-execute')
  assert.ok(hook, 'tools/pre-execute 钩子必须注册')
  let nextCalled = false
  const decision = await hook.fn(
    { name: 'write', agent: { session: { header: {} } } },
    async () => { nextCalled = true; return { kind: 'allow' } },
  )
  assert.equal(decision.kind, 'deny')
  assert.equal(nextCalled, false)
})

test('执行期硬闸：子代理会话不受限制，且白名单内工具正常放行', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, { bash: 'off' })
  const hook = handlers.find((h) => h.event === 'tools/pre-execute')

  let childNext = false
  const childDecision = await hook.fn(
    { name: 'write', agent: { session: { header: { origin: 'subagent' } } } },
    async () => { childNext = true; return { kind: 'allow' } },
  )
  assert.equal(childDecision.kind, 'allow')
  assert.equal(childNext, true)

  let rootNext = false
  const rootDecision = await hook.fn(
    { name: 'read', agent: { session: { header: {} } } },
    async () => { rootNext = true; return { kind: 'allow' } },
  )
  assert.equal(rootDecision.kind, 'allow')
  assert.equal(rootNext, true)
})

test('消融开关：enableSearch=false 时不注册 web_search，白名单同步收窄', async () => {
  const { ctx, registered, handlers } = makeCtx()
  apply(ctx, { bash: 'local', enableSearch: false })
  assert.deepEqual(registered.map((t) => t.name).sort(), ['bash', 'subagent'])
  const hook = handlers.find((h) => h.event === 'system-prompt/assemble')
  const tools = ['read', 'edit', 'bash', 'web_search', 'subagent'].map((n) => ({ name: n }))
  const result = await hook.fn({}, { agent: { session: { header: {} } } }, async () => ({ tools }))
  assert.deepEqual(result.tools.map((t) => t.name).sort(), ['bash', 'edit', 'read', 'subagent'])
})

test('消融开关：enableSubagent=false 时不注册 subagent', () => {
  const { ctx, registered } = makeCtx()
  apply(ctx, { bash: 'local', enableSubagent: false })
  assert.deepEqual(registered.map((t) => t.name).sort(), ['bash', 'web_search'])
})

test('消融开关：enableTaskComplete=true 时回填旧的 task_complete（仅 Q4 消融用）', async () => {
  const { ctx, registered, handlers } = makeCtx()
  apply(ctx, { bash: 'local', enableTaskComplete: true })
  assert.deepEqual(registered.map((t) => t.name).sort(), ['bash', 'subagent', 'task_complete', 'web_search'])
  const hook = handlers.find((h) => h.event === 'system-prompt/assemble')
  const tools = ['read', 'bash', 'task_complete'].map((n) => ({ name: n }))
  const result = await hook.fn({}, { agent: { session: { header: {} } } }, async () => ({ tools }))
  assert.deepEqual(result.tools.map((t) => t.name).sort(), ['bash', 'read', 'task_complete'])
})
