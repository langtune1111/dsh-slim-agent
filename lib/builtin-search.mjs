/**
 * builtin-search.mjs — 内置零依赖免 Key 搜索引擎与信源探针染色
 *
 * 核心特性：
 * 1. 零外部 npm 依赖：仅使用 Node 18+ 原生 fetch；
 * 2. 纯净环境独立可用：即使脱离包含 @copylee/dsh-free-search 的环境也能开箱即搜；
 * 3. 采用 Wikipedia OpenSearch + DuckDuckGo 双擎轮询，抗封锁、稳定性极高；
 * 4. 探针染色：自动给每个检索结果打上 [官方/权威]、[技术社区]、[经验参考] 标签与发布年份。
 */

function decodeHtmlEntities(str) {
  if (!str) return ''
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, '') // 剥离 HTML 标签
    .trim()
}

/**
 * 信源探针染色分类器 (汲取 dsh-see-world 理念)
 * 让 1.7B/4B 小模型无需耗费自身推理开销即可识别权威信源
 */
export function classifyDomain(rawUrl) {
  if (!rawUrl) return { tag: '[参考网页]', isOfficial: false }
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()

    // 官方 / 权威规范源
    const officialDomains = [
      'github.com',
      'gitlab.com',
      'nodejs.org',
      'python.org',
      'rust-lang.org',
      'golang.org',
      'kernel.org',
      'gnu.org',
      'w3.org',
      'ietf.org',
      'wikipedia.org',
      'mozilla.org',
      'developer.mozilla.org',
      'microsoft.com',
      'apple.com',
      'google.com',
      'apache.org',
      'linuxfoundation.org',
    ]

    if (
      officialDomains.some(d => host === d || host.endsWith('.' + d)) ||
      host.startsWith('docs.') ||
      host.startsWith('api.') ||
      host.endsWith('.edu') ||
      host.endsWith('.gov')
    ) {
      return { tag: '[官方/权威]', isOfficial: true }
    }

    // 技术社区 / 讨论源
    const communityDomains = [
      'stackoverflow.com',
      'stackexchange.com',
      'reddit.com',
      'v2ex.com',
      'juejin.cn',
      'zhihu.com',
      'dev.to',
      'news.ycombinator.com',
      'segmentfault.com',
      'cnblogs.com',
      'csdn.net',
    ]

    if (communityDomains.some(d => host === d || host.endsWith('.' + d))) {
      return { tag: '[技术社区]', isOfficial: false }
    }

    return { tag: '[经验参考]', isOfficial: false }
  } catch {
    return { tag: '[参考网页]', isOfficial: false }
  }
}

/**
 * 提取文本中的年份时间锚点
 */
export function extractTimeAnchor(text) {
  if (!text) return ''
  const match = text.match(/\b(202[0-9])\b/)
  return match ? ` (${match[1]}年)` : ''
}

/**
 * 内置引擎 A：Wikipedia OpenSearch API (100% 免费稳定，世界知识权威百科)
 */
async function searchWikipedia(query, signal) {
  try {
    // 优先中文 Wikipedia，含英文词则自动查询
    const isEn = /^[a-zA-Z0-9\s._-]+$/.test(query)
    const lang = isEn ? 'en' : 'zh'
    const url = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=4&namespace=0&format=json`

    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'dsh-slim-agent/0.1.0 (DeepSeek Harness Open Source Plugin)' },
    })
    if (!res.ok) return []

    const data = await res.json()
    // data 结构: [query, [titles], [descriptions], [urls]]
    const titles = data[1] || []
    const descriptions = data[2] || []
    const urls = data[3] || []

    const results = []
    for (let i = 0; i < titles.length; i++) {
      if (titles[i] && urls[i]) {
        results.push({
          title: titles[i],
          snippet: descriptions[i] || '维基百科词条概览。',
          url: urls[i],
        })
      }
    }
    return results
  } catch {
    return []
  }
}

/**
 * 内置引擎 B：DuckDuckGo HTML Lite 解析 (纯原生 regex，无依赖)
 */
async function searchDuckDuckGoHtml(query, signal) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    if (!res.ok) return []

    const html = await res.text()
    const results = []

    // 匹配每个结果块: class="result__a" 与 class="result__snippet"
    const regex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
    let match
    while ((match = regex.exec(html)) !== null && results.length < 5) {
      let rawHref = match[1]
      // 解码 DDG 的跳转链接 //duckduckgo.com/l/?uddg=...
      if (rawHref.includes('uddg=')) {
        try {
          const u = new URL(rawHref, 'https://html.duckduckgo.com')
          rawHref = decodeURIComponent(u.searchParams.get('uddg') || rawHref)
        } catch {}
      }
      const title = decodeHtmlEntities(match[2])
      const snippet = decodeHtmlEntities(match[3])
      if (title && rawHref) {
        results.push({ title, snippet, url: rawHref })
      }
    }
    return results
  } catch {
    return []
  }
}

/**
 * 内置搜索调度入口：双擎轮询
 */
export async function executeBuiltinSearch(query, options = {}) {
  const timeoutMs = options.timeoutMs ?? 12000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // 1. 优先尝试 DuckDuckGo 全网搜索
    let items = await searchDuckDuckGoHtml(query, controller.signal)

    // 2. 若全网搜索受阻或被风控，秒级切换 Wikipedia 权威百科兜底
    if (!items || items.length === 0) {
      items = await searchWikipedia(query, controller.signal)
    }

    clearTimeout(timer)
    return items || []
  } catch (err) {
    clearTimeout(timer)
    return []
  }
}