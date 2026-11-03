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
| 2026-11-04 | `0.3.0-alpha.2` | 联网研究能力专项（7 arm × 15 题） | 180 次 | ✅ 已完成（根 README 当前指向此报告） | [报告](history/2026-11-03__v0.3.0-alpha.1__web-research/REPORT.md) · [方案](history/2026-11-03__v0.3.0-alpha.1__web-research/PLAN.md) |
| 2026-11-03 | `0.2.3-beta.1` | 四种 Agent 配置 × 五档上下文横评 | 72 次 | ✅ 已完成 | [报告](history/2026-11-03__v0.2.3-beta.1__llamacpp-four-arm-matrix/REPORT.md) · [数据](history/2026-11-03__v0.2.3-beta.1__llamacpp-four-arm-matrix/data/) |

## 工具脚本（不属于某次实验）

| 文件 | 用途 |
|---|---|
| [`run.mjs`](run.mjs) | 单次真实开销测量与用例记录（`--overhead` / `--record` / `--summary`） |
| [`token-counter.mjs`](token-counter.mjs) | 固定开销静态估算（`npm run estimate`） |
| [`tokenizer.mjs`](tokenizer.mjs) | 轻量分词估算 |
| [`cases.json`](cases.json) | 标准评测用例定义 |
