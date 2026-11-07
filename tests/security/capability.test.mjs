import test from 'node:test'
import assert from 'node:assert/strict'

import { createGrantStore } from '../../src/security/capability/store.mjs'
import { createGuard, sessionInfoOf } from '../../src/security/index.mjs'
import { evaluate, REASON } from '../../src/security/policy/engine.mjs'
import { validatePolicy } from '../../src/security/policy/schema.mjs'
import { loadDefaultPolicy } from '../../src/security/index.mjs'

const NOW = 1_800_000_000_000
const clock = () => NOW

function baseSpec (over = {}) {
  return {
    taskId: 'task-1',
    sessionId: 'main',
    allowTools: ['read', 'bash', 'web_search'],
    allowPaths: ['/workspace'],
    network: 'allowlist',
    shell: 'workspace',
    maxToolCalls: 10,
    ttlSeconds: 60,
    delegable: { tools: ['read'], maxDepth: 1, maxToolCalls: 4 },
    ...over
  }
}

test('store: 授予后可读回，并带默认值', () => {
  const s = createGrantStore({ now: clock })
  const g = s.grant(baseSpec())
  assert.equal(g.usedCalls, 0)
  assert.equal(g.expiresAt, NOW + 60_000)
  assert.deepEqual(s.get('main').allowTools, ['read', 'bash', 'web_search'])
})

test('store: consume 扣预算，remaining 不落负', () => {
  const s = createGrantStore({ now: clock })
  s.grant(baseSpec({ maxToolCalls: 2 }))
  assert.equal(s.remaining('main'), 2)
  s.consume('main')
  assert.equal(s.remaining('main'), 1)
  s.consume('main')
  s.consume('main')
  assert.equal(s.remaining('main'), 0)
  assert.equal(s.get('main').usedCalls, 3)
})

test('store: revoke 后不再有授权', () => {
  const s = createGrantStore({ now: clock })
  s.grant(baseSpec())
  assert.ok(s.get('main'))
  assert.equal(s.revoke('main'), true)
  assert.equal(s.get('main'), null)
})

test('store: 子授权只能取交集，且网络/shell 降级', () => {
  const s = createGrantStore({ now: clock })
  s.grant(baseSpec())
  const child = s.deriveChild('main', 'child-1', { depth: 1 })
  assert.deepEqual(child.allowTools, ['read'])
  assert.equal(child.network, 'none')
  assert.equal(child.shell, 'none')
  assert.ok(child.maxToolCalls <= 4)
  assert.equal(child.expiresAt, s.get('main').expiresAt)
})

test('store: 子授权不继承父的可委派能力（不能再往下派）', () => {
  const s = createGrantStore({ now: clock })
  s.grant(baseSpec())
  const child = s.deriveChild('main', 'child-1', { depth: 1 })
  assert.deepEqual(child.delegable.tools, [])
  assert.equal(child.delegable.maxDepth, 0)
})

test('store: 深度超出可委派上限直接抛错', () => {
  const s = createGrantStore({ now: clock })
  s.grant(baseSpec({ delegable: { tools: ['read'], maxDepth: 1, maxToolCalls: 4 } }))
  assert.throws(() => s.deriveChild('main', 'grandchild', { depth: 2 }), /exceeds delegable.maxDepth/)
})

test('store: 父授权不存在时派生失败', () => {
  const s = createGrantStore({ now: clock })
  assert.throws(() => s.deriveChild('nope', 'child'), /parent grant not found/)
})

test('store: 子授权预算不超过父的剩余额度', () => {
  const s = createGrantStore({ now: clock })
  s.grant(baseSpec({ maxToolCalls: 10, delegable: { tools: ['read'], maxDepth: 1, maxToolCalls: 100 } }))
  for (let i = 0; i < 8; i++) s.consume('main')
  const child = s.deriveChild('main', 'child-1', { depth: 1 })
  assert.ok(child.maxToolCalls <= 2, 'child budget must not exceed parent remaining')
})

test('engine: 子代理即使拿到工具，也不能用父的网络能力', () => {
  const p = validatePolicy({ ...loadDefaultPolicy(), egress: { allowedHosts: ['api.example.com'], denyShellNetworkVerbs: ['curl'], taintedPayloadPolicy: 'deny' } })
  const s = createGrantStore({ now: clock })
  s.grant(baseSpec())
  const child = s.deriveChild('main', 'child-1', { depth: 1 })
  const r = evaluate(
    { sessionId: 'child-1', toolName: 'read', args: { file_path: '/workspace/a' }, isChild: true, depth: 1 },
    { policy: p, grant: child, now: NOW }
  )
  assert.equal(r.decision, 'allow')
  const shell = evaluate(
    { sessionId: 'child-1', toolName: 'bash', args: { command: 'cat /workspace/a' }, isChild: true, depth: 1 },
    { policy: p, grant: child, now: NOW }
  )
  assert.equal(shell.decision, 'deny')
  assert.equal(shell.reasonCode, REASON.TOOL_NOT_GRANTED, '子授权没有 bash，必须拒绝')
})

test('sessionInfoOf: 主子代理身份识别', () => {
  const main = sessionInfoOf({ agent: { session: { id: 'm1', header: { id: 'm1', cwd: '/w' } } } })
  assert.deepEqual(main, { sessionId: 'm1', isChild: false, depth: 0 })

  const child = sessionInfoOf({ agent: { session: { id: 'c1', header: { id: 'c1', origin: 'subagent', delegationDepth: 1 } } } })
  assert.deepEqual(child, { sessionId: 'c1', isChild: true, depth: 1 })

  const orphan = sessionInfoOf({})
  assert.equal(orphan.sessionId, 'unknown')
  assert.equal(orphan.isChild, false)
})

test('guard: grantTask 可在运行期补充授权', () => {
  const g = createGuard()
  const before = g.evaluateCall({ sessionId: 'late', toolName: 'read', args: { file_path: '/workspace/a' } })
  assert.equal(before.reasonCode, REASON.NO_GRANT)
  g.grantTask({ sessionId: 'late', allowTools: ['read'], allowPaths: ['/workspace'], maxToolCalls: 3 })
  const after = g.evaluateCall({ sessionId: 'late', toolName: 'read', args: { file_path: '/workspace/a' } })
  assert.equal(after.decision, 'allow')
})

test('guard: 审计条目含决策链关键字段', () => {
  const seen = []
  const g = createGuard({ grants: [baseSpec()], onDecision: (r) => seen.push(r) })
  g.evaluateCall({ sessionId: 'main', toolName: 'bash', args: { command: 'curl http://x.example/y' } })
  const r = seen[0]
  assert.equal(r.decision, 'deny')
  assert.equal(r.reasonCode, REASON.EGRESS_DENIED)
  assert.equal(r.tool, 'bash')
  assert.ok(r.sessionId.length <= 8)
})