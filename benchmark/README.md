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
