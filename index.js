/**
 * dsh-slim-agent — 主入口文件
 *
 * 面向消费级显卡部署的中小模型（1.7B-8B）：
 * 在 8K 上下文硬约束下，兼具免 Key 联网世界知识与必要代码工具，窄主宽子隔离，可调并发防 OOM，抗插件污染。
 */

import { applyPresetAssembly } from './lib/preset-assembly.mjs'
import { registerSlimTools } from './lib/tools-slim.mjs'
import { createSubagentScheduler } from './lib/subagent-scheduler.mjs'

export const name = 'dsh-slim-agent'
export const inject = ['tools', 'systemPrompt', 'web']

export function apply(ctx, config = {}) {
  ctx.logger?.info?.('[dsh-slim-agent] Initializing 8K Slim Agent plugin...')

  // 1. 初始化子代理可调并发调度器
  const scheduler = createSubagentScheduler(ctx, config)

  // 2. 挂载严格白名单与防污染隔离守卫
  const unregisterAssembly = applyPresetAssembly(ctx, config)

  // 3. 注册 6 个紧凑主代理工具
  const unregisterTools = registerSlimTools(ctx, scheduler, config)

  ctx.on('dispose', () => {
    ctx.logger?.info?.('[dsh-slim-agent] Disposing 8K Slim Agent plugin...')
    try {
      if (typeof unregisterAssembly === 'function') unregisterAssembly()
      if (typeof unregisterTools === 'function') unregisterTools()
    } catch (err) {
      ctx.logger?.warn?.(`[dsh-slim-agent] Error during dispose: ${String(err)}`)
    }
  })
}