/**
 * run.mjs — 真实环境测量工具 (支持真实 6 工具 Schema 上下文开销测算)
 *
 * 用法：
 *   1) 实测固定开销（完整带 6 个工具 Schema + 纯消息对照）：
 *      node benchmark/run.mjs --overhead --base http://127.0.0.1:1234/v1 --model qwen3.5-4b
 *      → 把模型端真实统计的 usage.prompt_tokens 写入 benchmark/results/overhead-<model>-<date>.jsonl
 *
 *   2) 手工记录一次任务结果（配合 benchmark/cases.json 的用例 id）：
 *      node benchmark/run.mjs --record --case CASE_B --model qwen3.5-4b --ok --note "命中官方 LTS"
 *      → 写入 benchmark/results/cases-<model>-<date>.jsonl
 *
 *   3) 汇总统计：
 *      node benchmark/run.mjs --summary
 */

import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countTokens } from './tokenizer.mjs'
import { slimOverheadParts } from './token-counter.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const resultsDir = join(here, 'results')

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf('--' + name)
  if (i === -1) return fallback
  const next = process.argv[i + 1]
  return next !== undefined && !next.startsWith('--') ? next : true
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

async function ensureDir() {
  await mkdir(resultsDir, { recursive: true })
}

/** 组装与预设等效的完整 payload（persona + 完整的 6 个主代理工具定义）。 */
function buildPayload() {
  const parts = slimOverheadParts()
  const system = [
    '你是面向本地中小模型的极简高效编程与知识增强助手。',
    '1. 简单操作：阅读、编辑文件或单条命令由你自己使用 read/edit/bash 完成。',
    '2. 联网线索：需要最新事实或外部知识时，用 web_search 取 3-5 条带来源标签的摘要。',
    '3. 深度研究：需要读网页全文或多步比对时，委派 subagent，不要在主窗口读长文。',
    '4. 事实纪律：依据确凿事实作答，查不到就明说“未充分证实”，不要编造。',
    '5. 目标达成后立即调用 task_complete 收尾，不要追加无意义回复。',
  ].join('\n')

  const tools = [
    {
      type: 'function',
      function: {
        name: 'read',
        description: 'Read lines from a UTF-8 text file. Specify offset and limit to page through large files.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path.' },
            offset: { type: 'integer', description: 'Start line, default 1.' },
            limit: { type: 'integer', description: 'Max lines, default 200.' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit',
        description: 'Replace exact literal text in a file. old_string must match exactly once.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path.' },
            old_string: { type: 'string', description: 'Exact text to replace.' },
            new_string: { type: 'string', description: 'Replacement text.' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'bash',
        description: 'Run one shell command in the session workspace. Prefer short, single-purpose commands.',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: 'Command line to execute.' } },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for clues. Returns up to 4 items: source-tag, title, URL, one-line snippet. Never returns page bodies.',
        parameters: {
          type: 'object',
          properties: {
            queries: { type: 'array', items: { type: 'string' }, description: '1 to 3 query strings.' },
          },
          required: ['queries'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'task_complete',
        description: 'Call exactly once when the objective is achieved: summarizes and stops further turns.',
        parameters: {
          type: 'object',
          properties: { summary: { type: 'string', description: 'One or two sentences: what was done and the conclusion.' } },
          required: ['summary'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'subagent',
        description: 'Delegate multi-page reading or deep research to an isolated child agent. Only its distilled report returns; page bodies never enter this context.',
        parameters: {
          type: 'object',
          properties: {
            task_description: { type: 'string', description: 'Objective plus the context the child needs.' },
            constraints: { type: 'string', description: 'Scope limits, forbidden sources, etc. (optional).' },
            max_turns: { type: 'integer', description: 'Turn cap; defaults to the preset limit.' },
            context_budget: { type: 'integer', description: 'Advisory token budget for the child.' },
            expected_output: { type: 'string', description: 'Shape of the report you want back.' },
          },
          required: ['task_description', 'expected_output'],
        },
      },
    },
  ]

  return { parts, system, tools }
}

async function requestPromptTokens(base, body) {
  const res = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error('endpoint returned HTTP ' + res.status)
  const data = await res.json()
  return data?.usage?.prompt_tokens ?? null
}

async function overhead() {
  const base = arg('base', process.env.LMSTUDIO_BASE || 'http://127.0.0.1:1234/v1')
  const model = arg('model', process.env.LMSTUDIO_MODEL || 'local-model')
  const { system, tools, parts } = buildPayload()

  console.log(`正在请求 ${base} 测量模型 [${model}] 的首轮真实固定开销...`)

  // 1. 发送带完整 6 个工具 Schema 的真实调用
  const bodyWithTools = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: 'ping' }],
    tools,
    tool_choice: 'auto',
    max_tokens: 1,
    temperature: 0,
  }
  const promptTokensWithTools = await requestPromptTokens(base, bodyWithTools)

  // 2. 发送不带工具的纯消息调用（用于对照差值）
  const bodyWithoutTools = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: 'ping' }],
    max_tokens: 1,
    temperature: 0,
  }
  const promptTokensWithoutTools = await requestPromptTokens(base, bodyWithoutTools)

  const localEstimate = await countTokens(system, { baseUrl: base, model })
  const toolOverhead = (promptTokensWithTools !== null && promptTokensWithoutTools !== null)
    ? (promptTokensWithTools - promptTokensWithoutTools)
    : null

  const record = {
    ts: new Date().toISOString(),
    kind: 'overhead',
    model,
    base,
    realTotalPromptTokensWith6Tools: promptTokensWithTools,
    realPromptTokensWithoutTools: promptTokensWithoutTools,
    serverToolSchemaOverhead: toolOverhead,
    localSystemEstimate: localEstimate,
    estimateParts: parts,
    note: 'realTotalPromptTokensWith6Tools 是模型服务端的真正首轮固定开销（含系统词+6工具Schema+ChatML格式）。',
  }

  await ensureDir()
  const file = join(resultsDir, 'overhead-' + model.replace(/[^\w.-]+/g, '_') + '-' + today() + '.jsonl')
  await appendFile(file, JSON.stringify(record) + '\n', 'utf8')
  console.log('测量完成！已写入 ' + file)
  console.log(JSON.stringify(record, null, 2))
}

async function record() {
  const id = arg('case')
  const model = arg('model', 'unknown')
  if (!id) throw new Error('--case <CASE_ID> is required')
  const ok = process.argv.includes('--ok')
  const note = arg('note', '')
  const record = { ts: new Date().toISOString(), kind: 'case', case: id, model, ok, note }
  await ensureDir()
  const file = join(resultsDir, 'cases-' + String(model).replace(/[^\w.-]+/g, '_') + '-' + today() + '.jsonl')
  await appendFile(file, JSON.stringify(record) + '\n', 'utf8')
  console.log('写入 ' + file)
}

async function summary() {
  await ensureDir()
  const files = (await readdir(resultsDir)).filter((f) => f.startsWith('cases-'))
  if (files.length === 0) {
    console.log('还没有任何用例记录。先跑用例并 --record，再执行 --summary。')
    return
  }
  const byKey = new Map()
  for (const file of files) {
    const lines = (await readFile(join(resultsDir, file), 'utf8')).split('\n').filter(Boolean)
    for (const line of lines) {
      const row = JSON.parse(line)
      const key = row.case + ' @ ' + row.model
      const cell = byKey.get(key) || { total: 0, ok: 0 }
      cell.total += 1
      if (row.ok) cell.ok += 1
      byKey.set(key, cell)
    }
  }
  console.log('用例 | 样本数 | 成功数 | 成功率')
  for (const [key, cell] of byKey) {
    console.log(key + ' | ' + cell.total + ' | ' + cell.ok + ' | ' + ((cell.ok / cell.total) * 100).toFixed(1) + '%')
  }
  console.log('')
  console.log('提示：样本数 < 5 时不要对外引用成功率。')
}

const mode = arg('overhead') ? 'overhead' : arg('record') ? 'record' : arg('summary') ? 'summary' : null
try {
  if (mode === 'overhead') await overhead()
  else if (mode === 'record') await record()
  else if (mode === 'summary') await summary()
  else {
    console.log('用法：')
    console.log('  node benchmark/run.mjs --overhead --base http://127.0.0.1:1234/v1 --model <model>')
    console.log('  node benchmark/run.mjs --record --case CASE_B --model <model> [--ok] [--note "..."]')
    console.log('  node benchmark/run.mjs --summary')
  }
} catch (error) {
  console.error('失败：' + String(error?.message || error))
  process.exitCode = 1
}