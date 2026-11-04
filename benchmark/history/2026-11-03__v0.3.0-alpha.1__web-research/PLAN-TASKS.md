# 其余题目的实验计划（PLAN-TASKS，未执行）

> 状态：**方案，尚未跑任何一次。**
> 基线：`dsh-slim-agent 0.3.0-beta.1`
> 前置：先做 [PLAN-CITATION.md](PLAN-CITATION.md)（引用约束实验），再做本方案。

---

## 0. 前提：对照组已经有搜索了

上一轮 A/B/G 三个对照组没有搜索工具，导致"A/B/G 全灭"不能用来评价架构。
本方案**一律采用修好公平性之后的设置**：

| arm | 搜索来源 | 适配器 |
|---|---|---|
| A 极简 | DSH 自己的 `web_search` | [adapters/dsh-bench-search.mjs](../../adapters/dsh-bench-search.mjs) |
| B 标准 | 同上 | 同上 |
| C slim 无子代理 | slim 内置 `web_search` | 产品自身 |
| D slim 完整 | 同上 | 产品自身 |
| G pi | pi 扩展注册的 `web_search` | [adapters/pi-bench-search.mjs](../../adapters/pi-bench-search.mjs) |

四路共享 [`adapters/search-core.mjs`](../../adapters/search-core.mjs)：同端点、同条数、同输出模板。
对照组与 slim 的剩余差异见 [adapters/README.md](../../adapters/README.md)。

**F arm 已按你的决定移除**（`task_complete` 的影响上一轮已有结论）。

---

## 1. 六道未跑的主线题

每题 **5 arm × 2 模型 × 2 重复 = 20 次**，共 **120 次 ≈ 3.5 h**，上下文 65536。

| 题 | 它在考什么 | 需要的官方来源 | 强化判据 | 预期失败模式 |
|---|---|---|---|---|
| **A3** | llama.cpp 最新正式 release tag 与发布日 | `github.com` releases 页 | tag 与日期都要精确；只答 tag 不给日期判 FAIL | `NO_SEARCH` / `STALE_SOURCE` |
| **B2** | PostgreSQL 当前最新主版本 + 该主版本下最新小版本 | `postgresql.org` 两个页面 | 必须同时给出主版本与小版本；只给一个判 FAIL | `SEARCH_OK_NO_UNDERSTANDING` |
| **C2** | Rust 最新稳定版比 Go 最新稳定版晚发布多少天 | `rust-lang.org` + `go.dev` | 两个日期都要出现，且天数差必须正确 | `MULTISOURCE_WRONG` |
| **C3** | Python 最新稳定版与 PostgreSQL 最新小版本，发布日相差几个月（向下取整） | `python.org` + `postgresql.org` | 必须展示两个日期与取整过程 | `MULTISOURCE_WRONG` / 计算错误 |
| **D2** | 读本地 `fixtures/D2.md` 的 Python 约束，联网确认最新稳定版，判断约束是否需要调整 | `python.org` | 必须同时出现 `read` 与 `web_search` 调用 | `NO_SEARCH` / 未读本地 |
| **D3** | 读本地 `fixtures/D3.md` 的 Rust 版本，联网确认最新，指出落后多少版本线 | `rust-lang.org` | 必须算出 1.75 → 当前版本的版本线差距 | 计算错误 / 未读本地 |

**为什么这六道值得补**：A3 补 A 类到 3 题；B2 补 B 类到 2 题；C2/C3 补 C 类到 3 题；
D2/D3 补 D 类到 3 题。补齐后四类任务各有 2–3 题，分类通过率才有意义。

---

## 2. 三道超纲题

每题 **5 arm × 2 模型 × 1 重复 = 10 次**，共 **30 次 ≈ 1 h**。

超纲题的目的是**标出能力天花板**，不是比高低。**即使 0/30 也是有效结果。**

| 题 | 为什么超纲 | 观察点 | 期望失败类型 |
|---|---|---|---|
| **X1** | 需同时读 Node 官方 release schedule 与 endoflife.date，判断 v26 维护结束时间并比对两源 | 模型会不会把两个来源的日期混为一谈 | `MULTISOURCE_WRONG` |
| **X2** | 需把「>=3.14 且 <3.16」与「必须支持到 2031」两个条件同时代入 EOL 表判断可行性 | 会不会只答"可行/不可行"却不给 EOL 依据 | `CITATION_UNSUPPORTED` |
| **X3** | 需读 changelog 找 breaking change，并判断对 OpenAI 兼容接口的影响 | 会不会直接编造变更条目 | `FAKE_CITATION` |

三道题**单独成表**，不计入任何主通过率。

---

## 3. 4K 块（前置条件未满足，默认不做）

| 项 | 内容 |
|---|---|
| 规模 | 2 题（A1、D1）× 3 arm（A/E/G）× 2 模型 × 1 重复 = **12 次 ≈ 0.5 h** |
| 前置 | `pi-ai` 的 `CONTEXT_SAFETY_TOKENS = 4096` 必须被绕过或修复，否则 100% `BUDGET_INVALID` |
| 决定 | **默认不做**，等 [ISSUE-dsh-context-budget.md](ISSUE-dsh-context-budget.md) 有回应 |

---

## 4. 汇总

| 包 | 内容 | 运行数 | 预估 |
|---|---|---|---|
| 引用实验（先行） | 见 PLAN-CITATION | 80 | 2.3 h |
| 本方案 · 主线六题 | A3 B2 C2 C3 D2 D3 | 120 | 3.5 h |
| 本方案 · 超纲三题 | X1 X2 X3 | 30 | 1.0 h |
| 本方案 · 4K 块 | 默认不做 | (12) | (0.5 h) |
| **合计（不含 4K）** | | **230** | **≈ 6.8 h** |

---

## 5. 验收口径

1. 每题必须有 **2 次重复**，且两次结果都记录（不做多数票，只做如实分布）。
2. 若某题 5 个 arm 全部 FAIL，需附**至少 2 条失败样例原文**，不能只给数字。
3. `BUDGET_INVALID` 与 `TIMEOUT` 分开统计，不并入 FAIL 的分子或分母。
4. 超纲题单独成表，**即使全 0 也照写**。
5. 任何 arm 出现 `host` / `deepseek` 引擎 → 该 arm 数据作废。

---

## 6. 待定

1. 执行顺序：引用实验跑完再决定是否继续，还是要一次排完 230 次？（建议前者：引用实验可能直接改变结论方向）
2. 是否需要给 `fixtures/` 再加 D2/D3 的"干扰项"（例如文件里同时写两个版本号）？默认不加，保持简单。
3. 报告归属：本方案单独出一份 `REPORT-TASKS.md`，还是并入现有 REPORT 的续篇？
