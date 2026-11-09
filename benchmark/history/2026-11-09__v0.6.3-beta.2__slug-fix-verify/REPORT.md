# 0.6.3-beta.2 实机验证：事实对了，引用没跟上

> Qwen3.5 4B / 64K / 思考关 / 6 题各 1 次

---

## 1. 这一版改了什么

`java` / `docker` 的 slug 指向了 301 和 404 页面（正确是 `oracle-jdk` / `docker-engine`），
并且之前会把 404 页也登记成「第二来源」。两个都修了。

## 2. 结果（6 次单跑）

| 题 | 结果 | 事实命中 | 引用域名 | 耗时 |
|---|---|---|---|---|
| A1 | PASS | ✓/✓ | endoflife.date, nodejs.org | 66s |
| B3 | FAIL | ✓/✗ | endoflife.date | 55s |
| D1 | FAIL | ✓ | （空） | 137s |
| T2 | PASS | ✓ | （空） | 37s |
| A2 | FAIL | ✓/✗ | endoflife.date, www.python.org | 76s |
| B1 | FAIL | ✓/✗ | endoflife.date, golang.smalljerry.cn | 119s |

**PASS 2/6。** 单次样本，不能当趋势用。

## 3. 两个真问题（这次验出来的）

### 3.1 失败点已经从「找不到」挪到「不写引用」

- **D1**：事实全对（`facts_ok [True]`），正文把 v24.11.0 和 v26.13.0 都分析对了，
  但 `cited_domains` 是**空的**。原因不是"写错引用"，是 **`calls` 里根本没有 `final_answer`**
  （`['read','web_search']` 就结束了）——模型直接用散文收尾，绕过了那个会自动回填来源的工具。
  对比 A1/B3/A2 的 `calls` 都以 `final_answer` 结尾，`final` 也带 `[FINAL]` 前缀。
- **B3**：答案对（1.99.1 / 2026-10-15），推理里明明引了 `[S0] blog.rust-lang.org`，
  但最终只把 `[S5] endoflife.date` 写进了来源，`cited_domains` 只有一个域名，跨源核验不成立。

**说明**：补抓版本页这一步是有效的（A1、B3、A2 都拿到了 `endoflife.date`）。
现在的瓶颈分成两半：**一半是绕过了 `final_answer`（D1）**，
**一半是进了 `final_answer` 但只填一个编号（B3）**。

### 3.3 重复检索
B1 的 `calls` 是 `['web_search','web_search','web_search','web_search','final_answer']`——
同一类查询连搜四次，`agent_requests` 到 5，这是它 137 s 之外另一个耗时来源。

### 3.2 镜像站被当成官网

B1（Go）引了 `golang.smalljerry.cn` 并称其为「Go 官网」——那是一个镜像站。
搜索后端给出的就是这种域名，模型无法分辨。

## 4. 下一步（写进 NEXT.md）

1. **强制引用**：`final_answer` 的 answer 里必须出现至少一个 `[Sn]`，
   没出现就把已登记来源追加成「参考来源：…」而不是让判分归零；
2. **官方域名收敛**：把 `golang.smalljerry.cn` 这类镜像从「官方」降级，只在正文里当普通来源；
3. 这两条都要**先加样本**（每题 ≥3 次）再下结论，本次 6 次单跑只够发现现象。

## 5. 边界

- 6 次单跑，抖动大（同一 build 全量两次可差 3 个 PASS），不能据此判断版本好坏；
- A2 的标准答案本身存疑（见 NEXT.md P1），这次它又被判失败，但模型给出的日期是「未证实」——
  这其实是**正确的谨慎**，是判分口径的问题。
