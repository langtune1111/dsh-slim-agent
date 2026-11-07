/**
 * DSH Agent Security Guard — 插件入口。
 *
 * 定位：**执行层**的确定性安全治理。不修改模型、不修改 slim-core，
 * 通过 `tools/pre-execute` 在真正的工具执行之前做授权判定。
 *
 * fail-closed 约定：
 *  - 策略加载/校验失败 → 拒绝一切工具调用；
 *  - 判定过程抛异常 → 拒绝；
 *  - 缺少授权 → 拒绝。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { validatePolicy } from './policy/schema.mjs'
import { evaluate, REASON } from './policy/engine.mjs'
import { createGrantStore } from './capability/store.mjs'
import { createLedger, digestValue } from './audit/ledger.mjs'

export const name = 'dsh-agent-security-guard'
export const inject = []

const HERE = dirname(fileURLToPath(import.meta.url))

/** 读取随包发布的默认策略。 */
export function loadDefaultPolicy () {
  const file = join(HERE, 'policy', 'defaults.json')
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * 构造一个可独立测试的 Guard 实例（不依赖 DSH 运行时）。
 * @param {object} [config]
 * @param {object} [config.policy] 策略对象；缺省用 defaults.json
 * @param {object[]} [config.grants] 启动时预置的授权（评测/演示用）
 * @param {string} [config.auditFile] 审计文件路径；不传则只留内存
 * @param {(sessionId:string)=>object|null} [config.taintProvider] 污点来源（阶段 2 接入）
 * @param {()=>number} [config.now] 时间源（测试用）
 * @param {(record:object)=>void} [config.onDecision] 决策观察者（评测器用）
 */
export function createGuard (config = {}) {
  let policy
  let initError = null
  try {
    policy = config.policy ? validatePolicy(config.policy) : validatePolicy(loadDefaultPolicy())
  } catch (error) {
    initError = error
    policy = null
  }

  const grants = createGrantStore(config.now ? { now: config.now } : {})
  const ledger = createLedger({
    file: config.auditFile,
    now: config.now,
    sink: config.onDecision
  })

  for (const spec of config.grants ?? []) {
    try { grants.grant(spec) } catch { /* 单条坏授权忽略，其余照常 */ }
  }

  function evaluateCall (request) {
    const started = Date.now()
    const sessionId = request?.sessionId ?? 'unknown'
    if (initError || !policy) {
      const record = ledger.record({
        sessionId,
        taskId: null,
        tool: request?.toolName ?? null,
        decision: 'deny',
        reasonCode: 'POLICY_INVALID',
        detail: String(initError?.message || 'policy unavailable'),
        argDigest: digestValue(request?.args)
      })
      return { decision: 'deny', reasonCode: 'POLICY_INVALID', detail: record.detail }
    }

    const grant = grants.get(sessionId)
    let taint = null
    try {
      taint = typeof config.taintProvider === 'function' ? config.taintProvider(sessionId) : null
    } catch {
      taint = null
    }

    const result = evaluate(
      {
        sessionId,
        taskId: grant?.taskId ?? null,
        toolName: request?.toolName,
        args: request?.args,
        isChild: request?.isChild === true,
        depth: request?.depth
      },
      { policy, grant, taint }
    )

    if (result.decision === 'allow') grants.consume(sessionId)

    ledger.record({
      sessionId,
      taskId: grant?.taskId ?? null,
      tool: request?.toolName ?? null,
      decision: result.decision,
      reasonCode: result.reasonCode,
      detail: result.detail,
      argDigest: digestValue(request?.args),
      taintHits: result.reasonCode === REASON.TAINTED_EGRESS ? String(result.detail).split(';').filter(Boolean).length : 0,
      latencyMs: Date.now() - started
    })

    return result
  }

  return {
    policy,
    initError,
    grants,
    ledger,
    evaluateCall,
    grantTask: (spec) => grants.grant(spec),
    dispose () {
      grants.clear()
      ledger.clear()
    }
  }
}

/** 从 DSH 的 exec 里解出会话身份（字段不保证存在，全部要做兜底）。 */
export function sessionInfoOf (exec) {
  const header = exec?.agent?.session?.header ?? exec?.session?.header
  const id = exec?.agent?.session?.id ?? header?.id ?? 'unknown'
  const depth = Number.isFinite(header?.delegationDepth) ? header.delegationDepth : 0
  const isChild = header?.origin === 'subagent' || depth > 0
  return { sessionId: String(id), isChild, depth }
}

/**
 * DSH 插件入口。任何一个环节出错都退化成"全部拒绝"。
 */
export function apply (ctx, config = {}) {
  const guard = createGuard(config)
  const disposers = []

  const denyAll = async () => ({ kind: 'deny', reason: '[security-guard] 安全层不可用，已按 fail-closed 拒绝' })

  if (guard.initError) {
    try { ctx?.logger?.error?.('[security-guard] 策略加载失败，进入 fail-closed: ' + String(guard.initError)) } catch {}
    disposers.push(ctx.on('tools/pre-execute', denyAll, { prepend: true }))
    return () => { for (const d of disposers.splice(0)) { try { d?.() } catch {} } }
  }

  disposers.push(ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const info = sessionInfoOf(exec)
      const result = guard.evaluateCall({
        sessionId: info.sessionId,
        toolName: exec?.name ?? exec?.tool?.name,
        args: exec?.arguments ?? exec?.args ?? {},
        isChild: info.isChild,
        depth: info.depth
      })
      if (result.decision === 'deny') {
        return { kind: 'deny', reason: '[security-guard] ' + result.reasonCode + (result.detail ? ': ' + result.detail : '') }
      }
    } catch (error) {
      try { ctx?.logger?.error?.('[security-guard] 判定异常，fail-closed: ' + String(error)) } catch {}
      return { kind: 'deny', reason: '[security-guard] 判定异常，已按 fail-closed 拒绝' }
    }
    return next()
  }, { prepend: true }))

  disposers.push(ctx.on('session/disposed', (session) => {
    try {
      const id = session?.id ?? session?.header?.id
      if (id) guard.grants.revoke(String(id))
    } catch {}
  }))

  return () => {
    for (const dispose of disposers.splice(0)) {
      try { typeof dispose === 'function' ? dispose() : dispose?.dispose?.() } catch {}
    }
    guard.dispose()
  }
}