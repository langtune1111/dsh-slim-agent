/**
 * pi 扩展：把同一套 Security Guard 策略引擎挂到 pi runtime 上。
 *
 * pi 的扩展事件 `tool_call` 支持 `{ block: true, reason }` 阻止工具执行，
 * 因此这里不需要重写策略，只做"事件 → 引擎 → 决定"的转接。
 *
 * 配置：环境变量 SECGUARD_CONFIG 指向 JSON 文件：
 *   { "policy": {...}(可选), "grants": [ {...} ], "auditFile": "...", "sessionId": "pi-main" }
 */
import { readFileSync, appendFileSync } from 'node:fs'
import { createGuard } from '../../src/security/index.mjs'

export default function piSecurityGuard (pi) {
  let config = {}
  try {
    if (process.env.SECGUARD_CONFIG) {
      config = JSON.parse(readFileSync(process.env.SECGUARD_CONFIG, 'utf8'))
    }
  } catch (error) {
    // 配置读失败 = fail-closed：不给任何授权，后面每个调用都会被拒
    config = { grants: [] }
  }

  const sessionId = config.sessionId || 'pi-main'
  const guard = createGuard({
    policy: config.policy,
    grants: (config.grants || []).map((g) => ({ ...g, sessionId }))
  })

  const decisions = []
  const record = (entry) => {
    decisions.push(entry)
    if (config.auditFile) {
      try {
        appendFileSync(config.auditFile, JSON.stringify(entry) + '\n')
      } catch {}
    }
  }

  pi.on('tool_call', async (event) => {
    let verdict
    try {
      verdict = guard.evaluateCall({
        sessionId,
        toolName: event.toolName,
        args: event.input ?? {},
        isChild: false,
        depth: 0
      })
    } catch (error) {
      return { block: true, reason: '[security-guard] evaluation failed (fail-closed)' }
    }
    record({
      at: new Date().toISOString(),
      tool: event.toolName,
      decision: verdict.decision,
      reasonCode: verdict.reasonCode,
      detail: verdict.detail || ''
    })
    if (verdict.decision === 'deny') {
      return { block: true, reason: '[security-guard] ' + verdict.reasonCode + (verdict.detail ? ': ' + verdict.detail : '') }
    }
    return undefined
  })
}