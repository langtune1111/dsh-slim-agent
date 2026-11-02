/**
 * dsh-slim-agent — 主入口文件
 *
 * 面向消费级显卡部署的中小模型（1.7B-8B）：
 * 在 8K 上下文硬约束下，兼具免 Key 联网世界知识与必要代码工具，窄主宽子隔离，可调并发防 OOM，抗插件污染。
 */

import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { applyPresetAssembly } from './lib/preset-assembly.mjs'
import { registerSlimTools } from './lib/tools-slim.mjs'
import { createSubagentScheduler } from './lib/subagent-scheduler.mjs'

export const name = 'dsh-slim-agent'
export const inject = ['tools', 'systemPrompt', 'web']

function ensurePresetRegistration(logger) {
  try {
    const dshHome = process.env.DSH_HOME || join(os.homedir(), '.dsh')
    const patchPath = join(dshHome, 'cordis.patch.yml')

    if (!existsSync(patchPath)) return

    const content = readFileSync(patchPath, 'utf8')
    if (content.includes('preset-local-slim-agent')) return

    const isWin = process.platform === 'win32'
    const managedBlock = `
# --- dsh-slim-agent preset managed (auto-generated; do not edit) ---
- insert:
    - id: preset-local-slim-agent
      name: "@deepseek-ai/dsh-agent-preset"
      config:
        id: local-slim-agent
        name: "中小模型·轻量知识增强 (8K Slim)"
        description: "面向消费级显卡部署的中小模型（1.7B-8B）：在 8K 上下文硬约束下，兼具免 Key 联网世界知识与必要代码工具，窄主宽子隔离，可调并发防 OOM，抗插件污染。"
        order: 15
        plugins:
          - id: persona
            name: "@deepseek-ai/dsh-persona"
            config:
              complete: true
              includeRuntimeContext: false
              text: |-
                你是面向本地中小模型的极简高效编程与知识增强助手。
                【工作规则】
                1. 简单操作：阅读、编辑文件或单条命令由你自己使用 read/edit/bash 快速完成。
                2. 联网线索：需要最新世界知识、实时事实或外部线索时，使用 web_search 获取 3-5 条带信源标签的简短摘要。
                3. 深度研究：需抓取网页全文、多步对比分析或大量数据提炼时，必须委派 subagent，严禁在主窗口阅读海量原文。
                4. 事实纪律：依据确凿事实与权威标签作答，未搜到确切证据时如实说明“未充分证实”，严禁主观编造事实。
                5. 任务结束：当用户目标达成后，必须立即调用 task_complete 总结并退出，严禁生成无意义后续调用。
          - id: tool-bash
            name: "@deepseek-ai/dsh-tool-bash"
            disabled: ${isWin ? 'true' : 'false'}
          - id: tool-pwsh
            name: "@deepseek-ai/dsh-tool-pwsh"
            disabled: ${isWin ? 'false' : 'true'}
          - id: tool-fs
            name: "@deepseek-ai/dsh-tool-fs"
          - id: subagent-spawn
            name: "@deepseek-ai/dsh-subagent-spawn-in-process"
          - id: slim-plugin-core
            name: "dsh-slim-agent"
            config:
              concurrencyLimit: 1
              searchEngine: "auto"
              maxTurnsDefault: 8
              maxTurnsDeep: 12
              maxToolCalls: 15
              contextBudgetTokens: 5000
# --- end dsh-slim-agent preset managed ---
`
    appendFileSync(patchPath, managedBlock, 'utf8')
    logger?.info?.('[dsh-slim-agent] Automatically registered preset into cordis.patch.yml')
  } catch (err) {
    logger?.warn?.(`[dsh-slim-agent] Notice during ensurePresetRegistration: ${String(err)}`)
  }
}

export function apply(ctx, config = {}) {
  ctx.logger?.info?.('[dsh-slim-agent] Initializing 8K Slim Agent plugin...')

  // 1. 自动确保 ~/.dsh/cordis.patch.yml 中存在预设注册（自愈机制）
  ensurePresetRegistration(ctx.logger)

  // 2. 初始化子代理可调并发调度器
  const scheduler = createSubagentScheduler(ctx, config)

  // 3. 挂载严格白名单与防污染隔离守卫
  const unregisterAssembly = applyPresetAssembly(ctx, config)

  // 4. 注册 6 个紧凑主代理工具
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