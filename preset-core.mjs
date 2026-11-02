/**
 * slim-core.mjs — 单文件零相对依赖版核心（供预设 file:// 行挂载）
 * 6 工具 + 6 工具白名单 + 可调并发子代理调度 + 内置免 Key 搜索。
 * 只依赖 node: 内建模块，不 import 任何本地文件（规避预设作用域的相对解析问题）。
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(execCb)

export const name = 'dsh-slim-agent-core'
export const inject = ['tools', 'systemPrompt']

const ALLOW = new Set(['read', 'edit', 'bash', 'web_search', 'task_complete', 'subagent'])

/* ---------- 信源染色 ---------- */
function classify(url) {
  try {
    const h = new URL(url).hostname.toLowerCase()
    const official = ['github.com', 'nodejs.org', 'python.org', 'rust-lang.org', 'golang.org',
      'w3.org', 'ietf.org', 'wikipedia.org', 'mozilla.org', 'microsoft.com', 'apache.org']
    if (official.some(d => h === d || h.endsWith('.' + d)) || h.startsWith('docs.') || h.endsWith('.edu') || h.endsWith('.gov')) return '[官方/权威]'
    const community = ['stackoverflow.com', 'stackexchange.com', 'reddit.com', 'v2ex.com', 'juejin.cn', 'zhihu.com', 'dev.to', 'csdn.net', 'cnblogs.com']
    if (community.some(d => h === d || h.endsWith('.' + d))) return '[技术社区]'
    return '[经验参考]'
  } catch { return '[参考网页]' }
}
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
const yearOf = (s) => { const m = String(s || '').match(/\b(202[0-9])\b/); return m ? ` (${m[1]})` : '' }

/* ---------- 内置免 Key 搜索 ---------- */
async function ddg(query, signal) {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' },
    })
    if (!res.ok) return []
    const html = await res.text()
    const out = []
    const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
    let m
    while ((m = re.exec(html)) !== null && out.length < 5) {
      let href = m[1]
      if (href.includes('uddg=')) { try { href = decodeURIComponent(new URL(href, 'https://html.duckduckgo.com').searchParams.get('uddg') || href) } catch {} }
      const title = stripTags(m[2]); const snippet = stripTags(m[3])
      if (title && href) out.push({ title, snippet, url: href })
    }
    return out
  } catch { return [] }
}
async function wiki(query, signal) {
  try {
    const en = /^[a-zA-Z0-9\s._-]+$/.test(query)
    const res = await fetch(`https://${en ? 'en' : 'zh'}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=4&namespace=0&format=json`, { signal })
    if (!res.ok) return []
    const d = await res.json(); const t = d[1] || [], s = d[2] || [], u = d[3] || []
    return t.map((_, i) => ({ title: t[i], snippet: s[i] || '维基百科词条', url: u[i] })).filter(x => x.title && x.url)
  } catch { return [] }
}
async function searchWorld(ctx, query, opts) {
  const timeout = opts.timeoutMs ?? 15000
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeout)
  try {
    if (ctx?.web && typeof ctx.web.search === 'function' && opts.mode !== 'builtin') {
      try {
        const r = await ctx.web.search({ query, maxResults: opts.max }, ctl.signal)
        if (Array.isArray(r?.sources) && r.sources.length) { clearTimeout(timer); return r.sources }
      } catch {}
    }
    let items = await ddg(query, ctl.signal)
    if (!items.length) items = await wiki(query, ctl.signal)
    clearTimeout(timer)
    return items
  } catch { clearTimeout(timer); return [] }
}

/* ---------- 并发信号量 ---------- */
class Semaphore {
  constructor(cap) { this.cap = Math.max(1, cap); this.cur = 0; this.q = [] }
  async acquire() { if (this.cur < this.cap) { this.cur++; return } await new Promise(r => this.q.push(r)); this.cur++ }
  release() { this.cur--; const n = this.q.shift(); if (n) n() }
}

export function apply(ctx, config = {}) {
  const opts = {
    max: config.searchMaxResults ?? 4,
    timeoutMs: config.searchTimeoutMs ?? 15000,
    mode: config.searchEngine === 'builtin' ? 'builtin' : 'auto',
    maxTurns: config.maxTurnsDefault ?? 8,
    maxTurnsDeep: config.maxTurnsDeep ?? 12,
    maxToolCalls: config.maxToolCalls ?? 15,
  }
  const sem = new Semaphore(config.concurrencyLimit ?? 1)
  const disposers = []
  const reg = (t) => { try { disposers.push(ctx.tools.register(t)) } catch (e) { try { ctx.logger?.warn?.('[slim-core] tool ' + t.name + ' skipped: ' + String(e && e.message || e)) } catch {} } }

  /* read / edit 由 @deepseek-ai/dsh-tool-fs 提供，这里不再重复注册（重名会抛错） */

  /* 3. bash */
  reg({
    name: 'bash',
    description: 'Execute a shell command.',
    parameters: { type: 'object', properties: { command: { type: 'string', description: 'Command line.' } }, required: ['command'] },
    output: { schema: { type: 'object', properties: { output: { type: 'string' } }, required: ['output'] }, render: (_a, v) => [{ type: 'text', text: v.output }] },
    async execute(args, exec) {
      try {
        const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
        const { stdout, stderr } = await execAsync(args.command, { cwd, timeout: 60000, maxBuffer: 524288, windowsHide: true })
        let t = (stdout || '').trim()
        if (stderr) t += (t ? '\n' : '') + '[stderr]\n' + stderr.trim()
        if (!t) t = '(no output)'
        return { output: t.length > 4000 ? t.slice(0, 4000) + `\n...(truncated ${t.length} chars)` : t }
      } catch (e) { return { output: `[exit ${e.code ?? 1}]\n${String((e.stdout || '') + (e.stderr || e.message || '')).slice(0, 4000)}` } }
    },
  })

  /* 4. web_search */
  reg({
    name: 'web_search',
    description: 'Search the web for facts or clues. Returns 3-5 concise items with source trust tags. Never returns page bodies.',
    parameters: { type: 'object', properties: { queries: { type: 'array', items: { type: 'string' }, description: '1-3 query strings.' } }, required: ['queries'] },
    output: { schema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] }, render: (_a, v) => [{ type: 'text', text: v.result }] },
    async execute(args) {
      const qs = (args.queries || []).filter(q => typeof q === 'string' && q.trim())
      if (!qs.length) return { result: 'No valid query provided.' }
      const q = qs.join(' ')
      const items = await searchWorld(ctx, q, opts)
      if (!items.length) return { result: `No results for "${q}". Try broader keywords or delegate to subagent.` }
      const lines = [`[线索] "${q}"（前 ${Math.min(items.length, opts.max)} 条，深挖请委派 subagent）:`]
      for (let i = 0; i < Math.min(items.length, opts.max); i++) {
        const it = items[i]; const url = it.url || ''
        let title = String(it.title || 'link').replace(/[\r\n]+/g, ' ').slice(0, 35)
        let sn = String(it.snippet || '').replace(/[\r\n]+/g, ' ').slice(0, 75)
        lines.push(`${i + 1}. ${classify(url)} [${title}](${url})${yearOf(title + ' ' + sn)} — ${sn || '无摘要'}`)
      }
      return { result: lines.join('\n') }
    },
  })

  /* 5. task_complete */
  reg({
    name: 'task_complete',
    description: 'Call when the objective is achieved to summarize and stop further turns.',
    parameters: { type: 'object', properties: { summary: { type: 'string', description: 'One or two sentences of the final conclusion.' } }, required: ['summary'] },
    output: { schema: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'] }, render: (_a, v) => [{ type: 'text', text: v.status }] },
    async execute(args, exec) { try { if (typeof exec?.concludeTurn === 'function') exec.concludeTurn() } catch {} return { status: `[DONE] ${args.summary}` } },
  })

  /* 6. subagent */
  reg({
    name: 'subagent',
    description: 'Delegate multi-step reading or deep research to an isolated subagent. Only distilled conclusions come back.',
    parameters: {
      type: 'object',
      properties: {
        task_description: { type: 'string', description: 'Objective and context.' },
        constraints: { type: 'string', description: 'Scope limits (optional).' },
        max_turns: { type: 'integer', description: 'Turn cap (default 8, deep 12).' },
        context_budget: { type: 'integer', description: 'Token budget (default 4000).' },
        expected_output: { type: 'string', description: 'Expected summary structure.' },
      },
      required: ['task_description', 'expected_output'],
    },
    output: { schema: { type: 'object', properties: { report: { type: 'string' } }, required: ['report'] }, render: (_a, v) => [{ type: 'text', text: v.report }] },
    async execute(args, exec) {
      const turns = Math.min(Math.max(1, args.max_turns ?? opts.maxTurns), opts.maxTurnsDeep)
      await sem.acquire()
      try {
        const prompt = [
          '【深度研究子任务】',
          `目标：${args.task_description}`,
          args.constraints ? `限制：${args.constraints}` : '',
          `期望结构：${args.expected_output}`,
          `预算：最多 ${turns} 轮。`,
          '',
          '纪律：可用 web_search/web_fetch/read/bash 多步检索；不要把网页原文原样甩出；',
          '关键结论尽量用两个独立信源交叉验证；未证实的放【未验证部分】；',
          '最终按【已确认结论】【未验证部分】【建议主代理下一步】三段式输出。',
        ].filter(Boolean).join('\n')
        if (ctx.subagents && typeof ctx.subagents.start === 'function') {
          let turns_used = 0, calls = 0, landed = false
          const handle = await ctx.subagents.start(config.subagentProvider ?? 'spawn', {
            label: `slim: ${String(args.task_description).slice(0, 30)}`,
            prompt: [{ type: 'text', text: prompt }],
            parent: exec?.agent, signal: exec?.signal,
            setup: (child) => {
              child.on('agent/pre-step', async (_p, next) => {
                turns_used++
                if (turns_used >= turns && !landed) {
                  landed = true
                  child.tools?.restrict?.({ deny: ['web_search', 'web_fetch', 'bash', 'edit'] })
                  return { kind: 'steer', message: { role: 'system', content: '【预算耗尽】工具已锁定，立即按三段式输出：\n1.【已确认结论】\n2.【未验证部分】\n3.【建议主代理下一步】' } }
                }
                return next()
              })
              child.on('tools/pre-execute', () => {
                calls++
                if (calls > opts.maxToolCalls && !landed) {
                  landed = true
                  child.tools?.restrict?.({ deny: ['web_search', 'web_fetch', 'bash', 'edit'] })
                }
              })
            },
          })
          const out = await handle.done
          const text = out?.output?.[0]?.text ?? out?.result ?? ''
          return { report: text || '【子代理完成，无文本输出】' }
        }
        return { report: `【子代理不可用】已记录目标：${args.task_description}` }
      } finally { sem.release() }
    },
  })

  /* 主代理可见面：只留 6 个 */
  ctx.on('system-prompt/assemble', async (_asm, context, next) => {
    const assembled = await next()
    try {
      const agent = context?.agent
      const hdr = agent?.session?.header
      if (hdr && (hdr.origin === 'subagent' || (hdr.delegationDepth ?? 0) > 0)) return assembled
      const tools = Array.isArray(assembled.tools) ? assembled.tools : []
      return { ...assembled, tools: tools.filter(t => ALLOW.has(t?.name)) }
    } catch { return assembled }
  }, { prepend: true })

  return () => { for (const d of disposers) { try { if (typeof d === 'function') d(); else d?.dispose?.() } catch {} } }
}