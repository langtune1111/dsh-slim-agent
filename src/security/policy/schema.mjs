/**
 * 策略结构校验（手写，不引入依赖）。
 * 设计原则：宁可抛错也不要放行——调用方捕获后按 fail-closed 处理。
 */

const TOOL_CLASSES = new Set(['local-read', 'local-write', 'shell', 'external-read', 'external-write', 'delegate', 'control'])

function isPlainObject (v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function requireStringArray (value, field) {
  if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) {
    throw new TypeError('policy.' + field + ' must be an array of strings')
  }
}

/**
 * 校验并返回规范化后的策略对象（浅拷贝，不修改入参）。
 * @param {unknown} raw
 * @returns {object}
 */
export function validatePolicy (raw) {
  if (!isPlainObject(raw)) throw new TypeError('policy must be an object')
  if (raw.version !== 1) throw new TypeError('policy.version must be 1')

  const defaults = raw.defaults
  if (!isPlainObject(defaults)) throw new TypeError('policy.defaults must be an object')
  for (const key of ['decision', 'unknownTool', 'missingGrant']) {
    if (defaults[key] !== 'deny' && defaults[key] !== 'allow') {
      throw new TypeError('policy.defaults.' + key + ' must be "deny" or "allow"')
    }
  }
  // 安全底线：默认值不允许是 allow
  for (const key of ['decision', 'unknownTool', 'missingGrant']) {
    if (defaults[key] !== 'deny') throw new TypeError('policy.defaults.' + key + ' must be "deny" (fail-closed)')
  }

  const tools = raw.tools
  if (!isPlainObject(tools)) throw new TypeError('policy.tools must be an object')
  for (const [name, spec] of Object.entries(tools)) {
    if (!isPlainObject(spec)) throw new TypeError('policy.tools.' + name + ' must be an object')
    if (!TOOL_CLASSES.has(spec.class)) throw new TypeError('policy.tools.' + name + '.class is invalid: ' + spec.class)
  }

  const sensitive = raw.sensitive ?? {}
  if (!isPlainObject(sensitive)) throw new TypeError('policy.sensitive must be an object')
  requireStringArray(sensitive.paths ?? [], 'sensitive.paths')
  requireStringArray(sensitive.markers ?? [], 'sensitive.markers')
  requireStringArray(sensitive.contentRegex ?? [], 'sensitive.contentRegex')
  for (const pattern of sensitive.contentRegex ?? []) {
    try { new RegExp(pattern) } catch (error) { throw new TypeError('policy.sensitive.contentRegex invalid: ' + pattern) }
  }

  const egress = raw.egress ?? {}
  if (!isPlainObject(egress)) throw new TypeError('policy.egress must be an object')
  requireStringArray(egress.allowedHosts ?? [], 'egress.allowedHosts')
  requireStringArray(egress.denyShellNetworkVerbs ?? [], 'egress.denyShellNetworkVerbs')
  requireStringArray(egress.shellInterpreters ?? [], 'egress.shellInterpreters')
  if (egress.taintedPayloadPolicy !== undefined && egress.taintedPayloadPolicy !== 'deny') {
    // 只允许 deny：tainted 外发没有"放行"档位
    throw new TypeError('policy.egress.taintedPayloadPolicy must be "deny"')
  }

  const limits = raw.limits ?? {}
  if (!isPlainObject(limits)) throw new TypeError('policy.limits must be an object')
  for (const key of ['defaultMaxToolCalls', 'defaultTtlSeconds', 'childMaxDepth']) {
    const v = limits[key]
    if (v !== undefined && (!Number.isFinite(v) || v < 0)) throw new TypeError('policy.limits.' + key + ' must be a non-negative number')
  }

  // 提示词防护（可选）
  let promptGuard
  if (raw.promptGuard !== undefined) {
    const pg = raw.promptGuard
    if (!isPlainObject(pg)) throw new TypeError('policy.promptGuard must be an object')
    const patterns = pg.patterns
    if (patterns !== undefined) {
      if (!Array.isArray(patterns)) throw new TypeError('policy.promptGuard.patterns must be an array')
      for (const item of patterns) {
        if (!isPlainObject(item)) throw new TypeError('policy.promptGuard.patterns[] must be objects')
        if (item.re === undefined) throw new TypeError('policy.promptGuard.patterns[].re is required')
      }
    }
    promptGuard = {
      enabled: pg.enabled !== false,
      threshold: Number.isFinite(pg.threshold) ? pg.threshold : 4,
      escalate: pg.escalate !== false,
      ...(patterns ? { patterns } : {})
    }
  }

  return {
    version: 1,
    defaults: { decision: 'deny', unknownTool: 'deny', missingGrant: 'deny' },
    tools: { ...tools },
    sensitive: {
      paths: [...(sensitive.paths ?? [])],
      markers: [...(sensitive.markers ?? [])],
      contentRegex: [...(sensitive.contentRegex ?? [])]
    },
    egress: {
      allowedHosts: [...(egress.allowedHosts ?? [])],
      denyShellNetworkVerbs: [...(egress.denyShellNetworkVerbs ?? [])],
      shellInterpreters: [...(egress.shellInterpreters ?? [])],
      taintedPayloadPolicy: 'deny'
    },
    promptGuard,
    limits: {
      defaultMaxToolCalls: limits.defaultMaxToolCalls ?? 40,
      defaultTtlSeconds: limits.defaultTtlSeconds ?? 900,
      childMaxDepth: limits.childMaxDepth ?? 1
    }
  }
}