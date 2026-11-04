/**
 * pi-bench-search.mjs — 给 pi 对照组补一个**通过 pi 自己的扩展机制**注册的 web_search。
 *
 * pi 内置工具里没有联网搜索，所以对照组 A/B 有 DSH 的 web_search、slim 有自己的，
 * pi 若赤手空拳就又不公平了。这个扩展把同一个后端接进 pi，使三个 arm 的搜索源、
 * 可搜范围、结果条数与输出格式一致。
 *
 * 用法：
 *   pi --extension /root/dsh-bench/adapters/pi-bench-search.mjs ...
 * 或放进 ~/.pi/agent/extensions/ 由 pi 自动发现。
 */

import { bingSearch, renderClues, normalizeQueries, TOOL_DESCRIPTION, TOOL_PARAMETERS } from './search-core.mjs'

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function benchSearchExtension(pi) {
  pi.registerTool({
    name: 'web_search',
    label: 'Web Search',
    description: TOOL_DESCRIPTION,
    promptSnippet: 'web_search: 联网检索线索（只返回标题/URL/摘要，不返回正文）',
    parameters: TOOL_PARAMETERS,
    async execute(_toolCallId, params, signal) {
      const query = normalizeQueries(params)
      if (!query) {
        return { content: [{ type: 'text', text: 'No usable query provided.' }] }
      }
      const items = await bingSearch(query, { signal })
      return { content: [{ type: 'text', text: renderClues(query, items, 'bing') }] }
    },
  })
}
