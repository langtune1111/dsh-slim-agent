# dsh-slim-agent

面向消费级显卡本地小模型（1.7B–8B）与短上下文（4K–8K）环境的 DeepSeek Harness (DSH) 预设插件。通过“窄主代理 + 隔离子代理”的分工架构，在降低主窗口上下文开销的同时，提供受控的联网搜索与子代理多步研究能力。

[![Version](https://img.shields.io/badge/version-0.2.3--beta.1-orange.svg)](https://github.com/langtune1111/dsh-slim-agent/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.1%20(0.2.1--rc.5%20verified)-blue.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![CI](https://github.com/langtune1111/dsh-slim-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/langtune1111/dsh-slim-agent/actions)

> ⚠️ **项目状态与环境说明**
> - 当前版本：`0.2.3-beta.1`。已在 **DSH desktop 0.2.1-rc.5 (Windows / 本地环境)** 上完成端到端联调与原生 `startActivation` 验证。
> - 本项目不包含虚构的性能跑分数字；固定开销数据均由透明脚本测量或经验估算得到（见 [数据测量与复现](#数据测量与复现)）。
> - `bash` 工具默认要求宿主提供沙箱接口 (`ctx.subprocess.spawn`)；在无沙箱的宿主上会明确报错拒绝执行。

---

## 一、 架构设计与分工机制

在短上下文（4K / 8K）下运行全功能 Agent 时，数十个工具定义与长篇网页正文极易占满上下文窗口，并导致小模型产生工具选择幻觉。本插件采用“窄主代理 + 宽子代理”的分工模型：

```
                              用户输入任务
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 主代理 (Main Agent) — 运行于 4K/8K 短上下文                              │
│ • 固定开销：约 0.9K ~ 1.2K tokens (含 tool-fs)                          │
│ • 仅暴露 6 个基础工具：                                                  │
│   read        edit        bash        web_search       task_complete    │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │ 遇到多网页阅读 / 深度资料比对
                                      ▼ 委派子代理 (subagent)
┌─────────────────────────────────────────────────────────────────────────┐
│ 子代理 (Subagent) — 独立执行环境                                        │
│ • 拥有完整调研工具面 (web_search, web_fetch, read, bash...)             │
│ • 执行多步阅读、检索与比对                                              │
│ • 任务完成或预算耗尽后整体销毁                                          │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │ 仅回传结构化提炼结论
                                      │ 【已确认结论】+【未验证疑点】+【建议下一步】
                                      ▼ (原始网页长文绝不进入主上下文)
┌─────────────────────────────────────────────────────────────────────────┐
│ 主代理整合结论，执行本地代码修改并完成任务                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 主代理 6 个工具职责

| 工具 | 来源 | 职责说明 |
|---|---|---|
| `read` / `edit` | `@deepseek-ai/dsh-tool-fs` | 标准文件读取与单处精确修改，受宿主工作区沙箱约束 |
| `bash` | 本插件 | 单条命令执行。默认由 `ctx.subprocess.spawn` 监管，绑定工作区并写审计日志 |
| `web_search` | 本插件 | 仅返回 3–5 条 `[来源标签] [标题](URL) (年份) - 一行摘要`，**不返回网页正文** |
| `task_complete` | 本插件 | 显式收尾原语，调用 `exec.concludeTurn()` 阻断小模型无意义后续调用 |
| `subagent` | 本插件 | 委派子代理执行深度研究，通过原生 `startActivation` 调度，只回传提炼报告 |

主代理工具白名单具备 **fail-closed** 机制：`system-prompt/assemble` 过滤异常时返回空工具集，避免意外放行全量外来插件工具。

---

## 二、 架构的优势与不足 (Trade-offs)

客观评估“窄主宽子”架构的技术利弊与适用边界：

### 优势 (Advantages)
1. **主上下文开销受控**：主代理工具面收窄至 6 个基础工具，固定 Schema 开销显著降低，为实际任务留出 85%+ 上下文空间，缓解小模型因工具冗余导致的格式与选择错误。
2. **长篇网页正文物理隔离**：检索与长文阅读限制在独立的子代理会话中完成，原始 HTML/Markdown 不回流到主上下文，杜绝 4K/8K 窗口的直接溢出。
3. **显存并发防护**：通过异步信号量限制子代理并发为 1（默认，可配置），保证单卡本地部署时主子代理分时复用推理通道，避免多代理并发抢占显存引发 OOM。
4. **自洽免 Key 检索线索**：内置 DuckDuckGo / Wikipedia 降级检索链，辅以来源分类标签（`[源码仓库]`、`[文档站]`、`[社区讨论]`、`[百科]`）与年份线索，降低时效性问题上的盲目虚构。

### 不足与局限 (Limitations & Trade-offs)
1. **端到端推理耗时与总 Token 增加（时间换空间）**：
   - 虽然主代理上下文节省了，但子代理在独立会话中多轮执行搜索和阅读，**整个任务端到端消耗的总 Token 数和推理耗时实际上是增加的**；
   - 在本地单显卡部署时，主代理与子代理必须串行分时推理，如果子代理轮次较多，用户的**整体等待时间会明显长于单次直接回答**。
2. **依赖小模型的意图拆解质量**：
   - 1.7B–4B 模型本身的指令拆解与规划能力有限。若主代理生成的 `task_description` 或 `expected_output` 模糊不清，子代理容易检索偏航；若主模型未能准确判断何时该调用 `subagent`，分层优势将无法发挥。
3. **信息有损压缩（无法追溯正文细节）**：
   - 子代理只回传提炼后的三段式报告，主模型无法查看原始网页细节。如果子代理提炼遗漏了关键参数或代码段，主模型将无法补救。
4. **来源标签仅为域名启发式分类**：
   - `classifySource` 仅根据 Hostname 正则分类（例如将 docs.* 标为文档站、github.com 标为源码仓库），**并非真正的语义级事实核验**，无法识别虚假内容、社区争议或过时技术博客。
5. **轮次与工具预算为软约束**：
   - 当前 `maxTurnsDefault` 与 `maxToolCalls` 主要通过 Prompt 提示词进行约束，尚未接入基于子会话事件的外部强行终止（kill）硬熔断。

---

## 三、 数据测量与复现 (Benchmarking)

本仓库不提供脱离实测的硬编码成功率数字。固定开销与用例记录全部由透明脚本提供：

### 1. 固定开销组成测算 (Character Heuristic vs Real Schema)
运行 `npm run estimate` 输出的经验估算（±15% 字符估算，非分词器实测）：
- **系统提示词 (Persona)**：~147 tokens
- **4 个自注册工具 Schema**：~370 tokens
- **通信协议与消息帧包装**：~120 tokens
- **自注册部分小计**：约 637 tokens

加上宿主 `@deepseek-ai/dsh-tool-fs` 挂载的 `read` / `edit` 工具定义，首轮固定总开销约在 **0.9K ~ 1.2K tokens** 之间（具体取决于本地模型服务端的 ChatML 模板与分词器实现）。

### 2. 端到端真实测量步骤
启动本地推理服务（如 LM Studio，加载目标模型并开启 Local Server）后，运行以下测量脚本：

```bash
# 测量真正包含 6 个工具 Schema 时的首轮端到端固定开销
node benchmark/run.mjs --overhead --base http://127.0.0.1:1234/v1 --model qwen3.5-4b

# 手工记录一次标准用例的执行结果（用例定义见 benchmark/cases.json）
node benchmark/run.mjs --record --case CASE_B --model qwen3.5-4b --ok --note "命中官方发布信息"

# 汇总样本数据（样本数 < 5 时提示不可对外引用）
node benchmark/run.mjs --summary
```

测量记录将写入 `benchmark/results/overhead-*.jsonl` 与 `benchmark/results/cases-*.jsonl`，可追溯核验。

---

## 四、 📦 安装与使用指南

### 安装方式

```bash
# 方式 1：推荐直接发网址给 DSH 客户端对话框自动安装
“帮我安装这个插件：https://github.com/langtune1111/dsh-slim-agent”

# 方式 2：通过 DSH CLI 命令行添加
dsh plugin add dsh-slim-agent

# 方式 3：下载 Release 离线包安装
dsh plugin add ./dsh-slim-agent-0.2.3-beta.1.tgz
```

### 🚀 重启一次即用 (One-Restart Setup)

本插件采用**内存注册表即刻激活 + 静态原子持久化双保险机制**：
- 安装完成后，**仅需完全退出并重启 1 次 DSH 客户端**；
- 打开任意新对话，在左上角的 **模式 (Preset)** 下拉列表中，即可直接选用：
  > 👉 **「中小模型·轻量知识增强 (8K Slim)」**

### 插件配置参数 (`config`)

可在预设定义或安装配置中调节以下参数：

```yaml
concurrencyLimit: 1        # 子代理并发上限（默认 1，防显存 OOM）
searchEngine: auto         # 搜索路由：auto (优先宿主，降级内置) | builtin (只用内置) | host (只用宿主)
maxTurnsDefault: 8         # 子代理默认轮次提示（软限制）
maxTurnsDeep: 12           # 深度研究最大轮次上限
maxToolCalls: 15           # 子代理工具调用上限提示
bash: sandbox              # 命令执行策略：sandbox (默认，需宿主沙箱) | local (本地执行+危险正则拦截) | off (不注册)
autoInstall: true          # 是否自动将预设维护至 ~/.dsh/cordis.patch.yml（写前备份 .bak，原子重命名）
```

---

## 五、 本地模型部署建议配置 (LM Studio)

1. **测试基线模型**：推荐使用 `LFM-3 1.7B Q5_K_M`（极小规模）或 `Qwen3.5 4B Q4_K_M`（主力）；
2. **上下文设置**：在参数面板中将 **Context Length** 手动设为 **`8192`**（亦可用于测试 `4096` 极限窗口）；
3. **显存配置**：GPU Offload 设为 Max（4B Q4KM 权重约 2.6GB，8K KV Cache 约 0.8GB，合计约 3.8GB，可在 6GB 消费级显卡上流畅运行）；
4. 启动 Local Server（默认 `http://127.0.0.1:1234`），DSH 客户端通过 OpenAI 兼容适配器连接。

---

## 六、 🧪 自动化测试套件

本仓库包含 **26 项全离线单元测试**（不依赖外部网络与任何第三方 npm 包），覆盖安全策略、状态机契约与安装器防护：

```bash
npm test
```

测试覆盖范围：
- 信源分类器（域名启发式、年份正则）
- 异步信号量并发与防死锁释放保证
- 真实的 `ctx.subprocess.spawn` 沙箱参数分发与 `bash: off` 行为
- 破坏性命令正则拦截（`local` 模式）
- 搜索引擎三模式路由隔离（`builtin` / `host` / `auto`）
- 主代理工具白名单 fail-closed 异常保护
- 子代理原生 `startActivation` 接口契约
- 安装器单边损坏标记拒绝写入与 `.bak` 备份失败硬熔断防护

GitHub Actions CI 在 Ubuntu / Windows / macOS × Node 20 / 22 矩阵上全绿通过。

---

## 许可证

[MIT License](LICENSE)