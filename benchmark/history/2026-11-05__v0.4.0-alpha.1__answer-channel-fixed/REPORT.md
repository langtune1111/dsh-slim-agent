# 答复通道打通（0.4.0-alpha.1，2026-11-05）

> 模型 LFM3 1.7B　上下文 65536　思考关　`convergeMode: hardCap` + `final_answer`
> 数据：[`data/finonly.ndjson`](data/finonly.ndjson)（6 次）、[`data/alpha_confirm.ndjson`](data/alpha_confirm.ndjson)（12 次）

---

## 1. 根因：不是提示词问题，是**工具面为空**

用计量代理逐请求比对后发现，泄漏有确定条件：

| 请求的 `tools` 数量 | `finish_reason` | 输出形态 |
|---|---|---|
| ≥1（正常） | `tool_calls` | 结构化工具调用，解析正常 |
| **0（收敛后）** | `stop` | **`<tool_call>…</tool_call>` 当纯文本吐出来** |

也就是说：0.3.2 里出现的「非空答复」全部是「工具面被清空后，模型仍按训练习惯写调用语法」。
llama.cpp 的解析本身没问题——单独测单轮、多轮、截断（`max_tokens=10`）都能正确解析。

## 2. 对策：收敛时不留空白，留**唯一出口**

`convergeFinalOnly`（默认开）：收敛后不是把工具清空，而是**只保留 `final_answer` 一个工具**。
模型只会调用工具，那就让它调用「提交答案」这个工具——结论写进 `answer` 参数，评测侧直接取参数。

## 3. 结果

| 指标 | 改前（0.3.3） | 改后（0.4.0-alpha.1） |
|---|---|---|
| 调用 `final_answer` | 0/6 | **12/12** |
| 真实自然语言答复 | 0/12 | **12/12** |
| 答复里混入工具标记 | 12/12 | **0/12** |
| TIMEOUT | 6/6 | **0/12** |
| 研究题 PASS | 0 | **1** |

### 3.1 两批明细

- **首批 6 次（3 题 x 2 轮）**：final_answer 6/6，真实答复 6/6，任一事实命中 2/6，官方域名 0/6，PASS 0，FAIL 6，TIMEOUT 0
- **确认 12 次（6 题 x 2 轮）**：final_answer 12/12，真实答复 12/12，任一事实命中 2/12，官方域名 1/12，PASS 1，FAIL 11，TIMEOUT 0

## 4. 答案长什么样

现在拿到的是人话，而且会老实说不知道：

> 根据项目文件 D1.md 锁定版本为 Node.js v24.11.0 (LTS Jod) [S3]，但未证实 Node.js 官方最新 LTS 是否为 v26.13.0。

> 未证实。虽然在本地 fixtures 目录中（D3.md）记录 Rust 工具链为 1.75.0 stable，但该文件为项目内部约束台账，
> 并未来自官方发布源；我未通过网络搜索到当前 Rust 稳定版号的官方最新信息，故无法确定。

## 5. 还没解决的

1. **事实命中率仍低**（2/12）：模型倾向于「未证实」，而不是去核实。
2. **引用仍是 1/12**：虽然 `final_answer` 带 `sources` 参数，模型大多填空数组。
3. 12 次里只过了 1 道题，说明「能说人话」离「答对」还有距离。

## 6. 结论

**答复通道已经打通**：从「0 条可读答案」变成「12/12 都是人话，且不再混入工具标记」。
这是本线第一次出现研究题的 PASS。接下来要解决的是事实核验与引用，不再是「说不说话」。

## 7. 复现

```yaml
config:
  convergeMode: hardCap
  hardCap: 8
  enableFinalAnswer: true     # 提供 final_answer
  convergeFinalOnly: true     # 收敛时只留 final_answer
```
