/**
 * 脱敏审计台账。
 *
 * 红线：绝不把参数原文、文件内容、密钥写进日志。
 * 只记录：工具名、决策、原因码、参数摘要（sha256 前 16 位 + 长度）、时间。
 */
import { createHash } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export function digestValue (value) {
  let text
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  } catch {
    text = String(value ?? '')
  }
  const hash = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
  return { digest: hash, length: text.length }
}

export function createLedger (options = {}) {
  const file = options.file
  const now = typeof options.now === 'function' ? options.now : Date.now
  const sink = typeof options.sink === 'function' ? options.sink : null
  /** @type {object[]} */
  const memory = []
  let ready = null

  function ensureDir () {
    if (!file) return Promise.resolve()
    if (!ready) ready = mkdir(dirname(file), { recursive: true }).catch(() => {})
    return ready
  }

  return {
    /** 记录一条决策；返回写入的对象，便于测试断言。 */
    record (entry) {
      const record = {
        ts: new Date(now()).toISOString(),
        sessionId: entry.sessionId ? String(entry.sessionId).slice(0, 8) : 'unknown',
        taskId: entry.taskId ?? null,
        tool: entry.tool ?? null,
        decision: entry.decision === 'allow' ? 'allow' : 'deny',
        reasonCode: entry.reasonCode ?? null,
        detail: entry.detail ? String(entry.detail).slice(0, 200) : '',
        argDigest: entry.argDigest?.digest ?? null,
        argLength: entry.argDigest?.length ?? null,
        taintHits: Number.isFinite(entry.taintHits) ? entry.taintHits : 0,
        latencyMs: Number.isFinite(entry.latencyMs) ? entry.latencyMs : null
      }
      memory.push(record)
      if (sink) {
        try { sink(record) } catch { /* 观察者失败不得影响主流程 */ }
      }
      if (file) {
        const line = JSON.stringify(record) + '\n'
        void ensureDir().then(() => appendFile(file, line, 'utf8')).catch(() => {})
      }
      return record
    },
    entries () {
      return memory.slice()
    },
    clear () {
      memory.length = 0
    }
  }
}