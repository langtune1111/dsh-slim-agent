# ISSUE DRAFT — `clampMaxTokensToContext` reserves a hard-coded 4096 tokens, so any model with `contextWindow <= 4096` always receives `max_tokens: 1`

> 投递说明：这是给 `deepseek-ai/deepseek-harness` 的 issue 草稿，可直接复制到 GitHub。
> 证据来自 2026-11-03 的本地实测，环境见下方 Environment。

**Title**

`clampMaxTokensToContext` silently clamps `max_tokens` to 1 for any model with a small context window (hard-coded 4096-token reserve)

**Summary**

`@earendil-works/pi-ai`'s `clampMaxTokensToContext()` subtracts a hard-coded
`CONTEXT_SAFETY_TOKENS = 4096` from the model's context window before deciding the output budget.
For any model configured with `contextWindow <= 4096` the subtraction goes non-positive, and the
result is silently floored to `MIN_MAX_TOKENS = 1`. The request still succeeds (`HTTP 200`), the
model emits a single token, `finish_reason` becomes `length`, and no error or warning is surfaced
anywhere. Callers cannot distinguish "the model finished" from "the framework gave it one token to
work with".

**Environment**

| item | value |
|---|---|
| DSH | `0.2.1-rc.5` (Debian 13, Node v24.22.0) |
| Model API | custom OpenAI-compatible route via `@deepseek-ai/dsh-llm-pi-ai` |
| Model | local GGUF served by llama.cpp `b12066` (`gpt-oss`-style `/v1/chat/completions`) |
| Route config | `contextWindow: 4096`, `maxTokens: 512` |
| Entry point | `dsh --profile headless --patch <overlay> "<task>"` |

**Root cause**

`@earendil-works/pi-ai/dist/api/simple-options.js`:

```js
const CONTEXT_SAFETY_TOKENS = 4096;
const MIN_MAX_TOKENS = 1;

export function clampMaxTokensToContext(model, context, maxTokens) {
    if (model.contextWindow <= 0)
        return Math.max(MIN_MAX_TOKENS, maxTokens);
    const available = model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;
    return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, available));
}
```

and `@earendil-works/pi-ai/dist/utils/estimate.js` uses a character heuristic:

```js
const CHARS_PER_TOKEN = 3.5;
export function estimateTextTokens(text) { return Math.ceil(text.length / CHARS_PER_TOKEN); }
```

Two independent problems compound here:

1. **The reserve is absolute, not proportional.** A fixed 4096 tokens is larger than the whole
   window of a 4K model. Any `contextWindow <= 4096 + prompt_tokens` degenerates to `max_tokens = 1`.
2. **The estimator over-counts tool-heavy prompts.** `chars / 3.5` ignores the tokenizer and is
   applied to the JSON of every tool schema. In our measurements the framework estimated ~1880
   prompt tokens where the real tokenizer reported 1289 (+46%).

**Measured evidence** (all numbers are the literal `max_tokens` sent on the wire, captured by a
recording proxy in front of the model server):

| configured `contextWindow` | configured `maxTokens` | real `prompt_tokens` | `max_tokens` sent | `finish_reason` |
|---|---|---|---|---|
| 2048 | 1024 | 1289 | **1** | `length` |
| 4096 | 2048 | 1289 | **1** | `length` |
| 4096 | 512 | 1203 | **1** | `length` |
| 8192 | 4096 | 1289 | 2216 | `stop` |
| 65536 | 4096 | 1289 | 4096 | `stop` |

The 8192 row is the tell: `8192 - 1880ish - 4096 = 2216`, i.e. the observed value is exactly the
formula with the estimator error included.

**Impact**

* Every model route with `contextWindow <= 4096` is effectively unusable for agentic work, and it
  fails silently — a 4K route still reports `finish_reason: length` with a one-token answer, which
  most harnesses will record as a model failure rather than a configuration floor.
* Because the reserve does not scale, a 4K model can never be tested at its advertised window.
* Benchmark results collected this way are misleading (we initially attributed the failure to the
  model before locating this code path).

**Suggested fixes (any of these removes the failure mode)**

1. Scale the reserve with the window, e.g. `Math.min(4096, Math.max(512, model.contextWindow * 0.25))`.
2. Expose the reserve as configuration (`contextSafetyTokens`) instead of a module constant.
3. When `available < some minimum` (e.g. 256), fail loudly with a typed error
   (`CONTEXT_WINDOW_TOO_SMALL`) rather than silently sending `max_tokens: 1`.
4. Prefer the authoritative `usage` from the previous assistant message
   (`calculateContextTokens(usage)`, already implemented in the same package) over the
   character heuristic whenever it is available for the session.

**Reproduction**

```yaml
# overlay.patch.yml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      local:
        apiKeyEnv: LOCAL_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:8099/v1
        models:
          - id: local-model
            name: local
            contextWindow: 4096
            maxTokens: 512
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: local
    model: local-model
```

```bash
LOCAL_KEY=x dsh --profile headless --patch overlay.patch.yml "Reply with the single word OK"
# observe the outgoing request body: max_tokens == 1
```

Any logging proxy in front of the model server is enough; no special tooling required.

---

## 中文摘要（供本仓库读者）

`pi-ai` 的 `clampMaxTokensToContext()` 在算输出预算时固定扣掉 4096 tokens：

```js
const CONTEXT_SAFETY_TOKENS = 4096;
const available = model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;
return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, available));
```

于是 `contextWindow ≤ 4096` 的模型永远只剩下 `maxTokens = 1`，请求照样 200、
`finish_reason` 是 `length`、模型只吐一个 token，**全程没有任何报错或警告**。

叠加第二个问题：`estimateContextTokens` 用 `chars / 3.5` 估算，还把所有工具 schema 的 JSON
都按这个比例折算，实测高估约 46%（估 1880、真实 1289）。

这不是"小模型不行"，而是**框架在下发请求前就把输出预算抹平了**。

建议：把 4096 改成随窗口缩放 / 暴露为配置 / 剩余预算不足时抛 `CONTEXT_WINDOW_TOO_SMALL`，
以及优先使用上一轮响应里的权威 `usage` 而不是字符启发式。
