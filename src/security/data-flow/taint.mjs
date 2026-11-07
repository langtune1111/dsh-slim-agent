/**
 * Data Flow Guard：敏感内容污点登记与匹配。
 *
 * 边界（不夸大）：
 *  - 这是**确定性匹配**：显式标记 / 路径 / 正则命中片段；
 *  - 不做编码还原（base64、分片、改写），识别不了的变形就识别不了；
 *  - 真正的兜底是"默认不给网络与 shell 能力"，污点匹配是第二道。
 */

const MAX_TOKENS_PER_SESSION = 200
const TOKEN_MAX_LEN = 96

function normalizeText (value) {
  if (typeof value !== 'string') return ''
  return value.replace(/\r/g, '').replace(/[ \t]+/g, ' ')
}

/**
 * 从一段文本里抽取敏感片段：
 *  - markers：整段包含即登记（如 SIM_SECRET_）
 *  - contentRegex：命中的片段本身作为 token 登记（截断到 96 字符）
 */
export function extractSecrets (text, sensitive) {
  const out = { markers: [], tokens: [] }
  const body = normalizeText(text)
  if (body === '') return out
  for (const marker of sensitive?.markers ?? []) {
    if (marker && body.includes(marker)) out.markers.push(marker)
  }
  for (const pattern of sensitive?.contentRegex ?? []) {
    let re
    try { re = new RegExp(pattern, 'gi') } catch { continue }
    let m
    let guard = 0
    while ((m = re.exec(body)) !== null && guard < 20) {
      guard += 1
      const hit = String(m[0] ?? '').trim()
      if (hit.length >= 4 && hit.length <= TOKEN_MAX_LEN) out.tokens.push(hit)
      if (re.lastIndex === m.index) re.lastIndex += 1
    }
  }
  return out
}

/** 某个路径是否落在敏感路径清单里（前缀匹配，按路径段对齐）。 */
export function isSensitivePath (candidate, sensitive) {
  if (typeof candidate !== 'string' || candidate === '') return false
  const target = candidate.replace(/\\/g, '/')
  for (const p of sensitive?.paths ?? []) {
    if (typeof p !== 'string' || p === '') continue
    const base = p.replace(/\\/g, '/').replace(/\/+$/, '')
    if (target === base || target.startsWith(base + '/')) return true
  }
  return false
}

/**
 * 污点仓库：按会话聚合 { markers, paths, tokens }，供策略引擎匹配。
 * 同时保留"污点来自哪次调用"，便于审计回溯。
 */
export function createTaintStore (options = {}) {
  const sensitive = options.sensitive ?? { paths: [], markers: [], contentRegex: [] }
  /** @type {Map<string, {markers:Set<string>, paths:Set<string>, tokens:Set<string>, origins:object[]}>} */
  const bySession = new Map()

  function bucket (sessionId) {
    const key = String(sessionId ?? 'unknown')
    let b = bySession.get(key)
    if (!b) {
      b = { markers: new Set(), paths: new Set(), tokens: new Set(), origins: [] }
      bySession.set(key, b)
    }
    return b
  }

  return {
    /**
     * 观察一次工具结果。
     * @param {{sessionId:string, callId?:string, tool?:string, text?:string, paths?:string[]}} input
     */
    observe (input) {
      const sessionId = String(input?.sessionId ?? 'unknown')
      const b = bucket(sessionId)
      const before = b.markers.size + b.paths.size + b.tokens.size

      for (const p of input?.paths ?? []) {
        if (isSensitivePath(p, sensitive)) b.paths.add(p)
      }

      const text = normalizeText(input?.text ?? '')
      if (text !== '') {
        const found = extractSecrets(text, sensitive)
        for (const marker of found.markers) b.markers.add(marker)
        for (const token of found.tokens) {
          if (b.tokens.size < MAX_TOKENS_PER_SESSION) b.tokens.add(token)
        }
      }

      const after = b.markers.size + b.paths.size + b.tokens.size
      if (after > before) {
        b.origins.push({ callId: input?.callId ?? null, tool: input?.tool ?? null, added: after - before, at: Date.now() })
      }
      return { tainted: after > 0, added: after - before }
    },
    /** 供策略引擎使用的视图。 */
    forSession (sessionId) {
      const b = bySession.get(String(sessionId ?? 'unknown'))
      if (!b) return { markers: new Set(), paths: new Set(), tokens: new Set() }
      return { markers: b.markers, paths: b.paths, tokens: b.tokens }
    },
    size (sessionId) {
      const b = bySession.get(String(sessionId ?? 'unknown'))
      if (!b) return 0
      return b.markers.size + b.paths.size + b.tokens.size
    },
    origins (sessionId) {
      const b = bySession.get(String(sessionId ?? 'unknown'))
      return b ? b.origins.slice() : []
    },
    clear (sessionId) {
      if (sessionId === undefined) bySession.clear()
      else bySession.delete(String(sessionId))
    }
  }
}