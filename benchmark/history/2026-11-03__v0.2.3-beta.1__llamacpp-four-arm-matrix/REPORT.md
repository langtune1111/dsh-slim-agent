# 本地小模型 Agent 框架横向实测报告

| 项 | 内容 |
|---|---|
| 实验编号 | `BENCH-2026-11-03-v0.2.3-beta.1` |
| 实验日期 | 2026-11-03 |
| 被测版本 | `dsh-slim-agent 0.2.3-beta.1`（当时主代理 6 工具，含 `task_complete`） |
| 实验内容 | 四种 Agent 配置 × 五档上下文窗口 × 两个本地模型的横向实测 |
| 规模 | 72 次受控运行（4 配置 × 5 窗口 × 2 任务 × 2 模型） |
| 状态 | ✅ 已完成 |
| 原始数据 | [`data/`](data/)（逐次 NDJSON + 汇总表 + 编排日志） |
| 档案索引 | [benchmark/README.md](../../README.md)（全部历史实验） |
| 后续影响 | 本次实测发现 `task_complete` 吞答复、白名单可被绕过，促成 `0.3.0-alpha.1` 的两处修复 |


> 日期：2026-11-03（CST）
> 被测对象：**dsh-slim-agent**（本仓库预设） vs **DSH 标准模式** vs **DSH 极简模式** vs **pi agent**
> 被测模型：`LFM3-1.7B-AD-Q5_K_M`、`Qwen3.5-4B.Q4_K_M`
> 上下文窗口：2K / 4K / 8K / 64K / 256K
> 推理端：llama.cpp `0.8.0-dev (build b12066, commit 713319e28)` + Vulkan 后端，跑在 Windows 上，通过局域网暴露 OpenAI 兼容 `/v1`
> Agent 端：Debian 13 上的 DeepSeek Harness `0.2.1-rc.5` 与 `pi 1.3.0`
> 规模：72 次受控运行（4 配置 × 5 窗口 × 2 任务 × 2 模型，其中 Qwen 256K 因硬件不可行记为 N/A）

---

## 1. 结论速览

1. **窗口越小，"工具面开销"越决定生死。** DSH 标准模式固定 24 个工具、首轮约 6.0–6.2K tokens；8K 窗口下只剩 1 token 的生成预算，2K/4K 直接被服务端 400 拒绝。极简（2 工具，约 0.9–1.0K）与 pi（4 工具，约 1.4–1.6K）在 8K 起全部可用。
2. **2K 窗口对所有框架都不可用。** 四套配置在 2K 下全部失败，且失败原因一致：框架把 `max_tokens` 压到 **1**，模型只能吐 1 个 token（`finish_reason=length`）。这与工具数量无关，是"预留输出预算 ≥ 剩余窗口"时的统一下限行为。
3. **8K 是分水岭。** 8K 时极简（2/2）与 pi（2/2）LFM3 全通过；标准 0/2；slim 1/2（T2 结束在 `tool_calls` 没有产出最终答复）。
4. **端到端速度：pi 最快，slim 最慢。** 同一任务下 pi 的中位耗时约为 slim 的 1/3：原因是 slim 的 6 工具 schemas + 5 条系统规则更长，LFM3 1.7B 更易进入多轮工具循环；pi 只给 4 个工具且描述更短。
5. **256K 是模型能力问题，不是框架问题。** LFM3（`arch=lfm3`，滑窗注意力）在 6GB 显卡上可以真的开出 256K 上下文；Qwen3.5 4B（`arch=qwen35`）在该卡上无论 f16 还是 q8_0 KV、无论全量还是部分 offload，都建立不了 KV cache。
6. **实测发现 slim 插件一个真实缺陷**：`preset-core.mjs` 的 `inject` 只声明了 `['tools','systemPrompt']`，却在 `apply()` 里访问 `ctx.subprocess` / `ctx.subagents` / `ctx.agents` / `ctx.web`。在严格校验作用域的宿主上会直接抛 `cannot get property "subprocess" without inject`，插件整条挂掉。详见第 7 节。

---

## 2. 测试环境

### 2.1 渲染端（Windows，llama.cpp）

| 项 | 值 |
|---|---|
| 主机 | DESKTOP-NA8RM99 |
| CPU | Intel Core i5-6400（4 核 4 线程，2.70 GHz） |
| 内存 | 19.9 GB |
| 显卡 | NVIDIA P106-100（6 GB，驱动 566.03）；另有一块 Intel HD 530 集显 |
| 系统盘 | Windows 11 x64，部署盘 `G:` 为 exFAT |
| 推理引擎 | llama.cpp `0.8.0-dev` / build `b12066` / Vulkan x64 |
| 监听 | `0.0.0.0:8080`（局域网可达） |
| 启动参数 | `-c <窗口> -np 1 -t 4 -ngl 99 --device Vulkan1 --jinja --metrics --alias <id>`，环境变量 `LLAMA_ARG_REASONING=off` |

### 2.2 被测端（Debian）

| 项 | 值 |
|---|---|
| 主机 | `debian13` @ `192.168.101.244` |
| 系统 | Debian GNU/Linux 13.7，内核 6.12.107+deb13-amd64 |
| Node | v24.22.0（DSH），v22.23.3（pi） |
| DSH | `0.2.1-rc.5`（`/root/.nvm/versions/node/v24.22.0/bin/dsh`） |
| pi | `1.3.0`（`@earendil-works/pi-coding-agent`，`/usr/local/bin/pi`） |
| 计量代理 | 自建 `proxy.py`，监听 `127.0.0.1:8099`，转发到 `192.168.101.163:8080` |

### 2.3 模型

| 模型 | 文件 | 大小 | 量化 | 架构 | `n_ctx_train` |
|---|---|---|---|---|---|
| LFM3 1.7B | `G:\models\lfm\LFM3-1.7B-AD-Q5_K_M\LFM3-1.7B-AD-Q5_K_M.gguf` | 1.22 GB | Q5_K_M | `lfm3` | 262144 |
| Qwen3.5 4B | `G:\models\ali\Qwen3.5-4B.Q4_K_M\Qwen3.5-4B.Q4_K_M.gguf` | 2.52 GB | Q4_K_M | `qwen35` | 262144 |

### 2.4 网络拓扑

```
Windows (192.168.101.163:8080)  llama-server  --┐
                                                │ LAN /24
Debian  (192.168.101.244)                       │
  proxy.py 127.0.0.1:8099  ─────────────────────┘
      ▲
      ├── dsh --profile headless --patch ...    (3 种配置)
      └── pi --provider llamacpp-local          (pi agent)
```

---

## 3. 四种被测配置的定义

| 名称 | 定义 | 工具数 | 说明 |
|---|---|---|---|
| **slim-agent** | 本仓库预设：`persona` + `tool-fs` + `slim-core`（`bash`/`web_search`/`task_complete`/`subagent`） | 6 | `searchEngine: builtin`，`bash: sandbox`，`concurrencyLimit: 1` |
| **标准** | DSH 出厂 `standard` 预设 | 24 | persona「You are a coding agent…」+ 全套工具 + 子代理 + workflow |
| **极简** | DSH 出厂 `minimal` 预设 | 2 | persona「You are a helpful software engineer assistant.」+ 只读 `tool-fs` + bash |
| **pi-agent** | `pi 1.3.0` 内置工具（read / bash / edit / write） | 4 | `--thinking off --no-context-files --no-session` |

> **等价性说明（必须阅读）**：DSH `0.2.1-rc.5` 的 one-shot runner（`dsh --profile headless`）**不组合 agent preset**，其源码显式拒绝：`session "…" runs under agent preset "…", which the one-shot runner does not compose`。因此本报告用**逐插件等价覆盖层**在 `headless` profile 上复刻三种 DSH 组合：把出厂 `presets/*.patch.yml` 里的插件清单翻译成"全局启用清单 + 其余行 `disabled: true`"。工具数量、工具 schema 文本、persona 文案与出厂 preset 一致；差异仅在于挂载层级（全局 vs preset 作用域），不影响模型可见的 token 数。复刻文件见第 9 节。

---

## 4. 任务与判据

两个任务都要求真实使用工具，且结果可机器二值判定：

| 任务 | 提示词 | 判据（严格） |
|---|---|---|
| **T1**（写文件+执行） | 「在当前目录创建 fib.py：读取 argv[1] 作为 n，打印前 n 个斐波那契数（从 1,1 开始，每行一个）。然后运行 python3 fib.py 8，把输出原样贴回来。」 | 工作目录存在 `fib.py`，**且**最终答复里出现连续序列 `1,1,2,3,5,8,13,21` |
| **T2**（读文件取数） | 「读取 notes/facts.md，告诉我西门的通行码。只回答四位数字。」 | 最终答复包含 `7314` |

`notes/facts.md` 是一份 7 节、约 1.1 KB 的园区运维手册，通行码埋在「4. 门禁密码」小节里。

> 判据刻意从严：只要能"看起来像成功"但序列错位（例如输出 `1,2,3,5,8,13,21,34`）一律判 FAIL。首轮自动判分曾把 `standard@256K` 的错位输出误判为 PASS，人工复核后已改为严格判据并对全部 72 条重算。

---

## 5. 测量方法

所有 LLM 请求都经过自建计量代理，逐请求落 NDJSON，字段包括：`n_messages`、`n_tools`、`max_tokens`、`prompt_tokens`、`completion_tokens`、`finish_reason`、`duration_s`、首条用户消息、以及流式回复的累积文本。因此报告中的 token 数与耗时**不是估算**，是线路上的真值。

- 每次运行使用**全新工作目录** `/tmp/dshbench/<run>/`，避免跨轮污染；
- 每次运行前 `tail` 记录代理日志偏移，运行后切出本次的原始请求记录；
- `dsh` 侧固定 `contextWindow = <被测窗口>`、`maxTokens = min(4096, 窗口/2)`；
- `pi` 侧通过 `~/.pi/agent/models.json` 注入同名的 OpenAI 兼容 provider，参数与 DSH 侧对齐；
- 每个窗口都会**重启** llama-server，保证 `-c` 与被测窗口严格相等（`n_slots=1`，`n_ctx_slot=<窗口>`）。

---

## 6. 实测结果

## A. 固定开销（首轮 prompt tokens）

| 模型 | 模式 | 工具数 | 首轮 prompt tokens | 占 8K | 占 4K | 占 2K |
|---|---|---|---|---|---|---|
| lfm3-1.7b-q5 | slim-agent | 6 | 1289 | 15.7% | 31.5% | 62.9% |
| lfm3-1.7b-q5 | 标准 | 24 | 6073 | 74.1% | 148.3% | 296.5% |
| lfm3-1.7b-q5 | 极简 | 2 | 895 | 10.9% | 21.9% | 43.7% |
| lfm3-1.7b-q5 | pi-agent | 4 | 1441 | 17.6% | 35.2% | 70.4% |
| qwen35-4b-q4km | slim-agent | 6 | 1401 | 17.1% | 34.2% | 68.4% |
| qwen35-4b-q4km | 标准 | 24 | 6186 | 75.5% | 151.0% | 302.1% |
| qwen35-4b-q4km | 极简 | 2 | 974 | 11.9% | 23.8% | 47.6% |
| qwen35-4b-q4km | pi-agent | 4 | 1567 | 19.1% | 38.3% | 76.5% |

## B. 通过率（T1 文件工具 + T2 读文件取数，2 项合计）

**lfm3-1.7b-q5**

| 模式 | 2K | 4K | 8K | 64K | 256K |
|---|---|---|---|---|---|
| slim-agent | 0/2 | 0/2 | 1/2 | 1/2 | 2/2 |
| 标准 | 0/2 | 0/2 | 0/2 | 2/2 | 1/2 |
| 极简 | 0/2 | 0/2 | 2/2 | 2/2 | 2/2 |
| pi-agent | 0/2 | 0/2 | 2/2 | 2/2 | 2/2 |

**qwen35-4b-q4km**

| 模式 | 2K | 4K | 8K | 64K | 256K |
|---|---|---|---|---|---|
| slim-agent | 0/2 | 0/2 | 1/2 | 1/2 | N/A |
| 标准 | 0/2 | 0/2 | 0/2 | 1/2 | N/A |
| 极简 | 0/2 | 0/2 | 2/2 | 2/2 | N/A |
| pi-agent | 0/2 | 0/2 | 2/2 | 2/2 | N/A |

## C. 端到端耗时（秒，T1+T2 合计）

| 模型 | 窗口 | slim-agent | 标准 | 极简 | pi-agent |
|---|---|---|---|---|
| lfm3-1.7b-q5 | 2K | 25 | 25 | 23 | 9 |
| lfm3-1.7b-q5 | 4K | 25 | 25 | 24 | 10 |
| lfm3-1.7b-q5 | 8K | 82 | 48 | 58 | 22 |
| lfm3-1.7b-q5 | 64K | 86 | 81 | 55 | 62 |
| lfm3-1.7b-q5 | 256K | 43 | 68 | 53 | 90 |
| qwen35-4b-q4km | 2K | 36 | 26 | 26 | 17 |
| qwen35-4b-q4km | 4K | 29 | 26 | 26 | 16 |
| qwen35-4b-q4km | 8K | 85 | 133 | 120 | 43 |
| qwen35-4b-q4km | 64K | 125 | 254 | 154 | 50 |
| qwen35-4b-q4km | 256K | N/A | N/A | N/A | N/A |

## D. 逐次明细

| run | 模型 | 模式 | 窗口 | 任务 | 判定 | 工具 | prompt | 输出tok | 端到端s | finish |
|---|---|---|---|---|---|---|---|---|---|---|
| minimal__2048__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 极简 | 2K | T1 | FAIL | 2 | 895 | 1 | 12.2 | length |
| minimal__2048__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 极简 | 2K | T2 | FAIL | 2 | 862 | 1 | 11.2 | length |
| pi__2048__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | pi-agent | 2K | T1 | FAIL | 4 | 1441 | 1 | 4.8 | length |
| pi__2048__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | pi-agent | 2K | T2 | FAIL | 4 | 1408 | 1 | 4.6 | length |
| slim__2048__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | slim-agent | 2K | T1 | FAIL | 6 | 1289 | 1 | 13.3 | length |
| slim__2048__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | slim-agent | 2K | T2 | FAIL | 6 | 1256 | 1 | 11.3 | length |
| standard__2048__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 标准 | 2K | T1 | FAIL | 24 | 0 | 0 | 12.6 | None |
| standard__2048__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 标准 | 2K | T2 | FAIL | 24 | 0 | 0 | 12.5 | None |
| minimal__4096__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 极简 | 4K | T1 | FAIL | 2 | 895 | 1 | 12.2 | length |
| minimal__4096__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 极简 | 4K | T2 | FAIL | 2 | 862 | 1 | 11.5 | length |
| pi__4096__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | pi-agent | 4K | T1 | FAIL | 4 | 1441 | 1 | 5.0 | length |
| pi__4096__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | pi-agent | 4K | T2 | FAIL | 4 | 1408 | 1 | 4.6 | length |
| slim__4096__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | slim-agent | 4K | T1 | FAIL | 6 | 1289 | 1 | 13.5 | length |
| slim__4096__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | slim-agent | 4K | T2 | FAIL | 6 | 1256 | 1 | 11.4 | length |
| standard__4096__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 标准 | 4K | T1 | FAIL | 24 | 0 | 0 | 12.8 | None |
| standard__4096__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 标准 | 4K | T2 | FAIL | 24 | 0 | 0 | 12.5 | None |
| minimal__8192__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 极简 | 8K | T1 | PASS | 2 | 895 | 591 | 38.6 | stop |
| minimal__8192__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 极简 | 8K | T2 | PASS | 2 | 862 | 124 | 19.1 | stop |
| pi__8192__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | pi-agent | 8K | T1 | PASS | 4 | 1441 | 273 | 14.2 | stop |
| pi__8192__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | pi-agent | 8K | T2 | PASS | 4 | 1408 | 36 | 7.8 | stop |
| slim__8192__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | slim-agent | 8K | T1 | PASS | 6 | 1289 | 329 | 64.8 | stop |
| slim__8192__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | slim-agent | 8K | T2 | FAIL | 6 | 1256 | 140 | 16.9 | tool_calls |
| standard__8192__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 标准 | 8K | T1 | FAIL | 24 | 6073 | 1 | 24.0 | length |
| standard__8192__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 标准 | 8K | T2 | FAIL | 24 | 6040 | 1 | 24.5 | length |
| minimal__65536__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 极简 | 64K | T1 | PASS | 2 | 895 | 525 | 37.3 | stop |
| minimal__65536__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 极简 | 64K | T2 | PASS | 2 | 862 | 121 | 18.0 | stop |
| pi__65536__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | pi-agent | 64K | T1 | PASS | 4 | 1441 | 1426 | 54.3 | stop |
| pi__65536__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | pi-agent | 64K | T2 | PASS | 4 | 1408 | 38 | 7.8 | stop |
| slim__65536__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | slim-agent | 64K | T1 | PASS | 6 | 1289 | 277 | 68.6 | stop |
| slim__65536__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | slim-agent | 64K | T2 | FAIL | 6 | 1256 | 140 | 17.5 | tool_calls |
| standard__65536__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 标准 | 64K | T1 | PASS | 24 | 6073 | 471 | 48.6 | stop |
| standard__65536__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 标准 | 64K | T2 | PASS | 24 | 6040 | 121 | 32.8 | stop |
| minimal__262144__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 极简 | 256K | T1 | PASS | 2 | 895 | 443 | 33.4 | stop |
| minimal__262144__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 极简 | 256K | T2 | PASS | 2 | 862 | 144 | 20.0 | stop |
| pi__262144__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | pi-agent | 256K | T1 | PASS | 4 | 1441 | 1560 | 81.0 | stop |
| pi__262144__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | pi-agent | 256K | T2 | PASS | 4 | 1408 | 83 | 9.0 | stop |
| slim__262144__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | slim-agent | 256K | T1 | PASS | 6 | 1289 | 266 | 25.5 | stop |
| slim__262144__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | slim-agent | 256K | T2 | PASS | 6 | 1256 | 83 | 17.7 | stop |
| standard__262144__lfm3-1.7b-q5__T1 | lfm3-1.7b-q5 | 标准 | 256K | T1 | FAIL | 24 | 6073 | 400 | 35.9 | stop |
| standard__262144__lfm3-1.7b-q5__T2 | lfm3-1.7b-q5 | 标准 | 256K | T2 | PASS | 24 | 6040 | 166 | 31.9 | stop |
| minimal__2048__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 极简 | 2K | T1 | FAIL | 2 | 972 | 1 | 14.9 | length |
| minimal__2048__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 极简 | 2K | T2 | FAIL | 2 | 935 | 1 | 11.3 | length |
| pi__2048__qwen35-4b-q4km__T1 | qwen35-4b-q4km | pi-agent | 2K | T1 | FAIL | 4 | 1566 | 1 | 8.2 | length |
| pi__2048__qwen35-4b-q4km__T2 | qwen35-4b-q4km | pi-agent | 2K | T2 | FAIL | 4 | 1529 | 1 | 8.4 | length |
| slim__2048__qwen35-4b-q4km__T1 | qwen35-4b-q4km | slim-agent | 2K | T1 | FAIL | 6 | 1399 | 1 | 22.3 | length |
| slim__2048__qwen35-4b-q4km__T2 | qwen35-4b-q4km | slim-agent | 2K | T2 | FAIL | 6 | 1362 | 1 | 13.5 | length |
| standard__2048__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 标准 | 2K | T1 | FAIL | 24 | 0 | 0 | 12.9 | None |
| standard__2048__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 标准 | 2K | T2 | FAIL | 24 | 0 | 0 | 12.6 | None |
| minimal__4096__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 极简 | 4K | T1 | FAIL | 2 | 972 | 1 | 14.3 | length |
| minimal__4096__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 极简 | 4K | T2 | FAIL | 2 | 935 | 1 | 11.8 | length |
| pi__4096__qwen35-4b-q4km__T1 | qwen35-4b-q4km | pi-agent | 4K | T1 | FAIL | 4 | 1566 | 1 | 8.3 | length |
| pi__4096__qwen35-4b-q4km__T2 | qwen35-4b-q4km | pi-agent | 4K | T2 | FAIL | 4 | 1529 | 1 | 8.2 | length |
| slim__4096__qwen35-4b-q4km__T1 | qwen35-4b-q4km | slim-agent | 4K | T1 | FAIL | 6 | 1399 | 1 | 17.0 | length |
| slim__4096__qwen35-4b-q4km__T2 | qwen35-4b-q4km | slim-agent | 4K | T2 | FAIL | 6 | 1362 | 1 | 12.2 | length |
| standard__4096__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 标准 | 4K | T1 | FAIL | 24 | 0 | 0 | 13.1 | None |
| standard__4096__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 标准 | 4K | T2 | FAIL | 24 | 0 | 0 | 12.4 | None |
| minimal__8192__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 极简 | 8K | T1 | PASS | 2 | 972 | 946 | 89.8 | stop |
| minimal__8192__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 极简 | 8K | T2 | PASS | 2 | 935 | 166 | 29.8 | stop |
| pi__8192__qwen35-4b-q4km__T1 | qwen35-4b-q4km | pi-agent | 8K | T1 | PASS | 4 | 1566 | 519 | 28.0 | stop |
| pi__8192__qwen35-4b-q4km__T2 | qwen35-4b-q4km | pi-agent | 8K | T2 | PASS | 4 | 1529 | 101 | 14.7 | stop |
| slim__8192__qwen35-4b-q4km__T1 | qwen35-4b-q4km | slim-agent | 8K | T1 | FAIL | 6 | 1399 | 517 | 58.2 | tool_calls |
| slim__8192__qwen35-4b-q4km__T2 | qwen35-4b-q4km | slim-agent | 8K | T2 | PASS | 6 | 1362 | 92 | 27.1 | stop |
| standard__8192__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 标准 | 8K | T1 | FAIL | 24 | 6184 | 1 | 98.8 | length |
| standard__8192__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 标准 | 8K | T2 | FAIL | 24 | 6147 | 1 | 34.1 | length |
| minimal__65536__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 极简 | 64K | T1 | PASS | 2 | 974 | 893 | 80.5 | stop |
| minimal__65536__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 极简 | 64K | T2 | PASS | 2 | 937 | 104 | 73.4 | stop |
| pi__65536__qwen35-4b-q4km__T1 | qwen35-4b-q4km | pi-agent | 64K | T1 | PASS | 4 | 1567 | 790 | 35.8 | stop |
| pi__65536__qwen35-4b-q4km__T2 | qwen35-4b-q4km | pi-agent | 64K | T2 | PASS | 4 | 1530 | 113 | 14.6 | stop |
| slim__65536__qwen35-4b-q4km__T1 | qwen35-4b-q4km | slim-agent | 64K | T1 | FAIL | 6 | 1401 | 484 | 94.6 | tool_calls |
| slim__65536__qwen35-4b-q4km__T2 | qwen35-4b-q4km | slim-agent | 64K | T2 | PASS | 6 | 1364 | 115 | 30.3 | stop |
| standard__65536__qwen35-4b-q4km__T1 | qwen35-4b-q4km | 标准 | 64K | T1 | FAIL | 24 | 6186 | 4096 | 214.1 | length |
| standard__65536__qwen35-4b-q4km__T2 | qwen35-4b-q4km | 标准 | 64K | T2 | PASS | 24 | 6149 | 130 | 40.2 | stop |


---

## 7. 失效模式分析（逐条证据）

### 7.1 2K 窗口：四套配置全军覆没，且都是同一个原因

| 配置 | 首轮 prompt | 框架下发的 `max_tokens` | `finish_reason` | 结果 |
|---|---|---|---|---|
| slim-agent | 1289 | **1** | `length` | 模型只吐 1 个 token |
| 标准 | 6073 | **1** | — | 服务端 400 `exceed_context_size_error` |
| 极简 | 895 | **1** | `length` | 只吐 1 个 token |
| pi-agent | 1441 | **1** | `length` | 只吐 1 个 token |

`max_tokens=1` 不是模型的问题：计量代理记录的是**框架发出去的请求体**。当"期望输出预算"（本实验设为 `min(4096, 窗口/2)`，2K 时即 1024）大于剩余窗口时，两套框架都把它夹到下限 1。也就是说 2K 窗口下，任何 agent 都没有可用输出空间——**小模型 Agent 的下限是 4K 起，且必须先把工具面压到 1K 以内才有意义**。

### 7.2 8K 窗口：标准模式"能装进去，但没法回答"

标准模式在 8K 下的实测：

- 首轮 prompt **6073 tokens**（24 个工具 schema + persona + runtime context）；
- 框架算出的 `max_tokens = 1`；
- LFM3 的回答是一个字符 `I`，Qwen3.5 直接空答复；
- 两次运行各花 24 s / 99 s，全部 FAIL。

换算下来：8K 窗口里 **74.1%** 被固定开销吃掉，剩下 2.1K 既不够一轮工具调用，也不够一轮像样的生成。这就是"窄主宽子"要解决的问题的量化版本。

### 7.3 slim 的 T2 在 8K/64K 卡在工具循环

LFM3 + slim，T2（读文件取数）在 8K 和 64K 都是 `finish_reason=tool_calls`、最终答复为空：

- 第 1 轮：模型调用 `read` 读 `notes/facts.md`（正确）；
- 第 2 轮：模型没有输出答复，而是继续发起工具调用，回合在 `tool_calls` 上结束。

同样的提示词，极简与 pi 在 8K 就一次通过。差别在 system prompt 的 5 条规则里有「目标达成后立即调用 task_complete 收尾」——1.7B 在这种"该收尾还是该继续"的判断上会踩空。**这是本插件在 1.7B 上需要继续调 prompt 的地方，不是框架缺陷。**

### 7.4 Qwen3.5 4B 在标准模式下会"跑飞"

`standard@64K` 的 T1：模型生成 **4096 tokens**（打满上限），内容是越来越长的一串天文数字，`finish_reason=length`，耗时 214 s，文件根本没建。24 个工具 + 6.2K 固定开销把 4B 模型的注意力彻底带偏。

同配置 64K 的 T2 却通过了（40 s）。说明对 4B 而言标准模式并非"必然崩"，而是**任务越长越容易崩**。

### 7.5 Qwen3.5 4B 的 256K：硬件不可行（有实验证据）

| 尝试 | 结果 |
|---|---|
| `-c 262144 -ngl 99`（f16 KV） | `ggml_vulkan: Device memory allocation of size 1073741824 failed` |
| `-c 262144 -ngl 99 -ctk q8_0 -ctv q8_0` | `failed to allocate buffer for kv cache` |
| `-c 262144 -ngl 20 -ctk q8_0 -ctv q8_0` | `failed to allocate compute pp buffers` |

原因可由模型元数据直接推出：`qwen35` 有 32 层、`n_head_kv=4`、`n_embd_head_k/v=256`，即每 token 全注意力 KV 约 128 KB；即使按实测拟合出的 ~34 KB/token 混合结构估算，262144 tokens 也需 **8–9 GB** KV，叠加 2.5 GB 权重远超 6 GB 显存。

作为对照，LFM3（`lfm3`）是滑窗注意力，`n_head_kv` 按层交替为 0/4，每 token 仅约 24 KB，262144 tokens 的 KV 约 6.4 GB 且大量落在滑窗外，因此**同一张卡上真的能开出 256K**，六个 256K 运行全部正常完成。

**结论：256K 能不能跑，取决于模型架构，不取决于 Agent 框架。**

### 7.6 思考试图关闭但没完全关闭

启动时设置了 `LLAMA_ARG_REASONING=off`，LFM3 基本遵守；Qwen3.5 仍会把思维链写出来，且在 DSH 下表现为 `dsh: reasoning:\n…` 打到 stderr，在 pi 下被正常收进 reasoning 通道。这部分 token 计入 `completion_tokens`，是 Qwen 端到端耗时明显高于 LFM3 的主因之一（同为 64K，Qwen 极简 154 s vs LFM3 极简 55 s）。

---

## 8. 实测暴露的插件缺陷（重要）

### 8.1 `inject` 声明缺失，导致插件在严格宿主上整体不挂载

`preset-core.mjs` 第 28 行：

```js
export const inject = ['tools', 'systemPrompt']
```

但 `apply()` 中实际访问了 `ctx.subprocess`（3 处）、`ctx.subagents`（3 处）、`ctx.agents`（2 处）、`ctx.web`（3 处）。Cordis 在严格作用域下对未声明服务的属性访问**直接抛错**，`?.` 短路不会生效：

```
slim-core (file:///…/core.mjs): Error: cannot get property "subprocess" without inject
    at new apply (file:///…/core.mjs:258:43)
```

后果：插件注册的工具一个都没挂上，预设里只剩 persona 生效——**而且白名单钩子也没装上，主代理反而看到了宿主全部 8 个工具**，比不装插件更糟。

**已修复**（本次改动）：

1. `inject` 改为 `['tools', 'systemPrompt', 'subprocess', 'subagents']`；
2. `web` 与 `agents` 改用 `optionalService(ctx, name)` 读取（先 `ctx.get`，再退回属性访问）。实测这两个服务在插件作用域里用 `ctx.get` 就能拿到，不必声明为必需——宿主关掉 web 插件时插件仍能上线，只是检索退化为内置 DDG / Wikipedia；
3. 保留原 `?.` / `typeof` 守卫，缺失服务时给出可读报错而不是抛栈。

验证：`npm test` 26/26 通过；端到端复跑 `slim@65536` T1，工具数 6、`bash` 路径正常、`fib.py` 成功落盘。

### 8.2 白名单在“运行中途新增工具”时会漏（新发现，未修）

复跑 `slim@65536` 的 T2 时，逐次请求的工具集发生了漂移：

| 第几次调用 | 工具数 | 工具名 |
|---|---|---|
| 1–3 | 6 | `bash, edit, read, subagent, task_complete, web_search` ✅ |
| 4–6 | **8** | `bash, edit, read, **read_image**, subagent, task_complete, web_search, **write**` ❌ |

触发条件：模型先用 `read` 读了一次文件，DSH 的 `fs-observation-policy` 随即把 `write` / `read_image` 注册进来；而白名单只在 `system-prompt/assemble` 时生效，这一轮没有重新装配，两个越界工具就直接漏给了模型。

T1 全程 6 个工具（模型走的是 `bash`，没触发 `read`），所以这个问题在之前的矩阵里没有暴露。

**建议修复方向**（未实施）：白名单不能只靠“列工具时过滤”，还要在**执行前**拦截。DSH 有 `tools/pre-execute` 事件（`dsh-assistant-hub` 就是用它做门控的），可以加一道执行期硬闸：

```js
ctx.on('tools/pre-execute', async (call, next) => {
  if (!ALLOW.has(call.name)) throw new Error(`[slim] tool "${call.name}" is outside the whitelist`)
  return next()
})
```

这样即使工具在装配之后才出现，也调不动。

### 8.3 预设在 `dsh headless` 下不生效

出厂 runner 明确不组合 preset，因此 `dsh plugin add` 装好、`~/.dsh/cordis.patch.yml` 写好之后，`dsh --profile headless` 依然用全局插件集。若希望插件能在 CLI/CI 里被评测，需要在插件侧额外提供"无 preset 时的降级挂载路径"，或改用 `dsh tui` / `dsh web`。

### 8.4 宿主工具同名冲突

插件的 `bash` 与宿主 `@deepseek-ai/dsh-tool-bash` 同名。在 preset 作用域里没问题（宿主那个不在该作用域），但在全局挂载等价复刻时必须让宿主那行 `disabled: true`，否则重复注册。文档里值得写一句。

---

## 9. 复现步骤

### 9.1 起 llama.cpp（Windows）

```powershell
$env:LLAMA_ARG_REASONING = 'off'
G:\llamacpp\vulkan\llama-server.exe `
  -m G:\models\lfm\LFM3-1.7B-AD-Q5_K_M\LFM3-1.7B-AD-Q5_K_M.gguf `
  -c 8192 -np 1 -t 4 -ngl 99 --device Vulkan1 `
  --host 0.0.0.0 --port 8080 --jinja --metrics --alias lfm3-1.7b-q5
```

### 9.2 起计量代理（Debian）

```bash
BENCH_PORT=8099 nohup python3 /root/dsh-bench/proxy.py > /root/dsh-bench/logs/proxy.out 2>&1 &
```

### 9.3 单次运行

```bash
# DSH（三选一：slim / standard / minimal）
bash /root/dsh-bench/run-one.sh slim 8192 lfm3-1.7b-q5 'LFM3-1.7B-Q5-KM' T1

# pi
bash /root/dsh-bench/run-pi.sh pi 8192 lfm3-1.7b-q5 'LFM3-1.7B-Q5-KM' T1
```

### 9.4 批量跑一个窗口

```bash
bash /root/dsh-bench/run-ctx.sh lfm3-1.7b-q5 'LFM3-1.7B-Q5-KM' 8192
```

### 9.5 关键文件位置

| 内容 | 路径 |
|---|---|
| 等价覆盖层（slim） | `/root/dsh-bench/modes/slim.yml` |
| 等价覆盖层（标准） | `/root/dsh-bench/modes/standard.yml` |
| 等价覆盖层（极简） | `/root/dsh-bench/modes/minimal.yml` |
| 模型/patch 模板 | `/root/dsh-bench/base.template.yml` |
| 计量代理 | `/root/dsh-bench/proxy.py` |
| 原始结果 | `/root/dsh-bench/results/dsh.ndjson`、`pi.ndjson` |
| 本机留档 | `G:\ai test\dsh\bench\results\combined.json`、`tables.md` |

---

## 10. 数据可信度与已知边界

- **可信**：`prompt_tokens` / `completion_tokens` / `max_tokens` / `finish_reason` 均来自线路上的真实请求与响应，非估算；每个窗口都重启服务端保证 `n_ctx` 精确。
- **边界 1**：DSH 三种组合是用全局覆盖层复刻 preset（原因见第 3 节），挂载层级与出厂 preset 不同。
- **边界 2**：`headless` profile 没有 `time-context` / `tool-schedule` / `present` 三个插件，标准模式实测 24 个工具，比出厂 `standard` 预设少了 `time-context` / `tool-schedule` / `present` 三项（headless profile 未挂载）。方向上只会让标准模式**显得更好**，不会夸大它的劣势。
- **边界 3**：每个格子只跑了 2 个任务、每任务 1 次，未做多次重复；1.7B/4B 的采样方差本身较大，单格结论宜看作"方向"而非"精度"。
- **边界 4**：采样参数未固定（llama-server 默认 `temp 0.8 / top_k 40 / top_p 0.95`），这会放大方差。若要复现到小数点，请在 `-c` 之外再加 `--temp 0`。
