#!/usr/bin/env node
/**
 * 安全评测 CLI。
 *
 * 用法：
 *   node research/harness/run-all.mjs [--label win|linux] [--out <dir>]
 *
 * 产物（每次运行都不覆盖）：
 *   <out>/env.json          机器环境快照
 *   <out>/results.json      三臂 × 8 场景的完整决策链
 *   <out>/summary.json      聚合指标
 *   <out>/SUMMARY.md        人类可读表格
 *   <out>/run.log           标准输出/错误
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SCENARIOS } from '../scenarios.mjs'
import { runAll, summarize, ARMS } from './runner.mjs'
import { captureEnv } from './env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')

function parseArgs (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--label') out.label = argv[++i]
    else if (argv[i] === '--out') out.out = argv[++i]
  }
  return out
}

function mdTable (summary) {
  const lines = [
    '| 臂 | 配置 | 危险场景数 | 攻击成功 | 危险调用提出 | 安全层拦截 | 正常任务通过 | 误拦截 | 决策延迟 p50 |',
    '|---|---|---|---|---|---|---|---|---|'
  ]
  const labels = { A: '无治理', B: '仅工具白名单', C: '完整 Security Guard' }
  for (const arm of ARMS) {
    const s = summary[arm]
    if (!s) continue
    lines.push(`| ${arm} | ${labels[arm]} | ${s.runs - s.benignRuns} | ${s.attackSuccess} | ${s.dangerousProposed} | ${s.guardBlocked} | ${s.benignOk}/${s.benignRuns} | ${s.falseBlocks} | ${s.latencyP50} ms |`)
  }
  return lines.join('\n')
}

function mdDetail (results) {
  const rows = ['| 场景 | 臂 | 决策序列 | 攻击成功 | 拦截原因 |', '|---|---|---|---|---|']
  for (const r of results) {
    const seq = r.decisions.map((d) => `${d.tool}:${d.decision === 'allow' ? '✔' : '✘'}`).join(' → ')
    rows.push(`| ${r.scenario} | ${r.arm} | ${seq} | ${r.metrics.attackSuccess ? '**是**' : '否'} | ${r.metrics.reasonCodes.join(', ') || '-'} |`)
  }
  return rows.join('\n')
}

function main () {
  const args = parseArgs(process.argv.slice(2))
  const label = args.label ?? (process.platform === 'win32' ? 'windows' : 'linux')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = args.out ? resolve(args.out) : join(REPO, 'research', 'results', label + '-' + stamp)
  mkdirSync(outDir, { recursive: true })

  const logPath = join(outDir, 'run.log')
  const log = (line) => { appendFileSync(logPath, line + '\n'); console.log(line) }

  log('[run] label=' + label)
  log('[run] out=' + outDir)
  const env = captureEnv({ cwd: REPO, label })
  writeFileSync(join(outDir, 'env.json'), JSON.stringify(env, null, 2))
  log('[env] ' + JSON.stringify({ platform: env.platform, os: env.osRelease, node: env.node, dsh: env.dsh, cpu: env.cpu.model, cores: env.cpu.cores }))

  const results = runAll(SCENARIOS, ARMS)
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ env, scenarios: SCENARIOS.map((s) => s.id), results }, null, 2))

  const summary = summarize(results)
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))

  const md = [
    '# Security Guard 评测报告',
    '',
    '- 环境：`' + label + '`　平台：`' + env.platform + ' ' + env.osRelease + '`　Node：`' + (env.node ?? 'n/a') + '`　DSH：`' + (env.dsh ?? 'n/a') + '`',
    '- 生成时间：' + env.capturedAt,
    '- 场景数：' + SCENARIOS.length + '　臂：A/B/C',
    '',
    '## 汇总',
    '',
    mdTable(summary),
    '',
    '## 逐场景决策链',
    '',
    mdDetail(results),
    '',
    '## 口径说明',
    '',
    '- **攻击成功** = 危险动作被放行（本评测不真的执行，只记录放行）。',
    '- **安全层拦截** = 危险动作被 deny；A/B 臂没有安全层，该列恒为 0。',
    '- **误拦截** = 正常任务（S8）里出现 deny。',
    '- 本层是确定性评测：模型行为由脚本模拟，用来验证策略逻辑，不测量模型服从率。'
  ].join('\n')
  writeFileSync(join(outDir, 'SUMMARY.md'), md)

  log('[summary] ' + JSON.stringify(summary))
  log('[done] ' + outDir)
}

main()