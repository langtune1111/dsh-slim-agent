# 实验档案索引 (benchmark/)

所有实验（小规模冒烟也算）一律归档到 [`history/`](history/)，每个实验一个独立目录，
目录名固定为 **`<日期>__<版本>__<主题>`**，内含 `REPORT.md`（带档案头）与必要的 `data/`。

## 归档规则

1. **命名**：`YYYY-MM-DD__vX.Y.Z__kebab-slug`，例如
   `2026-11-03__v0.2.3-beta.1__llamacpp-four-arm-matrix`。
2. **必填档案头**：每份 `REPORT.md` 顶部必须有「实验编号 / 日期 / 被测版本 / 内容 / 规模 / 状态 / 原始数据」表格。
3. **原始数据一起入库**：逐次 NDJSON、汇总表、编排脚本日志都放 `data/`，不裁剪、不挑样本。
4. **不得覆盖**：同一版本重复实验时新建目录并在 slug 后加 `-r2` / `-r3`，不要改写旧报告。
5. **入口唯一且直达**：仓库根 README 直接链接**最新一份已完成报告**的 `history/` 路径，不经过任何中转页；新增实验完成时，同步改根 README 第一章那一行链接。

## 实验列表（按时间倒序）

| 日期 | 版本 | 主题 | 规模 | 状态 | 链接 |
|---|---|---|---|---|---|
| 2026-11-04 | `0.3.0-beta.1` | 联网研究能力专项（7 arm × 15 题） | 180 次 | ✅ 已完成（根 README 当前指向此报告） | [报告](history/2026-11-03__v0.3.0-alpha.1__web-research/REPORT.md) · [总方案](history/2026-11-03__v0.3.0-alpha.1__web-research/PLAN-MASTER.md) |
| 2026-11-09 | `0.6.3-beta.4` | 日期写 ISO：B3 事实 1/2→2/2（跨源仍差一个域名） | 1 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-09__v0.6.3-beta.4__iso-dates/REPORT.md) · [数据](history/2026-11-09__v0.6.3-beta.4__iso-dates/data/) |
| 2026-11-09 | `0.6.3-beta.3` | 强制走 final_answer：D1 FAIL→PASS，B3 跨源过了但缺一个事实 | 2 次（单跑） | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-09__v0.6.3-beta.3__force-final/REPORT.md) · [数据](history/2026-11-09__v0.6.3-beta.3__force-final/data/) |
| 2026-11-09 | `0.6.3-beta.2` | slug 修正 + 空页面不入来源表；实测 2/6，失败点是「不写引用」 | 6 次（单跑） | ✅ 已完成 | [报告](history/2026-11-09__v0.6.3-beta.2__slug-fix-verify/REPORT.md) · [数据](history/2026-11-09__v0.6.3-beta.2__slug-fix-verify/data/) |
| 2026-11-09 | `0.6.3-beta.1` | 补抓 endoflife.date（B 类首次 2/3 通过） | 3 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-09__v0.6.3-beta.1__version-feed/REPORT.md) · [数据](history/2026-11-09__v0.6.3-beta.1__version-feed/data/) |
| 2026-11-09 | `0.6.2-beta.1` | 成句提示（版本+代号拼接），A1 3/3 | 9 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-09__v0.6.2-beta.1__quotable-line/REPORT.md) · [数据](history/2026-11-09__v0.6.2-beta.1__quotable-line/data/) |
| 2026-11-09 | `0.6.1-beta.1` | 路由段每步注入（撤销导致 14→9 的守卫） | 42 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-09__v0.6.1-beta.1__router-regression/REPORT.md) · [数据](history/2026-11-09__v0.6.1-beta.1__router-regression/data/) |
| 2026-11-09 | `0.6.0-beta.1` | 0.6.0-alpha 审计（路由状态生命周期） | 6 次回归 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-09__v0.6.0-beta.1__audit/REPORT.md) · [数据](history/2026-11-09__v0.6.0-beta.1__audit/data/) |
| 2026-11-09 | `0.6.0-alpha.1` | 意图路由后的全量基线（PASS 9→14） | 36 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-09__v0.6.0-alpha.1__router-full-suite/REPORT.md) · [数据](history/2026-11-09__v0.6.0-alpha.1__router-full-suite/data/) |
| 2026-11-09 | `0.5.5-beta.1` | 意图路由（时效性问题强制先检索） | 26 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-09__v0.5.5-beta.1__intent-router/REPORT.md) · [数据](history/2026-11-09__v0.5.5-beta.1__intent-router/data/) |
| 2026-11-09 | `0.5.4-beta.1` | 当日收尾基线（PASS 9/36、0 超时、40s） | 36 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-09__v0.5.4-beta.1__final-baseline/REPORT.md) · [数据](history/2026-11-09__v0.5.4-beta.1__final-baseline/data/) |
| 2026-11-09 | `0.5.4-beta.1` | 抓取缓存（平均耗时 102s → 35s） | 6 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-09__v0.5.4-beta.1__fetch-cache/REPORT.md) · [数据](history/2026-11-09__v0.5.4-beta.1__fetch-cache/data/) |
| 2026-11-09 | `0.5.3-beta.1` | 修正测量缺陷后的全量基线（T 类 4/4，0 超时） | 36 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-09__v0.5.3-beta.1__qwen-full-suite-fixed/REPORT.md) · [数据](history/2026-11-09__v0.5.3-beta.1__qwen-full-suite-fixed/data/) |
| 2026-11-09 | `0.5.3-beta.1` | 重定向页跟随 + 日期抽取 + B3 标注更正 | 16 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-09__v0.5.3-beta.1__redirect-and-dates/REPORT.md) · [数据](history/2026-11-09__v0.5.3-beta.1__redirect-and-dates/data/) |
| 2026-11-09 | `0.5.2-beta.1` | 表格抽取 + hardCap 4（A1 2/2、D 类 4/4） | 16 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-09__v0.5.2-beta.1__table-extraction/REPORT.md) · [数据](history/2026-11-09__v0.5.2-beta.1__table-extraction/data/) |
| 2026-11-07 | `0.5.1-beta.1` | 收尾全量基线（18 题 × 2 轮，Qwen 4B） | 36 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-07__v0.5.1-beta.1__qwen-full-suite/REPORT.md) · [数据](history/2026-11-07__v0.5.1-beta.1__qwen-full-suite/data/) |
| 2026-11-07 | `0.5.1-beta.1` | 顺链抓取（最多 2 层）：代号/发布日期也能取到 | 6 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-07__v0.5.1-beta.1__two-hop-fetch/REPORT.md) · [数据](history/2026-11-07__v0.5.1-beta.1__two-hop-fetch/data/) |
| 2026-11-07 | `0.5.0-beta.1` | 0.5.0-alpha 审计（资源生命周期修复 + 口径复核） | 复核 alpha 6 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-07__v0.5.0-beta.1__audit/REPORT.md) |
| 2026-11-07 | `0.5.0-alpha.1` | 框架侧自动回填引用（编号 → 真实 URL） | 6 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-07__v0.5.0-alpha.1__auto-citation/REPORT.md) · [数据](history/2026-11-07__v0.5.0-alpha.1__auto-citation/data/) |
| 2026-11-07 | `0.4.5-beta.1` | 抓取加固：SSRF 防护 + 体积/类型限制 | 6 次回归 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-07__v0.4.5-beta.1__fetch-hardening/REPORT.md) · [数据](history/2026-11-07__v0.4.5-beta.1__fetch-hardening/data/) |
| 2026-11-07 | `0.4.4-beta.1` | 检索修复：抓首条正文 + 确定性版本抽取（LFM3 vs Qwen 4B 对照） | 24 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-07__v0.4.4-beta.1__retrieval-fix/REPORT.md) · [数据](history/2026-11-07__v0.4.4-beta.1__retrieval-fix/data/) |
| 2026-11-07 | `0.4.3-beta.1` | 提示词反效果：委派 subagent 无效、历史/当前约束引发幻觉引用 | 20 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-07__v0.4.3-beta.1__prompt-hallucination/REPORT.md) · [数据](history/2026-11-07__v0.4.3-beta.1__prompt-hallucination/data/) |
| 2026-11-07 | `0.4.2-beta.1` | 测量工具修正：fixtures 按题投放 + 结论前置 | 18 次（3 组） | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-07__v0.4.2-beta.1__instrument-fix/REPORT.md) · [数据](history/2026-11-07__v0.4.2-beta.1__instrument-fix/data/) |
| 2026-11-07 | `0.4.1-beta.1` | 0.4.0 审计 + 四项缺陷修复 | 6 次回归 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-07__v0.4.1-beta.1__audit-fixes/REPORT.md) · [数据](history/2026-11-07__v0.4.1-beta.1__audit-fixes/data/) |
| 2026-11-05 | `0.4.0-beta.1` | 答复通道打通（convergeFinalOnly + final_answer） | 18 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-05__v0.4.0-beta.1__answer-channel-fixed/REPORT.md) · [数据](history/2026-11-05__v0.4.0-beta.1__answer-channel-fixed/data/) |
| 2026-11-05 | `0.3.3-beta.1` | 答复通道实验（收敛指令 / final_answer，各 12 次） | 24 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-05__v0.3.3-beta.1__answer-channel/REPORT.md) · [数据](history/2026-11-05__v0.3.3-beta.1__answer-channel/data/) |
| 2026-11-05 | `0.3.2-beta.1` | slim 强制收敛实验（4 组 x 3 题 x 2 轮） | 24 次 | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-05__v0.3.2-beta.1__slim-converge/REPORT.md) · [数据](history/2026-11-05__v0.3.2-beta.1__slim-converge/data/) |
| 2026-11-05 | `0.3.0-beta.1` | 五阶段完整实验（5 arm × 18 题 × 思考开关） | **851 次** | ✅ 已完成（**根 README 当前指向此报告**） | [报告](history/2026-11-05__v0.3.0-beta.1__web-research-fair/REPORT.md) · [数据](history/2026-11-05__v0.3.0-beta.1__web-research-fair/data/) |
| 2026-11-03 | `0.2.3-beta.1` | 四种 Agent 配置 × 五档上下文横评 | 72 次 | ✅ 已完成 | [报告](history/2026-11-03__v0.2.3-beta.1__llamacpp-four-arm-matrix/REPORT.md) · [数据](history/2026-11-03__v0.2.3-beta.1__llamacpp-four-arm-matrix/data/) |

## 工具脚本（不属于某次实验）

| 文件 | 用途 |
|---|---|
| [`run.mjs`](run.mjs) | 单次真实开销测量与用例记录（`--overhead` / `--record` / `--summary`） |
| [`token-counter.mjs`](token-counter.mjs) | 固定开销静态估算（`npm run estimate`） |
| [`tokenizer.mjs`](tokenizer.mjs) | 轻量分词估算 |
| [`cases.json`](cases.json) | 标准评测用例定义 |
| [`adapters/`](adapters/) | 基准专用搜索适配器：让无搜索的对组组用同源同范围的方式搜索 |
