/**
 * tokenizer.mjs — 优先用真实分词器，拿不到就明确回退到估算。
 *
 * 顺序：
 *  1) LM Studio 本地服务（OpenAI 兼容）的 /v1/tokenize（若可用）
 *  2) 已安装的 tiktoken（可选依赖，缺失则跳过）
 *  3) token-counter 的字符估算（结果标注 source = "estimate"）
 *
 * 任何返回都带 `source` 字段：调用方必须把它显示出来，不能把估算当实测。
 */

import { estimateTokens } from './token-counter.mjs'

async function viaLmStudio(text, baseUrl, model) {
  try {
    const res = await fetch(baseUrl.replace(/\/$/, '') + '/tokenize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const tokens = Array.isArray(data?.tokens) ? data.tokens.length : null
    return typeof tokens === 'number' ? tokens : null
  } catch {
    return null
  }
}

async function viaTiktoken(text) {
  try {
    const mod = await import('tiktoken')
    const enc = mod.get_encoding('cl100k_base')
    const count = enc.encode(text).length
    enc.free()
    return count
  } catch {
    return null
  }
}

/**
 * @returns {Promise<{tokens:number, source:'lmstudio'|'tiktoken'|'estimate'}>}
 */
export async function countTokens(text, options = {}) {
  const normalized = String(text ?? '')
  if (normalized === '') return { tokens: 0, source: 'estimate' }

  if (options.baseUrl) {
    const n = await viaLmStudio(normalized, options.baseUrl, options.model || 'local-model')
    if (n !== null) return { tokens: n, source: 'lmstudio' }
  }
  if (options.allowTiktoken !== false) {
    const n = await viaTiktoken(normalized)
    if (n !== null) return { tokens: n, source: 'tiktoken' }
  }
  return { tokens: estimateTokens(normalized), source: 'estimate' }
}