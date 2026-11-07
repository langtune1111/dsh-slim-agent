import test from 'node:test'
import assert from 'node:assert/strict'

import { createGuard, sessionInfoOf } from '../../src/security/index.mjs'
import { REASON } from '../../src/security/policy/engine.mjs'
import { validatePolicy } from '../../src/security/policy/schema.mjs'
import { loadDefaultPolicy } from '../../src/security/index.mjs'

const NOW = 1_800_000_000_000

const policy = validatePolicy({
  ...loadDefaultPolicy(),
  egress: { allowedHosts: ['api.example.com'], denyShellNetworkVerbs: ['curl'], taintedPayloadPolicy: 'deny' }
})

const profiles = {
  research: {
    allowTools: ['read', 'web_search', 'bash', 'subagent'],
    allowPaths: ['/w'],
    network: 'allowlist',
    shell: 'workspace',
    maxToolCalls: 10,
    ttlSeconds: 600,
    delegable: { tools: ['read', 'web_search'], maxDepth: 1, maxToolCalls: 5 }
  },
  readonly: {
    allowTools: ['read'],
    allowPaths: ['/w'],
    network: 'none',
    shell: 'none',
    maxToolCalls: 3,
    ttlSeconds: 600,
    delegable: { tools: ['read'], maxDepth: 0, maxToolCalls: 0 }
  }
}

test('stage3: startTask 按模板授权，重复开任务重置预算', () => {
  const g = createGuard({ policy, taskProfiles: profiles, now: () => NOW })
  const grant = g.startTask('s1', 'readonly')
  assert.deepEqual(grant.allowTools, ['read'])
  assert.equal(grant.network, 'none')

  g.evaluateCall({ sessionId: 's1', toolName: 'read', args: { file_path: '/w/a' } })
  g.evaluateCall({ sessionId: 's1', toolName: 'read', args: { file_path: '/w/a' } })
  g.evaluateCall({ sessionId: 's1', toolName: 'read', args: { file_path: '/w/a' } })
  const blocked = g.evaluateCall({ sessionId: 's1', toolName: 'read', args: { file_path: '/w/a' } })
  assert.equal(blocked.reasonCode, REASON.BUDGET_EXHAUSTED)

  // 新任务 = 新预算
  g.startTask('s1', 'readonly')
  const again = g.evaluateCall({ sessionId: 's1', toolName: 'read', args: { file_path: '/w/a' } })
  assert.equal(again.decision, 'allow')
})

test('stage3: 未知任务模板直接抛错（不允许模型自定义权限）', () => {
  const g = createGuard({ policy, taskProfiles: profiles })
  assert.throws(() => g.startTask('s1', 'god-mode'), /unknown task profile/)
})

test('stage3: 子会话首次调用自动从父授权派生（只拿交集）', () => {
  const g = createGuard({ policy, taskProfiles: profiles, now: () => NOW })
  g.startTask('parent', 'research')
  const child = g.ensureChildGrant('child-1', 'parent', 1)
  assert.ok(child)
  assert.deepEqual(child.allowTools.sort(), ['read', 'web_search'])
  assert.equal(child.network, 'none')
  assert.equal(child.shell, 'none')
})

test('stage3: 父授权不存在时派生失败 → 子调用 NO_GRANT', () => {
  const g = createGuard({ policy, taskProfiles: profiles, now: () => NOW })
  const child = g.ensureChildGrant('orphan', 'nobody', 1)
  assert.equal(child, null)
  const r = g.evaluateCall({ sessionId: 'orphan', toolName: 'read', args: { file_path: '/w/a' }, isChild: true, depth: 1 })
  assert.equal(r.decision, 'deny')
  assert.equal(r.reasonCode, REASON.NO_GRANT)
})

test('stage3: 子代理即使拿到 read，也读不到父授权路径之外的文件', () => {
  const g = createGuard({ policy, taskProfiles: profiles, now: () => NOW })
  g.startTask('parent', 'research')
  g.ensureChildGrant('child-1', 'parent', 1)
  const ok = g.evaluateCall({ sessionId: 'child-1', toolName: 'read', args: { file_path: '/w/a' }, isChild: true, depth: 1 })
  assert.equal(ok.decision, 'allow')
  const bad = g.evaluateCall({ sessionId: 'child-1', toolName: 'read', args: { file_path: '/etc/passwd' }, isChild: true, depth: 1 })
  assert.equal(bad.reasonCode, REASON.PATH_DENIED)
})

test('stage3: 子代理不能用 bash（父授予了也不降级继承）', () => {
  const g = createGuard({ policy, taskProfiles: profiles, now: () => NOW })
  g.startTask('parent', 'research')
  g.ensureChildGrant('child-1', 'parent', 1)
  const r = g.evaluateCall({ sessionId: 'child-1', toolName: 'bash', args: { command: 'cat /w/a' }, isChild: true, depth: 1 })
  assert.equal(r.decision, 'deny')
  assert.equal(r.reasonCode, REASON.TOOL_NOT_GRANTED)
})

test('stage3: 孙子代理（depth 2）超过可委派深度 → 拒绝', () => {
  const g = createGuard({ policy, taskProfiles: profiles, now: () => NOW })
  g.startTask('parent', 'research')
  g.ensureChildGrant('child-1', 'parent', 1)
  const grandchild = g.ensureChildGrant('grand-1', 'child-1', 2)
  assert.equal(grandchild, null, '子授权不可再委派，派生出 null')
  const r = g.evaluateCall({ sessionId: 'grand-1', toolName: 'read', args: { file_path: '/w/a' }, isChild: true, depth: 2 })
  assert.equal(r.reasonCode, REASON.NO_GRANT)
})

test('stage3: 父任务结束后，子会话不能再凭旧派生授权继续用', () => {
  const g = createGuard({ policy, taskProfiles: profiles, now: () => NOW })
  g.startTask('parent', 'research')
  g.ensureChildGrant('child-1', 'parent', 1)
  g.grants.revoke('parent')
  const r = g.evaluateCall({ sessionId: 'child-1', toolName: 'read', args: { file_path: '/w/a' }, isChild: true, depth: 1 })
  assert.equal(r.reasonCode, REASON.GRANT_EXPIRED, '父授权撤掉后子授权到期时间随父失效')
})

test('sessionInfoOf: 解析 parentSession 与 cwd', () => {
  const info = sessionInfoOf({
    agent: { session: { id: 'c1', header: { id: 'c1', origin: 'subagent', delegationDepth: 1, parentSession: 'p1', cwd: '/w' } } }
  })
  assert.equal(info.parentSessionId, 'p1')
  assert.equal(info.cwd, '/w')
  assert.equal(info.isChild, true)
  assert.equal(info.depth, 1)
})