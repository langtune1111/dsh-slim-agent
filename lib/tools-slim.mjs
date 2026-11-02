/**
 * tools-slim.mjs — 6 个扁平紧凑工具定义与轻量执行
 *
 * 工具清单（严格 6 个）：
 * 1. read: 读文本文件（支持 offset, limit）
 * 2. edit: 精准单处字符串替换（适配 exFAT 与标准卷，直接安全原子落盘）
 * 3. bash: 跨平台终端执行（统一命名为 bash，Windows 上自动适配 Git Bash / cmd / pwsh）
 * 4. web_search: 极简线索搜索（由 search-adapter 过滤，严禁大正文进主上下文）
 * 5. task_complete: 显式任务终结原语（带一句话 summary，直接调用 concludeTurn 防止循环）
 * 6. subagent: 结构化委派（带五大调度参数，由 subagent-scheduler 管理执行）
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import { executeLightweightSearch } from './search-adapter.mjs'

const execAsync = promisify(execCb)

export function registerSlimTools(ctx, scheduler, options = {}) {
  const disposers = []

  // ── 1. read ─────────────────────────────────────────────────────────
  disposers.push(
    ctx.tools.register({
      name: 'read',
      description: 'Read lines from a UTF-8 text file. Specify offset (1-based line) and limit to page through large files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read.' },
          offset: { type: 'integer', description: 'Starting line number (1-based, default: 1).' },
          limit: { type: 'integer', description: 'Maximum number of lines to return (default: 200).' },
        },
        required: ['path'],
      },
      output: {
        schema: {
          type: 'object',
          properties: { content: { type: 'string' } },
          required: ['content'],
        },
        render: (_args, val) => [{ type: 'text', text: val.content }],
      },
      async execute(args, exec) {
        try {
          const filePath = resolve(args.path)
          const raw = await readFile(filePath, 'utf8')
          const allLines = raw.split(/\r?\n/)
          const offset = Math.max(1, args.offset ?? 1)
          const limit = Math.max(1, Math.min(args.limit ?? 200, 500))
          const slice = allLines.slice(offset - 1, offset - 1 + limit)

          const formatted = slice.map((line, idx) => `${offset + idx}: ${line}`).join('\n')
          const total = allLines.length
          const summary = `[File: ${args.path} | Lines ${offset}-${offset + slice.length - 1} of ${total}]\n`
          return { content: summary + formatted }
        } catch (err) {
          return { content: `Error reading file "${args.path}": ${String(err.message || err)}` }
        }
      },
    })
  )

  // ── 2. edit ─────────────────────────────────────────────────────────
  disposers.push(
    ctx.tools.register({
      name: 'edit',
      description: 'Replace exact literal text in a file. old_string must match exactly once.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path.' },
          old_string: { type: 'string', description: 'Exact literal text to replace.' },
          new_string: { type: 'string', description: 'Replacement text.' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
      output: {
        schema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
        render: (_args, val) => [{ type: 'text', text: val.message }],
      },
      async execute(args, exec) {
        try {
          const filePath = resolve(args.path)
          const content = await readFile(filePath, 'utf8')
          const occurrences = content.split(args.old_string).length - 1

          if (occurrences === 0) {
            return { message: `Edit failed: old_string not found in "${args.path}". Please read the file first to verify exact content.` }
          }
          if (occurrences > 1) {
            return { message: `Edit failed: old_string matches ${occurrences} places in "${args.path}". Provide more surrounding lines to make it unique.` }
          }

          const replaced = content.replace(args.old_string, args.new_string)
          await writeFile(filePath, replaced, 'utf8')
          return { message: `Successfully updated "${args.path}".` }
        } catch (err) {
          return { message: `Edit error for "${args.path}": ${String(err.message || err)}` }
        }
      },
    })
  )

  // ── 3. bash ─────────────────────────────────────────────────────────
  disposers.push(
    ctx.tools.register({
      name: 'bash',
      description: 'Execute a shell command. Use for builds, inspections, tests, or file operations.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command line to execute.' },
        },
        required: ['command'],
      },
      output: {
        schema: {
          type: 'object',
          properties: { output: { type: 'string' } },
          required: ['output'],
        },
        render: (_args, val) => [{ type: 'text', text: val.output }],
      },
      async execute(args, exec) {
        try {
          const cmd = args.command
          const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
          const maxOutput = 4000

          const { stdout, stderr } = await execAsync(cmd, {
            cwd,
            timeout: 60000,
            maxBuffer: 1024 * 512,
            windowsHide: true,
          })

          let text = (stdout || '').trim()
          if (stderr) {
            text += (text ? '\n' : '') + '[stderr]\n' + stderr.trim()
          }
          if (!text) text = '(command completed with no output)'
          if (text.length > maxOutput) {
            text = text.slice(0, maxOutput) + `\n... (truncated: output was ${text.length} chars)`
          }
          return { output: text }
        } catch (err) {
          const errOutput = (err.stdout || '') + '\n' + (err.stderr || err.message || '')
          return { output: `[exit code: ${err.code ?? 1}]\n${errOutput.slice(0, 4000)}` }
        }
      },
    })
  )

  // ── 4. web_search ───────────────────────────────────────────────────
  disposers.push(
    ctx.tools.register({
      name: 'web_search',
      description: 'Search the web for real-time facts or external clues. Returns 3-5 concise title+snippet items. Does not fetch full page content.',
      parameters: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            items: { type: 'string' },
            description: '1 to 3 search keywords or query strings.',
          },
        },
        required: ['queries'],
      },
      output: {
        schema: {
          type: 'object',
          properties: { result: { type: 'string' } },
          required: ['result'],
        },
        render: (_args, val) => [{ type: 'text', text: val.result }],
      },
      async execute(args, exec) {
        const text = await executeLightweightSearch(ctx, args.queries, {
          maxResults: options.searchMaxResults ?? 4,
          timeoutMs: options.searchTimeoutMs ?? 15000,
        })
        return { result: text }
      },
    })
  )

  // ── 5. task_complete ────────────────────────────────────────────────
  disposers.push(
    ctx.tools.register({
      name: 'task_complete',
      description: 'Explicit termination tool. Call this when the task objective is achieved to summarize outcome and prevent unnecessary follow-up loops.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'One to two concise sentences summarizing the completed work and final conclusion.',
          },
        },
        required: ['summary'],
      },
      output: {
        schema: {
          type: 'object',
          properties: { status: { type: 'string' } },
          required: ['status'],
        },
        render: (_args, val) => [{ type: 'text', text: val.status }],
      },
      async execute(args, exec) {
        if (typeof exec?.concludeTurn === 'function') {
          exec.concludeTurn()
        }
        return { status: `[TASK FINISHED]: ${args.summary}` }
      },
    })
  )

  // ── 6. subagent ─────────────────────────────────────────────────────
  disposers.push(
    ctx.tools.register({
      name: 'subagent',
      description: 'Delegate heavy research, multi-step web reading, or complex exploration to an isolated subagent. Returns only distilled conclusions.',
      parameters: {
        type: 'object',
        properties: {
          task_description: {
            type: 'string',
            description: 'Detailed objective, specific target and context for the subagent to investigate.',
          },
          constraints: {
            type: 'string',
            description: 'Any boundaries, forbidden paths, or specific scope limits (optional).',
          },
          max_turns: {
            type: 'integer',
            description: 'Turn limit for this subagent (default: 8, deep research: 12).',
          },
          context_budget: {
            type: 'integer',
            description: 'Subagent context token budget (default: 4000, max: 6000).',
          },
          expected_output: {
            type: 'string',
            description: 'Expected structure or fields of the returned summary.',
          },
        },
        required: ['task_description', 'expected_output'],
      },
      output: {
        schema: {
          type: 'object',
          properties: { report: { type: 'string' } },
          required: ['report'],
        },
        render: (_args, val) => [{ type: 'text', text: val.report }],
      },
      async execute(args, exec) {
        if (!scheduler || typeof scheduler.delegate !== 'function') {
          return { report: 'Error: Subagent scheduler is not available in current session.' }
        }
        const result = await scheduler.delegate(args, exec)
        return { report: result }
      },
    })
  )

  return () => {
    for (const d of disposers) {
      try {
        if (typeof d === 'function') d()
        else if (typeof d?.dispose === 'function') d.dispose()
      } catch {}
    }
  }
}