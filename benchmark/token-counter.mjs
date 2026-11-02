/**
 * token-counter.mjs — 上下文固定开销的**估算器**
 *
 * ⚠️ 这不是 tokenizer 实测。这里按字符类别给出经验系数，误差通常在 ±15% 以内。
 * 需要精确值时用 benchmark/tokenizer.mjs（走真实分词器），或直接读模型返回的 usage.prompt_tokens。
 */

export function estimateTokens(text) {
  if (!text) return 0
  const cjk = (String(text).match(/[\u4e00-\u9fa5]/g) || []).length
  const ascii = String(text).length - cjk
  return Math.ceil(cjk * 0.8 + ascii * 0.28)
}

/** README 里描述的那套组合，用于估算固定开销。 */
export function slimOverheadParts() {
  const persona = [
    '你是面向本地中小模型的极简高效编程与知识增强助手。',
    '1. 简单操作：阅读、编辑文件或单条命令由你自己使用 read/edit/bash 完成。',
    '2. 联网线索：需要最新事实或外部知识时，用 web_search 取 3-5 条带来源标签的摘要。',
    '3. 深度研究：需要读网页全文或多步比对时，委派 subagent，不要在主窗口读长文。',
    '4. 事实纪律：依据确凿事实作答，查不到就明说“未充分证实”，不要编造。',
    '5. 目标达成后立即调用 task_complete 收尾，不要追加无意义回复。',
  ].join('\n')

  // read / edit 由 tool-fs 提供，这里只算我们自己注册的 4 个工具
  const tools = [
    { name: 'bash', description: 'Run one shell command in the session workspace. Prefer short, single-purpose commands.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Command line to execute.' } }, required: ['command'] } },
    { name: 'web_search', description: 'Search the web for clues. Returns up to 4 items: source-tag, title, URL, one-line snippet. Never returns page bodies.', parameters: { type: 'object', properties: { queries: { type: 'array', items: { type: 'string' }, description: '1 to 3 query strings.' } }, required: ['queries'] } },
    { name: 'task_complete', description: 'Call exactly once when the objective is achieved: summarizes and stops further turns.', parameters: { type: 'object', properties: { summary: { type: 'string', description: 'One or two sentences: what was done and the conclusion.' } }, required: ['summary'] } },
    { name: 'subagent', description: 'Delegate multi-page reading or deep research to an isolated child agent. Only its distilled report returns; page bodies never enter this context.', parameters: { type: 'object', properties: { task_description: { type: 'string' }, constraints: { type: 'string' }, max_turns: { type: 'integer' }, context_budget: { type: 'integer' }, expected_output: { type: 'string' } }, required: ['task_description', 'expected_output'] } },
  ]

  const personaTokens = estimateTokens(persona)
  const toolTokens = estimateTokens(JSON.stringify(tools))
  const framingTokens = 120
  return { personaTokens, toolTokens, framingTokens, total: personaTokens + toolTokens + framingTokens }
}

/** 不同上下文档位下，剩余给任务的空间（同样是估算）。 */
export function contextBudget(totalTokens, windows = [4096, 8192, 32768]) {
  return windows.map((window) => ({
    window,
    available: window - totalTokens,
    ratio: Number((((window - totalTokens) / window) * 100).toFixed(1)),
  }))
}

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  const parts = slimOverheadParts()
  console.log('=== 固定开销估算（非 tokenizer 实测）===')
  console.log(`persona        ~${parts.personaTokens}`)
  console.log(`4 个自注册工具  ~${parts.toolTokens}`)
  console.log(`协议/帧        ~${parts.framingTokens}`)
  console.log(`合计           ~${parts.total} tokens（±15%）`)
  console.log('')
  for (const row of contextBudget(parts.total)) {
    console.log(`窗口 ${row.window}: 剩余 ~${row.available} (${row.ratio}%)`)
  }
  console.log('')
  console.log('注意：read/edit 由 tool-fs 提供，其 schema 也会计入固定开销，此处未统计。')
}