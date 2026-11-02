/**
 * run.mjs — 真实环境的最小测量工具（不是完整评测框架）
 *
 * 用法：
 *   1) 实测固定开销（推荐先跑这个）
 *      node benchmark/run.mjs --overhead --base http://127.0.0.1:1234/v1 --model qwen3.5-4b
 *      → 把模型返回的 usage.prompt_tokens 写入 benchmark/results/overhead-<model>-<date>.jsonl
 *
 *   2) 手工记录一次任务结果（配合 benchmark/cases.json 的用例 id）
 *      node benchmark/run.mjs --record --case CASE_B --model qwen3.5-4b --ok --note "命中官方 LTS 版本"
 *      → 写入 benchmark/results/cases-<model>-<date>.jsonl
 *
 *   3) 汇总
 *      node benchmark/run.mjs --summary
 *
 * 设计原则：没有真实运行记录，就不产出百分比。README 里只放这里汇总出来的数字。
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

/** 组装与预设等效的最小 payload（persona + 4 个工具 schema）。 */
function buildPayload() {
  const parts = slimOverheadParts()
  return {
    parts,
    system: [
      '你是面向本地中小模型的极简高效编程与知识增强助手。',
      '1. 简单操作：阅读、编辑文件或单条命令由你自己使用 read/edit/bash 完成。',
      '2. 联网线索：需要最新事实或外部知识时，用 web_search 取 3-5 条带来源标签的摘要。',
      '3. 深度研究：需要读网页全文或多步比对时，委派 subagent，不要在主窗口读长文。',
      '4. 事实纪律：依据确凿事实作答，查不到就明说“未充分证实”，不要编造。',
      '5. 目标达成后立即调用 task_complete 收尾，不要追加无意义回复。',
    ].join('\n'),
  }
}

async function overhead() {
  const base = arg('base', process.env.LMSTUDIO_BASE || 'http://127.0.0.1:1234/v1')
  const model = arg('model', process.env.LMSTUDIO_MODEL || 'local-model')
  const { system, parts } = buildPayload()

  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: 'ping' }],
    max_tokens: 1,
    temperature: 0,
  }
  const res = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error('endpoint returned HTTP ' + res.status)
  const data = await res.json()
  const promptTokens = data?.usage?.prompt_tokens

  const localEstimate = await countTokens(system, { baseUrl: base, model })
  const record = {
    ts: new Date().toISOString(),
    kind: 'overhead',
    model,
    base,
    usagePromptTokens: typeof promptTokens === 'number' ? promptTokens : null,
    systemTokens: localEstimate,
    estimateParts: parts,
    note: 'usagePromptTokens 含系统消息 + 用户消息 + 服务端模板；systemTokens 是本仓库自己算的估算/分词结果',
  }
  await ensureDir()
  const file = join(resultsDir, 'overhead-' + model.replace(/[^\w.-]+/g, '_') + '-' + today() + '.jsonl')
  await appendFile(file, JSON.stringify(record) + '\n', 'utf8')
  console.log('写入 ' + file)
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