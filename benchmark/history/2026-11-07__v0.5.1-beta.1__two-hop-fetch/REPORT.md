# 顺链抓取：代号也能拿到了（0.5.1-beta.1）

> Qwen3.5 4B / 64K / 思考关 / A1 B3 D1 × 2
> 数据：[`data/runs.ndjson`](data/runs.ndjson)

---

## 1. 上一版差在哪

0.5.0 只抓首条页面。A1 问「代号」，首页只有 `v26.13.0`，没有代号；B3 问发布日期，同样不在首页。

## 2. 这版怎么做

在抓到的页面里找链接，**最多顺两层、最多两次**，优先「previous-releases / release / changelog / archive」这类：

```
nodejs.org  →  /zh-cn/download  →  /zh-cn/about/previous-releases
                                    └─ v26  Lithium  May 2025 ...
```

实测下载页里就有「Node.js 发布 → /zh-cn/about/previous-releases」这条链接，
而那个页面写着 `v26  Lithium  May 05, 2026`。

## 3. 结果

| 指标 | 0.5.0 | 0.5.1 |
|---|---|---|
| PASS | 1/6 | **3/6** |
| 任一事实命中 | 5/6 | **6/6** |
| 全部事实命中 | 1/6 | **3/6** |
| TIMEOUT | 1/6 | 0/6 |

A1 现在的答案：

> Node.js 当前最新的 LTS 版本是 v26.13.0，代号是 Lithium（锂）[S1]。
> 该版本于 2026 年 10 月 28 日发布，标志着 Node.js 26.x 系列…

**这是本次迭代第一次在「实时事实 + 代号」这类题上拿到正确且带引用的答案。**

## 4. 还不稳

- A1 第二次仍说「代号尚未公开」；B3 的发布日期仍缺（Rust 官网结构不同，没顺到发布页）。
- 说明顺链依赖站点结构，通用性有限。下一步应做「按站点模板抽取」，而不是继续加通用启发式。

## 5. 配置

- `fetchFollowLinks`（默认开）：顺链抓取开关
- 最多 2 层、最多 2 次额外抓取，全部走 `isFetchableUrl` 白名单
