/**
 * dsh-slim-agent — 安装器（host 作用域）
 *
 * 只做两件幂等的事，且**默认不会偷偷改用户配置**：
 *   A. 把 preset-core.mjs 复制到 <dshHome>/.agent-presets/_slim-code/core.mjs
 *   B. 在 <dshHome>/cordis.patch.yml 里维护一段托管声明块（写前备份 .bak）
 *
 * 关掉自动安装：在插件配置里设 autoInstall: false。
 * 原因：写 dshHome 属于越界副作用，用户应当知情并可拒绝。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

export const name = 'dsh-slim-agent'
export const inject = []

const BEGIN = '# --- dsh-slim-agent managed block (auto-generated; do not edit) ---'
const END = '# --- end dsh-slim-agent managed block ---'

const PERSONA = [
  '你是面向本地中小模型的极简高效编程与知识增强助手。',
  '1. 简单操作：阅读、编辑文件或单条命令由你自己使用 read/edit/bash 完成。',
  '2. 联网线索：需要最新事实或外部知识时，用 web_search 取 3-5 条带来源标签的摘要。',
  '3. 深度研究：需要读网页全文或多步比对时，委派 subagent，不要在主窗口读长文。',
  '4. 事实纪律：依据确凿事实作答，查不到就明说“未充分证实”，不要编造。',
  '5. 目标达成后立即调用 task_complete 收尾，不要追加无意义回复。',
]

function declarationBlock(coreUrl) {
  const persona = PERSONA.map((line) => '                ' + line).join('\n')
  return [
    BEGIN,
    '- insert:',
    '    - id: preset-local-slim-agent',
    '      name: "@deepseek-ai/dsh-agent-preset"',
    '      config:',
    '        id: local-slim-agent',
    '        name: 中小模型·轻量知识增强 (8K Slim)',
    '        description: 消费级显卡上的 1.7B-8B 本地小模型：8K 上下文下兼具免 Key 联网线索与必要代码工具，主代理 6 工具白名单，子代理并发默认 1。',
    '        order: 32',
    '        plugins:',
    '          - id: persona',
    '            name: "@deepseek-ai/dsh-persona"',
    '            config:',
    '              prefix: |-',
    persona,
    '          - id: tool-pwsh',
    '            name: "@deepseek-ai/dsh-tool-pwsh"',
    '          - id: tool-fs',
    '            name: "@deepseek-ai/dsh-tool-fs"',
    '          - id: slim-core',
    '            name: ' + coreUrl,
    '            config:',
    '              concurrencyLimit: 1',
    '              searchEngine: auto',
    '              bash: sandbox',
    END,
    '',
  ].join('\n')
}

/** 幂等安装；返回实际写入的路径，供调用方打日志。 */
export function install(logger, config = {}) {
  if (config.autoInstall === false) {
    logger?.info?.('[dsh-slim-agent] autoInstall=false, skipping preset installation')
    return { ok: false, skipped: 'autoInstall-disabled' }
  }
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    const codeDir = join(home, '.agent-presets', '_slim-code')
    const corePath = join(codeDir, 'core.mjs')
    const patchPath = join(home, 'cordis.patch.yml')
    const source = join(dirname(fileURLToPath(import.meta.url)), 'preset-core.mjs')

    mkdirSync(codeDir, { recursive: true })
    if (existsSync(source)) copyFileSync(source, corePath)

    const coreUrl = 'file:///' + corePath.replace(/\\/g, '/')
    const block = declarationBlock(coreUrl)
    const original = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''

    const begin = original.indexOf(BEGIN)
    const end = original.indexOf(END)
    // 归一化拼接：块前只保留一个空行分隔，块后不留尾随内容，
    // 这样第二次运行的产物与第一次逐字节相同（幂等）。
    const head = (begin >= 0 ? original.slice(0, begin) : original).trimEnd()
    const tail = begin >= 0 && end > begin ? original.slice(end + END.length).trim() : ''
    const next = (head ? head + '\n\n' : '') + block + (tail ? tail + '\n' : '')

    if (next === original) {
      logger?.info?.('[dsh-slim-agent] preset declaration already up to date')
      return { ok: true, unchanged: true, corePath, patchPath }
    }

    if (original !== '') {
      const backup = patchPath + '.bak'
      try { writeFileSync(backup, original, 'utf8') } catch (error) {
        logger?.warn?.('[dsh-slim-agent] could not write backup: ' + String(error))
      }
    }
    writeFileSync(patchPath, next, 'utf8')
    logger?.info?.('[dsh-slim-agent] preset declaration written to ' + patchPath + ' (restart DSH to apply)')
    return { ok: true, corePath, patchPath }
  } catch (error) {
    logger?.warn?.('[dsh-slim-agent] install failed: ' + String(error))
    return { ok: false, error: String(error) }
  }
}

export function apply(ctx, config = {}) {
  install(ctx.logger, config)
}