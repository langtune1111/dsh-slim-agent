/**
 * 任务级能力授权（Task-bound Capability）。
 *
 * 约定：
 *  - 授权只能由宿主/评测器显式授予，**永不从模型输入推导**；
 *  - 子代理授权 = 父授权 ∩ 可委派集合，且网络/shell 默认降级；
 *  - 缺少授权时一律视为"无权限"，由策略引擎给出 deny。
 */

const DEFAULT_DELEGABLE = { tools: [], maxDepth: 0, maxToolCalls: 0 }

function nowDefault () {
  return Date.now()
}

/**
 * @param {{now?:() => number}} [options]
 */
export function createGrantStore (options = {}) {
  const now = typeof options.now === 'function' ? options.now : nowDefault
  /** @type {Map<string, object>} */
  const bySession = new Map()

  function normalize (spec) {
    if (!spec || typeof spec !== 'object') throw new TypeError('grant spec must be an object')
    if (typeof spec.sessionId !== 'string' || spec.sessionId === '') throw new TypeError('grant.sessionId is required')
    const ttl = Number.isFinite(spec.ttlSeconds) ? spec.ttlSeconds : 0
    const delegable = spec.delegable && typeof spec.delegable === 'object' ? spec.delegable : DEFAULT_DELEGABLE
    return {
      taskId: String(spec.taskId ?? 'default'),
      sessionId: spec.sessionId,
      allowTools: Array.isArray(spec.allowTools) ? [...spec.allowTools] : [],
      allowPaths: Array.isArray(spec.allowPaths) ? [...spec.allowPaths] : [],
      network: spec.network === 'allowlist' ? 'allowlist' : 'none',
      shell: spec.shell === 'full' ? 'full' : (spec.shell === 'workspace' ? 'workspace' : 'none'),
      maxToolCalls: Number.isFinite(spec.maxToolCalls) ? spec.maxToolCalls : 40,
      usedCalls: 0,
      expiresAt: Number.isFinite(spec.expiresAt) ? spec.expiresAt : (ttl > 0 ? now() + ttl * 1000 : Number.POSITIVE_INFINITY),
      delegable: {
        tools: Array.isArray(delegable.tools) ? [...delegable.tools] : [],
        maxDepth: Number.isFinite(delegable.maxDepth) ? delegable.maxDepth : 0,
        maxToolCalls: Number.isFinite(delegable.maxToolCalls) ? delegable.maxToolCalls : 0
      }
    }
  }

  return {
    /** 授予（覆盖同会话旧授权）。 */
    grant (spec) {
      const g = normalize(spec)
      bySession.set(g.sessionId, g)
      return g
    },
    get (sessionId) {
      return bySession.get(sessionId) ?? null
    },
    /** 放行一次调用后扣预算；返回扣减后的授权。 */
    consume (sessionId) {
      const g = bySession.get(sessionId)
      if (!g) return null
      g.usedCalls += 1
      return g
    },
    remaining (sessionId) {
      const g = bySession.get(sessionId)
      if (!g) return 0
      return Math.max(0, g.maxToolCalls - g.usedCalls)
    },
    revoke (sessionId) {
      return bySession.delete(sessionId)
    },
    clear () {
      bySession.clear()
    },
    /**
     * 派生子授权：只能取父授权与可委派集合的交集，且网络/shell 降级。
     * 子代理不继承父的全部权限，这一点是硬约束。
     */
    deriveChild (parentSessionId, childSessionId, overrides = {}) {
      const parent = bySession.get(parentSessionId)
      if (!parent) throw new Error('deriveChild: parent grant not found: ' + parentSessionId)
      const delegable = parent.delegable ?? DEFAULT_DELEGABLE
      const depth = Number.isFinite(overrides.depth) ? overrides.depth : 1
      if (depth > delegable.maxDepth) {
        throw new Error('deriveChild: depth ' + depth + ' exceeds delegable.maxDepth ' + delegable.maxDepth)
      }
      const tools = parent.allowTools.filter((t) => delegable.tools.includes(t))
      const childCap = Number.isFinite(delegable.maxToolCalls) && delegable.maxToolCalls > 0
        ? delegable.maxToolCalls
        : Math.max(0, parent.maxToolCalls - parent.usedCalls)
      const remainingParent = Math.max(0, parent.maxToolCalls - parent.usedCalls)
      const child = normalize({
        taskId: parent.taskId + ':child',
        sessionId: childSessionId,
        allowTools: tools,
        allowPaths: parent.allowPaths,
        network: 'none',
        shell: 'none',
        maxToolCalls: Math.min(childCap, remainingParent),
        expiresAt: parent.expiresAt,
        delegable: { tools: [], maxDepth: 0, maxToolCalls: 0 }
      })
      bySession.set(childSessionId, child)
      return child
    }
  }
}