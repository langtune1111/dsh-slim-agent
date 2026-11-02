/**
 * token-counter.mjs — 8K/4K 上下文固定开销实测分析器 (更新 see-world 规则版)
 */

export function estimateTokens(text) {
  if (!text) return 0;
  const cjkMatches = text.match(/[\u4e00-\u9fa5]/g) || [];
  const cjkCount = cjkMatches.length;
  const nonCjkCount = text.length - cjkCount;
  return Math.ceil(cjkCount * 0.8 + nonCjkCount * 0.28);
}

export function computeSlimOverhead() {
  const persona = `你是面向本地中小模型的极简高效编程与知识增强助手。
【工作规则】
1. 简单操作：阅读、编辑文件或单条命令由你自己使用 read/edit/bash 快速完成。
2. 联网线索：需要最新世界知识、实时事实或外部线索时，使用 web_search 获取 3-5 条带信源标签的简短摘要。
3. 深度研究：需抓取网页全文、多步对比分析或大量数据提炼时，必须委派 subagent，严禁在主窗口阅读海量原文。
4. 事实纪律：依据确凿事实与权威标签作答，未搜到确切证据时如实说明“未充分证实”，严禁主观编造事实。
5. 任务结束：当用户目标达成后，必须立即调用 task_complete 总结并退出，严禁生成无意义后续调用。`;

  const tools = [
    {
      name: "read",
      description:
        "Read lines from a UTF-8 text file. Specify offset (1-based line) and limit to page through large files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to read." },
          offset: {
            type: "integer",
            description: "Starting line number (1-based, default: 1).",
          },
          limit: {
            type: "integer",
            description: "Maximum number of lines to return (default: 200).",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "edit",
      description:
        "Replace exact literal text in a file. old_string must match exactly once.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Target file path." },
          old_string: {
            type: "string",
            description: "Exact literal text to replace.",
          },
          new_string: { type: "string", description: "Replacement text." },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
    {
      name: "bash",
      description:
        "Execute a shell command. Use for builds, inspections, tests, or file operations.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command line to execute.",
          },
        },
        required: ["command"],
      },
    },
    {
      name: "web_search",
      description:
        "Search the web for real-time facts or external clues. Returns 3-5 concise title+snippet items. Does not fetch full page content.",
      parameters: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            items: { type: "string" },
            description: "1 to 3 search keywords or query strings.",
          },
        },
        required: ["queries"],
      },
    },
    {
      name: "task_complete",
      description:
        "Explicit termination tool. Call this when the task objective is achieved to summarize outcome and prevent unnecessary follow-up loops.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description:
              "One to two concise sentences summarizing the completed work and final conclusion.",
          },
        },
        required: ["summary"],
      },
    },
    {
      name: "subagent",
      description:
        "Delegate heavy research, multi-step web reading, or complex exploration to an isolated subagent. Returns only distilled conclusions.",
      parameters: {
        type: "object",
        properties: {
          task_description: {
            type: "string",
            description:
              "Detailed objective, specific target and context for the subagent to investigate.",
          },
          constraints: {
            type: "string",
            description:
              "Any boundaries, forbidden paths, or specific scope limits (optional).",
          },
          max_turns: {
            type: "integer",
            description:
              "Turn limit for this subagent (default: 8, deep research: 12).",
          },
          context_budget: {
            type: "integer",
            description:
              "Subagent context token budget (default: 4000, max: 6000).",
          },
          expected_output: {
            type: "string",
            description: "Expected structure or fields of the returned summary.",
          },
        },
        required: ["task_description", "expected_output"],
      },
    },
  ];

  const personaTokens = estimateTokens(persona);
  const toolsTokens = estimateTokens(JSON.stringify(tools));
  const framingTokens = 120;
  const totalOverhead = personaTokens + toolsTokens + framingTokens;

  return {
    personaTokens,
    toolsTokens,
    framingTokens,
    totalOverhead,
    availableIn4K: 4096 - totalOverhead,
    ratioIn4K: (((4096 - totalOverhead) / 4096) * 100).toFixed(1) + "%",
    availableIn8K: 8192 - totalOverhead,
    ratioIn8K: (((8192 - totalOverhead) / 8192) * 100).toFixed(1) + "%",
    availableIn32K: 32768 - totalOverhead,
    ratioIn32K: (((32768 - totalOverhead) / 32768) * 100).toFixed(1) + "%",
  };
}

const stats = computeSlimOverhead();
console.log("=== 8K Slim Agent 固定开销实测分析 (v2.0) ===");
console.log(`- 系统提示词 (含 see-world 事实纪律): ~${stats.personaTokens} tokens`);
console.log(`- 6 个核心工具 Schema 描述           : ~${stats.toolsTokens} tokens`);
console.log(`- 通信协议与消息帧包装                : ~${stats.framingTokens} tokens`);
console.log(`-----------------------------------------------`);
console.log(`- 固定总开销 (Fixed Overhead)         : ~${stats.totalOverhead} tokens (目标: 1,000–1,600)`);
console.log(`- 4K 极限窗口剩余可用                 : ~${stats.availableIn4K} tokens (${stats.ratioIn4K})`);
console.log(`- 8K 基准窗口剩余可用                 : ~${stats.availableIn8K} tokens (${stats.ratioIn8K})`);
console.log(`- 32K 扩展窗口剩余可用                : ~${stats.availableIn32K} tokens (${stats.ratioIn32K})`);
console.log("===============================================");