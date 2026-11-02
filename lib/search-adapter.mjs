/**
 * search-adapter.mjs — 自洽多后端搜索适配器 (含信源探针染色)
 *
 * 核心特性：
 * 1. 自适应双模：
 *    - 若宿主环境有高级搜索（如 @copylee/dsh-free-search），优先调用 ctx.web.search；
 *    - 若脱离宿主环境或宿主搜索失败，秒级自动降级至内置零依赖引擎 (builtin-search)；
 * 2. 深度融入 dsh-see-world 理念：
 *    - 自动探针识别信源级别：[官方/权威]、[技术社区]、[经验参考]；
 *    - 提取年份时间锚点，让 1.7B/4B 小模型一眼辨识权威性与新鲜度；
 * 3. 严格 8K 上下文友好：只输出 3-4 条高度萃取的线索，单次压制在 200 tokens 内，杜绝长文泄入。
 */

import { executeBuiltinSearch, classifyDomain, extractTimeAnchor } from './builtin-search.mjs'

export async function executeLightweightSearch(ctx, queries, options = {}) {
  const maxResults = options.maxResults ?? 4
  const timeoutMs = options.timeoutMs ?? 15000
  const searchEngineMode = options.searchEngine ?? 'auto' // auto | host | builtin

  const cleanQueries = Array.isArray(queries) ? queries.filter(q => typeof q === 'string' && q.trim().length > 0) : []
  if (cleanQueries.length === 0) {
    return '【搜索提示】未提供有效搜索词，请输入 1-3 个具体关键词。'
  }

  const query = cleanQueries.join(' ')
  let rawSources = []
  let usedEngine = 'builtin'

  // 1. 尝试宿主环境搜索 (若配置允许且环境具备)
  const canUseHost = (searchEngineMode === 'auto' || searchEngineMode === 'host') && ctx?.web && typeof ctx.web.search === 'function'

  if (canUseHost) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await ctx.web.search({ query, maxResults }, controller.signal)
      clearTimeout(timer)
      if (Array.isArray(res?.sources) && res.sources.length > 0) {
        rawSources = res.sources
        usedEngine = 'host'
      }
    } catch {
      clearTimeout(timer)
      // 宿主调用异常时，优雅静默进入下方内置兜底
    }
  }

  // 2. 降级使用内置零依赖引擎（保证脱离任何插件环境均可自洽运行）
  if (rawSources.length === 0 && searchEngineMode !== 'host') {
    rawSources = await executeBuiltinSearch(query, { timeoutMs })
    usedEngine = 'builtin'
  }

  if (rawSources.length === 0) {
    return `【检索结果】未检索到关于 "${query}" 的有效事实。建议更换更通用的关键词，或委派 subagent 针对特定站点深入排查。`
  }

  // 3. 信源染色与时间锚定格式化 (dsh-see-world 理念)
  const lines = []
  lines.push(`【外部事实线索】关键词: "${query}" (前 ${Math.min(rawSources.length, maxResults)} 条权威信源，深挖请委派 subagent):`)

  for (let i = 0; i < Math.min(rawSources.length, maxResults); i++) {
    const item = rawSources[i]
    const url = item.url || ''
    const { tag } = classifyDomain(url)

    let title = (item.title || '网页链接').trim().replace(/[\r\n]+/g, ' ')
    if (title.length > 35) title = title.slice(0, 32) + '...'

    let snippet = (item.snippet || '').trim().replace(/[\r\n]+/g, ' ')
    const timeAnchor = extractTimeAnchor(title + ' ' + snippet)

    // 截取核心一句话，最长 75 字符
    if (snippet.length > 75) {
      snippet = snippet.slice(0, 72) + '...'
    }

    lines.push(`${i + 1}. ${tag} [${title}](${url})${timeAnchor} — ${snippet || '无额外摘要'}`)
  }

  return lines.join('\n')
}