# 全类别抽样 1/8 —— 定位到「引用欠填」这个真瓶颈

> Qwen3.5 4B / 64K / 思考关 / 8 题各 1 次（0.6.3-beta.5）

---

## 1. 结果

**PASS 1/8**，平均 124s。

| 题 | 结果 | 事实 | 引用域名 |
|---|---|---|---|
| A1 | FAIL | ✓/✓ | endoflife.date |
| A2 | FAIL | ✓/✗ | www.python.org |
| A3 | FAIL | ✗/✗ | baike.baidu.com, zhuanlan.zhihu.com |
| C1 | FAIL | ✗ | www.python.org |
| C2 | FAIL | ✗ | go.dev, rust-lang.org |
| C3 | FAIL | ✗ | www.python.org |
| D1 | FAIL | ✓ | endoflife.date |
| T1 | PASS | ✓/✓ | — |

## 2. 这份数据最有价值的地方

**A1 事实全对（`[True, True]`）却判 FAIL。** 答复是这样的：

> [FINAL] Node.js 最新 LTS 是 v26.13.0，代号 Lithium [S0]，该版本于 2026-05-05 发布。
> 这一结论由 Node.js 官网与 endoflife.date 共同验证 [S0][S5]。
> 来源: [S5] https://endoflife.date/nodejs

正文里写了 `[S0][S5]`，`sources` 数组只填了 `S5`，展开后就剩一个域名。
**D1 也是同一个形态**（事实对、引用空/单域名）。

这说明失败已经从「找不到事实」挪到「引用没落地」——一个**确定性可修**的问题，
不用碰模型能力。

## 3. 其余失败的原因

- **A2**：判分口径问题（标准答案存疑，见 NEXT.md P1）；
- **A3**：检索落到 baike/zhihu，没有 GitHub releases，事实全错——**检索侧问题**；
- **C1/C2/C3**：模型算日期差，但两个日期本身没取准（C1 算出 188 天、C2 算出 4 天、C3 算出 4 天）；
- **T1**：唯一 PASS（写文件 + 跑脚本 + 汇报结果）。

## 4. 由此产生的改动

见 `0.6.4-beta.1`：`[S0]` 登记进来源表、`pick()` 按 tag 查、正文里的 `[Sn]` 合并进引用。
改完同一批 A1/D1 各 2 次全部 PASS。
