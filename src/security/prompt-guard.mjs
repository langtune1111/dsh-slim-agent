/**
 * 提示词防护（输入侧启发式）。
 *
 * 定位必须说清楚，否则这个模块最容易被夸大成"安全边界"：
 *  - 它是**启发式信号**，不是判定器；漏报是常态，误报也要接受；
 *  - 它的作用不是"把恶意文本过滤掉"（文本过滤永远可绕过），而是**触发执行层升级**：
 *    一旦在不可信内容里看到指令注入特征，就把该会话的外发能力锁死，
 *    后续任何外发调用都以 `INJECTION_SUSPECTED` 拒绝。
 *  - 真正的边界仍然是执行闸门（能力 + 数据流）。提示词防护只是让它更早、更保守。
 */

/** 默认特征库：偏"指令覆盖 / 角色提升 / 系统提示词窃取 / 外发指令"四类。 */
export const DEFAULT_PATTERNS = [
  { id: 'ignore-instructions', weight: 3, re: /(忽略|无视|忘记)(以上|之前|前面|上述|所有)?.{0,6}(指令|提示|要求|设定)/i },
  { id: 'ignore-instructions-en', weight: 3, re: /\b(ignore|disregard|forget)\b.{0,20}\b(previous|above|prior|earlier)\b.{0,20}\b(instruction|prompt|rule)s?\b/i },
  { id: 'role-override', weight: 2, re: /(你现在是|从现在起你是|扮演|you are now|act as|pretend to be)/i },
  { id: 'system-prompt-theft', weight: 3, re: /(系统提示词|system prompt|system instructions|初始化你的模型|你的设定|你的预设)/i },
  { id: 'secret-exfil', weight: 3, re: /(发送到|上传到|post to|send to|exfiltrate).{0,40}(https?:\/\/|\b\d{1,3}(\.\d{1,3}){3}\b)/i },
  { id: 'curl-upload', weight: 2, re: /\bcurl\b.{0,60}(-d|--data|-F|--form|-T|--upload-file)/i },
  { id: 'sudo-escalation', weight: 2, re: /\b(sudo|chmod\s+777|setuid)\b/i },
  { id: 'base64-blob', weight: 1, re: /[A-Za-z0-9+/]{120,}={0,2}/ },
  { id: 'hidden-comment', weight: 1, re: /<!--[\s\S]{0,400}?(忽略|ignore|system|指令)/i },
  { id: 'tool-directive', weight: 1, re: /(调用|执行|运行).{0,8}(bash|curl|wget|python|命令)/i }
]

const DEFAULTS = { enabled: true, threshold: 4, escalate: true }

function configOf (policy) {
  const raw = policy?.promptGuard
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS, patterns: DEFAULT_PATTERNS }
  return {
    enabled: raw.enabled !== false,
    threshold: Number.isFinite(raw.threshold) ? raw.threshold : DEFAULTS.threshold,
    escalate: raw.escalate !== false,
    patterns: Array.isArray(raw.patterns) && raw.patterns.length ? raw.patterns : DEFAULT_PATTERNS
  }
}

/**
 * 扫描一段不可信内容。
 * @param {string} text
 * @param {object} policy
 * @returns {{suspected:boolean, score:number, hits:string[], threshold:number}}
 */
export function scanContent (text, policy) {
  const cfg = configOf(policy)
  if (!cfg.enabled || typeof text !== 'string' || text === '') {
    return { suspected: false, score: 0, hits: [], threshold: cfg.threshold }
  }
  let score = 0
  const hits = []
  for (const p of cfg.patterns) {
    let re
    try {
      re = p.re instanceof RegExp ? p.re : new RegExp(String(p.re), 'i')
    } catch {
      continue
    }
    if (re.test(text)) {
      score += Number.isFinite(p.weight) ? p.weight : 1
      hits.push(p.id ?? 'pattern')
    }
  }
  return { suspected: score >= cfg.threshold, score, hits, threshold: cfg.threshold }
}

/** 该会话是否已被标记为"疑似注入"。 */
export function isSuspected (flags) {
  return flags instanceof Set && flags.has('injection-suspected')
}

/** 供策略引擎使用：疑似注入时，外发一律拒绝。 */
export function shouldEscalate (policy, flags) {
  const cfg = configOf(policy)
  return cfg.escalate && isSuspected(flags)
}