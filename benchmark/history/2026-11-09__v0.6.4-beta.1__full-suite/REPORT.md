# 全量 18 题：7 PASS（D 类 3/3，B3 通过）

> Qwen3.5 4B / 64K / 思考关 / 18 题各 1 次 / 0.6.4-beta.1

---

## 1. 总成绩

**PASS 7/18**，平均 118s。

| 类别 | 通过 |
|---|---|
| A | 1/3 |
| B | 1/3 |
| C | 0/3 |
| D | 3/3 |
| T | 2/2 |
| X | 0/4 |

对照 0.6.2 的 36 次全量（每题 2 次）：11–14/36，折合每 18 题 5.5–7 次通过。
本次 7/18 处在那个区间上沿，**单次样本还分不出真实差异**。

## 2. 逐题

| 题 | 结果 | 事实 | 引用域名 | 耗时 |
|---|---|---|---|---|
| A1 | PASS | ✓/✓ | node.org.cn, nodejs.org | 100s |
| A2 | FAIL | ✓/✗ | endoflife.date, www.python.org | 93s |
| A3 | FAIL | ✗/✗ | baike.baidu.com, zhuanlan.zhihu.com | 177s |
| B1 | FAIL | ✓/✗ | endoflife.date, go.dev | 160s |
| B2 | FAIL | ✗/✗ | endoflife.date, www.postgresql.org | 102s |
| B3 | PASS | ✓/✓ | blog.rust-lang.org, endoflife.date, rust-lang.org | 74s |
| C1 | FAIL | ✗ | www.python.org | 149s |
| C2 | FAIL | ✗ | baike.baidu.com, endoflife.date | 114s |
| C3 | FAIL | ✗ | www.postgresql.org | 161s |
| D1 | PASS | ✓ | endoflife.date, nodejs.org | 95s |
| D2 | PASS | ✓ | endoflife.date, www.python.org | 66s |
| D3 | PASS | ✓ | endoflife.date, rust-lang.org | 78s |
| T1 | PASS | ✓/✓ | — | 137s |
| T2 | PASS | ✓ | — | 44s |
| X1 | FAIL | ✓ | baike.baidu.com, endoflife.date | 137s |
| X2 | TIMEOUT | ✗ | — | 200s |
| X3 | FAIL | ✗ | www.launchnotes.com, zhuanlan.zhihu.com | 126s |
| X4 | FAIL | ✓/✗ | — | 102s |

## 3. 值得注意的三件事

1. **D 类 3/3 全过**（本地文件 + 网络结合），这是今天第一次整类全绿；
2. **B3 通过**（`rust-lang.org` + `endoflife.date` 都进引用），说明引用合并+跨源提示组合有效；
3. **C 类 0/3 全灭**，而且 C2 的引用里出现 `baike.baidu.com`——两个产品的日期根本没同时拿到。

## 4. 下一步

C 类要的是「两个产品的发布日期」，一次搜索只覆盖一个产品。
已实现：按查询里的产品名，把**各自的官方版本页**都抓一遍（nodejs/python/rust/go），
见 0.6.4-beta.2。
