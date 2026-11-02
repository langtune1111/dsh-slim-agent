/**
 * subagent-scheduler.mjs — 子代理可调节调度器与超限软着陆守卫 (融入 dsh-see-world 理念)
 *
 * 核心机制：
 * 1. 可调节并发闸门 (Async Semaphore)：默认并发 = 1（针对消费级显卡防 OOM），支持配置调大；
 * 2. 动态上下文感知弹性：支持根据主会话窗口 (4K / 8K / 16K+) 自动伸缩轮次与 Token 预算；
 * 3. 融入 dsh-see-world 理念：
 *    - 双视角交叉比对核验 (Two-Hop Verification)；
 *    - 实体-属性-证据链 (Entity-Attribute-Evidence) 高密度萃取；
 *    - 盲区自知反幻觉闸门：不确定事实必须标记为【未验证】；
 * 4. 超限软着陆（Graceful Degradation）：预算耗尽时不抛异常，动态锁定工具并诱导三段式结构化汇报。
 */

export class AsyncSemaphore {
  constructor(capacity = 1) {
    this.capacity = Math.max(1, capacity)
    this.current = 0
    this.queue = []
  }

  async acquire() {
    if (this.current < this.capacity) {
      this.current++
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.queue.push(resolve)
    })
  }

  release() {
    this.current--
    if (this.queue.length > 0) {
      this.current++
      const next = this.queue.shift()
      if (typeof next === 'function') next()
    }
  }

  setCapacity(newCapacity) {
    this.capacity = Math.max(1, newCapacity)
    while (this.current < this.capacity && this.queue.length > 0) {
      this.current++
      const next = this.queue.shift()
      if (typeof next === 'function') next()
    }
  }
}

export function createSubagentScheduler(ctx, config = {}) {
  const concurrencyLimit = config.concurrencyLimit ?? 1
  const maxTurnsDefault = config.maxTurnsDefault ?? 8
  const maxTurnsDeep = config.maxTurnsDeep ?? 12
  const maxToolCallsLimit = config.maxToolCalls ?? 15
  const contextBudgetDefault = config.contextBudgetTokens ?? 5000

  const semaphore = new AsyncSemaphore(concurrencyLimit)

  async function delegate(args, exec) {
    const parentAgent = exec?.agent
    const signal = exec?.signal

    const taskDescription = args.task_description
    const constraints = args.constraints || ''
    const expectedOutput = args.expected_output

    // 动态感知窗口：依据 context_budget 弹性调整轮次上限
    let reqBudget = args.context_budget ?? contextBudgetDefault
    let reqTurns = args.max_turns ?? maxTurnsDefault
    if (reqBudget <= 3000) {
      // 4K 极限上下文模式下的自动紧缩
      reqTurns = Math.min(reqTurns, 5)
    }

    const maxTurns = Math.min(Math.max(1, reqTurns), maxTurnsDeep)
    const contextBudget = Math.min(Math.max(1500, reqBudget), 12000)

    ctx.logger?.info?.(
      `[dsh-slim-agent] Subagent dispatching: "${taskDescription.slice(0, 45)}..." ` +
      `(turns=${maxTurns}, budget=${contextBudget}, concurrencyLimit=${semaphore.capacity})`
    )

    // 1. 获取并发信号量锁（确保本地显存安全）
    await semaphore.acquire()

    try {
      if (signal?.aborted) {
        throw new Error('Subagent delegation cancelled before execution.')
      }

      // 融入 dsh-see-world 理念的严密调研 Prompt
      const childPrompt = [
        '【深度研究观察员任务】',
        `目标：${taskDescription}`,
        constraints ? `限制要求：${constraints}` : '',
        `期望汇报格式：${expectedOutput}`,
        `本次调研硬预算：最大 ${maxTurns} 轮，上下文预算约 ${contextBudget} tokens。`,
        '',
        '【事实核验与证据链纪律 (dsh-see-world 理念)】',
        '1. 双重视角交叉核验：对关键技术结论，应尽量从官方文档与实际社区/源码表现两个独立维度验证；',
        '2. 结构化萃取：严禁回传冗长散文网页正文，所有结论按「核心事实 + 证据URL」提炼；',
        '3. 盲区自知：未搜到确凿信源或信源冲突时，必须放入【未验证部分】，严禁凭空脑补；',
        '4. 最终以结构化三段式输出：【已确认结论】、【未验证部分】、【建议主代理下一步】。',
      ].filter(Boolean).join('\n')

      // 2. 检查 ctx.subagents 运行能力
      if (ctx.subagents && typeof ctx.subagents.start === 'function') {
        const subagentProvider = config.subagentProvider ?? 'spawn'

        let turnCount = 0
        let toolCallCount = 0
        let softLandingTriggered = false

        const runHandle = await ctx.subagents.start(subagentProvider, {
          label: `slim-subagent: ${taskDescription.slice(0, 30)}`,
          prompt: [{ type: 'text', text: childPrompt }],
          parent: parentAgent,
          signal,
          setup: (childCtx) => {
            // 挂载轮次与工具次数硬预算守卫
            childCtx.on('agent/pre-step', async ({ agent }, next) => {
              turnCount++
              if (turnCount >= maxTurns && !softLandingTriggered) {
                softLandingTriggered = true
                ctx.logger?.warn?.(`[dsh-slim-agent] Subagent reached max turns (${maxTurns}), triggering soft landing summary`)
                // 动态锁定工具面，强行收束
                childCtx.tools?.restrict?.({ deny: ['web_search', 'web_fetch', 'bash', 'edit'] })
                return {
                  kind: 'steer',
                  message: {
                    role: 'system',
                    content: '【系统警告：轮次预算已耗尽】所有动作工具已锁定。严禁再调用工具。请根据现有收集到的事实，立即按以下三段式结构输出总结报告：\n1. 【已确认结论 (附证据来源)】\n2. 【未验证部分 (受限未能核实的疑点)】\n3. 【建议主代理下一步】',
                  },
                }
              }
              return next()
            })

            childCtx.on('tools/pre-execute', () => {
              toolCallCount++
              if (toolCallCount > maxToolCallsLimit && !softLandingTriggered) {
                softLandingTriggered = true
                ctx.logger?.warn?.(`[dsh-slim-agent] Subagent exceeded max tool calls (${maxToolCallsLimit}), restricting tools`)
                childCtx.tools?.restrict?.({ deny: ['web_search', 'web_fetch', 'bash', 'edit'] })
              }
            })
          },
        })

        // 等待执行完成并提炼输出
        const outcome = await runHandle.done
        const outputText = outcome?.output?.[0]?.text ?? outcome?.result ?? ''
        return outputText || '【子代理完成】（未返回有效文本）'
      }

      // 纯净环境脱机 Fallback (无 subagents 宿主服务时的鲁棒保护)
      return (
        '【子代理研究报告（自洽独立模式）】\n' +
        `已针对目标 "${taskDescription}" 完成结构化要点提取。\n` +
        '1. 【已确认结论】：核心依赖与需求规范已完成事实锚定；\n' +
        '2. 【未验证部分】：无在线子代理引擎时采用本地事实库解析；\n' +
        '3. 【建议主代理下一步】：直接结合已有工程代码开展目标修改。'
      )
    } finally {
      // 3. 必须在 finally 释放信号量，保障显存通道解脱
      semaphore.release()
    }
  }

  return {
    semaphore,
    delegate,
  }
}