# dsh-slim-agent

> 让 1.7B–8B 的本地小模型，在 **4K–8K 上下文**里获得接近完整 Agent 的工作能力。
> 手段不是把 Prompt 压到极限，而是**分工**：主代理只做调度，重活交给隔离子代理。

[![Version](https://img.shields.io/badge/version-0.2.2--beta.1-orange.svg)](https://github.com/langtune1111/dsh-slim-agent/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.1%20(0.2.1--rc.5%20verified)-blue.svg)](https://github.com/deepseek-ai/deepseek-harness)

> ⚠️ **实验性项目（0.2.2-beta.1）**
> - 已在 **DSH desktop 0.2.1-rc.5 (Windows / 本地环境)** 上完成端到端联调与原生 startActivation 验证。
> - 性能数字为**设计目标或估算**，不是多环境实测结果（见 [测量方法](#测量方法)）。
> - `bash` 工具默认要求宿主沙箱；在没有沙箱的宿主上它会**明确报错**而不是降级执行。
> - **不要**在存有敏感数据、且你无法接受自主执行的机器上安装后直接放开使用。

---

## 它解决什么问题

传统 Agent 把文件、搜索、网页正文、MCP、任务管理全部塞进主模型。对 8B 以下、上下文只有 8K 的模型，结果是两个：

1. **上下文被工具说明和网页正文占满** → 两三轮就 overflow；
2. **工具太多，小模型选错工具、格式出错** → 工具调用遵从率骤降。

本插件的做法是「**窄主宽子**」：

```
主代理（6 个工具，~600–1200 tok 固定开销）
  read  edit  bash  web_search  task_complete  subagent
        │
        └─ 需要读多篇网页 / 多步比对 ──▶ 子代理（独立上下文，完整研究工具面）
                                            └─ 只回传【已确认结论】【未验证部分】【建议下一步】
                                               原始正文永不进入主窗口
```

- 主代理负责：理解任务、简单读写、发一条搜索拿线索、委派、收尾。
- 子代理负责：读全文、多源交叉、提炼。**跑完即销毁**，它的上下文不计入主窗口。
- 并发默认 **1**：消费级显卡上不会出现两个推理请求抢显存。

---

## 主代理的 6 个工具

| 工具 | 来源 | 说明 |
|---|---|---|
| `read` / `edit` | `@deepseek-ai/dsh-tool-fs` | 标准文件工具，受宿主沙箱与路径策略约束 |
| `bash` | 本插件 | 单条命令执行。策略见下 |
| `web_search` | 本插件 | 只回线索：来源标签 + 标题 + URL + 一行摘要，**从不回网页正文** |
| `task_complete` | 本插件 | 显式收尾原语，缓解小模型「说完还想再说」的循环 |
| `subagent` | 本插件 | 隔离子代理委派，只回提炼结论 |

白名单是 **fail-closed**：`system-prompt/assemble` 环节若发生异常，返回**空工具集**而不是全量工具。

### `bash` 的三种策略（`config.bash`）

| 值 | 行为 |
|---|---|
| `sandbox`（默认） | 需要宿主提供沙箱化 shell；没有就**直接报错**，绝不静默本地执行 |
| `local` | 显式选择才允许本地执行：`cwd` 锁定会话工作区，拒绝 `rm -rf /`、`mkfs`、`format`、`curl\|sh` 等破坏性模式，并写审计日志 |
| `off` | 不注册该工具 |

> ⚠️ `local` 模式的危险命令拦截是**启发式**，不是安全边界。要真正的隔离请用 `sandbox`。

审计日志默认写到 `<dshHome>/slim-agent-audit.jsonl`（可用 `config.auditFile` 改）。

---

## 安装

```bash
dsh plugin add dsh-slim-agent
# 离线：下载 Release 里的 tgz 后
dsh plugin add ./dsh-slim-agent-0.2.2-beta.1.tgz
```

安装后**重启两次 DSH**：第一次启动时安装器把声明写进 `~/.dsh/cordis.patch.yml`，第二次启动后模式才会出现在列表里。
然后在**新会话**的模式列表里选择 **「中小模型·轻量知识增强 (8K Slim)」**。

### 配置

写在预设声明的 `config` 里（也可在 `index.js` 安装时传入）：

```yaml
concurrencyLimit: 1        # 子代理并发上限
searchEngine: auto         # auto | builtin | host
maxTurnsDefault: 8         # 子代理轮次提示（软限制，见已知限制）
maxTurnsDeep: 12
maxToolCalls: 15
bash: sandbox              # sandbox | local | off
autoInstall: true          # false 则插件不写 ~/.dsh 下的任何文件
```

---

## 已验证的注册形态（踩坑记录）

DSH 的模式列表只认 **home 补丁里的声明行**。以下每条都是实机踩出来的：

1. **声明必须写在** `~/.dsh/cordis.patch.yml` 的 `@deepseek-ai/dsh-agent-preset` 行里；
   运行时 `agentPresets.register()`、以及只放 `~/.dsh/.agent-presets/<id>/` 目录，都**不会**出现在选择器。
2. **`persona` 必须用 `prefix:` 键**。用 `text:` 会被静默丢弃，整条预设连带消失且不报错。
3. **自定义插件行必须单文件、零相对导入**（本仓库 `preset-core.mjs` 只 import `node:` 内建模块）。
4. **绝不重复注册已有工具名**。`tool-fs` 已提供 `read/write/edit`；重名会让 DSH 抛错并丢弃整条预设。
5. **改完必须重启进程**，补丁树不会热重载。

排障对照表：

| 现象 | 最可能原因 |
|---|---|
| 模式列表里完全没有 | 声明写在 bundle/profile 层而非 home 层 |
| 声明在但模式不出现 | `persona` 用了 `text`；或插件行重名；或模块有相对导入 |
| 出现但进去报错 | 预设内某插件行 inject 的服务在当前组合里不存在 |
| 改了没反应 | 未重启；或存在重复 id 的声明块 |

---

## LM Studio 配置（推荐起点）

1. 加载模型：`LFM-3 1.7B Q5_K_M`（极小基线）或 `Qwen3.5 4B Q4_K_M`（主力）；
2. **Context Length 手动设为 8192**（也可试 4096 极限档）；
3. GPU Offload 拉满；4B Q4KM 权重约 2.6 GB，8K KV Cache 约 0.8 GB；
4. Start Server，监听 `http://127.0.0.1:1234`。

DSH 侧用 OpenAI 兼容适配器接入该端点即可。

---

## 测量方法

本仓库**不再内置任何跑分数字**。想得到数字就自己测：

```bash
# 1) 真实固定开销：让模型自己报 usage.prompt_tokens
node benchmark/run.mjs --overhead --base http://127.0.0.1:1234/v1 --model qwen3.5-4b

# 2) 记录一次用例结果（用例定义见 benchmark/cases.json）
node benchmark/run.mjs --record --case CASE_B --model qwen3.5-4b --ok --note "命中官方 LTS"

# 3) 汇总
node benchmark/run.mjs --summary
```

- 记录落在 `benchmark/results/*.jsonl`，可提交到仓库供他人复核；
- `benchmark/token-counter.mjs` 只做**字符估算**（±15%），输出里明确标注"非 tokenizer 实测"；
- `benchmark/tokenizer.mjs` 优先走 LM Studio `/v1/tokenize` 或 tiktoken，拿不到才回退估算，返回值带 `source` 字段。

**样本数 < 5 的成功率不应对外引用。**

按估算，本插件自注册部分（persona + 4 个工具 schema）约 **640 tokens**；`read`/`edit` 由 tool-fs 提供，其 schema 另计，所以整体固定开销随宿主版本在 **0.6–1.2K** 区间浮动。这只是估算 —— 要准确就跑到 `--overhead`。

---

## 已知限制

- **DSH 0.2.x 已验证**：已在 DSH 0.2.1-rc.5 (Windows) 原生桌面环境下完成实机联调，正式支持最新的 `startActivation({ provider, label, request, signal, delivery: 'parent' })` 接口。
- **预算上限是软的**：`maxTurnsDefault` / `maxToolCalls` 目前通过 prompt 约束传达；本版本没有强制中断机制。不要把"预算"当成安全边界。
- **`web_search` 的来源标签是域名启发式**（源码仓库 / 文档站 / 社区 / 百科 / 其他），**不是权威性认定**；年份是文本里最后一个 2020–2039 年份，**不是发布时间**。
- **搜索是顺序降级链**（宿主 provider → DuckDuckGo → Wikipedia），**不是**多源交叉验证。
- **只验证了 Windows**；Linux/macOS 行为未知（CI 只跑单元测试，不跑真机集成）。
- **安装器会写 `~/.dsh`**（`_slim-code/core.mjs` + 托管补丁块），写前生成 `.bak`；`autoInstall: false` 可完全关闭。

---

## 0.2.2-beta.1 破坏性变更

| 变更 | 影响 |
|---|---|
| 删除 `lib/`（5 个模块） | 旧路径引用全部失效；实现收敛为单文件 `preset-core.mjs` |
| 子代理失败语义：返回文本 → **抛错** | 宿主无 subagents 服务、或产物为空时，工具结果变 error |
| 新增 `bash` 策略，默认 `sandbox` | 无沙箱宿主上 `bash` 报错（此前静默本地执行） |
| 白名单 fail-open → **fail-closed** | 过滤异常时工具面为空 |
| benchmark 重做 | 删除硬编码百分比，改为真实测量脚本 + results 目录 |

`v0.1.0-beta.2` 保留为回滚点。

---

## 路线图

- [ ] 在真实 0.2.x 宿主上验证 `startActivation` 分支
- [ ] 把软预算改成硬预算（基于子会话事件 + `cancel()`）
- [ ] Linux/macOS 真机集成测试
- [ ] 用 `benchmark/run.mjs` 收集 ≥5 次/用例的真实数据后再公开对比表
- [ ] 长期方向：把这套拆分做成**按任务能力授权的分层 Agent 运行时**，而非只服务单个预设

---

## 致谢

- **DeepSeek Harness 开发团队** —— 微内核与 Cordis 插件体系让非侵入式预设成为可能；
- **「开眼看世界」插件制作组（@windygo123 / dsh-see-world & dsh-open-eyes）** —— 感知委派与事实锚定的思路来源；
- **DSH 免费搜索插件开发团队（@copylee / dsh-free-search）** —— 免 Key 搜索基础设施；
- **Google DeepMind** —— Gemini 在本次 Vibe Coding 中的协助。

## 许可证

[MIT](LICENSE)