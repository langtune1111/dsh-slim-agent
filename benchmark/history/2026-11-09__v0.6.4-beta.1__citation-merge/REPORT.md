# 引用按正文合并：[S0] 也能回填成真实 URL（A1 2/2、D1 2/2）

> Qwen3.5 4B / 64K / 思考关 / A1 ×2、D1 ×2、B3 ×2

---

## 1. 问题

全类别抽样的 8 题里，**A1 事实全对却判 FAIL**：

> [FINAL] Node.js 最新 LTS 是 v26.13.0…这一结论由 Node.js 官网和 endoflife.date 双重验证 [S0][S5]。
> 来源: [S5] https://endoflife.date/nodejs

正文里明明写了 `[S0][S5]`，但 `sources` 数组只填了 `S5`，引用行只剩一个域名。
同样的形态在 B3、D1 上重复出现——**模型说得对，写引用时偷懒**。

## 2. 改动（三处，都是确定性逻辑）

1. 抓正文时把 **`[S0]` 也登记进来源表**（之前它在表里没有条目，展开时被直接丢掉）；
2. `pick()` 改成**按 tag 查表**，不再只按位置（`table[n-1]`）；
3. `final_answer` 里把**正文中出现的 `[Sn]` 一并算作引用来源**，与 `sources` 数组合并去重。

第 3 条不是替模型编引用：它写进正文的编号就是它自己声称用过的来源，
之前的实现只是没把这些编号读出来。

## 3. 结果

**PASS 5/6**

| 题 | 结果 | 事实 | 引用域名 | 耗时 |
|---|---|---|---|---|
| A1 #1 | PASS | ✓/✓ | node.org.cn, nodejs.org | 75s |
| A1 #1 | PASS | ✓/✓ | endoflife.date, nodejs.org | 61s |
| D1 #1 | PASS | ✓ | endoflife.date, node.org.cn, nodejs.org | 128s |
| D1 #1 | PASS | ✓ | nodejs.org | 138s |
| B3 #1 | FAIL | ✓/✓ | rust-lang.org | 41s |
| B3 #1 | PASS | ✓/✓ | blog.rust-lang.org, endoflife.date | 107s |

对照：改动前同一批里 **A1 1 FAIL / D1 1 FAIL / B3 1 FAIL（各 1 次）**。

## 4. 还没解决

- **B3 仍有一次 FAIL**：那次只引到 `rust-lang.org`，`endoflife.date` 没进引用——`sources` 欠填是概率性的，
  正文合并只能补"写了编号却没填数组"的情况，补不了"压根没写编号"；
- **A3**（llama.cpp）检索到的还是百科/知乎，没有落到 GitHub releases，事实全错。

## 5. 边界

6 次样本。A1、D1 各自 2/2 只能说「机制通了」，要谈通过率得跑全量。
