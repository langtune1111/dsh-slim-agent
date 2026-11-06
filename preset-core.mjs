/**
 * preset-core.mjs — dsh-slim-agent 的唯一实现（预设作用域内挂载）
 *
 * 设计目标：让 1.7B–8B 本地小模型在 4K–8K 上下文里拥有接近完整 Agent 的能力。
 * 手段：主代理只留 5 个工具；读完网页正文/跨源比对交给子代理，只回传提炼结论。
 *      0.3.0-alpha.1 起移除 task_complete：它的 concludeTurn() 会立刻结束回合，
 *      导致模型写进 summary 的结论被丢弃、最终答复为空（实测 3 次调用 3 次空答复）。
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
/**
 * 必需服务声明。
 *
 * Cordis 对**未注入**服务的属性访问会直接抛错（`a?.b` 的短路救不了它），
 * 实测报错形如 `cannot get property "subprocess" without inject`。
 * 而 `ctx.get(name)` 只能取到全局可见的服务：`web` / `agents` 可以，
 * `subprocess` / `subagents` 属于作用域服务，必须写进 inject 才可见。
 *
 * 取舍：`subprocess` 与 `subagents` 声明为必需（二者都在 @deepseek-ai/dsh-base 里，
 * 缺失时本插件会保持未激活而不是带着坏掉的 bash 工具上线）；
 * `web` 与 `agents` 保持可选，用 ctx.get 读取，宿主关掉 web 时自动退化为内置检索。
 */
export const inject = ['tools', 'systemPrompt', 'subprocess', 'subagents']

/**
 * 读取全局可见的可选服务。三种宿主都能工作：
 *  - 真实 Cordis：ctx.get(name) 返回服务或 undefined；
 *  - 精简宿主 / 单元测试替身：没有 ctx.get，服务直接挂在 ctx 上；
 *  - 严格宿主：访问缺失服务会抛错，这里吞掉并返回 undefined。
 */
function optionalService(ctx, name) {
  try {
    if (ctx && typeof ctx.get === 'function') return ctx.get(name)
  } catch {}
  try {
    return ctx ? ctx[name] : undefined
  } catch {
    return undefined
  }
}

/** 主代理可见的工具。read/edit 来自 tool-fs，其余由本模块注册。
 *  实际白名单在 apply() 里按消融开关动态构造（allow）。 */

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

/**
 * 抓取首条结果并做**确定性**抽取。
 *
 * 实测（2026-11-07）：Bing 返回的摘要里几乎不含版本号这类事实——
 * 问「Node.js 最新 LTS」拿到的是官网首页摘要，一个字都没有版本。
 * 但把同一个 URL 抓下来，首页正文里明明白白写着 `v26.13.0 Latest LTS`。
 * 也就是说：缺的不是模型的理解力，是**喂给它的材料**。
 *
 * 所以这里直接把页面抓下来、去标签、抠出版本号与 LTS 上下文，
 * 不让 1.7B 去"读摘要猜答案"。
 */
/** 只允许公网 http(s)：拒绝 file:/ftp: 与回环/私网/链路本地地址，避免被搜索结果带去 SSRF。 */
export function isFetchableUrl(rawUrl) {
  let u
  try {
    u = new URL(rawUrl)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === '' || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 0 || a === 10 || a === 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false
  }
  return true
}

export async function fetchExcerpt(rawUrl, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) || 8000
  const maxChars = Number(opts.maxChars) || 1500
  if (!isFetchableUrl(rawUrl)) return null
  try {
    const res = await fetch(rawUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; dsh-slim-agent)' },
      redirect: 'follow',
    })
    if (!res.ok) return null
    const type = String(res.headers.get('content-type') || '').toLowerCase()
    if (type && !/text\/|json|xml/.test(type)) return null
    const len = Number(res.headers.get('content-length') || 0)
    if (len > 2_000_000) return null
    let raw = await res.text()
    // 先截断再跑正则：避免对几 MB 的页面做全文匹配
    if (raw.length > 400_000) raw = raw.slice(0, 400_000)
    const text = stripTags(
      raw
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' '),
    )
    const versions = Array.from(new Set(String(text).match(/v?\d+\.\d+\.\d+/g) || [])).slice(0, 6)
    const contexts = []
    const re = /(latest\s*(lts|stable)|最新.*?(长期支持|lts)|lts)/gi
    let m
    while ((m = re.exec(text)) !== null && contexts.length < 3) {
      contexts.push(text.slice(Math.max(0, m.index - 60), Math.min(text.length, m.index + 90)))
    }
    return { text: String(text).slice(0, maxChars), versions, contexts: contexts.map((c) => c.trim()) }
  } catch {
    return null
  }
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

async function searchBing(query, signal) {
  try {
    const res = await fetch('https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=zh-CN', {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })
    if (!res.ok) return []
    const html = await res.text()
    const out = []
    const re = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/li>/gi
    let m
    while ((m = re.exec(html)) !== null && out.length < 5) {
      const href = decodeBingHref(m[1])
      const title = stripTags(m[2])
      const tail = m[3] || ''
      const pm = tail.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      const snippet = pm ? stripTags(pm[1]) : ''
      if (title && href && /^https?:\/\//.test(href)) out.push({ title, snippet, url: href })
    }
    if (out.length) return out
    const re2 = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let n
    while ((n = re2.exec(html)) !== null && out.length < 5) {
      const href = decodeBingHref(n[1])
      const title = stripTags(n[2])
      if (title && href && /^https?:\/\//.test(href)) out.push({ title, snippet: '', url: href })
    }
    return out
  } catch {
    return []
  }
}

/** Bing 跳转链接形如 https://www.bing.com/ck/a?...&u=a1<base64url>；解出真实 URL。 */
function decodeBingHref(raw) {
  try {
    if (!raw.includes('bing.com/ck/a')) return raw
    const u = new URL(raw, 'https://www.bing.com').searchParams.get('u')
    if (!u) return raw
    const b64 = u.startsWith('a1') ? u.slice(2) : u
    return Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  } catch {
    return raw
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
    // 只有非 builtin 模式，才尝试调用宿主 web 服务（宿主未挂载时 ctx.get 返回 undefined）
    const hostWeb = optionalService(ctx, 'web')
    if (opts.searchEngine !== 'builtin' && hostWeb && typeof hostWeb.search === 'function') {
      try {
        const r = await hostWeb.search({ query, maxResults: opts.maxResults }, ctl.signal)
        if (Array.isArray(r?.sources) && r.sources.length) return { engine: 'host', items: r.sources }
      } catch {}
    }
    // 只有非 host 模式，才调用内置免 Key 搜索（DuckDuckGo / Wikipedia 降级链）
    if (opts.searchEngine !== 'host') {
      let items = await searchDuckDuckGo(query, ctl.signal)
      if (items.length) return { engine: 'duckduckgo', items }
      // DuckDuckGo 在部分网络环境（如中国大陆直连）不可达，退到 Bing
      items = await searchBing(query, ctl.signal)
      if (items.length) return { engine: 'bing', items }
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
    maxSearches: config.maxSearches === undefined ? 5 : Math.max(0, Math.floor(Number(config.maxSearches) || 0)),
    // 抓首条结果正文并做确定性抽取（只读一次、8 秒超时、失败静默）
    fetchTopResult: config.fetchTopResult !== false,
    fetchTimeoutMs: Number(config.fetchTimeoutMs) || 8000,
    fetchMaxChars: Number(config.fetchMaxChars) || 1200,
    // 强制收敛：'off' 保持 0.3.1 行为；'budget' 搜索超限后清空工具；'hardCap' 工具调用总量达上限后清空
    convergeMode: ['off', 'budget', 'hardCap'].includes(config.convergeMode) ? config.convergeMode : 'off',
    // 最终答复改由工具提交：1.7B 只会可靠地产生工具调用，不会可靠地写自然语言结论
    enableFinalAnswer: config.enableFinalAnswer !== false,
    // 收敛时保留 final_answer 作为唯一出口：实测工具面为空时模型会把调用写成纯文本，
    // 留一个"提交工具"反而能让它把结论说完整。
    convergeFinalOnly: config.convergeFinalOnly !== false,
    hardCap: Number(config.hardCap) || 8,
    bash: config.bash || 'sandbox',
    // 消融开关（默认值与正式行为一致；仅供 benchmark 逐项对照使用）
    enableSearch: config.enableSearch !== false,
    enableSubagent: config.enableSubagent !== false,
    enableTaskComplete: config.enableTaskComplete === true,
    auditFile: config.auditFile || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'slim-agent-audit.jsonl'),
  }
  const sem = new AsyncSemaphore(opts.concurrencyLimit)
  const disposers = []

  /* 计数分桶：优先用 session.id（一次会话一个桶），拿不到再退回 cwd。
   * 早先只按 cwd 分桶，在桌面端多会话共用同一工作目录时会把预算串到一起，
   * 而且进程内永不重置——这是 0.4.0 的一个真实缺陷。 */
  const searchBudget = new Map()
  const callBudget = new Map()
  const bucketOf = (holder) => {
    try {
      const session = holder?.agent?.session ?? holder?.session ?? holder
      const id = session?.id ?? session?.header?.id
      if (id) return 'sid:' + String(id)
      const cwd = session?.header?.cwd
      if (cwd) return 'cwd:' + String(cwd)
    } catch {}
    return 'cwd:' + process.cwd()
  }
  const budgetKey = (exec) => bucketOf(exec)

  /** 新的一轮开始：清掉该会话的计数（预算按"轮"而不是按"进程生命周期"）。 */
  const resetTurn = (holder) => {
    const key = bucketOf(holder)
    searchBudget.delete(key)
    callBudget.delete(key)
  }

  /* 最近一次检索的来源表：bucket -> [{tag,url,title}]，供 final_answer 回填真实 URL。 */
  const lastSources = new Map()

  const bumpSearchBudget = (exec) => {
    const key = budgetKey(exec)
    const next = (searchBudget.get(key) ?? 0) + 1
    searchBudget.set(key, next)
    return next
  }
  const bumpCallBudget = (exec) => {
    const key = budgetKey(exec)
    const next = (callBudget.get(key) ?? 0) + 1
    callBudget.set(key, next)
    return next
  }

  /* 本轮是否已经进入"只能出文本"的收敛态。 */
  /* 收敛后必须让模型停止"调用工具"的表达方式。
   * 实测：工具面清空后，1.7B 仍会把 <tool_call>…</tool_call> 当文本写出来，
   * 那段标记会变成"最终答复"，看着非空、其实不是答案。 */
  const CONVERGE_SECTION = {
    name: 'slim:converged',
    interpolate: false,
    text: [
      '【工具已停用】本轮没有任何工具可用，也不要假装调用。',
      '禁止输出 <tool_call>、<function=...>、<parameter=...>、```json 形式的函数调用标记。',
      '必须用自然语言直接给出最终结论：一到三句话，能确定的写结论并附上前面搜索得到的来源编号（如 [S1]），',
      '不能确定的写「未证实」。',
    ].join(''),
  }

  /* 收敛必须有出口：final_answer 关掉时不做收敛。
   * 实测工具面一旦为空，1.7B 会把 <tool_call> 当文本写出来，产出不可用。 */
  const canConverge = opts.convergeFinalOnly && opts.enableFinalAnswer
  const isConverged = (key) => {
    if (!canConverge) return false
    if (opts.convergeMode === 'budget') return (searchBudget.get(key) ?? 0) > opts.maxSearches
    if (opts.convergeMode === 'hardCap') return (callBudget.get(key) ?? 0) >= opts.hardCap
    return false
  }

  /* 主代理可见工具集 = 白名单 = 开关产物。两者必须同源，否则会出现
   * "注册了但不给列"或"列了但调不动"的错位。 */
  const allow = new Set(['read', 'edit', 'bash'])
  if (opts.enableSearch) allow.add('web_search')
  if (opts.enableSubagent) allow.add('subagent')
  if (opts.enableTaskComplete) allow.add('task_complete')
  if (opts.enableFinalAnswer) allow.add('final_answer')

  /** 注册工具：任何一次注册失败都不应拖垮整条预设。 */
  const reg = (tool) => {
    if (!allow.has(tool.name)) return
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
        query: { type: 'string', description: 'One search query string. Keep it short: 2-6 keywords.' },
      },
      required: ['query'],
    },
    output: textOut('result'),
    async execute(args, exec) {
      // 单字符串参数：1.7B 在数组参数上反复出错，收窄成 string
      let query = typeof args.query === 'string' ? args.query.trim() : ''
      // 兼容旧格式（数组）——子代理或其他调用方可能仍按老 schema 传
      if (query === '' && Array.isArray(args.queries)) {
        query = args.queries.filter((q) => typeof q === 'string' && q.trim() !== '').slice(0, 3).join(' ').trim()
      }
      if (query === '') return { result: 'No usable query provided.' }

      // 检索预算硬上限：防止小模型把整轮预算烧在搜索循环里
      const used = bumpSearchBudget(exec)
      if (used > opts.maxSearches) {
        audit({ kind: 'web_search', policy: 'budget', refused: 'over-budget', used, query })
        return {
          result: '[BUDGET] 检索预算已用尽（上限 ' + opts.maxSearches + ' 次，本次是第 ' + used + ' 次）。'
            + '不要再调用 web_search。请立刻基于已有结果作答；'
            + '仍然无法确认的内容直接写「未证实」。',
        }
      }

      const { engine, items } = await searchWeb(ctx, query, opts)
      if (items.length === 0) {
        return { result: 'No results for "' + query + '". Try broader keywords, or delegate to subagent with a specific site.' }
      }
      const max = Math.min(items.length, opts.maxResults)
      const lines = ['[S0] 本次检索 "' + query + '" via ' + engine + '，共 ' + max + ' 条候选来源，编号如下：']
      const refs = []
      const refTable = []
      for (let i = 0; i < max; i += 1) {
        const item = items[i]
        const url = item.url || ''
        const title = String(item.title || 'link').replace(/\s+/g, ' ').slice(0, 40)
        const snippet = String(item.snippet || '').replace(/\s+/g, ' ').slice(0, 80)
        const tag = 'S' + (i + 1)
        refs.push('[' + tag + '] ' + url)
        refTable.push({ tag, url, title })
        lines.push('[' + tag + '] ' + classifySource(url) + ' ' + title + guessYear(title + ' ' + snippet) + ' — ' + (snippet || '无摘要') + '  <' + url + '>')
      }
      // 抓首条正文做确定性抽取（不依赖模型理解摘要）
      if (opts.fetchTopResult) {
        const pick = items.find((it) => /nodejs\.org|rust-lang\.org|python\.org|go\.dev|github\.com|wikipedia\.org/.test(String(it.url || ''))) || items[0]
        const target = String(pick?.url || '')
        if (/^https?:\/\//.test(target)) {
          const ex = await fetchExcerpt(target, { timeoutMs: opts.fetchTimeoutMs, maxChars: opts.fetchMaxChars })
          if (ex) {
            if (ex.versions.length) lines.push('[S0] 页面实测版本号（来自 ' + classifySource(target) + '）：' + ex.versions.join(' / '))
            ex.contexts.slice(0, 2).forEach((c) => lines.push('[S0] 原文片段：' + c))
          }
        }
      }
      // 结论前置：把最相关的一条先摊开，避免小模型只读到编号就去找本地文件
      const top = items[0] || {}
      const topTitle = String(top.title || '').replace(/\s+/g, ' ').slice(0, 60)
      const topSnip = String(top.snippet || '').replace(/\s+/g, ' ').slice(0, 120)
      if (topTitle || topSnip) {
        lines.unshift('[S0] 结论候选（来自 ' + classifySource(String(top.url || '')) + '）：' + (topTitle ? topTitle + ' — ' : '') + (topSnip || '无摘要'))
      }
      lines.push('')
      lines.push('[S0] 工作区里的项目文件记录的是**历史锁定版本**，涉及「当前 / 最新」时以此处检索结果为准，不要照抄文件里的版本号。')
      lines.push('[S0] 引用格式（强制）：答案里每个来自上述来源的事实，必须紧跟方括号编号，例如「最新 LTS 是 v26.13.0 [S1]」。')
      try { lastSources.set(budgetKey(exec), refTable) } catch {}
      lines.push('[S0] 答案末尾必须单列一行：来源: ' + refs.join(' | '))
      lines.push('[S0] 找不到来源支持的内容，一律写「未证实」，不要编造编号。')
      return { result: lines.join('\n') }
    },
  })

  /* ── 2.5 final_answer：把"写结论"变成"调工具" ────────────────────────
   * 实测：小模型在不给工具时会输出 <tool_call> 文本当答复，给工具时又只会
   * 反复调用。既然如此，就让结论本身通过一次工具调用来提交：
   * 参数里有 answer（自然语言结论）和 sources（引用到的 [S1] 编号）。
   * 会话日志会完整记录这次调用的 arguments，评测侧直接取它当答复。 */
  if (opts.enableFinalAnswer) {
    reg({
      name: 'final_answer',
      description: 'Submit the final answer. Call this exactly once when you are ready to conclude.',
      parameters: {
        type: 'object',
        properties: {
          answer: { type: 'string', description: 'The final answer in plain language, 1-3 sentences.' },
          sources: {
            type: 'array',
            items: { type: 'string' },
            description: 'Source labels used, e.g. ["S1","S3"]. Empty array if none.',
          },
        },
        required: ['answer'],
      },
      output: textOut('status'),
      async execute(args, exec) {
        const answer = String(args.answer ?? '').trim()
        const sources = Array.isArray(args.sources) ? args.sources.map((x) => String(x)) : []
        // 把 [S1] 这类编号展开成真实 URL：小模型几乎不会自己写 URL，
        // 但让它记住一个短编号是可行的，所以由框架侧回填。
        const table = lastSources.get(budgetKey(exec)) || []
        const pick = (label) => {
          const m = String(label).match(/S(\d+)/i)
          if (m) return table[Number(m[1]) - 1]
          if (/^https?:\/\//i.test(String(label))) return { tag: label, url: String(label), title: '' }
          return null
        }
        let expanded = sources.map(pick).filter(Boolean)
        if (expanded.length === 0) expanded = table.slice(0, 2)
        const citeText = expanded.length
          ? '来源: ' + expanded.map((r) => (r.tag && /^S\d+$/i.test(r.tag) ? '[' + r.tag + '] ' : '') + r.url).join(' | ')
          : ''
        const full = citeText ? (answer + '\n' + citeText) : answer
        audit({ kind: 'final_answer', answer: answer.slice(0, 200), sources,
                expanded: expanded.map((r) => r.url).slice(0, 4) })
        try {
          if (typeof exec?.concludeTurn === 'function') exec.concludeTurn()
        } catch {}
        return { status: '[FINAL] ' + full }
      },
    })
  }

  /* ── 3. （已移除）task_complete ──────────────────────────────────────
   * 0.2.x 里它调用 exec.concludeTurn() 立即结束回合。concludeTurn 的签名是
   * `concludeTurn(): void`，不吃任何 payload，插件也无法回注 assistant 文本，
   * 所以模型写进 summary 的结论被直接丢弃，这一轮只剩工具调用、没有正文，
   * headless/客户端拿到的最终答复是空字符串。
   *
   * 实测（LFM3 1.7B / Qwen3.5 4B，8K 与 64K）：task_complete 被调用 3 次，
   * 3 次都出现 finish_reason=tool_calls 且最终答复为空；不调用它的同类运行
   * 大多正常收尾。结论：这个工具在小模型上只会把答复吃掉，收益为零。
   *
   * 想要"停下来"的语义，请让模型直接给出文字结论；宿主侧不再需要显式收尾工具。
   *
   * 下面这段是**故意保留的旧行为**，只有 enableTaskComplete: true 时才挂载，
   * 用于 benchmark 的 Q4 消融（验证"收尾工具到底是正收益还是负收益"）。
   * 生产配置永远不要打开它。 */

  if (opts.enableTaskComplete) {
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
  }

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
        const agents = optionalService(ctx, 'agents')
        if (agents && typeof agents.get === 'function') {
          const childAgent = agents.get(childId)
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

  /* ── 5. 主代理工具面：5 个，异常时 fail-closed ────────────────────── */
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
      const key = bucketOf(context?.agent?.session ?? context?.agent)
      if (isConverged(key)) {
        const sections = Array.isArray(assembled.sections) ? assembled.sections.slice() : []
        if (!sections.some((sec) => sec?.name === CONVERGE_SECTION.name)) sections.push(CONVERGE_SECTION)
        // 收敛 == 只留 final_answer 这一个出口
        const tools = (Array.isArray(assembled.tools) ? assembled.tools : []).filter((t) => t?.name === 'final_answer')
        audit({ kind: 'converge', mode: opts.convergeMode, action: 'final-only',
                searches: searchBudget.get(key) ?? 0, calls: callBudget.get(key) ?? 0, kept: tools.length })
        return { ...assembled, tools, sections }
      }
      const tools = Array.isArray(assembled.tools) ? assembled.tools : []
      return { ...assembled, tools: tools.filter((tool) => allow.has(tool?.name)) }
    } catch (error) {
      try { ctx.logger?.warn?.('[slim-core] whitelist failed, exposing no tools (fail-closed): ' + String(error)) } catch {}
      return withoutTools(assembled)
    }
  }, { prepend: true })

  /* ── 6. 执行期硬闸（tools/pre-execute）──────────────────────────────
   * 只靠 assemble 过滤是不够的：DSH 的 fs-observation-policy 会在模型 read
   * 过文件之后，把 write / read_image 这类工具**中途**注册进来，那一轮不再
   * 走 assemble，越界工具就漏给了模型（实测 slim@65536 T2 第 4 次调用起
   * 工具数从 6 变 8）。pre-execute 每次调用都会过，用它兜住。
   *
   * 子代理会话必须放行：子代理的工具面本来就该是宽的。 */
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const header = exec?.agent?.session?.header ?? exec?.session?.header
      if (header === undefined) return next()
      const isChild = header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
      if (isChild) return next()
      const name = exec?.name ?? exec?.tool?.name ?? exec?.call?.name
      const key = budgetKey(exec)
      if (isConverged(key)) {
        if (name === 'final_answer') return next()
        audit({ kind: 'converge', mode: opts.convergeMode, action: 'deny-call', tool: name,
                calls: callBudget.get(key) ?? 0 })
        return { kind: 'deny', reason: '[slim] 本轮工具已停用：请用 final_answer 提交结论，无法确认的写「未证实」' }
      }
      if (typeof name === 'string' && name !== '' && !allow.has(name)) {
        try { ctx.logger?.warn?.('[slim-core] denied out-of-whitelist tool: ' + name) } catch {}
        return { kind: 'deny', reason: `[slim] tool "${name}" is outside the main-agent whitelist` }
      }
      bumpCallBudget(exec)
    } catch {}
    return next()
  }, { prepend: true })

  /* ── 7. 预算生命周期：每轮重置、会话结束清理 ─────────────────────── */
  try {
    disposers.push(ctx.on('session/event', (session, event) => {
      try {
        const type = event?.type ?? event?.name
        if (type === 'turn/start') resetTurn(session)
        else if (type === 'session/disposed') {
          const key = bucketOf(session)
          searchBudget.delete(key)
          callBudget.delete(key)
        }
      } catch {}
    }))
  } catch {}

  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        if (typeof dispose === 'function') dispose()
        else if (typeof dispose?.dispose === 'function') dispose.dispose()
      } catch {}
    }
  }
}