# 联网研究 + Agent 能力实验 · 总方案（PLAN-MASTER）

> 状态：**方案定稿，尚未开跑。**
> 基线：`dsh-slim-agent 0.3.0-beta.1`
> 取代：`PLAN-CITATION.md`、`PLAN-TASKS.md`（已并入，仅留决策痕迹）
> 上一轮 180 次运行见 [REPORT.md](REPORT.md)，其数据在本方案里**只作留档**（理由见 §9）。

---

## 0. 一句话

**五个 arm 全部具备同源同范围的搜索能力**，在 **14 道主线题（12 道联网研究 + 2 道 Agent 基础能力）
+ 4 道超纲题**上跑无约束基线，再对两道引用密集型题目叠加「强制引用」变体。
**按「模型 × 思考模式」切成三个阶段**：阶段一两个模型都关思考；阶段二 LFM3 开、阶段三 Qwen 开，
开思考时用 `--reasoning-budget 1024` 给思考设上限（否则它会吃光回答额度）。
**LFM3 双路并发、Qwen 单路**；**4K 与 6K 均已实测否决**。
总计 **750 次运行、约 19 小时**，**连续跑完一次性交付**。

---

## 1. 公平性设置（地基）

上一轮 A/B/G 三个对照组**没有搜索工具**，而 slim 自带搜索，"A/B/G 全灭"根本无法评价架构。
本轮：**每个 arm 从自己那一侧的机制拿到搜索，后端、条数、输出格式全部一致。**

| arm | 搜索来源 | 实现 |
|---|---|---|
| **A 极简** | DSH 自己的 `web_search` | [`adapters/dsh-bench-search.mjs`](../../adapters/dsh-bench-search.mjs) |
| **B 标准** | 同上 | 同上 |
| **C slim 无子代理** | slim 内置 `web_search` | 产品自身 |
| **D slim 完整** | 同上 | 产品自身 |
| **G pi** | pi 扩展注册的 `web_search` | [`adapters/pi-bench-search.mjs`](../../adapters/pi-bench-search.mjs) |

共享后端 [`adapters/search-core.mjs`](../../adapters/search-core.mjs)：同 Bing 端点、同 UA、**同取 4 条**、
同输出模板，`classifySource` / `guessYear` 逐字复制。残留差异见 [adapters/README.md](../../adapters/README.md)，
报告里必须复述。

**F arm 移除**（`task_complete` 影响已有结论）。
**DeepSeek 搜索 API 仍是红线**：插件层禁用 + 剔除 `DEEPSEEK_API_KEY` + 只用 Bing 链 + 运行时校验 `engine` 字段。

---

## 2. 题目

题目与判据全部冻结在 [`dataset.json`](dataset.json)，本地文件在 [`fixtures/`](fixtures/)。
**不加干扰项**：D1/D2/D3 各只写一个版本号，T2 只写一个工单号。

| 类 | 题数 | 题目 | 考察点 |
|---|---|---|---|
| **T Agent 基础** | 2 | T1 建 `prime.py` 并运行；T2 读 `fixtures/T2.md` 取工单号 | 纯工具使用，**不联网、不要求引用** |
| **A 实时事实** | 3 | A1 Node LTS · A2 Python 最新稳定版 · A3 llama.cpp 最新 release | 训练知识之外的版本/日期 |
| **B 多源核验** | 3 | B1 Go · B2 PostgreSQL · B3 Rust（含"旧资料过期"陷阱） | 识别过期/矛盾 |
| **C 多跳推理** | 3 | C1 Node/Python 日差 · C2 Rust/Go 日差 · C3 Python/PostgreSQL 月差 | 两处数据推导 |
| **D 本地+联网** | 3 | D1 Node 台账 · D2 Python 约束 · D3 Rust 台账 | read + 搜索结合 |
| **X 超纲** | 4 | X1 Node LTS 维护结束 · X2 Python 范围可行性 · X3 llama.cpp breaking change · **X4 把 legacy.py 重构成 core.py + cli.py** | 能力天花板 |

> T 类是"最早那批 Agent 能力题"，题面简单；把难题（多文件重构）放进 X 系，而不是把 T 类做难。

---

## 3. 变量与判据

| 自变量 | 取值 |
|---|---|
| arm | A / B / C / D / G |
| 模型 | LFM3 1.7B、Qwen3.5 4B（**均开启思考模式**，见 §4bis） |
| 上下文 | 65536（主）；6144（P5 边界探测） |
| **引用约束** | **V0 无约束**（原始问题） / **V1 强制引用**（"每个事实后必须紧跟 `[来源: URL]`，无来源写未证实"） |

引用约束**只改任务提示词**，不改产品代码，五个 arm 对称。

主指标：`Citation Coverage`、`Citation Precision`、`Answer Accuracy`、`Fabricated Citations`；
辅助：端到端耗时、LLM 请求数、搜索调用数、终态（PASS/FAIL/TIMEOUT/BUDGET_INVALID）、**最小可用窗口**。

---

## 4. 低上下文档：4K 与 6K 都实测不可用（本轮已探针验证，原始记录见 [PROBE-2026-11-04.md](PROBE-2026-11-04.md)）

`pi-ai` 的 `clampMaxTokensToContext()` 在算输出预算时**固定扣 4096**：

```js
const CONTEXT_SAFETY_TOKENS = 4096;
const available = model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;
```

### 4.1 6K 实测（2026-11-04，LFM3，思考模式开）

| arm | ctx | `max_tokens` 实际下发 | 终态 |
|---|---|---|---|
| A 极简 | 6144 | **1** | BUDGET_INVALID |
| B 标准 | 6144 | **1** | BUDGET_INVALID |
| C slim 无子代理 | 6144 | **1** | BUDGET_INVALID |
| D slim 有搜索 | 6144 | **1** | BUDGET_INVALID |
| E slim 完整 | 6144 | **161** | BUDGET_INVALID（< 256 阈值） |
| G pi | 6144 | 请求未发出 | TIMEOUT |

**结论：6K 不可用。** 5/6 的运行拿到 1 个 token 的额度，唯一拿到正数的 arm 也只有 161，
低于我们定的 256 下限。**因此本方案不做 6K 档**，也不做 4K——两者都是结构性不可用。

### 4.2 为什么不再试更小的窗口

`available = ctx - est - 4096`。要让 `available ≥ 256`，需要 `ctx ≥ 4352 + est`。
实测 slim 的 `est` 约 1.9K、极简约 1.3K，于是门槛落在 **5.7K–6.3K**——正好在 6K 上下。
既然 6K 已经全灭，再往下降只会更糟，**低上下文这一档整体放弃**，写进报告作为结论之一：

> 在 DSH 0.2.1-rc.5 上，`contextWindow ≤ 6K` 的模型路由拿不到可用的输出预算，
> 这不是模型能力问题，是框架固定预留 4096 tokens 导致的。

### 4.3 替代信息：最小可用窗口

不测 4K/6K，但**记录每个 arm 在 64K 下的首轮 prompt 大小**，
配合上面的门槛公式，可以在报告里反推出"该 arm 的理论最小可用窗口"，无需再花机时。

---

## 4bis. 思考模式：默认没有独立预算，但可以用 `--reasoning-budget` 给

### 4bis.1 实测：思考直接吃掉 `max_tokens`

直接打 llama-server（LFM3，`--reasoning on`，默认 budget = -1）：

| `max_tokens` | completion_tokens | `content` | `reasoning_content` | finish |
|---|---|---|---|---|
| 32 | 32 | **空** | 121 字符（全在思考里） | `length` |

**结论：llama.cpp 的思考 token 与回答 token 共用同一个 `max_tokens` 池，
默认没有任何独立预算。** 额度给少了，模型就把 100% 的预算烧在思考上，回答是空的。

这解释了之前的探针数据：开思考后 completion tokens 从 700–1000 涨到 1808，
极简 arm 从 1100–1500 涨到 3569——不是模型变啰嗦，是思考在抢同一份额度。

### 4bis.2 但 llama.cpp 给了旋钮

`llama-server --help` 里有：

```
--reasoning-budget N        token budget for thinking: -1 unrestricted, 0 immediate end, N>0 token budget (default: -1)
--reasoning-budget-message  message injected before the end-of-thinking tag when the budget is hit
```

实测 `--reasoning-budget 64` + `max_tokens = 256`：

| 项 | 结果 |
|---|---|
| `reasoning_content` | 234 字符（约 64–73 tokens，被截断） |
| `content` | **正常回答**，非空 |
| `completion_tokens` | 171 |
| `finish_reason` | `stop` |

**也就是说：给它一个预算，思考就不再挤占回答。**

### 4bis.3 本轮怎么用

- **阶段一（思考关）**：`--reasoning off`，作为基线。
- **阶段二/三（思考开）**：`--reasoning on --reasoning-budget 1024`，
  即每轮最多 1024 tokens 用于思考，剩余额度留给回答（`max_tokens` 仍为 4096）。
  选 1024 的理由：约为 4096 的 1/4，既能让 1.7B/4B 展开推理，又保证至少有 3072 给回答。
- **微对照组**：每个开思考阶段额外跑 **5 次不限预算**（`-1`）的同题运行，
  用来量化"不设预算会让多少运行退化成空回答"。这 5 次单独成表，不进主通过率。

---

## 4ter. 并发：LFM3 开两路，Qwen 单路（实测见 [PROBE](PROBE-2026-11-04.md)）

实测（2026-11-04）：

| 模型 | 配置 | VRAM | 结果 |
|---|---|---|---|
| LFM3 1.7B | `-np 1`, 1×64K | 2153 MiB | 可用 |
| LFM3 1.7B | `-np 2`, 2×64K | **2929 MiB** | **可用** |
| Qwen3.5 4B | `-np 2`, 2×64K | — | **OOM**（`failed to create_context`） |

**吞吐实测**：LFM3 单路时 150 s 内单 agent 完成 10 次 LLM 请求；
两路并发时两个 agent 各完成 **14 次**（合计 28 次），**聚合吞吐约 2.8×**。
原因是一路在等搜索/工具时，另一路可以用 GPU。

**决定**：
- **LFM3：2 并发**（`-np 2`，每槽 64K）
- **Qwen3.5 4B：1 并发**（`-np 1`，64K）——显存不够，不做降级折衷，避免 KV 量化破坏与 LFM3 的可比性
- 每个 arm、每个模型内部并发度**完全一致**，不存在"某些 arm 跑得快"的不公平
- 单次 ctx 全程 65536，不因并发改变

**公平性说明**：并发会让 GPU 争抢，理论上可能把"本该 FAIL"的运行挤成 TIMEOUT。
处置：① 同一模型内所有 arm 并发度相同；② 墙钟上限提到 180 s 抵消争抢；
③ 报告里给出每个 arm 的 TIMEOUT 率，若某 arm 显著偏高会在脚注里说明。

---

## 5. 三个阶段（按模型 × 思考模式切分，连续执行不汇报）

每个阶段跑**完整套件**：P0 校准 5 次 + P1 联网主线 12 题 + P2 Agent 基础 2 题 +
P3 引用约束 2 题 + P4 超纲 4 题。

| 阶段 | 模型 | 思考模式 | 单模型套件 | 运行数 | 并发 | 预估 |
|---|---|---|---|---|---|---|
| **阶段一** | LFM3 + Qwen | **关**（`--reasoning off`） | 185 × 2 | **370** | LFM3 2 路 / Qwen 1 路 | ≈ 9 h |
| **阶段二** | LFM3 | **开**（`--reasoning-budget 1024`） | 185 | **185** | 2 路 | ≈ 3 h |
| **阶段二·对照** | LFM3 | 开 + 不限预算（`-1`） | 5 | **5** | 2 路 | 10 min |
| **阶段三** | Qwen3.5 4B | **开**（`--reasoning-budget 1024`） | 185 | **185** | 1 路 | ≈ 6.5 h |
| **阶段三·对照** | Qwen3.5 4B | 开 + 不限预算（`-1`） | 5 | **5** | 1 路 | 15 min |
| **合计** | | | | **750** | | **≈ 19 h** |

### 5.1 单模型套件（185 次）的构成

| 子阶段 | 内容 | arm × 题 | 重复 | 运行数 |
|---|---|---|---|---|
| P0 校准 | 5 个 arm 各冒烟 1 次 | 5 × 1 | 1 | 5 |
| P1 联网主线 | A1-A3 B1-B3 C1-C3 D1-D3（12 题） | 5 × 12 | 2 | 120 |
| P2 Agent 基础 | T1 T2 | 5 × 2 | 2 | 20 |
| P3 引用约束 | A1 B3，V1 强制引用 | 5 × 2 | 2 | 20 |
| P4 超纲 | X1-X4 | 5 × 4 | 1 | 20 |
| 合计 | | | | **185** |

### 5.2 执行纪律

- 顺序：`阶段一 → 阶段二(+对照) → 阶段三(+对照)`，**中途不汇报、不中断**，全部跑完一次性交付。
- 唯一允许中止：某阶段的 P0 校准失败（适配器搜不到东西）。
- 每阶段之间重启 llama-server 并切换模型/思考参数（不是"跑完再换"，是切换后立刻继续）。
- 单任务墙钟 **180 s**；单次输出上限 `min(4096, ctx/2)`；上下文全程 **65536**。
- 阶段一的 370 次里，LFM3 与 Qwen 各 185 次，**题目、arm、重复完全对称**。

---

## 6. 跑之前要补的代码（harness 增量）

| 项 | 说明 |
|---|---|
| `required_file` 支持 | T1/X4 要检查工作目录里是否真的生成了 `prime.py` / `cli.py` |
| V1 提示词后缀注入 | 按 `variant` 参数给 prompt 追加引用约束句 |
| 并发调度 | `run_master.sh` 支持 `JOBS=2`（LFM3）/ `JOBS=1`（Qwen），按模型切换 |
| 思考模式适配 | `--reasoning off` / `--reasoning on --reasoning-budget 1024`；统计 reasoning 占比与 `length` 截断率 |
| 墙钟上限 | 从 120 s 提到 **180 s** |
| 报告渲染 | 增加 T 类、X4、思考模式三维对比（关 / 开+预算 / 开不限）、`Citation Coverage` 表；删掉 6K 段 |

这些都不改动 `dsh-slim-agent` 产品代码。

---

## 7. 验收口径

1. P0 全绿才继续：5 个 arm 都解析出 ≥1 条结果，条数与格式一致。
2. 每题 2 次重复（P4/P5 为 1 次），两次结果都记录，不做多数票。
3. 任何 arm 出现 `host` / `deepseek` 引擎 → 该 arm 作废。
4. `BUDGET_INVALID` 与 `TIMEOUT` 单独统计，不并入 FAIL。
5. 某题 5 arm 全失败时，附 ≥2 条失败样例原文。
6. 超纲题单独成表，**0/40 也照写**。
7. 所有原始记录进 `data/master/`，不裁剪。

---

## 8. 交付

跑完后新建 `benchmark/history/<执行日期>__v0.3.0-beta.1__web-research-fair/`，
内含 `REPORT.md`（含 §4 的 4K→6K 说明）、`data/master/runs.ndjson`、`dataset.json` 快照与 `fixtures/` 快照。
根 README 第一章的链接指向这份新报告。

---

## 9. 与上一轮数据的关系

上一轮 180 次**不废弃，但降级为"不公平对照"留档**：

- 可用于说明"没有搜索工具时，1.7B/4B 做不了实时事实题"；
- **不可用于**"slim 优于极简/标准/pi"这类架构结论；
- 本轮 P1 会用公平设置把这批题重跑一遍，新旧并列展示。

---

## 10. 风险

| 风险 | 影响 | 处置 |
|---|---|---|
| 12 道研究题仍然 0 通过 | 主指标无区分度 | 靠 Citation Coverage、收敛性、搜索次数、最小可用窗口四个辅助指标出结论 |
| 思考模式把输出上限吃满 | `length` 截断激增、TIMEOUT 上升 | 墙钟提到 180 s；报告单列 reasoning 占比与截断率，不掩盖 |
| 并发争抢把 FAIL 挤成 TIMEOUT | 公平性受质疑 | 同模型内所有 arm 并发度一致；报告给出每 arm 的 TIMEOUT 率并加脚注 |
| 总时长接近 19 h | 夜里跑不完 | 三阶段天然可断点续跑；每阶段独立出数据，中断也不丢已完成部分 |
| 思考预算 1024 对小模型仍偏大 | 出现空回答 | 微对照组（不限预算 5 次）能量化该效应；若空回答率 > 30% 会在报告里调低建议值 |
| 适配器与 slim 行为不完全一致 | 可信度下降 | 差异已在 adapters/README.md 列明，报告单列 |
| Bing 结果漂移 | 同题两次不同 | 记录每次 URL 列表，报告给漂移率 |
