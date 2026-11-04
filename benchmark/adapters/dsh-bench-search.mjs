/**
 * dsh-bench-search.mjs — 给「极简 / 标准」对照组补一个**属于它们自己工具面**的 web_search。
 *
 * 这不是给 slim 开外挂：它是一个独立的 DSH host 插件，通过标准的 `ctx.tools.register`
 * 注册工具，和 `@deepseek-ai/dsh-tool-web` 处在同一层级。被测 agent 用的是它自己的
 * 插件栈，只是这个栈里多了一个搜索工具——正如 slim 的栈里也有一个。
 *
 * 用法（benchmark patch 片段）：
 *   - insert:
 *       - id: bench-web-search
 *         name: 'file:///root/dsh-bench/adapters/dsh-bench-search.mjs'
 *
 * 输出格式、结果条数、搜索端点由 ../adapters/search-core.mjs 统一，三个 arm 完全一致。
 */

import { bingSearch, renderClues, normalizeQueries, TOOL_DESCRIPTION, TOOL_PARAMETERS } from './search-core.mjs'

export const name = 'bench-web-search'
export const inject = ['tools']

/** 与 slim 的 textOut('result') 等价的输出契约。 */
const textOut = (key) => ({
  schema: { type: 'object', properties: { [key]: { type: 'string' } }, required: [key] },
  render: (_args, value) => [{ type: 'text', text: String(value[key] ?? '') }],
})

export function apply(ctx, config = {}) {
  const maxResults = Number(config.maxResults) || 5
  const timeoutMs = Number(config.timeoutMs) || 15000

  const dispose = ctx.tools.register({
    name: 'web_search',
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,
    output: textOut('result'),
    async execute(args) {
      const query = normalizeQueries(args)
      if (!query) return { result: 'No usable query provided.' }
      const items = await bingSearch(query, { maxResults, timeoutMs })
      return { result: renderClues(query, items, 'bing') }
    },
  })

  return () => {
    try {
      dispose?.()
    } catch {}
  }
}
