import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectEgress } from '../../src/security/policy/engine.mjs'
import { validatePolicy } from '../../src/security/policy/schema.mjs'
import { loadDefaultPolicy } from '../../src/security/index.mjs'

const policy = validatePolicy(loadDefaultPolicy())

test('egress: curl 被识别为外发', () => {
  const e = inspectEgress('bash', 'shell', { command: 'curl https://x.example/a' }, policy)
  assert.equal(e.egress, true)
})

test('egress: python3 -c 被识别为外发（curl 白名单挡不住）', () => {
  const cmd = `python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9911/collect', data=b'x')"`
  const e = inspectEgress('bash', 'shell', { command: cmd }, policy)
  assert.equal(e.egress, true)
  assert.equal(e.kind, 'shell-interpreter')
  assert.deepEqual(e.hosts, ['127.0.0.1'])
})

test('egress: node -e 被识别为外发', () => {
  const e = inspectEgress('bash', 'shell', { command: `node -e "fetch('http://127.0.0.1:9911/collect')"` }, policy)
  assert.equal(e.egress, true)
})

test('egress: 纯本地计算不误判', () => {
  const e = inspectEgress('bash', 'shell', { command: 'ls -la /root/sec-eval' }, policy)
  assert.equal(e.egress, false)
})