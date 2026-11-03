/**
 * dsh-slim-agent — 安装器与运行时双保险入口（host 作用域）
 *
 * 核心保障：实现用户安装后「仅需重启 1 次 DSH」即可在模式列表中选用！
 *
 * 双保险机制：
 *   1. 静态持久化（install）：将预设声明安全原子写入 ~/.dsh/cordis.patch.yml（带单边残缺标记防御、备份失败硬熔断与原子重命名写入）；
 *   2. 运行时即刻激活（apply）：在首次启动时，直接调用 0.2.x 的 agentPresets 服务向内存注册表中注册定义，无需等待二次重启即可当场选用！
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

export const name = 'dsh-slim-agent'
export const inject = []

const BEGIN = '# --- dsh-slim-agent managed block (auto-generated; do not edit) ---'
const END = '# --- end dsh-slim-agent managed block ---'

const PERSONA_LINES = [
  '你是面向本地中小模型的极简高效编程与知识增强助手。',
  '1. 简单操作：阅读、编辑文件或单条命令由你自己使用 read/edit/bash 完成。',
  '2. 联网线索：需要最新事实或外部知识时，用 web_search 取 3-5 条带来源标签的摘要。',
  '3. 读网页正文、跨源比对或多步研究，必须委派 subagent，不要把网页长文读进主窗口；本地文件任务不要委派。',
  '4. 事实纪律：依据确凿事实作答，查不到就明说“未充分证实”，不要编造。',
  '5. 完成后直接用文字给出结论，不要再调用工具。',
]

function declarationBlock(coreUrl) {
  const persona = PERSONA_LINES.map((line) => '                ' + line).join('\n')
  return [
    BEGIN,
    '- insert:',
    '    - id: preset-local-slim-agent',
    '      name: "@deepseek-ai/dsh-agent-preset"',
    '      config:',
    '        id: local-slim-agent',
    '        name: 中小模型·轻量知识增强 (8K Slim)',
    '        description: 消费级显卡上的 1.7B-8B 本地小模型：8K 上下文下兼具免 Key 联网线索与必要代码工具，主代理 5 工具白名单，子代理并发默认 1。',
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

    // 单边残缺标记防御：如果只发现 BEGIN 或只发现 END，说明用户可能手动修改损坏了标记
    // 此时拒绝盲目拼接，防止清空/截断标记之后的用户自定义内容
    if ((begin >= 0 && end === -1) || (begin === -1 && end >= 0)) {
      logger?.warn?.(
        '[dsh-slim-agent] corrupted managed block markers in ' + patchPath +
        ' (found one marker without its closing pair). Aborting auto-install to prevent truncating config.'
      )
      return { ok: false, error: 'corrupted-markers' }
    }

    // 归一化拼接：块前只保留一个空行分隔，块后不留尾随内容，
    // 这样第二次运行的产物与第一次逐字节相同（幂等）。
    const head = (begin >= 0 ? original.slice(0, begin) : original).trimEnd()
    const tail = begin >= 0 && end > begin ? original.slice(end + END.length).trim() : ''
    const next = (head ? head + '\n\n' : '') + block + (tail ? tail + '\n' : '')

    if (next === original) {
      logger?.info?.('[dsh-slim-agent] preset declaration already up to date')
      return { ok: true, unchanged: true, corePath, patchPath }
    }

    // 1. 备份失败硬熔断：若原有配置存在但备份写入失败，立即安全中止，绝不冒着损坏用户配置的风险覆写
    if (original !== '') {
      const backup = patchPath + '.bak'
      try {
        writeFileSync(backup, original, 'utf8')
      } catch (error) {
        logger?.warn?.('[dsh-slim-agent] backup failed (' + String(error) + '). Aborting auto-install to protect original configuration.')
        return { ok: false, error: 'backup-failed' }
      }
    }

    // 2. 原子安全写入：先写入同目录临时文件，落盘后再原子重命名，防止进程意外崩溃导致半写文件
    const tmpPath = patchPath + '.tmp-' + process.pid + '-' + Date.now()
    try {
      writeFileSync(tmpPath, next, 'utf8')
      renameSync(tmpPath, patchPath)
    } catch (writeErr) {
      try { if (existsSync(tmpPath)) unlinkSync(tmpPath) } catch {}
      throw writeErr
    }

    logger?.info?.('[dsh-slim-agent] preset declaration written to ' + patchPath + ' (restart DSH to apply)')
    return { ok: true, corePath, patchPath }
  } catch (error) {
    logger?.warn?.('[dsh-slim-agent] install failed: ' + String(error))
    return { ok: false, error: String(error) }
  }
}

export function apply(ctx, config = {}) {
  // 1. 静态持久化写盘（幂等、带备份、原子写）
  install(ctx.logger, config)

  // 2. 运行时即刻激活（重启一次即用的关键突破）
  if (typeof ctx?.inject === 'function') {
    ctx.inject(['agentPresets'], async (presetCtx) => {
      try {
        const home = process.env.DSH_HOME || join(homedir(), '.dsh')
        const corePath = join(home, '.agent-presets', '_slim-code', 'core.mjs')
        const coreUrl = 'file:///' + corePath.replace(/\\/g, '/')
        const def = {
          id: 'local-slim-agent',
          name: '中小模型·轻量知识增强 (8K Slim)',
          description: '消费级显卡上的 1.7B-8B 本地小模型：8K 上下文下兼具免 Key 联网线索与必要代码工具，主代理 5 工具白名单，子代理并发默认 1。',
          order: 32,
          plugins: [
            {
              id: 'persona',
              name: '@deepseek-ai/dsh-persona',
              config: {
                prefix: PERSONA_LINES.join('\n'),
              },
            },
            {
              id: 'tool-pwsh',
              name: '@deepseek-ai/dsh-tool-pwsh',
              disabled: process.platform !== 'win32',
            },
            {
              id: 'tool-bash',
              name: '@deepseek-ai/dsh-tool-bash',
              disabled: process.platform === 'win32',
            },
            {
              id: 'tool-fs',
              name: '@deepseek-ai/dsh-tool-fs',
            },
            {
              id: 'slim-core',
              name: coreUrl,
              config: {
                concurrencyLimit: config.concurrencyLimit ?? 1,
                searchEngine: config.searchEngine || 'auto',
                bash: config.bash || 'sandbox',
              },
            },
          ],
        }

        if (presetCtx.agentPresets && typeof presetCtx.agentPresets.register === 'function') {
          await presetCtx.agentPresets.register(def)
          ctx.logger?.info?.('[dsh-slim-agent] preset "local-slim-agent" registered into live registry (available on 1st restart)')
        }
      } catch (err) {
        // 允许重复注册容错
      }
    })
  }
}