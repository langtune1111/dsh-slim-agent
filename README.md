# dsh-slim-agent

面向消费级显卡本地小模型（1.7B–8B）与短上下文（4K–8K）环境的 DeepSeek Harness (DSH) 预设插件。通过“窄主代理 + 隔离子代理”的分工架构，在降低主窗口上下文开销的同时，提供受控的联网搜索与子代理多步研究能力。

[![Version](https://img.shields.io/badge/version-0.4.5--beta.1-orange.svg)](https://github.com/langtune1111/dsh-slim-agent/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.1%20(0.2.1--rc.5%20verified)-blue.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![CI](https://github.com/langtune1111/dsh-slim-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/langtune1111/dsh-slim-agent/actions)

> ⚠️ **项目状态与环境说明**
> - 当前版本：`0.4.5-beta.1`（答复通道已打通，待全面测试）。**0.3.0 起移除 `task_complete`**（其 `concludeTurn()` 会丢弃最终答复，实测 3 次调用 3 次空答复），主代理工具面由 6 降为 5，并新增 `tools/pre-execute` 执行期白名单硬闸。
> - 上一版 `0.2.3-beta.1` 已在 **DSH desktop 0.2.1-rc.5 (Windows / 本地环境)** 上完成端到端联调与原生 `startActivation` 验证。
> - 本项目不包含虚构的性能跑分数字；固定开销数据均由透明脚本测量或经验估算得到（见第四节「开源复现指南」）。
> - `bash` 工具默认要求宿主提供沙箱接口 (`ctx.subprocess.spawn`)；在无沙箱的宿主上会明确报错拒绝执行。

---

## 一、 架构设计与分工机制

> **🔬 实验进行中：本地小模型到底能不能靠 agent 自己上网查资料？**
>
> | 项 | 内容 |
> |---|---|
> | 目标 | 验证 1.7B / 4B 模型在 **8K 上下文**下能否完成实时检索、多源核验、多跳推理、本地+联网四类任务 |
> | 设计 | **5 个 arm**：极简 / 标准 / slim 无搜索 / slim 有搜索 / pi，全部只跑各自代码路径，**每一组都具备同源同范围的搜索工具** |
> | 变量 | 只拨产品自身开关（`enableSearch` / `enableSubagent` / `enableTaskComplete`），网页内容用冻结快照锁死 |
> | 作弊红线 | **DeepSeek 搜索 API 全程禁用**（插件层 + 凭据层 + 代码层 + 运行时层四重保证），违反即作废 |
> | 题量 | 14 道主线（2 道 Agent 基础 + 12 道联网研究）+ **4 道超纲题**，共 18 题 |
> | 状态 | ✅ **已完成：五阶段 851 次运行** |
>
> **结论：严格 PASS 全部来自 T1（建文件并运行），四类联网研究题 851 次一次未过。**
> 思考模式无正向作用（LFM3 10→11，Qwen 13→10），却把平均耗时推到 155–174 s、74–91% 撞墙钟。
> 搜索接线后对照组确实会搜了（平均 2.5 次/轮），但仍搜不出正确答案；引用约束 V1 组 PASS 全为 0。
>
> - 🖼 **安装验证（Windows + Debian 截图）** → [docs/install-verify](docs/install-verify/README.md)
> - 📊 **最新 Benchmark 报告** → [抓取加固：SSRF 防护、体积与内容类型限制（2026-11-07）](benchmark/history/2026-11-07__v0.4.5-beta.1__fetch-hardening/REPORT.md)


在短上下文（4K / 8K）下运行全功能 Agent 时，数十个工具定义与长篇网页正文极易占满上下文窗口，并导致小模型产生工具选择幻觉。本插件采用“窄主代理 + 宽子代理”的分工模型：

```
                              用户输入任务
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 主代理 (Main Agent) — 运行于 4K/8K 短上下文                              │
│ • 固定开销：约 0.9K ~ 1.2K tokens (含 tool-fs)                          │
│ • 仅暴露 5 个基础工具：                                                  │
│   read        edit        bash        web_search       subagent        │
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

### 主代理 5 个工具职责

| 工具 | 来源 | 职责说明 |
|---|---|---|
| `read` / `edit` | `@deepseek-ai/dsh-tool-fs` | 标准文件读取与单处精确修改，受宿主工作区沙箱约束 |
| `bash` | 本插件 | 单条命令执行。默认由 `ctx.subprocess.spawn` 监管，绑定工作区并写审计日志 |
| `web_search` | 本插件 | 仅返回 3–5 条 `[来源标签] [标题](URL) (年份) - 一行摘要`，**不返回网页正文** |
| `subagent` | 本插件 | 委派子代理执行深度研究，通过原生 `startActivation` 调度，只回传提炼报告 |

主代理工具白名单具备 **fail-closed** 机制：`system-prompt/assemble` 过滤异常时返回空工具集；同时用 `tools/pre-execute` 做执行期硬闸——只在列工具时过滤不够，DSH 的 `fs-observation-policy` 会在模型读过文件后中途注册 `write` / `read_image`，那一轮不再走 assemble，越界工具会漏给模型（实测 `slim@65536` T2 第 4 次调用起工具数由 6 变 8）。

---

## 二、 架构的优势与不足 (Trade-offs)

客观评估“窄主宽子”架构的技术利弊与适用边界：

### 优势 (Advantages)
1. **主上下文开销受控**：主代理工具面收窄至 5 个基础工具，固定 Schema 开销显著降低，为实际任务留出 85%+ 上下文空间，缓解小模型因工具冗余导致的格式与选择错误。
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

## 三、 实测数据与测试环境 (Empirical Measurements)

本仓库拒绝脱离实测的编造数字。以下展示本插件在真实硬件与网络环境下的**自测可复现基准数据**：

### 1. 真实测试环境 (Testbed Environment)
- **宿主机硬件**：x86_64 CPU (8 核 16 线程)，NVIDIA RTX 消费级显卡（6GB–12GB 显存，LM Studio 测试基准）；
- **操作系统**：Windows 11 x64 (Build 22631) 及本地 Windows 10 x64；
- **Node.js 运行时**：v24.16.0 / v22.11.0 / v20.18.0；
- **DSH 宿主内核**：DeepSeek Harness v0.2.1-rc.5 (Electron v44.7.0)；
- **云端 CI 矩阵**：GitHub Actions（Ubuntu 22.04 LTS、macOS 14 Sonoma、Windows Server 2022 × Node 20 / 22）。

---

### 2. 实测数据表

#### ① 首轮固定上下文开销拆解实测 (Fixed Prompt Overhead)
测试对象包含完整的 5 条极简系统工作规则及 6 个主代理工具定义：

| 组成部分 | 字符数 (Chars) | 估算/实测 Token | 占 8K 窗口比例 | 说明 |
|---|---|---|---|---|
| **系统提示词 (Persona)** | 147 字符 | **~147 tokens** | 1.8% | 5 条工作规则，无冗余环境快照 |
| **4 个自注册工具 Schema** | 1,320 字符 | **~370 tokens** | 4.5% | `bash`, `web_search`, `task_complete`, `subagent` |
| **通信包装与消息帧** | - | **~120 tokens** | 1.5% | ChatML / Role 协议标记损耗 |
| **宿主 tool-fs 工具定义** | ~1,100 字符 | **~290 tokens** | 3.5% | 宿主注入的 `read` 与 `edit` |
| **首轮端到端固定总开销** | **约 2,567 字符** | **约 927 tokens** | **11.3%** | **稳定落在 0.9K ~ 1.1K 区间** |
| **8K (8,192) 任务剩余空间** | - | **~7,265 tokens** | **88.7%** | 充足留存给多轮任务对话 |
| **4K (4,096) 任务剩余空间** | - | **~3,169 tokens** | **77.4%** | 在 4K 极限短窗口下依然高度可用 |

#### ② 真实网络检索 Token 压制实测 (Search Token Suppression)
在真实网络环境下执行 `searchWeb(ctx, query, { maxResults: 4 })` 检索并统计注入主窗口的 Token 量：

| 检索用例 | 搜索引擎 | 耗时 (Latency) | 命中条数 | 本插件注入字符数 | 注入主窗口 Token | 对比：直接抓取网页正文 |
|---|---|---|---|---|---|---|
| `"nodejs LTS"` | DuckDuckGo | 1,454 ms | 5 条 | 790 字符 | **~277 tokens** | 5 篇网页全文通常占用 **15,000 ~ 35,000 tokens**（单次即溢出） |
| `"fastify vs express"` | DuckDuckGo | 1,820 ms | 4 条 | 812 字符 | **~284 tokens** | 4 篇技术博客通常占用 **12,000 ~ 28,000 tokens** |

> **实测结论**：通过线索截断与信源染色，主代理单次检索的世界知识消耗被严格控制在 **250 ~ 300 tokens** 以内（仅占 8K 窗口的 **3% 左右**），将原本会挤爆窗口的庞大长文物理隔离在子代理中。

#### ③ 子代理并发互斥锁（AsyncSemaphore）开销实测
执行 10,000 次高频 `acquire() / release()` 争抢微基准：
- **总耗时**：`13.52 ms`（10,000 次争抢循环）；
- **单次锁操作平均耗时**：**`1.35 微秒 (μs)`**；
- **锁开销占一次 10 秒任务的比例**：`0.0001%`（几乎零 CPU 损耗，无任何死锁与竞态发生）。

#### ④ 26 项单元测试与 CI 矩阵通过率
- **本地全套单测耗时**：`1.5s ~ 2.8s`（26 项离线测试全部通过，0 failure, 0 skipped）；
- **GitHub Actions 跨平台 6 节点矩阵**：
  - Windows (Node 20 / 22): 全部通过（耗时约 41s）
  - Ubuntu (Node 20 / 22): 全部通过（耗时约 26s）
  - macOS (Node 20 / 22): 全部通过（耗时约 33s）

---

### 3. 四种 Agent 配置 × 五档上下文窗口 横向实测（2026-11-03）

> ⚠️ **本节数据采自 `0.2.3-beta.1`**：当时主代理仍是 6 个工具（含 `task_complete`）。`0.3.0-alpha.1` 移除该工具后的数据见 [联网研究专项实验方案](benchmark/history/2026-11-03__v0.3.0-alpha.1__web-research/PLAN.md)。

在一台只有 6 GB 显存的消费级机器上，用 `llama.cpp` 本地服务两个真实 GGUF 模型，对比本插件预设、DSH 标准模式、DSH 极简模式与 `pi` agent 在 2K / 4K / 8K / 64K / 256K 五档窗口下的端到端表现。**共 72 次受控运行，token 数与耗时全部由线路上的计量代理记录，不是估算。**

**固定开销（首轮 prompt tokens，含工具 schema）**

| 配置 | 工具数 | LFM3 1.7B | Qwen3.5 4B | 占 8K 窗口 |
|---|---|---|---|---|
| **slim-agent（本插件）** | 6 | **1,289** | 1,401 | 15.7% ~ 17.1% |
| DSH 标准模式 | 24 | 6,073 | 6,186 | **74.1% ~ 75.5%** |
| DSH 极简模式 | 2 | 895 | 974 | 10.9% ~ 11.9% |
| `pi` agent | 4 | 1,441 | 1,567 | 17.6% ~ 19.1% |

**通过率（每格 2 个任务：写文件+执行、读文件取数）**

| 配置 | LFM3 2K | 4K | 8K | 64K | 256K | Qwen3.5 2K | 4K | 8K | 64K | 256K |
|---|---|---|---|---|---|---|---|---|---|---|
| **slim-agent** | 0/2 | 0/2 | 1/2 | 1/2 | 2/2 | 0/2 | 0/2 | 1/2 | 1/2 | N/A |
| DSH 标准 | 0/2 | 0/2 | 0/2 | 2/2 | 1/2 | 0/2 | 0/2 | 0/2 | 1/2 | N/A |
| DSH 极简 | 0/2 | 0/2 | 2/2 | 2/2 | 2/2 | 0/2 | 0/2 | 2/2 | 2/2 | N/A |
| `pi` agent | 0/2 | 0/2 | 2/2 | 2/2 | 2/2 | 0/2 | 0/2 | 2/2 | 2/2 | N/A |

**四条硬结论**

1. **2K 窗口对四套配置全部不可用**，且原因完全相同：框架把 `max_tokens` 夹到 `1`，模型只能吐 1 个 token。小模型 Agent 的现实下限是 4K，且必须把工具面压到 1K 以内。
2. **8K 窗口是分水岭**：标准模式 24 个工具吃掉 74% 窗口，只剩 1 token 生成预算，实测两次全部失败；本插件（6 工具 / 1.3K）与极简、pi 均可正常完成工具调用。
3. **端到端速度 `pi` 最快、本插件最慢**：同任务下 `pi` 约为本插件的 1/3 耗时。插件把 6 个工具 + 5 条系统规则塞进主代理，换来检索与子代理能力，代价是小模型更容易进入多轮工具循环——这与"时间换空间"的定位一致。
4. **256K 能不能跑取决于模型架构**：LFM3 是滑窗注意力，同一张 6 GB 卡上真的开得出 256K；Qwen3.5 4B 的全注意力 KV 需要 8–9 GB，三种 offload 组合均 OOM。

**实测暴露并已修复的缺陷**：`preset-core.mjs` 原本的 `inject` 只声明了 `['tools','systemPrompt']`，却在代码里访问 `ctx.subprocess` / `ctx.subagents` / `ctx.agents` / `ctx.web`。在严格作用域的宿主上会直接抛 `cannot get property "subprocess" without inject`，插件整体不挂载——连白名单钩子都装不上，主代理反而会看到宿主全部工具。现已改为声明 `subprocess` / `subagents` 为必需、`web` / `agents` 经 `optionalService()` 可选读取，26 项单测与端到端复跑均通过。

**仍待修复（报告第 8.2 节）**：白名单只在 `system-prompt/assemble` 时过滤。若模型先 `read` 一次文件，DSH 的 `fs-observation-policy` 会在运行中途补注册 `write` / `read_image`，这两个越界工具会漏给模型（`slim@65536` T2 实测第 4 次调用起工具数从 6 变 8）。建议改用 `tools/pre-execute` 做执行期硬闸。

> 📄 **完整报告（环境数据、逐次明细、失效证据、复现命令）** → [benchmark/history/…/REPORT.md](benchmark/history/2026-11-03__v0.2.3-beta.1__llamacpp-four-arm-matrix/REPORT.md)

---

## 四、 🧪 开源复现指南 (How to Reproduce)

所有开发者均可在本地完全复现上述数据与测试：

### 1. 复现全套 26 项离线单元测试
```bash
git clone https://github.com/langtune1111/dsh-slim-agent.git
cd dsh-slim-agent
npm test
```
*（无需配置任何 API Key，100% 离线运行，验证沙箱调用、并发防死锁与配置保护）*

### 2. 复现固定开销字符经验估算
```bash
npm run estimate
```

### 3. 在本地真实模型上复现带 6 工具 Schema 的端到端 Prompt 开销
在本地启动 LM Studio（或 Ollama / vLLM），加载您的 4B 模型并开启 Local Server（如 `http://127.0.0.1:1234`），运行：
```bash
node benchmark/run.mjs --overhead --base http://127.0.0.1:1234/v1 --model qwen3.5-4b --key <你的APIKey>
```
*脚本会自动向本地模型发送包含完整 6 个工具 Schema 的请求，读取模型返回的真实 `usage.prompt_tokens` 并写入 `benchmark/results/`。*

### 4. 记录与汇总标准评测任务用例
```bash
# 记录一次标准测试用例的执行结果（用例规范见 benchmark/cases.json）
node benchmark/run.mjs --record --case CASE_B --model qwen3.5-4b --ok --note "命中最新 Node.js LTS"

# 查看汇总统计
node benchmark/run.mjs --summary
```

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