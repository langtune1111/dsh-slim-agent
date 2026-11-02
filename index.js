/**
 * dsh-slim-agent — 安装器入口（host 作用域）
 *
 * 本机实测结论（DSH 0.1.2 桌面版）：
 *  1. 预设只能通过 home 补丁 `~/.dsh/cordis.patch.yml` 里的
 *     `@deepseek-ai/dsh-agent-preset` 声明行出现在模式选择器里；
 *     运行时 agentPresets.register() 与用户根目录扫描都不会显示。
 *  2. 声明里的 persona 必须用 `prefix` 键（用 `text` 会被静默丢弃）。
 *  3. 插件行可以指向 `file://` 本地模块，但模块必须是**单文件、零相对导入**，
 *     且**不能重复注册已有工具名**（tool-fs 已提供 read/write/edit，
 *     重复注册会抛错并把整条预设打掉）。
 *
 * 因此本文件只做两件幂等的事：
 *  A. 把 preset-core.mjs 复制到 <dshHome>/.agent-presets/_slim-code/core.mjs
 *  B. 把声明块写入 <dshHome>/cordis.patch.yml（已存在则整块替换）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

export const name = 'dsh-slim-agent'
export const inject = []

const BEGIN = '# --- dsh-slim-agent managed block (auto-generated; do not edit) ---'
const END = '# --- end dsh-slim-agent managed block ---'

const PERSONA = [
  '你是面向本地中小模型的极简高效编程与知识增强助手。',
  '1. 简单操作：阅读、编辑文件或单条命令由你自己使用 read/edit/bash 完成。',
  '2. 联网线索：需要最新事实或外部知识时，用 web_search 取 3-5 条带信源标签的摘要。',
  '3. 深度研究：需要读网页全文或多步比对时，委派 subagent，不要在主窗口读长文。',
  '4. 事实纪律：依据确凿事实作答，查不到就明说“未充分证实”，不要编造。',
  '5. 目标达成后立即调用 task_complete 收尾，不要追加无意义回复。',
].map((l) => '                ' + l).join('\n')

function declarationBlock(coreUrl) {
  return [
    BEGIN,
    '- insert:',
    '    - id: preset-local-slim-agent',
    '      name: "@deepseek-ai/dsh-agent-preset"',
    '      config:',
    '        id: local-slim-agent',
    '        name: 中小模型·轻量知识增强 (8K Slim)',
    '        description: 消费级显卡上的 1.7B-8B 本地小模型：8K 上下文下兼具免 Key 联网世界知识与必要代码工具，6 工具白名单，并发默认 1。',
    '        order: 32',
    '        plugins:',
    '          - id: persona',
    '            name: "@deepseek-ai/dsh-persona"',
    '            config:',
    '              prefix: |-',
    PERSONA,
    '          - id: tool-pwsh',
    '            name: "@deepseek-ai/dsh-tool-pwsh"',
    '          - id: tool-fs',
    '            name: "@deepseek-ai/dsh-tool-fs"',
    '          - id: slim-core',
    `            name: ${coreUrl}`,
    '            config:',
    '              concurrencyLimit: 1',
    '              searchEngine: auto',
    END,
    '',
  ].join('\n')
}

export function install(logger) {
  try {
    const home = process.env.DSH_HOME || join(os.homedir(), '.dsh')
    const codeDir = join(home, '.agent-presets', '_slim-code')
    const corePath = join(codeDir, 'core.mjs')
    const patchPath = join(home, 'cordis.patch.yml')
    const here = dirname(fileURLToPath(import.meta.url))

    mkdirSync(codeDir, { recursive: true })
    const src = join(here, 'preset-core.mjs')
    if (existsSync(src)) copyFileSync(src, corePath)

    const coreUrl = 'file:///' + corePath.replace(/\\/g, '/')
    const block = declarationBlock(coreUrl)

    let text = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
    const bi = text.indexOf(BEGIN)
    const ei = text.indexOf(END)
    if (bi >= 0 && ei > bi) {
      text = text.slice(0, bi).trimEnd() + '\n' + block + text.slice(ei + END.length).replace(/^\s*/, '')
    } else {
      text = text.trimEnd() + '\n\n' + block
    }
    writeFileSync(patchPath, text, 'utf8')
    logger?.info?.('[dsh-slim-agent] preset declaration written to ' + patchPath + ' (restart DSH once to see the mode)')
    return { ok: true, corePath, patchPath }
  } catch (error) {
    logger?.warn?.('[dsh-slim-agent] install failed: ' + String(error))
    return { ok: false, error: String(error) }
  }
}

export function apply(ctx) {
  install(ctx.logger)
}