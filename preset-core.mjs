/**
 * preset-core.mjs — dsh-slim-agent 的唯一实现（预设作用域内挂载）
 *
 * 设计目标：让 1.7B–8B 本地小模型在 4K–8K 上下文里拥有接近完整 Agent 的能力。
 * 手段：主代理只留 6 个工具；重型网页阅读与多步研究交给子代理，只回传提炼结论。
 *
 * 约束（均为本机实测得到，改动前请先看 README 的「已验证形态」）：
 *  - 必须是单文件、只 import `node:` 内建模块（跨文件相对导入在预设作用域解析失败）；
 *  - 不得注册 read/write/edit（由 @deepseek-ai/dsh-tool-fs 提供，重名会抛错并丢弃整条预设）。
 *
 * 配置项（写在预设声明的 config 里）：
 *   concurrencyLimit   子代理并发上限，默认 1
 *   searchEngine       'auto' | 'builtin' | 'host'，默认 auto
 *   maxTurnsDefault / maxTurnsDeep / maxToolCalls
 *   bash               'sandbox'(默认) | 'local' | 'off'
 *   auditFile          审计日志路径，默认 <dshHome>/slim-agent-audit.jsonl
 */

import { appendFile } from 'node:fs/promises'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { join } from 'node:path'

const execAsync = promisify(execCb)

export const name = 'dsh-slim-agent-core'
export const inject = ['tools', 'systemPrompt']

/** 主代理可见的 6 个工具。read/edit 来自 tool-fs，其余由本模块注册。 */
const ALLOW = new Set(['read', 'edit', 'bash', 'web_search', 'task_complete', 'subagent'])

/** local 模式下拒绝的命令模式（启发式，不是安全边界）。 */
const DANGEROUS = [
  /\brm\s+(-[a-zA-Z]*\s+)*\/(\s|$)/,
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+[a-zA-Z]:\//i,
  /\bformat\s+[a-zA-Z]:/i,
  /\bmkfs(\.|\s)/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bdiskpart\b/i,
  /\breg\s+delete\b/i,
  /curl[^|]*\|\s*(sudo\s+)?(ba)?sh/i,
  /wget[^|]*\|\s*(sudo\s+)?(ba)?sh/i,
  /\bdd\s+if=/i,
]

/* ───────────────────────────── 信源标签 ───────────────────────────── */

/**
 * 给搜索结果打上来源性质标签。
 * 注意：这是**域名启发式**，只帮助小模型快速区分"源码/文档/百科/社区"，不构成权威性认定。
 */
export function classifySource(rawUrl) {
  let host = ''
  let path = ''
  try {
    const u = new URL(rawUrl)
    host = u.hostname.toLowerCase()
    path = u.pathname
  } catch {
    return '[其他]'
  }
  const isWiki = host.endsWith('wikipedia.org') || host.endsWith('wiktionary.org')
  if (isWiki) return '[百科]'

  if (host === 'github.com' || host.endsWith('.github.com')) {
    if (/\/(issues|pull)\//.test(path)) return '[社区讨论]'
    if (/^\/([^/]+)\/([^/]+)\/(releases|blob|tree)/.test(path)) return '[源码仓库]'
    return '[源码仓库]'
  }
  if (host === 'stackoverflow.com' || host.endsWith('.stackexchange.com') || host === 'stackexchange.com') return '[社区问答]'
  if (['reddit.com', 'v2ex.com', 'news.ycombinator.com', 'juejin.cn', 'zhihu.com', 'dev.to', 'segmentfault.com', 'csdn.net', 'cnblogs.com'].some((d) => host === d || host.endsWith('.' + d))) return '[社区讨论]'
  if (host.startsWith('docs.') || host.startsWith('developer.') || /\/(docs|documentation|manual|reference)\//.test(path)) return '[文档站]'
  if (host.endsWith('.gov') || host.endsWith('.edu')) return '[机构站]'
  return '[其他]'
}

/** 从文本里取最近年份，仅作为"线索"，不是发布时间。 */
export function guessYear(text) {
  const matches = String(text || '').match(/\b(20[2-3][0-9])\b/g)
  if (!matches || matches.length === 0) return ''
  return ` (${matches[matches.length - 1]})`
}

/* ───────────────────────────── 搜索 ───────────────────────────── */

const stripTags = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

async function searchDuckDuckGo(query, signal) {
  try {
    const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
      signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' },
    })
    if (!res.ok) return []
    const html = await res.text()
    const out = []
    const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
    let m
    while ((m = re.exec(html)) !== null && out.length < 5) {
      let href = m[1]
      if (href.includes('uddg=')) {
        try {
          href = decodeURIComponent(new URL(href, 'https://html.duckduckgo.com').searchParams.get('uddg') || href)
        } catch {}
      }
      const title = stripTags(m[2])
      const snippet = stripTags(m[3])
      if (title && href) out.push({ title, snippet, url: href })
    }
    return out
  } catch {
    return []
  }
}

async function searchWikipedia(query, signal) {
  try {
    const en = /^[a-zA-Z0-9\s._-]+$/.test(query)
    const url = 'https://' + (en ? 'en' : 'zh') + '.wikipedia.org/w/api.php?action=opensearch&search=' +
      encodeURIComponent(query) + '&limit=4&namespace=0&format=json'
    const res = await fetch(url, { signal })
    if (!res.ok) return []
    const d = await res.json()
    const t = d[1] || []
    const s = d[2] || []
    const u = d[3] || []
    return t.map((_, i) => ({ title: t[i], snippet: s[i] || '', url: u[i] })).filter((x) => x.title && x.url)
  } catch {
    return []
  }
}

/**
 * 搜索：宿主 provider 优先，其次 DuckDuckGo，最后 Wikipedia。
 * 这是**顺序降级链**，不是交叉验证。
 */
export async function searchWeb(ctx, query, opts) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs)
  try {
    // 只有非 builtin 模式，才尝试调用宿主 ctx.web.search
    if (opts.searchEngine !== 'builtin' && ctx?.web && typeof ctx.web.search === 'function') {
      try {
        const r = await ctx.web.search({ query, maxResults: opts.maxResults }, ctl.signal)
        if (Array.isArray(r?.sources) && r.sources.length) return { engine: 'host', items: r.sources }
      } catch {}
    }
    // 只有非 host 模式，才调用内置免 Key 搜索（DuckDuckGo / Wikipedia 降级链）
    if (opts.searchEngine !== 'host') {
      let items = await searchDuckDuckGo(query, ctl.signal)
      if (items.length) return { engine: 'duckduckgo', items }
      items = await searchWikipedia(query, ctl.signal)
      if (items.length) return { engine: 'wikipedia', items }
    }
    return { engine: 'none', items: [] }
  } finally {
    clearTimeout(timer)
  }
}

/* ───────────────────────────── 并发闸门 ───────────────────────────── */

export class AsyncSemaphore {
  constructor(capacity = 1) {
    this.capacity = Math.max(1, Number(capacity) || 1)
    this.current = 0
    this.waiters = []
  }
  async acquire() {
    if (this.current < this.capacity) {
      this.current += 1
      return
    }
    await new Promise((resolve) => this.waiters.push(resolve))
    this.current += 1
  }
  release() {
    this.current = Math.max(0, this.current - 1)
    const next = this.waiters.shift()
    if (next) next()
  }
}

/* ───────────────────────────── 子代理 ───────────────────────────── */

/**
 * 探测宿主子代理能力并返回调用方式。
 * DSH 0.2.x：ctx.subagents.startActivation(spec)
 * DSH 0.1.x：ctx.subagents.start(name, request)
 */
export function detectSubagentApi(service) {
  if (!service || typeof service !== 'object') return null
  if (typeof service.startActivation === 'function') return 'activation'
  if (typeof service.start === 'function') return 'start'
  return null
}

/** 从一次 run 的结果里取最终助手文本。 */
function extractReport(result) {
  const output = Array.isArray(result?.output) ? result.output : []
  const parts = []
  for (const part of output) {
    if (typeof part === 'string') parts.push(part)
    else if (part && typeof part.text === 'string') parts.push(part.text)
  }
  return parts.join('\n').trim()
}

/* ───────────────────────────── 插件主体 ───────────────────────────── */

export function apply(ctx, config = {}) {
  const opts = {
    concurrencyLimit: Number(config.concurrencyLimit) || 1,
    searchEngine: config.searchEngine || 'auto',
    maxResults: Number(config.searchMaxResults) || 4,
    timeoutMs: Number(config.searchTimeoutMs) || 15000,
    maxTurnsDefault: Number(config.maxTurnsDefault) || 8,
    maxTurnsDeep: Number(config.maxTurnsDeep) || 12,
    maxToolCalls: Number(config.maxToolCalls) || 15,
    bash: config.bash || 'sandbox',
    auditFile: config.auditFile || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'slim-agent-audit.jsonl'),
  }
  const sem = new AsyncSemaphore(opts.concurrencyLimit)
  const disposers = []

  /** 注册工具：任何一次注册失败都不应拖垮整条预设。 */
  const reg = (tool) => {
    try {
      disposers.push(ctx.tools.register(tool))
    } catch (error) {
      try {
        ctx.logger?.warn?.('[slim-core] tool "' + tool.name + '" not registered: ' + String(error?.message || error))
      } catch {}
    }
  }

  const audit = (entry) => {
    void appendFile(opts.auditFile, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8').catch(() => {})
  }

  const textOut = (key) => ({
    schema: { type: 'object', properties: { [key]: { type: 'string' } }, required: [key] },
    render: (_args, value) => [{ type: 'text', text: String(value[key] ?? '') }],
  })

  /* ── 1. bash ─────────────────────────────────────────────────────── */
  const bashSandboxAvailable = typeof ctx.subprocess?.spawn === 'function'
  if (opts.bash !== 'off') {
    reg({
      name: 'bash',
      description: 'Run one shell command in the session workspace. Prefer short, single-purpose commands.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Command line to execute.' } },
        required: ['command'],
      },
      output: textOut('output'),
      async execute(args, exec) {
        const command = String(args.command ?? '')
        if (command.trim() === '') return { output: 'No command provided.' }

        const cwd = exec?.agent?.session?.header?.cwd || process.cwd()
        const startedAt = Date.now()

        // 策略 1: sandbox 沙箱执行（默认基线）
        if (opts.bash === 'sandbox') {
          if (!bashSandboxAvailable) {
            audit({ kind: 'bash', policy: 'sandbox', refused: 'no-sandbox-service', command })
            throw new Error('bash unavailable: host exposes no sandboxed shell (ctx.subprocess.spawn). Set bash: "local" in the preset config to allow unsandboxed execution.')
          }

          const isWin = process.platform === 'win32'
          const shellArgv = isWin
            ? ['powershell.exe', '-NoProfile', '-Command', command]
            : ['bash', '-c', command]

          try {
            const handle = ctx.subprocess.spawn({
              argv: shellArgv,
              cwd,
              stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
              graceMs: 5000,
              signal: exec?.signal,
            })
            const outcome = await handle.done
            let stdout = ''
            let stderr = ''
            try {
              stdout = handle.collected?.stdout?.readFrom?.(0)?.text ?? ''
              stderr = handle.collected?.stderr?.readFrom?.(0)?.text ?? ''
            } catch {}
            const exitCode = outcome?.exitCode ?? (outcome?.signal ? 1 : 0)
            let text = stdout.trim()
            if (stderr.trim()) text += (text ? '\n' : '') + '[stderr]\n' + stderr.trim()
            if (!text) text = '(no output)'
            audit({ kind: 'bash', policy: 'sandbox', command, cwd, exit: exitCode, ms: Date.now() - startedAt })
            return { output: text.length > 4000 ? text.slice(0, 4000) + '\n...(truncated ' + text.length + ' chars)' : text }
          } catch (error) {
            audit({ kind: 'bash', policy: 'sandbox', command, cwd, exit: 1, ms: Date.now() - startedAt })
            throw error
          }
        }

        // 策略 2: local 本地降级执行（显式允许）
        if (opts.bash === 'local') {
          const hit = DANGEROUS.find((re) => re.test(command))
          if (hit) {
            audit({ kind: 'bash', policy: 'local', refused: 'dangerous-pattern', pattern: String(hit), command })
            throw new Error('command refused by slim-agent policy: it matches a destructive pattern. Narrow the command or run it manually.')
          }

          try {
            const { stdout, stderr } = await execAsync(command, { cwd, timeout: 60000, maxBuffer: 512 * 1024, windowsHide: true })
            let text = (stdout || '').trim()
            if (stderr) text += (text ? '\n' : '') + '[stderr]\n' + stderr.trim()
            if (!text) text = '(no output)'
            audit({ kind: 'bash', policy: 'local', command, cwd, exit: 0, ms: Date.now() - startedAt })
            return { output: text.length > 4000 ? text.slice(0, 4000) + '\n...(truncated ' + text.length + ' chars)' : text }
          } catch (error) {
            audit({ kind: 'bash', policy: 'local', command, cwd, exit: error?.code ?? 1, ms: Date.now() - startedAt })
            const body = String((error?.stdout || '') + (error?.stderr || '') + (error?.message || '')).slice(0, 4000)
            return { output: '[exit ' + (error?.code ?? 1) + ']\n' + body }
          }
        }

        throw new Error('unknown bash policy: ' + opts.bash)
      },
    })
  }

  /* ── 2. web_search ───────────────────────────────────────────────── */
  reg({
    name: 'web_search',
    description: 'Search the web for clues. Returns up to 4 items: source-tag, title, URL, one-line snippet. Never returns page bodies.',
    parameters: {
      type: 'object',
      properties: {
        queries: { type: 'array', items: { type: 'string' }, description: '1 to 3 query strings.' },
      },
      required: ['queries'],
    },
    output: textOut('result'),
    async execute(args) {
      const queries = (Array.isArray(args.queries) ? args.queries : []).filter((q) => typeof q === 'string' && q.trim() !== '')
      if (queries.length === 0) return { result: 'No usable query provided.' }
      if (queries.length > 3) queries.length = 3
      const query = queries.join(' ')
      const { engine, items } = await searchWeb(ctx, query, opts)
      if (items.length === 0) {
        return { result: 'No results for "' + query + '". Try broader keywords, or delegate to subagent with a specific site.' }
      }
      const lines = ['[线索] "' + query + '" via ' + engine + '（前 ' + Math.min(items.length, opts.maxResults) + ' 条，读全文请委派 subagent）:']
      const max = Math.min(items.length, opts.maxResults)
      for (let i = 0; i < max; i += 1) {
        const item = items[i]
        const url = item.url || ''
        const title = String(item.title || 'link').replace(/\s+/g, ' ').slice(0, 40)
        const snippet = String(item.snippet || '').replace(/\s+/g, ' ').slice(0, 80)
        lines.push((i + 1) + '. ' + classifySource(url) + ' [' + title + '](' + url + ')' + guessYear(title + ' ' + snippet) + ' — ' + (snippet || '无摘要'))
      }
      lines.push('')
      lines.push('（标签是域名启发式，仅作参考；关键结论请交叉核对原始来源。）')
      return { result: lines.join('\n') }
    },
  })

  /* ── 3. task_complete ────────────────────────────────────────────── */
  reg({
    name: 'task_complete',
    description: 'Call exactly once when the objective is achieved: summarizes and stops further turns.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'One or two sentences: what was done and the conclusion.' } },
      required: ['summary'],
    },
    output: textOut('status'),
    async execute(args, exec) {
      try {
        if (typeof exec?.concludeTurn === 'function') exec.concludeTurn()
      } catch {}
      return { status: '[DONE] ' + String(args.summary ?? '') }
    },
  })

  /* ── 4. subagent ─────────────────────────────────────────────────── */
  reg({
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
    output: textOut('report'),
    async execute(args, exec) {
      const service = ctx.subagents
      if (!service || typeof service.startActivation !== 'function') {
        throw new Error('subagent unavailable: DSH 0.2.x host exposes no subagents.startActivation service.')
      }

      const turns = Math.min(Math.max(1, Number(args.max_turns) || opts.maxTurnsDefault), opts.maxTurnsDeep)
      const prompt = [
        '【深度研究子任务】',
        '目标：' + args.task_description,
        args.constraints ? '限制：' + args.constraints : '',
        '期望结构：' + args.expected_output,
        '预算：最多 ' + turns + ' 轮。',
        '单任务工具调用上限：最多 ' + opts.maxToolCalls + ' 次。',
        '',
        '纪律：',
        '1. 用 web_search / web_fetch / read / bash 做多步检索，不要臆测；',
        '2. 工具调用最多不超过 ' + opts.maxToolCalls + ' 次，接近上限时立刻整理收束；',
        '3. 不要把网页原文整段复制出来，只提炼要点并附来源 URL；',
        '4. 关键结论尽量用两个独立来源交叉核对；无法核实的写进【未验证部分】；',
        '5. 最后按三段式输出：【已确认结论】【未验证部分】【建议主代理下一步】。',
      ].filter(Boolean).join('\n')

      await sem.acquire()
      try {
        if (exec?.signal?.aborted) throw new Error('delegation cancelled before start')
        const request = {
          prompt: [{ type: 'text', text: prompt }],
          parent: exec?.agent,
          signal: exec?.signal,
          maxDepth: 1,
        }
        const activation = await service.startActivation({
          provider: config.subagentProvider || 'spawn',
          label: 'slim: ' + String(args.task_description).slice(0, 40),
          request,
          signal: exec?.signal,
          delivery: 'parent',
        })

        const childId = activation.childId
        let report = ''
        if (ctx.agents && typeof ctx.agents.get === 'function') {
          const childAgent = ctx.agents.get(childId)
          if (childAgent && typeof childAgent.whenIdle === 'function') {
            await childAgent.whenIdle()
            const events = childAgent.session?.snapshotEvents?.(0) || []
            const assistantMsgs = events.filter((e) => e.type === 'message' && e.data?.role === 'assistant')
            const lastMsg = assistantMsgs[assistantMsgs.length - 1]
            report = extractReport({ output: lastMsg?.data?.content || [] })
          }
        }
        if (!report) {
          report = `[子代理 ${childId} 已激活执行。]`
        }
        return { report }
      } finally {
        // 关键安全保证：无论取消还是报错，信号量 100% 释放，彻底杜绝死锁
        sem.release()
      }
    },
  })

  /* ── 5. 主代理工具面：6 个，异常时 fail-closed ────────────────────── */
  const withoutTools = (assembly) => {
    const copy = {}
    try {
      for (const key of Object.keys(assembly ?? {})) {
        if (key === 'tools') continue
        try { copy[key] = assembly[key] } catch { /* 单个坏字段直接丢弃 */ }
      }
    } catch { /* 完全读不出来就只返回空工具集 */ }
    return { ...copy, tools: [] }
  }

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    let assembled
    try {
      assembled = await next()
    } catch (error) {
      try { ctx.logger?.warn?.('[slim-core] upstream assembly failed, exposing no tools (fail-closed): ' + String(error)) } catch {}
      return { tools: [] }
    }
    try {
      const header = context?.agent?.session?.header
      const isChild = header !== undefined && (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0)
      if (isChild) return assembled
      const tools = Array.isArray(assembled.tools) ? assembled.tools : []
      return { ...assembled, tools: tools.filter((tool) => ALLOW.has(tool?.name)) }
    } catch (error) {
      try { ctx.logger?.warn?.('[slim-core] whitelist failed, exposing no tools (fail-closed): ' + String(error)) } catch {}
      return withoutTools(assembled)
    }
  }, { prepend: true })

  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        if (typeof dispose === 'function') dispose()
        else if (typeof dispose?.dispose === 'function') dispose.dispose()
      } catch {}
    }
  }
}