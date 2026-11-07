/**
 * 策略引擎（纯函数，无 I/O、无模型调用）。
 *
 * 设计契约：
 *  - evaluate() 永远返回一个显式 decision，不抛异常；
 *  - 任何异常路径（未知工具、缺授权、策略畸形）都落到 deny；
 *  - 判定顺序固定，保证审计可复现。
 */
import { resolve as resolvePath, sep } from 'node:path'

export const REASON = Object.freeze({
  ALLOW: 'ALLOW',
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',
  NO_GRANT: 'NO_GRANT',
  TOOL_NOT_GRANTED: 'TOOL_NOT_GRANTED',
  GRANT_EXPIRED: 'GRANT_EXPIRED',
  BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
  DEPTH_EXCEEDED: 'DEPTH_EXCEEDED',
  PATH_DENIED: 'PATH_DENIED',
  EGRESS_DENIED: 'EGRESS_DENIED',
  TAINTED_EGRESS: 'TAINTED_EGRESS',
  INJECTION_SUSPECTED: 'INJECTION_SUSPECTED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
})

const PATH_KEYS = ['file_path', 'path', 'target', 'target_path', 'cwd', 'workdir', 'directory']

/** 工具名 → 类别；未登记返回 null（调用方按 UNKNOWN_TOOL 处理）。 */
export function classifyTool (toolName, policy) {
  if (typeof toolName !== 'string' || toolName === '') return null
  const spec = policy?.tools?.[toolName]
  if (!spec || typeof spec.class !== 'string') return null
  return spec.class
}

/** 从参数里收集可能是路径的字符串（保守：只认显式字段 + 看起来像路径的片段）。 */
export function collectPaths (args) {
  const out = []
  if (args === null || typeof args !== 'object') return out
  for (const key of PATH_KEYS) {
    const v = args[key]
    if (typeof v === 'string' && v.trim() !== '') out.push(v.trim())
  }
  if (typeof args.command === 'string') {
    for (const token of args.command.split(/[\s|;&<>()]+/)) {
      if (token === '') continue
      if (/^[A-Za-z]:[\\/]/.test(token) || token.startsWith('/') || token.startsWith('./') || token.startsWith('../')) {
        out.push(token.replace(/^["']|["']$/g, ''))
      }
    }
  }
  return out
}

/** URL → host（小写，去端口）；失败返回 null。 */
export function hostOf (rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl === '') return null
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.hostname.toLowerCase()
  } catch {
    return null
  }
}

/** 在命令里找网络动词（curl/wget/...）。返回命中的动词数组。 */
export function findNetworkVerbs (command, policy) {
  if (typeof command !== 'string' || command === '') return []
  const verbs = policy?.egress?.denyShellNetworkVerbs ?? []
  if (verbs.length === 0) return []
  const found = []
  const tokens = command.split(/[\s|;&<>()`$"'\\]+/).filter(Boolean)
  for (const token of tokens) {
    const base = token.replace(/\.exe$/i, '').toLowerCase()
    for (const verb of verbs) {
      if (base === verb.toLowerCase() || base.endsWith('/' + verb.toLowerCase()) || base.endsWith('\\' + verb.toLowerCase())) {
        if (!found.includes(verb)) found.push(verb)
      }
    }
  }
  return found
}

/** 判断一次调用是否属于"外发方向"，并给出目标 host 列表。 */
export function inspectEgress (toolName, toolClass, args, policy) {
  if (toolClass === 'external-write') {
    const hosts = []
    for (const key of ['url', 'endpoint', 'target_url']) {
      const h = hostOf(args?.[key])
      if (h) hosts.push(h)
    }
    return { egress: true, kind: 'external-write', hosts, verbs: [] }
  }
  if (toolClass === 'external-read' && toolName === 'web_fetch') {
    const h = hostOf(args?.url)
    return { egress: Boolean(h), kind: 'fetch', hosts: h ? [h] : [], verbs: [] }
  }
  if (toolClass === 'shell') {
    const verbs = findNetworkVerbs(args?.command, policy)
    if (verbs.length === 0) return { egress: false, kind: 'shell', hosts: [], verbs }
    const hosts = []
    const urlRe = /https?:\/\/[^\s'"|;<>)]+/gi
    for (const m of String(args?.command ?? '').matchAll(urlRe)) {
      const h = hostOf(m[0])
      if (h && !hosts.includes(h)) hosts.push(h)
    }
    return { egress: true, kind: 'shell-network', hosts, verbs }
  }
  return { egress: false, kind: 'none', hosts: [], verbs: [] }
}

/** 参数里是否出现了污点（敏感标记 / 敏感路径 / 会话内登记过的片段令牌）。 */
export function containsTaint (value, taint) {
  if (!taint) return { tainted: false, hits: [] }
  let haystack = ''
  try {
    haystack = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  } catch {
    haystack = String(value ?? '')
  }
  const hits = []
  for (const marker of taint.markers ?? []) {
    if (marker && haystack.includes(marker)) hits.push('marker:' + marker)
  }
  for (const path of taint.paths ?? []) {
    if (path && haystack.includes(path)) hits.push('path:' + path)
  }
  for (const token of taint.tokens ?? []) {
    if (token && haystack.includes(token)) hits.push('token:' + token)
  }
  return { tainted: hits.length > 0, hits }
}

/** 路径是否落在授权范围内（前缀匹配，按路径段对齐）。 */
export function pathAllowed (candidate, allowPaths) {
  if (!Array.isArray(allowPaths) || allowPaths.length === 0) return false
  if (allowPaths.includes('*')) return true
  let target
  try {
    target = resolvePath(candidate)
  } catch {
    return false
  }
  for (const root of allowPaths) {
    if (typeof root !== 'string' || root === '') continue
    let base
    try {
      base = resolvePath(root)
    } catch {
      continue
    }
    if (target === base) return true
    if (target.startsWith(base.endsWith(sep) ? base : base + sep)) return true
  }
  return false
}

function deny (reasonCode, detail) {
  return { decision: 'deny', reasonCode, detail: detail ?? '' }
}

/**
 * 核心判定。
 * @param {{sessionId?:string, taskId?:string, toolName:string, args?:unknown, isChild?:boolean, depth?:number}} request
 * @param {{policy:object, grant?:object, taint?:object, now?:number}} state
 */
export function evaluate (request, state) {
  try {
    const policy = state?.policy
    if (!policy || !policy.tools) return deny(REASON.INTERNAL_ERROR, 'policy missing')
    const now = Number.isFinite(state?.now) ? state.now : Date.now()
    const toolName = request?.toolName
    const args = request?.args ?? {}
    const isChild = request?.isChild === true
    const depth = Number.isFinite(request?.depth) ? request.depth : (isChild ? 1 : 0)

    // 1. 工具必须已登记
    const toolClass = classifyTool(toolName, policy)
    if (toolClass === null) return deny(REASON.UNKNOWN_TOOL, 'tool not in policy: ' + String(toolName))

    // 2. 任务授权必须存在
    const grant = state?.grant
    if (!grant) return deny(REASON.NO_GRANT, 'no capability grant for this session')

    // 3. 子代理深度
    const maxDepth = policy?.limits?.childMaxDepth ?? 1
    if (depth > maxDepth) return deny(REASON.DEPTH_EXCEEDED, 'delegation depth ' + depth + ' > ' + maxDepth)

    // 4. 工具必须在授权子集里
    if (!Array.isArray(grant.allowTools) || !grant.allowTools.includes(toolName)) {
      return deny(REASON.TOOL_NOT_GRANTED, 'tool not granted: ' + String(toolName))
    }

    // 5. 有效期
    if (Number.isFinite(grant.expiresAt) && now > grant.expiresAt) {
      return deny(REASON.GRANT_EXPIRED, 'grant expired at ' + new Date(grant.expiresAt).toISOString())
    }

    // 6. 调用预算
    const used = Number.isFinite(grant.usedCalls) ? grant.usedCalls : 0
    const limit = Number.isFinite(grant.maxToolCalls) ? grant.maxToolCalls : (policy?.limits?.defaultMaxToolCalls ?? 40)
    if (used >= limit) return deny(REASON.BUDGET_EXHAUSTED, 'used ' + used + '/' + limit)

    // 7. shell 能力：不授予 shell 时所有 shell 类调用直接拒绝
    if (toolClass === 'shell' && (grant.shell ?? 'none') === 'none') {
      return deny(REASON.TOOL_NOT_GRANTED, 'shell capability is none')
    }

    // 8. 路径范围
    const paths = collectPaths(args)
    if (paths.length > 0) {
      for (const p of paths) {
        if (!pathAllowed(p, grant.allowPaths)) return deny(REASON.PATH_DENIED, 'path outside grant: ' + p)
      }
    }

    // 9. 外发方向
    const egress = inspectEgress(toolName, toolClass, args, policy)
    if (egress.egress) {
      // 9.0 提示词防护升级：会话里发现过注入特征 → 外发一律拒绝
      if (state?.escalate === true) {
        return deny(REASON.INJECTION_SUSPECTED, 'untrusted content flagged as prompt injection; egress locked')
      }
      const network = grant.network ?? 'none'
      if (network === 'none') return deny(REASON.EGRESS_DENIED, 'network capability is none (' + egress.kind + ')')
      if (network === 'allowlist') {
        const allowed = policy?.egress?.allowedHosts ?? []
        const bad = egress.hosts.filter((h) => !allowed.some((a) => h === a || h.endsWith('.' + a)))
        if (bad.length > 0) return deny(REASON.EGRESS_DENIED, 'host not allowed: ' + bad.join(','))
        if (egress.hosts.length === 0) return deny(REASON.EGRESS_DENIED, 'egress without identifiable host')
      }
      // 10. 污点外发
      const taint = containsTaint(args, state?.taint)
      if (taint.tainted) return deny(REASON.TAINTED_EGRESS, taint.hits.join(';'))
    }

    return { decision: 'allow', reasonCode: REASON.ALLOW, detail: '', egress }
  } catch (error) {
    return deny(REASON.INTERNAL_ERROR, String(error?.message || error))
  }
}