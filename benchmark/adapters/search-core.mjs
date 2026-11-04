/**
 * search-core.mjs — 基准测试专用的共享搜索后端。
 *
 * 目的：让「极简 / 标准 / pi」这三个对照组也能靠**自己的工具面**搜索，
 * 同时保证搜索源、可搜范围、结果条数与输出格式与 slim 内置的 web_search 对齐，
 * 否则"有搜索 vs 没搜索"的对比就没有意义。
 *
 * 对齐依据（逐项抄自 dsh-slim-agent 0.3.0-beta.1 的 preset-core.mjs）：
 *   - Bing 端点与参数：https://www.bing.com/search?q=...&setlang=zh-CN
 *   - User-Agent / Accept-Language 完全相同
 *   - 最多取 4 条（与 slim 的 maxResults 默认值一致，也与工具描述里的 “up to 4 items” 一致）
 *   - 输出模板：(序号). [标签] [标题](URL)(年份) — 摘要
 *   - classifySource / guessYear 逐字复制，保证标签与年份一致
 *
 * 本文件不依赖任何第三方包，也不修改产品行为。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8'
const BING_ENDPOINT = 'https://www.bing.com/search'
const MAX_RESULTS = 4
const TIMEOUT_MS = 15000

/** 与 preset-core.mjs 的 classifySource 逐字一致。 */
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

/** 与 preset-core.mjs 的 guessYear 逐字一致。 */
export function guessYear(text) {
  const matches = String(text || '').match(/\b(20[2-3][0-9])\b/g)
  if (!matches || matches.length === 0) return ''
  return ` (${matches[matches.length - 1]})`
}

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

/** Bing 跳转链接形如 https://www.bing.com/ck/a?...&u=a1<base64url>，解出真实 URL。 */
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

/**
 * 查询 Bing，返回 [{ title, snippet, url }]（最多 MAX_RESULTS 条）。
 * @param {string} query
 * @param {{ signal?: AbortSignal, maxResults?: number, timeoutMs?: number }} [options]
 */
export async function bingSearch(query, options = {}) {
  const max = Math.max(1, Math.min(options.maxResults ?? MAX_RESULTS, MAX_RESULTS))
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const onAbort = () => ctl.abort()
  if (options.signal) {
    if (options.signal.aborted) ctl.abort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const url = BING_ENDPOINT + '?q=' + encodeURIComponent(query) + '&setlang=zh-CN'
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': ACCEPT_LANGUAGE },
    })
    if (!res.ok) return []
    const html = await res.text()
    const out = []
    const re = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/li>/gi
    let m
    while ((m = re.exec(html)) !== null && out.length < max) {
      const href = decodeBingHref(m[1])
      const title = stripTags(m[2])
      const pm = (m[3] || '').match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      const snippet = pm ? stripTags(pm[1]) : ''
      if (title && href && /^https?:\/\//.test(href)) out.push({ title, snippet, url: href })
    }
    if (out.length) return out
    const re2 = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let n
    while ((n = re2.exec(html)) !== null && out.length < max) {
      const href = decodeBingHref(n[1])
      const title = stripTags(n[2])
      if (title && href && /^https?:\/\//.test(href)) out.push({ title, snippet: '', url: href })
    }
    return out
  } catch {
    return []
  } finally {
    clearTimeout(timer)
    if (options.signal) options.signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 渲染成与 slim web_search **相同格式**的线索块，供三个 arm 共用。
 * 返回字符串；无结果时返回提示语。
 */
export function renderClues(query, items, engine = 'bing') {
  if (!items || items.length === 0) {
    return 'No results for "' + query + '". Try broader keywords, or delegate to subagent with a specific site.'
  }
  const max = Math.min(items.length, MAX_RESULTS)
  const lines = ['[线索] "' + query + '" via ' + engine + '（前 ' + max + ' 条，读全文请委派 subagent）:']
  for (let i = 0; i < max; i += 1) {
    const item = items[i]
    const url = item.url || ''
    const title = String(item.title || 'link').replace(/\s+/g, ' ').slice(0, 40)
    const snippet = String(item.snippet || '').replace(/\s+/g, ' ').slice(0, 80)
    lines.push((i + 1) + '. ' + classifySource(url) + ' [' + title + '](' + url + ')' + guessYear(title + ' ' + snippet) + ' — ' + (snippet || '无摘要'))
  }
  lines.push('')
  lines.push('（标签是域名启发式，仅作参考；关键结论请交叉核对原始来源。）')
  return lines.join('\n')
}

/** 便捷入口：查询 + 渲染一步到位。 */
export async function searchAndRender(query, options = {}) {
  const items = await bingSearch(query, options)
  return renderClues(query, items, 'bing')
}

/** 与 slim 的 web_search 工具**完全一致**的工具描述与参数 schema。 */
export const TOOL_DESCRIPTION = 'Search the web for clues. Returns up to 4 items: source-tag, title, URL, one-line snippet. Never returns page bodies.'
export const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    queries: { type: 'array', items: { type: 'string' }, description: '1 to 3 query strings.' },
  },
  required: ['queries'],
}

/** 把 queries 数组归一化成单条查询（与 slim execute 中的处理一致）。 */
export function normalizeQueries(args) {
  const queries = (Array.isArray(args?.queries) ? args.queries : []).filter(
    (q) => typeof q === 'string' && q.trim() !== '',
  )
  if (queries.length === 0) return null
  if (queries.length > 3) queries.length = 3
  return queries.join(' ')
}
