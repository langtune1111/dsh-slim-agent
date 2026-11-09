# A3 打穿：GitHub releases 走 API，2/2

> Qwen3.5 4B / 64K / 思考关 / A3 × 2

---

## 1. 三个发现

1. **这台机器上 node fetch 抓 `github.com` 的 HTML 会超时**（实测 10.7s 失败），curl 却正常；
   而 `api.github.com` 1 秒内就返回。所以网页版不可用，API 可用。
2. **release body 里塞满历史日期**：用正则刮正文会把 `2025-04-05` 当成发布日期。
   必须直接解析 JSON 的 `tag_name` / `published_at` 字段。
3. **A3 的标准答案本身过期了**：数据集要 `0.8.0 / 2026-10-28`（写于 2026-11-03），
   而 2026-11-04 上游已发布 `v0.9.0`。旧答案在任何检索下都拿不到。

## 2. 改动

- 新增 `fetchReleaseJson()`：抓 API、只取 `tag_name` 与 `published_at`；
- 项目型查询（llama.cpp / ollama / vllm）直接补抓对应仓库的 latest release，
  引用 URL 仍给人类可读的 `github.com/.../releases`；
- 数据集 A3 的 `required_facts` 更新为 `v?0\.9\.0` / `2026-11-04`，并写了 `correction` 说明。

## 3. 结果

**PASS 2/2**

> [FINAL] llama.cpp 最新的正式发布版本是 v0.9.0，发布日期是 2026-11-04。此信息来自 llama.cpp 官方 GitHub releases 页面（ggml-org/llama.cpp/releases）。 来源: [S5] https://github.com/ggml-org/ll

> [FINAL] llama.cpp 最新的正式发布版本是 v0.9.0，发布日期是 2026-11-04。该信息来自 llama.cpp 官方发布页 https://github.com/ggml-org/llama.cpp/releases。 来源: [S5] https://github.com/ggml-org/

## 4. 说明：这是「修数据」还是「修能力」

两个都占了，但分开看：

- **修能力**：GitHub 抓取从「网页超时 + 正则刮错日期」变成「API 字段直读」，
  这条换成任何题库都成立；
- **修数据**：A3 的旧答案确实取不到了，和 A2 属于同一类「实时题会过期」的问题。
  数据集里留了 `correction` 字段，不隐藏改动。
