# 最新 Benchmark 报告

本页是仓库对外的**唯一实验入口**。历史实验见 [实验档案索引](README.md)。

---

## 📌 当前进行中

### `0.3.0-alpha.1` · 联网研究能力专项

> 本地小模型到底能不能靠 **agent 自己**上网查资料？

- 7 个 arm（极简 / 标准 / slim 无搜索 / slim 有搜索 / slim 完整 / slim+task_complete / pi）
- 12 道主线题（实时事实 / 多源核验 / 多跳推理 / 本地+联网）+ 3 道超纲题
- **DeepSeek 搜索 API 全程禁用**，网页内容用冻结快照锁死
- 状态：**⏳ 方案定稿，尚未开跑**

→ [实验报告（含全部 15 道题的题目与判据）](history/2026-11-03__v0.3.0-alpha.1__web-research/REPORT.md)
→ [实验方案（arm 定义 / 变量控制 / 计量口径）](history/2026-11-03__v0.3.0-alpha.1__web-research/PLAN.md)
→ [前置 issue：DSH 输出预算被固定扣掉 4096 tokens](history/2026-11-03__v0.3.0-alpha.1__web-research/ISSUE-dsh-context-budget.md)

---

## ✅ 最近一次已完成

### `0.2.3-beta.1` · 四种 Agent 配置 × 五档上下文横评

| 配置 | 工具数 | 首轮固定开销 | 8K 通过率 |
|---|---|---|---|
| slim-agent | 6 | 1,289 / 1,401 tokens | 1/2 |
| DSH 标准 | 24 | 6,073 / 6,186 tokens | 0/2 |
| DSH 极简 | 2 | 895 / 974 tokens | 2/2 |
| pi agent | 4 | 1,441 / 1,567 tokens | 2/2 |

- 72 次受控运行，2K/4K 全灭、8K 是分水岭、256K 取决于模型架构
- 直接产出两处修复：`task_complete` 吞答复（3/3 空答复）、白名单可被中途注册的工具绕过

→ [完整报告](history/2026-11-03__v0.2.3-beta.1__llamacpp-four-arm-matrix/REPORT.md)
→ [原始数据](history/2026-11-03__v0.2.3-beta.1__llamacpp-four-arm-matrix/data/)
