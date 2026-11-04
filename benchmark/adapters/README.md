# 搜索适配器（benchmark 专用）

这三个文件**只服务于基准测试**，不进入 `dsh-slim-agent` 安装包，也不改变产品行为。
它们存在的唯一理由：让没有搜索工具的对组组也能靠自己那一侧的机制搜索，
从而把「架构差异」和「有没有搜索」这两个变量分开。

## 文件

| 文件 | 作用 |
|---|---|
| `search-core.mjs` | 共享后端：Bing 端点 + 解析 + 输出模板 + `classifySource` / `guessYear` |
| `dsh-bench-search.mjs` | DSH host 插件，用 `ctx.tools.register` 注册 `web_search`（供极简 / 标准 arm） |
| `pi-bench-search.mjs` | pi 扩展，用 `pi.registerTool` 注册同名同格式工具（供 pi arm） |

## 对齐了什么

| 维度 | 取值 | 依据 |
|---|---|---|
| 端点 | `https://www.bing.com/search?q=...&setlang=zh-CN` | 抄自 `preset-core.mjs` 的 `searchBing` |
| User-Agent | Chrome 120 desktop | 同上 |
| `Accept-Language` | `zh-CN,zh;q=0.9,en;q=0.8` | 同上 |
| 结果条数 | 4 | slim 的 `maxResults` 默认值 |
| 输出模板 | `序号. [标签] [标题](URL)(年份) — 摘要` + 末尾提示行 | 抄自 slim 的 `web_search.execute` |
| 标签 / 年份启发式 | `classifySource` / `guessYear` | **逐字复制** |
| 工具描述与 schema | `TOOL_DESCRIPTION` / `TOOL_PARAMETERS` | 逐字复制 |

## 没对齐的（必须写进报告，不能当误差藏）

1. **slim 有三段降级链**（DuckDuckGo → Bing → Wikipedia），适配器**只有 Bing**。
   本机网络下 DDG 与 Wikipedia 均不可达，因此实测中 slim 实际也全部落在 Bing 分支——
   这条差异在本次环境里不产生行为差别，但在能上 DDG 的网络里会有。
2. **slim 的搜索代码内置在 `preset-core.mjs` 里**，不可能与 `search-core.mjs` 逐字节相同。
   我们保证的是"同端点 + 同条数 + 同模板 + 同启发式"，不是"同一份字节"。
3. **slim 多了 `[线索] ... via <engine>` 里的引擎名**；适配器固定写 `bing`。
4. 适配器不参与 slim 的 `searchEngine` 配置（`auto`/`builtin`/`host`），它是独立工具。

## 用法

```yaml
# DSH arm（极简 / 标准）的 patch 片段
- insert:
    - id: bench-web-search
      name: 'file:///root/dsh-bench/adapters/dsh-bench-search.mjs'
```

```bash
# pi arm
pi --extension /root/dsh-bench/adapters/pi-bench-search.mjs ...
```

## 校验

```bash
node --check search-core.mjs
node --check dsh-bench-search.mjs
node --check pi-bench-search.mjs
node -e "import('./search-core.mjs').then(m=>m.bingSearch('nodejs latest LTS').then(r=>console.log(r.length, r[0])))"
```
