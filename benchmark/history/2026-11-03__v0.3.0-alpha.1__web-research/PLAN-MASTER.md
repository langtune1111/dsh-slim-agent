# 联网研究 + Agent 能力实验 · 总方案（PLAN-MASTER）

> 状态：**方案定稿，尚未开跑。**
> 基线：`dsh-slim-agent 0.3.0-beta.1`
> 取代：`PLAN-CITATION.md`、`PLAN-TASKS.md`（已并入，仅留决策痕迹）
> 上一轮 180 次运行见 [REPORT.md](REPORT.md)，其数据在本方案里**只作留档**（理由见 §9）。

---

## 0. 一句话

**五个 arm 全部具备同源同范围的搜索能力**，在 **14 道主线题（12 道联网研究 + 2 道 Agent 基础能力）
+ 4 道超纲题**上跑无约束基线，再对两道引用密集型题目叠加「强制引用」变体，
最后用 **6K 档**探测每个 arm 的最小可用窗口。总计 **400 次运行、约 11 小时**，**连续跑完一次性交付**。

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
| 模型 | LFM3 1.7B、Qwen3.5 4B |
| 上下文 | 65536（主）；6144（P5 边界探测） |
| **引用约束** | **V0 无约束**（原始问题） / **V1 强制引用**（"每个事实后必须紧跟 `[来源: URL]`，无来源写未证实"） |

引用约束**只改任务提示词**，不改产品代码，五个 arm 对称。

主指标：`Citation Coverage`、`Citation Precision`、`Answer Accuracy`、`Fabricated Citations`；
辅助：端到端耗时、LLM 请求数、搜索调用数、终态（PASS/FAIL/TIMEOUT/BUDGET_INVALID）、**最小可用窗口**。

---

## 4. 为什么不做 4K、改做 6K

`pi-ai` 的 `clampMaxTokensToContext()` 在算输出预算时**固定扣 4096**：

```js
const CONTEXT_SAFETY_TOKENS = 4096;
const available = model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;
```

- `contextWindow = 4096` → `available ≤ 0` → `max_tokens = 1`。**结构性不可用**，跑出来只有
  `BUDGET_INVALID`，信息量为零。
- `contextWindow = 6144` → `available = 2048 - est`。est 越小越可能拿到输出预算：
  极简这类轻提示词的 arm 可能刚好够 256 tokens，slim 这类重提示词的大概率仍然不够。

所以 **6K 是一个"边界探测档"**：它能测出**每个 arm 的最小可用窗口**在哪，
这恰恰是 4K 给不了的信息。报告里会把这条推理写清楚：
> 不做 4K（结构性不可用），改做 6K（可分辨的最小窗口），并把每个 arm 的可用/不可用记录下来。

如果 6K 也全员 `BUDGET_INVALID`，结论就是"在 DSH 0.2.1-rc.5 上，小窗口一律不可用"，
这同样是有价值的结论，照写。

---

## 5. 阶段与运行量（连续执行，中间不停）

| 阶段 | 内容 | arm × 模型 | 重复 | 运行数 | 预估 |
|---|---|---|---|---|---|
| **P0 校准** | 5 arm 各 1 次冒烟，确认适配器搜到东西、条数格式一致 | — | 1 | **10** | 25 min |
| **P1 联网主线 12 题（V0）** | A1-A3 B1-B3 C1-C3 D1-D3 | 5 × 2 | 2 | **240** | 6.6 h |
| **P2 Agent 基础 2 题（V0）** | T1 T2 | 5 × 2 | 2 | **40** | 0.4 h |
| **P3 引用约束（V1）** | A1 B3 | 5 × 2 | 2 | **40** | 1.1 h |
| **P4 超纲 4 题** | X1-X4 | 5 × 2 | 1 | **40** | 1.3 h |
| **P5 6K 边界** | T1 A1 D1 @6144 | 5 × 2 | 1 | **30** | 0.7 h |
| **合计** | | | | **400** | **≈ 10.5–11.5 h** |

执行顺序固定为 `P0 → P1 → P2 → P3 → P4 → P5`，**中途不汇报、不中断**，
全部跑完后一次性出报告与数据。P0 若失败（适配器搜不到东西）才允许中止。

---

## 6. 跑之前要补的代码（harness 增量）

| 项 | 说明 |
|---|---|
| `required_file` 支持 | T1/X4 要检查工作目录里是否真的生成了 `prime.py` / `cli.py` |
| 任务提示词注入 V1 后缀 | 按 `variant` 参数给 prompt 追加引用约束句 |
| 6K 档支持 | `run_task.py` 已接受任意 ctx，只需在计划里排进去 |
| 连续批量脚本 | `run_master.sh` 按 §5 顺序跑满 400 次，写单一 `runs.ndjson` 与阶段日志 |
| 报告渲染 | 现有 `render_report.py` 增加 T 类、X4、6K 段与 `Citation Coverage` 表 |

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
| 大量 TIMEOUT 拉长时长 | 可能超 12 h | 已按 1.7 min/次估算；若 P1 过半仍超时，后续阶段降为 1 次重复（需在报告中声明） |
| 适配器与 slim 行为不完全一致 | 可信度下降 | 差异已在 adapters/README.md 列明，报告单列 |
| Bing 结果漂移 | 同题两次不同 | 记录每次 URL 列表，报告给漂移率 |
