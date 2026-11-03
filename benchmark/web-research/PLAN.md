# 联网研究能力专项实验方案（PLAN，未执行）

> 状态：**方案待评审，尚未跑任何一次实验。**
> 版本基线：`dsh-slim-agent 0.3.0-alpha.1`
> 撰写日期：2026-11-03

---

## 0. 这一轮要回答什么

上一轮（`REPORT-2026-11-03-llamacpp.md`）只跑了「建文件并运行」和「读本地文件取数」两类任务，
证明了 Slim 在**纯本地工具任务**上相对 DSH 极简 / pi 存在退化，但**没有测到本插件的核心卖点**：
小模型能否在有限上下文里，靠联网检索拿到训练知识之外的信息，并把它组织成有出处的结论。

本方案要给出可证伪的答案：

| 编号 | 问题 | 对照 |
|---|---|---|
| Q1 | 加了同一份 `web_search`，小模型的世界知识类任务通过率提升多少？ | A vs B |
| Q2 | Slim 的工具组织 + 提示词，比"极简 + 一个搜索工具"更强吗？ | B vs C |
| Q3 | 子代理是否真的降低了主代理上下文、并提高复杂研究任务通过率？ | C vs D |
| Q4 | `task_complete`（0.3.0 已移除）对完成率是正收益还是负收益？ | D vs E |
| Q5 | 上述收益在 8K 是否成立、在 64K 是否消失？ | 8K vs 64K |

**默认立场：不预设 Slim 更优。** 若 Q2 的答案是"B ≥ C"，就按结果删功能。

---

## 1. 前置修复（必须先完成，再谈实验）

| # | 项 | 状态 |
|---|---|---|
| 1 | `inject` 声明缺 `subprocess` / `subagents`，严格宿主上插件不挂载 | ✅ 已修（0.3.0-alpha.1） |
| 2 | `task_complete` 的 `concludeTurn()` 丢弃最终答复 | ✅ 已移除该工具 |
| 3 | 白名单被 `fs-observation-policy` 中途注册的 `write`/`read_image` 绕过 | ✅ 已加 `tools/pre-execute` 执行期硬闸 + 2 条单测 |
| 4 | 版本号统一（README / package.json / tgz / 测试副本） | ✅ `0.3.0-alpha.1`；tgz 需在开跑前重新 `npm pack` |
| 5 | **输出预算算法**：`max_tokens=1` 的运行不得进入通过率统计 | ⚠️ **未解决，见 §7.3** |
| 6 | 子代理的 LLM 调用必须被单独计量 | ⚠️ 需在计量代理侧按 session 归属拆分，见 §6 |

> 第 5 项是硬门槛：在它解决之前，**4K 不进入主表**。

---

## 2. 对照组（七个 arm，全部来自同一份代码）

所有 arm 使用同一模型文件、同一 llama.cpp 实例、同一采样参数、同一搜索实现。

| Arm | 组成 | 用途 |
|---|---|---|
| **A** | 极简基线：`tool-fs`(只读) + `bash`，**无搜索** | 负面对照：模型自身知识 |
| **B** | 极简 + **Slim 的 `web_search`**（同一份代码、同一引擎、同一 schema） | 单纯联网的收益 |
| **C** | Slim 完整工具与 prompt，**但关掉 subagent** | 工具组织 + 提示词的收益 |
| **D** | Slim 完整（read/edit/bash/web_search/subagent） | 完整架构 |
| **E** | D + 重新挂回 `task_complete`（0.3.0 已删，用于验证 Q4） | 收尾工具的影响 |
| **F** | `pi` agent（无等价搜索工具） | 外部参照，**联网类任务标 N/A** |
| **G** | DSH 标准模式（24 工具） | 仅作工具开销上界参照，不参与主要比较 |

**实现要求**：B / C / D / E 必须是**同一条代码路径**，只差配置开关。
为此需要给 `preset-core.mjs` 增加三个 benchmark-only 配置项（默认值保持现有行为，不影响正式用法）：

```
enableSubagent: true|false      # C 组关掉
enableTaskComplete: false|true  # E 组打开
enableSearch: true|false        # A 组关掉
```

> 这是本方案唯一要求的**新增产品代码**；若你不接受为测试改产品代码，
> 退路是让 B/C 组挂载 `slim-core` 的一份 `benchmark/web-research/arms/*.mjs` 副本，
> 但那样就违反"同一份实现"的对照原则，可信度下降，需要在报告里显式声明。

---

## 3. 搜索实现与"禁用 DeepSeek 搜索 API"的技术保证

**这是硬性约束**：三种模式（含 0.3.0 的 Slim）都不得调用 DeepSeek 的搜索接口。

| 保证层 | 做法 | 验证方式 |
|---|---|---|
| 插件层 | 基准 profile 的 patch 里把 `@deepseek-ai/dsh-web-search-deepseek`、`@deepseek-ai/dsh-web-deepseek-api` 显式 `disabled: true`；`tool-web.search` 置 `false` | `dsh --profile headless --dump-config \| grep -c web-search-deepseek` 必须为 0（已禁用行不出现或为 disabled） |
| 凭据层 | 基准进程 `env -u DEEPSEEK_API_KEY`（`web-search-deepseek` 的 `apiKeyEnv` 指向它，缺凭据即不可用） | 启动后 `/proc/<pid>/environ` 校验 |
| 代码层 | Slim 的 `web_search` 用 `searchEngine: 'builtin'`（只走 DuckDuckGo → Wikipedia 降级链），**永不访问宿主 provider** | 单测已覆盖 `builtin` 模式下不调用宿主 |
| 运行时层 | 计量代理对**所有出站 HTTP**（含搜索）记日志：查询词、引擎、URL、耗时 | 报告中按 `engine` 字段统计，出现 `host`/`deepseek` 即为违规，实验作废 |

> A 组作为负面对照，`enableSearch: false`，连内置搜索都不给。

---

## 4. 任务集设计（12 题 / 4 类）

所有任务满足：**答案在训练截止之后、有官方一手来源、可用机器判据核对。**

### 4.1 四类任务

| 类 | 数量 | 考察点 | 及格线 |
|---|---|---|---|
| **A 实时事实检索** | 3 | 能否查到训练数据之外的最新版本号/日期 | 事实正确 + 至少 1 条官方 URL |
| **B 多源交叉核验** | 3 | 能否发现两份资料的冲突/过期 | ≥2 个来源 + 明确指出哪份过期 |
| **C 多跳推理** | 3 | 从两处数据推导结论 | ≥2 来源 + 推导链正确 |
| **D 本地 + 联网结合** | 3 | `read` 本地旧参数 + 搜索最新官方参数 + 对比 | 两段都用到 + 差异点正确 |

### 4.2 每题固定字段（`dataset.json`）

```json
{
  "task_id": "A1",
  "category": "A_realtime",
  "user_prompt": "……（不得包含搜索关键词或答案线索）",
  "expected_answer": "……",
  "required_facts": ["<regex 或精确串>", "……"],
  "required_sources": ["<域名白名单>", "……"],
  "evaluation_rules": {"must_call_search": true, "min_sources": 1, "max_age_days": 30},
  "benchmark_date": "2026-11-XX",
  "source_snapshot_date": "2026-11-XX",
  "snapshot": {"url": "……", "http_status": 200, "sha256": "……", "excerpt": "……"}
}
```

### 4.3 数据冻结纪律

- 出题前先抓官方页面快照（`sources.json`），记 URL / 发布时间 / `sha256` / 摘录；
- 题目一律取自 `benchmark_date - 14~30 天` 内的发布，确保两个模型的训练知识覆盖不到；
- 快照落盘 `benchmark/web-research/sources/`，实验期间不改；
- 若某题在开跑前被官方改版导致快照失效，**整题作废并重出**，不得临时改判据。

> 本轮 12 题具体内容在**执行阶段**用 `web_search`/`web_fetch` 现查现冻结，
> 不在方案里凭空写死数字，避免把未核实的值写进仓库。

---

## 5. 变量控制

| 变量 | 取值 |
|---|---|
| 模型 | `LFM3-1.7B-AD-Q5_K_M`、`Qwen3.5-4B.Q4_K_M`（文件哈希入报告） |
| 后端 | llama.cpp b12066 Vulkan，`-np 1 -t 4 -ngl 99`，`LLAMA_ARG_REASONING=off` |
| 采样 | `temperature=0`、`top_p=1`、固定 `seed=42`；如后端不支持完全确定性则逐次记录 seed |
| 上下文 | **8K 主表**、64K 对照；（4K 待 §7.3 解决后再补） |
| 单请求输出上限 | 512 tokens |
| 单任务总生成上限 | 4096 tokens |
| 单任务 LLM 请求数上限 | 12 |
| 单任务工具调用上限 | 10 |
| 单任务墙钟上限 | 180 s（超时记 `TIMEOUT`，不计 PASS） |
| 子代理并发 | 1（与产品默认一致） |

---

## 6. 计量口径（不能只算主代理）

### 6.1 必须分开记的数

```
main_prompt_tokens / main_completion_tokens
sub_prompt_tokens  / sub_completion_tokens
total_llm_requests / total_tool_calls / subagent_count
main_max_ctx / sub_max_ctx / overall_max_ctx
wall_s / peak_vram_mb / peak_rss_mb
```

### 6.2 归属方法

1. **主口径**：读 DSH 会话日志（`session.v4.jsonl.zstd`），按 `session id` 与 `delegationDepth` 把每个 `assistant/message` 的 usage 分到主 / 子；
2. **旁证**：计量代理（`127.0.0.1:8099`）按"运行前后行偏移切片"，交叉校验总数不得少于会话日志统计（防止有请求绕过代理）；
3. **显存**：Windows 侧 2 s 采样 `nvidia-smi --query-gpu=memory.used`，取该次运行区间峰值；
4. **搜索**：代理记录每次搜索的 `engine / query / url_count / ms`，单独出表。

> 已知边界：`pi` 不走 DSH 会话日志，只能靠代理侧统计，报告中单独标注。

---

## 7. 判定与"无效运行"的处理

### 7.1 综合通过（Overall PASS）必须是合取

```
PASS = 核心事实正确
     ∧ 日期/版本/数值正确
     ∧ 至少调用过一次 web_search（A 类任务除外）
     ∧ 引用 URL 真实可达（HEAD 200）且属于官方域名
     ∧ 未使用过期信息
     ∧ 没有编造来源
     ∧ 正常产出最终文字答复
```

### 7.2 分项指标

`Answer Accuracy` / `Search Compliance` / `Citation Precision` / `Citation Coverage` /
`Freshness Accuracy` / `Overall Pass Rate`，全部按 arm × 模型 × 上下文 × 任务类别交叉出表。

### 7.3 ⚠️ `CONTEXT_INFEASIBLE` 隔离（上一轮的教训）

上一轮出现过 `max_tokens=1` 仍被计入通过率的情况。本轮硬性规定：

- 若某次请求 `max_tokens < 256`，该次运行标记 **`BUDGET_INVALID`**，**不计入分母**，单独出表；
- 若 prompt 本身就是 `> contextWindow`，标记 **`CONTEXT_INFEASIBLE`**；
- 报告必须同时给出：有效运行数 / 无效运行数 / 各自原因分布；
- **4K 只有在 `BUDGET_INVALID` 比例 < 10% 时才进入主表**，否则只作为"宿主预算算法缺陷"的证据。

> 已实测：`contextWindow=4096, maxTokens=512, 实际 prompt=1203` 时，DSH 仍下发 `max_tokens=1`。
> 说明 DSH 的 prompt token 估计远大于真实值。开跑前需要先定位这个估计逻辑（见 §1 第 5 项），
> 否则 4K 一栏不可信。

### 7.4 失败类型枚举（用于失败分析）

`NO_SEARCH` / `BAD_QUERY` / `STALE_SOURCE` / `SEARCH_OK_NO_UNDERSTANDING` /
`MULTISOURCE_WRONG` / `FAKE_CITATION` / `CITATION_UNSUPPORTED` / `TOOL_ARG_MALFORMED` /
`TOOL_LOOP` / `SUBAGENT_FAILED` / `EARLY_CONCLUDE` / `NO_FINAL_ANSWER` /
`CONTEXT_INFEASIBLE` / `BUDGET_INVALID` / `TIMEOUT`

---

## 8. 运行规模（按本机算力裁剪后的版本）

原方案的 `12×3×2×3×5 = 1080` 次在本机需要 18–36 小时，且多数格子会重复踩同一个坑。
改为三段式：

| 阶段 | 规模 | 次数 | 预估耗时 | 目的 |
|---|---|---|---|---|
| **P0 冒烟** | 1 题 × 1 次 × 2 模型 × 8K × 5 arm | 10 | ~20 min | 验证 5 个 arm 都能跑、计量对得上 |
| **P1 筛查** | 6 题（A/B/C/D 各 1–2）× 2 次 × 2 模型 × 8K × 5 arm | 120 | ~4–6 h | 得到方向性差异 |
| **P2 确认** | 差异最大的 2 vs 2 arm × 3 题 × 5 次 × 2 模型 × (8K + 64K) | 240 | ~8–12 h | 收敛结论 |
| **P3 4K** | 待 §7.3 修复后，按 P1 规模补 4K | 120 | ~4–6 h | 验证低上下文优势 |

- 每个 `(arm, 题)` 的运行顺序**随机化**，避免缓存与搜索服务时效性偏向某一 arm；
- 失败样本**全部保留**，不做挑选；
- 单次 180 s 上限意味着 240 次的最坏耗时是 12 h，实测多数在 30–90 s，故给区间。

---

## 9. 交付物

```
benchmark/web-research/
├── PLAN.md              # 本文件
├── dataset.json         # 12 题 + 判据
├── sources.json         # 官方来源 + 快照哈希
├── sources/             # 冻结的页面快照
├── run.mjs              # 统一入口（arm × 模型 × 上下文 × 题 × 重复）
├── evaluate.mjs         # 机器判分 + 失败分类
├── results/             # 逐次 NDJSON
└── report.md            # 最终报告
```

`report.md` 必须包含：五组总通过率、两个模型分开、8K/64K 对比、四类任务分类通过率、
引用准确率与来源覆盖率、主/子代理 token 拆分、最大上下文占用、峰值显存、耗时、
失败模式分布与代表性日志、以及**"Slim 架构是否值得"的明确结论**。

---

## 10. 已知边界与风险

1. **小模型能力上限**：1.7B 做多跳推理本身就吃力，A 类全灭不一定是搜索工具的问题；报告需给出"命中但没用对"的案例区分。
2. **搜索引擎不稳定**：DDG 有速率限制与结果漂移；靠快照 + 固定查询时间片缓解，必要时对同一题冻结搜索结果再重放。
3. **样本量**：P1 每格仅 2 次，只能看方向；任何"±1 题"的差异不足以定论，需要 P2 支撑。
4. **不是同一路径就不算对照**：若最终采用"独立副本"而不是配置开关，必须在报告首页声明可信度降级。
5. **4K 的可信度**取决于 §7.3 的先修问题。

---

## 11. 需要你拍板的三件事

1. **是否接受给 `preset-core.mjs` 加三个 benchmark-only 配置项**（`enableSubagent` / `enableTaskComplete` / `enableSearch`），以保证五个 arm 走同一条代码路径？
2. **是否现在就投入 P0+P1**（约 130 次、5–7 小时），还是先把 §7.3 的预算算法查清楚再动？
3. **12 题的难度梯度**：是"全部按 8K 能跑通"来出，还是保留 2–3 题超纲题（预期全灭）用来观察失败模式？
