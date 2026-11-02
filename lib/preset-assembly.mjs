/**
 * preset-assembly.mjs — 严格白名单与第三方插件防污染隔离模块
 *
 * 核心目标：
 * 1. 在 system-prompt/assemble 瀑布上，将主代理的模型可见工具面严格收窄为 6 个核心工具；
 * 2. 彻底屏蔽所有原生工具（glob, grep, workflow, todo, goal...）及用户安装的第三方插件工具（mcp__*, 扩展工具）；
 * 3. 保证其他插件不受影响且保持活跃，仅在 local-slim-agent 会话作用域内实施白名单封锁；
 * 4. 子代理（origin: "subagent"）放行，保留其深度调研所需的完整工具面（web_fetch, web_search, 读写等）。
 */

export const name = 'slim-preset-assembly'
export const inject = ['systemPrompt', 'tools']

export const SLIM_MAIN_ALLOW = new Set([
  'read',
  'edit',
  'bash',
  'subagent',
  'web_search',
  'task_complete',
])

export const SUBAGENT_RESEARCH_ALLOW = new Set([
  'web_search',
  'web_fetch',
  'read',
  'edit',
  'bash',
  'glob',
  'grep',
])

export function isDelegatedChild(agent) {
  const header = agent?.session?.header
  if (!header) return false
  return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
}

export function applyPresetAssembly(ctx, options = {}) {
  const allowList = new Set(options.allowList ?? SLIM_MAIN_ALLOW)
  let loggedMain = false
  let loggedChild = false

  // ── 1. 模型可见面过滤（system-prompt/assemble 瀑布） ─────────────────────
  ctx.on(
    'system-prompt/assemble',
    async (_assembly, context, next) => {
      const assembled = await next()
      try {
        const agent = context?.agent
        if (!agent) return assembled

        const tools = Array.isArray(assembled.tools) ? assembled.tools : []

        // 子代理放行或指定调研工具面
        if (isDelegatedChild(agent)) {
          const childFiltered = tools.filter(t => SUBAGENT_RESEARCH_ALLOW.has(t?.name))
          if (!loggedChild) {
            ctx.logger?.info?.(`[dsh-slim-agent] Subagent tool surface filtered: ${tools.length} -> ${childFiltered.length}`)
            loggedChild = true
          }
          return { ...assembled, tools: childFiltered.length > 0 ? childFiltered : tools }
        }

        // 主代理严格 6 工具白名单
        const mainFiltered = tools.filter(t => allowList.has(t?.name))
        if (!loggedMain) {
          ctx.logger?.info?.(
            `[dsh-slim-agent] Main agent hermetic isolation active: ${tools.length} -> ${mainFiltered.length} tools ` +
            `(${[...allowList].join(', ')})`
          )
          loggedMain = true
        }

        return { ...assembled, tools: mainFiltered }
      } catch (err) {
        ctx.logger?.warn?.(`[dsh-slim-agent] Filter assembly error (fail-open): ${String(err)}`)
        return assembled
      }
    },
    { prepend: true }
  )

  // ── 2. Registry 级防御（堵住 Skill 目录 ~1.3k token 注入） ──────────────
  const disposers = []
  ctx.on('agent/created', ({ agent }) => {
    if (!agent || isDelegatedChild(agent)) return
    try {
      const tools = agent?.ctx?.tools
      if (typeof tools?.restrict === 'function') {
        // 主代理禁止 skill 工具可见，防止技能目录注入
        const denyList = ['skill', 'workflow', 'todo_write', 'create_goal']
        disposers.push(tools.restrict({ deny: denyList }))
        ctx.logger?.info?.(`[dsh-slim-agent] Denied heavy tools from registry: ${denyList.join(', ')}`)
      }
    } catch (err) {
      ctx.logger?.warn?.(`[dsh-slim-agent] Registry restrict error: ${String(err)}`)
    }
  })

  return () => {
    for (const d of disposers.splice(0)) {
      try {
        if (typeof d === 'function') d()
      } catch {}
    }
  }
}