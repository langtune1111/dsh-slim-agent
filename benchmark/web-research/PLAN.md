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
| Q1 | 没有任何搜索工具时，模型能答对多少实时事实题？ | A / C（负面对照） |
| Q2 | 打开插件自带的搜索后，通过率提升多少？ | C vs D |
| Q3 | 子代理是否降低主代理上下文占用、并提高复杂研究题通过率？ | D vs E |
| Q4 | `task_complete` 是正收益还是负收益？（0.3.0 已移除，F 组回填） | E vs F |
| Q5 | 上述收益在 8K 成立、在 64K 是否消失？ | 8K vs 64K |
| Q6 | 完整的 slim 是否比"极简/标准"更适合小模型？ | A / B vs E |

**默认立场：不预设 Slim 更优。** 若 Q2 的答案是"B ≥ C"，就按结果删功能。

---

## 1. 前置修复（必须先完成，再谈实验）

| # | 项 | 状态 |
|---|---|---|
| 1 | `inject` 声明缺 `subprocess` / `subagents`，严格宿主上插件不挂载 | ✅ 已修（0.3.0-alpha.1） |
| 2 | `task_complete` 的 `concludeTurn()` 丢弃最终答复 | ✅ 已移除该工具 |
| 3 | 白名单被 `fs-observation-policy` 中途注册的 `write`/`read_image` 绕过 | ✅ 已加 `tools/pre-execute` 执行期硬闸 + 2 条单测 |
| 4 | 版本号统一（README / package.json / tgz / 测试副本） | ✅ `0.3.0-alpha.1`；tgz 需在开跑前重新 `npm pack` |
| 5 | **输出预算算法**：`max_tokens=1` 的运行不得进入通过率统计 | ⚠️ 根因已定位（`pi-ai` 的 `CONTEXT_SAFETY_TOKENS = 4096`），见 [ISSUE-dsh-context-budget.md](../ISSUE-dsh-context-budget.md)；在官方修好前按 §7.3 隔离 |
| 6 | 子代理的 LLM 调用必须被单独计量 | ⚠️ 需在计量代理侧按 session 归属拆分，见 §6 |

> 第 5 项是硬门槛：在它解决之前，**4K 不进入主表**。

---

## 2. 对照组的构造原则：只测 agent 自己的能力

**原则：不给任何一组"外挂"搜索能力。**
每个 arm 跑的都是它自己那条代码路径，我们只拨动**产品自身已有的开关**；
不往 DSH 极简里塞一个第三方搜索实现，也不为对照另写一套搜索工具。
DeepSeek 的搜索 API 一律禁用（见 §3），那是作弊。

### 2.1 七个 arm

| Arm | 配置 | 自身的搜索能力 | 用途 |
|---|---|---|---|
| **A** | DSH 极简（`minimal` preset） | 无 | 负面对照：模型自身知识下限 |
| **B** | DSH 标准（`standard` preset，`tool-web.search=false`） | 无（工具面最大） | 工具开销上界参照 |
| **C** | slim：`enableSearch=false, enableSubagent=false` | 无 | 只有本地工具时的能力 |
| **D** | slim：`enableSearch=true, enableSubagent=false` | 有（内置 DDG→Wikipedia） | **纯搜索**的收益 |
| **E** | slim 完整（搜索 + 子代理） | 有 + 可读正文 | **产品默认配置** |
| **F** | slim 完整 + `enableTaskComplete=true` | 同上 | Q4：收尾工具是正收益还是负收益 |
| **G** | `pi` agent | 无（只有 read/bash/edit/write） | 外部参照，联网类任务记 N/A |

### 2.2 三个消融开关（已实现并且有单测）

`preset-core.mjs` 新增三个 **benchmark-only** 配置项，默认值与正式行为完全一致：

```yaml
enableSearch: true          # false → 不注册 web_search，白名单同步收窄
enableSubagent: true        # false → 不注册 subagent
enableTaskComplete: false   # true  → 回填 0.2.x 的旧 task_complete（仅 Q4 消融）
```

因为注册与白名单同源（都从开关构造 `allow` 集合），**不会出现"注册了但不给列"或"列了却调不动"的错位**；
`tools/pre-execute` 硬闸用的也是同一个集合。C/D/E/F 四组因此走的是**同一条代码路径**，
只有开关不同——这是本方案可信度的前提。

### 2.3 被否掉的做法

初稿里有一个 arm 叫"极简 + 注入 slim 的 web_search"。这个设计被取消，原因正是你指出的：
那等于给一个本来没有搜索能力的 agent 外挂了插件，测出来的是"插件+外壳"而不是"这个 agent 行不行"。
现在 K2 类问题改为 **C vs D vs E 内部对比**：同一个插件、同一套 prompt，只拨开关。

---

## 3. 搜索变量与"禁用 DeepSeek 搜索 API"的技术保证

### 3.1 三个必须被控制的变量

| 变量 | 控制方式 |
|---|---|
| **插件** | 用 §2.2 的开关；C/D/E/F 同一份代码 |
| **搜索实现** | 只有内置 DDG → Wikipedia 降级链（`searchEngine: 'builtin'`），永不调用宿主 provider |
| **网页内容** | 所有 arm 共用同一批**冻结快照**（`sources/`，含 sha256 与抓取时间）；实验期间不允许实时漂移 |

### 3.2 四层禁令（DeepSeek 搜索 API）

| 层 | 做法 | 验证 |
|---|---|---|
| 插件层 | patch 里把 `@deepseek-ai/dsh-web-search-deepseek`、`@deepseek-ai/dsh-web-deepseek-api` 显式 `disabled: true`；`tool-web.search: false` | 启动前 `dsh --dump-config` 断言这两行不存在或为 disabled |
| 凭据层 | 基准进程 `env -u DEEPSEEK_API_KEY` | 启动后读 `/proc/<pid>/environ` 校验 |
| 代码层 | slim 的 `web_search` 固定 `searchEngine: 'builtin'`，单测覆盖"builtin 模式绝不调用宿主" | `npm test` |
| 运行时层 | 计量代理对搜索调用记录 `engine` 字段；出现 `host`/`deepseek` 即判该次运行无效 | 报告按 engine 出表 |

> 违反任意一层 → 整个 arm 的实验数据作废，不许"修一下重跑一部分"。

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

### 4.4 超纲题（预期全灭，单列一栏）

按你的要求保留 3 道**明显超出 1.7B/4B 能力**的题，只用来观察失败模式，**不计入 Overall Pass Rate**：

| 编号 | 形态 | 期望观察到的失败类型 |
|---|---|---|
| **X1** | 需要读 3 篇官方文档 + 1 篇 changelog，跨 4 个来源比对同一 API 的三次变更 | `TOOL_LOOP` / `MULTISOURCE_WRONG` |
| **X2** | 需要先算出中间量，再去官方表里反查对应条目（两跳 + 数值换算） | `SEARCH_OK_NO_UNDERSTANDING` |
| **X3** | 需要识别某官方页面已被新版取代（旧链接仍 200 但内容过期） | `STALE_SOURCE` / `CITATION_UNSUPPORTED` |

超纲题的通过率单独成表，即使 0/9 也是有效信息。

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
| **P0 冒烟** | 1 题 × 1 次 × 2 模型 × 8K × 7 arm | 14 | ~25 min | 验证 7 个 arm 都能跑、计量对得上 |
| **P1 筛查** | 6 题（四类各 1–2）× 2 次 × 2 模型 × 8K × 7 arm | 168 | ~5–7 h | 得到方向性差异 |
| **P2 确认** | 差异最大的 2 vs 2 arm × 3 题 × 5 次 × 2 模型 × (8K + 64K) | 240 | ~8–12 h | 收敛结论 |
| **P3 4K** | 待官方修好 §7.3 后，按 P1 规模补 4K | 168 | ~5–7 h | 验证低上下文优势 |

- 每个 `(arm, 题)` 的运行顺序**随机化**，避免缓存与搜索服务时效性偏向某一 arm；
- 失败样本**全部保留**，不做挑选；
- 单次 180 s 上限意味着 240 次的最坏耗时是 12 h，实测多数在 30–90 s，故给区间。

---

## 9. 交付物

```
benchmark/web-research/
├── PLAN.md                        # 本文件（方案）
├── REPORT.md                      # ✅ 已建：15 道题的题目与判据已固化，结果表待回填
├── ISSUE-dsh-context-budget.md    # ✅ 已建：DSH 输出预算 issue 草稿
├── dataset.json                   # 待 P0 冻结（12 主线 + 3 超纲）
├── sources.json                   # 待 P0 冻结（官方来源 + 快照哈希）
├── sources/                       # 待 P0 冻结（页面快照）
├── run.mjs                        # 待写：统一入口（arm × 模型 × 上下文 × 题 × 重复）
├── evaluate.mjs                   # 待写：机器判分 + 失败分类
└── results/                       # 待写：逐次 NDJSON
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

1. ~~三个消融开关~~ —— **已实现**（31/31 单测通过）。
2. **P0+P1 什么时候开始**（约 180 次、6–8 小时）？前置的预算算法问题已经查清并整理成 issue，官方修不修都不影响 P1（P1 只跑 8K，8K 下 `max_tokens` 正常）。
3. **超纲题的占比**：已按你的要求保留 3 题超纲（§4.4），预期全灭，只用于观察失败模式，不计入主通过率。
