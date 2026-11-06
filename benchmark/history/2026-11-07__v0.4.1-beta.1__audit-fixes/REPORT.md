# 0.4.0-beta.1 审计报告与修复（0.4.1-beta.1）

> 审计对象：`0.4.0-beta.1`　审计方式：逐文件读代码 + 在 Debian 测试机复现
> 回归验证：[`data/runs.ndjson`](data/runs.ndjson)（LFM3 / 64K / 思考关 / 3 题 x 2 轮 = 6 次）

---

## 1. 审计发现的四个真实缺陷

### D1（严重）预算按工作目录分桶，桌面端会串会话且永不重置

0.4.0 用 `header.cwd ?? process.cwd()` 作为计数键。在桌面端，同一个工作区下的**所有会话共用一把计数**，
而且 `Map` 在进程生命周期内**从不清理**：用户在第 3 个会话里搜了 5 次，前面两个会话也会一起被判成「预算用尽」。

**修复**：改为优先用 `session.id`（`sid:`），取不到再退回 `cwd:`；并监听 `session/event`，
在 `turn/start` 时清掉该会话计数——预算语义从「进程生命周期」变成「每一轮」。

### D2（严重）被拒绝的工具调用也会烧掉 hardCap 预算

`pre-execute` 里先 `bumpCallBudget()` 再判白名单/收敛。模型反复调用一个不在白名单里的工具时，
计数照样涨，会提前触发收敛，把还没用的额度耗光。

**修复**：只对**真正放行**的调用计数（白名单判定之后才 `bump`）。

### D3（严重）关掉 `final_answer` 会退化成空工具面

`convergeFinalOnly && enableFinalAnswer` 为假时，收敛返回 `tools: []`。
而实测已经证明：**工具面为空时 1.7B 会把 `<tool_call>` 当文本吐出来**，产出不可用。

**修复**：`enableFinalAnswer=false` 时**根本不收敛**（`canConverge`）。没有出口就不掐断。

### D4（中等）预设被注册两次

`install()` 往 `~/.dsh/cordis.patch.yml` 写托管块，`apply()` 又在运行时注册同一个 id，
两边同时生效就抛 `Duplicate agent preset: local-slim-agent`（桌面端与 web profile 都复现过）。

**修复**：`install()` 返回 `created` 标记；**只有「这一轮刚写盘、本次启动还没生效」时才做运行时注册**。

### D5（轻微）收敛审计写了两条重复记录

`assemble` 里先记一条 `tools-cleared`、再记一条 `final-only`，且第一条的 action 名称是错的。已合并成一条。

## 2. 回归验证

| 指标 | 0.4.0-beta.1 | 0.4.1-beta.1（本次） |
|---|---|---|
| 调用 `final_answer` | 12/12 | **6/6** |
| 真实自然语言答复 | 12/12 | **6/6** |
| 答复混入工具标记 | 0/12 | **0/6** |
| TIMEOUT | 0/12 | **0/6** |

行为没有回退；改动集中在计数作用域与去重上。

## 3. 单测

35 项通过（新增 3 项收敛语义测试，改写 2 项）：

- `budget` 超限后只剩 `final_answer`
- `hardCap` 达上限后普通工具被拒、`final_answer` 仍放行
- `enableFinalAnswer=false` 时不收敛，工具面保持白名单

## 4. 仍未解决

1. **事实准确率低**：6 次里 0 次命中要求事实，模型倾向写「未证实」。
2. **引用几乎不出现**：即便 `final_answer` 有 `sources` 参数，模型多为空数组。
3. 这两点属于模型能力，不是这轮修的功能缺陷。
