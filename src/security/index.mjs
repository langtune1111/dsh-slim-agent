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
import { evaluate, classifyTool, collectPaths, REASON } from './policy/engine.mjs'
import { createGrantStore } from './capability/store.mjs'
import { createLedger, digestValue } from './audit/ledger.mjs'
import { createProvenanceLedger, buildUntrustedLabel } from './provenance/ledger.mjs'
import { createTaintStore } from './data-flow/taint.mjs'
import { scanContent, shouldEscalate } from './prompt-guard.mjs'

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

  const provenance = createProvenanceLedger()

  /** 会话级安全标记（例如 injection-suspected）。 */
  const sessionFlags = new Map()
  const flagsOf = (sessionId) => {
    const key = String(sessionId ?? 'unknown')
    let f = sessionFlags.get(key)
    if (!f) { f = new Set(); sessionFlags.set(key, f) }
    return f
  }
  const taint = createTaintStore({ sensitive: policy?.sensitive ?? {} })

  /** 从工具结果里取出纯文本（content blocks）。 */
  function textOfResult (result) {
    const blocks = result?.content
    if (!Array.isArray(blocks)) return ''
    return blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
  }

  /**
   * 观察一次工具结果：登记来源、抽取污点。
   * 这是"内容进入上下文"的唯一入口，provenance 与 data-flow 都在这里汇合。
   */
  function observeResult ({ sessionId, callId, toolName, args, result }) {
    const toolClass = policy ? classifyTool(toolName, policy) : null
    const text = textOfResult(result)
    const entry = provenance.record({
      sessionId,
      callId,
      tool: toolName,
      toolClass,
      digest: digestValue(text)
    })
    // 提示词防护：只扫"不可信来源"的文本；命中即给会话打标，后续外发升级为拒绝
    let promptInfo = { suspected: false, score: 0, hits: [], threshold: 0 }
    if (entry.untrusted && text !== '') {
      promptInfo = scanContent(text, policy)
      if (promptInfo.suspected) {
        flagsOf(sessionId).add('injection-suspected')
      }
    }
    let taintInfo = { tainted: false, added: 0 }
    if (toolClass === 'local-read' || toolClass === 'external-read' || toolClass === 'delegate') {
      taintInfo = taint.observe({
        sessionId,
        callId,
        tool: toolName,
        text,
        paths: collectPaths(args)
      })
    }
    return { entry, taint: taintInfo, prompt: promptInfo, text }
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
    // 子授权的生命周期不得超过父任务：父授权没了，子授权立即作废
    if (grant?.parentSessionId && !grants.get(grant.parentSessionId)) {
      const stamp = Date.now()
      ledger.record({
        sessionId,
        taskId: grant.taskId ?? null,
        tool: request?.toolName ?? null,
        decision: 'deny',
        reasonCode: REASON.GRANT_EXPIRED,
        detail: 'parent grant gone: ' + grant.parentSessionId,
        argDigest: digestValue(request?.args)
      })
      return { decision: 'deny', reasonCode: REASON.GRANT_EXPIRED, detail: 'parent task ended' }
    }
    let taintView = null
    try {
      taintView = typeof config.taintProvider === 'function' ? config.taintProvider(sessionId) : taint.forSession(sessionId)
    } catch {
      taintView = null
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
      { policy, grant, taint: taintView, escalate: shouldEscalate(policy, flagsOf(sessionId)) }
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

  const taskProfiles = config.taskProfiles && typeof config.taskProfiles === 'object' ? config.taskProfiles : {}

  /**
   * 用任务模板开一个任务：模板来自配置，不允许模型提供。
   * 同一会话重复开任务会重置预算（任务级，而非进程级）。
   */
  function startTask (sessionId, profileName, overrides = {}) {
    const profile = taskProfiles[profileName]
    if (!profile) throw new Error('unknown task profile: ' + String(profileName))
    const spec = {
      ...profile,
      ...overrides,
      sessionId: String(sessionId),
      taskId: overrides.taskId ?? (profileName + '@' + new Date().toISOString())
    }
    return grants.grant(spec)
  }

  /**
   * 子代理首次出现时按父授权派生（只取交集，网络/shell 降级）。
   * 父授权不存在或不可委派 → 返回 null，调用方按 NO_GRANT 处理。
   */
  function ensureChildGrant (childSessionId, parentSessionId, depth) {
    if (!parentSessionId) return null
    const existing = grants.get(childSessionId)
    if (existing) return existing
    const parent = grants.get(parentSessionId)
    if (!parent) return null
    try {
      return grants.deriveChild(parentSessionId, String(childSessionId), { depth: Number.isFinite(depth) ? depth : 1 })
    } catch {
      return null
    }
  }

  return {
    policy,
    initError,
    grants,
    ledger,
    provenance,
    taint,
    taskProfiles,
    flags: sessionFlags,
    evaluateCall,
    observeResult,
    startTask,
    ensureChildGrant,
    grantTask: (spec) => grants.grant(spec),
    dispose () {
      grants.clear()
      ledger.clear()
      provenance.clear()
      sessionFlags.clear()
      taint.clear()
    }
  }
}

/** 从 DSH 的 exec 里解出会话身份（字段不保证存在，全部要做兜底）。 */
export function sessionInfoOf (exec) {
  const header = exec?.agent?.session?.header ?? exec?.session?.header
  const id = exec?.agent?.session?.id ?? header?.id ?? 'unknown'
  const depth = Number.isFinite(header?.delegationDepth) ? header.delegationDepth : 0
  const isChild = header?.origin === 'subagent' || depth > 0
  const parentSessionId = header?.parentSession ? String(header.parentSession) : null
  return { sessionId: String(id), isChild, depth, parentSessionId, cwd: header?.cwd ?? null }
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
      // 子代理首次调用时按父授权现场派生，拿不到就按 NO_GRANT 拒绝
      if (info.isChild) guard.ensureChildGrant(info.sessionId, info.parentSessionId, info.depth)
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

  // 观察工具结果：登记来源 + 抽取污点。
  // 用 tools/result（纯观察事件，不参与决策）而不是 post-execute——
  // 实测在 post-execute 里返回/透传决策会让宿主抛
  // "Cannot read properties of undefined (reading 'kind')"，而观察结果不需要改决策。
  if (config.observeResults !== false) {
    try {
      disposers.push(ctx.on('tools/result', (exec, result) => {
        try {
          const info = sessionInfoOf(exec)
          guard.observeResult({
            sessionId: info.sessionId,
            callId: exec?.callId,
            toolName: exec?.name ?? exec?.tool?.name,
            args: exec?.arguments ?? exec?.args ?? {},
            result
          })
        } catch (error) {
          try { ctx?.logger?.warn?.('[security-guard] 结果观察失败（不影响主流程）: ' + String(error)) } catch {}
        }
      }))
    } catch {}
  }

  // 外部内容来源标签：需要往下一轮上下文注入，属于实验性能力，
  // 默认关闭；开启前必须先在目标 DSH 版本上验证 additionalContexts 的行为。
  if (config.injectUntrustedLabel === true) {
    disposers.push(ctx.on('tools/post-execute', async (exec, result, next) => {
      const decided = await next()
      try {
        const info = sessionInfoOf(exec)
        const observed = guard.observeResult({
          sessionId: info.sessionId,
          callId: exec?.callId,
          toolName: exec?.name ?? exec?.tool?.name,
          args: exec?.arguments ?? exec?.args ?? {},
          result
        })
        if (observed.entry.untrusted && observed.text !== '') {
          const message = { role: 'user', content: [{ type: 'text', text: buildUntrustedLabel(observed.entry) }] }
          const existing = Array.isArray(decided?.additionalContexts) ? decided.additionalContexts : []
          return { ...(decided ?? { kind: 'accept' }), additionalContexts: [...existing, message] }
        }
      } catch {}
      return decided
    }))
  }
  // 每轮开始：没有授权的会话按 defaultTaskProfile 开任务（未配置则不授权）
  if (config.defaultTaskProfile) {
    disposers.push(ctx.on('session/event', (session, event) => {
      try {
        const type = event?.type ?? event?.name
        if (type !== 'turn/start') return
        const id = String(session?.id ?? session?.header?.id ?? '')
        if (id === '') return
        const header = session?.header
        const isChild = header?.origin === 'subagent' || (header?.delegationDepth ?? 0) > 0
        if (isChild) return
        if (config.resetTaskPerTurn !== false || !guard.grants.get(id)) {
          guard.startTask(id, config.defaultTaskProfile)
        }
      } catch (error) {
        try { ctx?.logger?.warn?.('[security-guard] 自动授权失败: ' + String(error)) } catch {}
      }
    }))
  }

  disposers.push(ctx.on('session/disposed', (session) => {
    try {
      const id = session?.id ?? session?.header?.id
      if (id) {
        guard.grants.revoke(String(id))
        guard.taint.clear(String(id))
        guard.flags.delete(String(id))
      }
    } catch {}
  }))

  return () => {
    for (const dispose of disposers.splice(0)) {
      try { typeof dispose === 'function' ? dispose() : dispose?.dispose?.() } catch {}
    }
    guard.dispose()
  }
}