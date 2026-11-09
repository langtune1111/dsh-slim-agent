# 强制走 final_answer：D1 从 0 到 1

> Qwen3.5 4B / 64K / 思考关 / D1、B3 各 1 次

---

## 1. 问题

上一轮验证（0.6.3-beta.2）发现 D1 失败的原因不是「引用写错」，
而是 **`calls` 里根本没有 `final_answer`**——模型直接用散文收尾，
那条会自动回填来源的路径压根没跑，`cited_domains` 自然是空的。

## 2. 改动（一行）

路由快照里加一句：

> 结论必须通过 final_answer 提交；直接写正文会被丢弃，等于没回答。

## 3. 结果

| 题 | 改前 | 改后 |
|---|---|---|
| D1 | FAIL，`calls=['read','web_search']`，`cited_domains=[]` | **PASS**，`calls=['read','web_search','final_answer']`，5 个域名 |
| B3 | FAIL，只引 `endoflife.date` | FAIL，但**两个域名都引到了**（`rust-lang.org` + `endoflife.date`） |

D1 的实际答复：

> 当前最新 Node.js LTS 版本为 v26.13.0，代号 Lithium，于 2026-10-28 发布；
> 项目当前锁定的是 v24.11.0（LTS Jod，2025-06-01 发布），v24 LTS 的最新版本是 v24.22.2（2026-10-27 发布）。

## 4. B3 还差什么

跨源这一关**过了**（`official_hits` 同时含 `rust-lang.org` 和 `endoflife.date`），
但 `facts_ok [True, False]`——第二个事实没命中。答案给的是「1.99.1 / 2026-10-15」，
和之前通过那次的文案一致，所以要么判分要的是别的字段，要么措辞没对上。**下一轮先查这个。**

## 5. 边界

- 每题只有 1 次，只能证明「机制通了」，不能当通过率；
- B3 仍然连搜 4 次（`agent_requests` 5），重复检索的问题还在。
