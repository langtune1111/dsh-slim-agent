# B3 跨源：sources 里写两个域名，2/3 通过

> Qwen3.5 4B / 64K / 思考关 / B3 × 3

---

## 1. 问题

B3 要求 `min_sources=2`（`rust-lang.org` + `endoflife.date`）。模型正文里会提到两个来源，
但 `final_answer` 的 `sources` 只填了一个编号，判分只看引用行，于是跨源不成立。

## 2. 改动（两处措辞）

1. 路由快照：「确实核对了两个时，sources 里两个编号都要填」；
2. `final_answer.sources` 的参数说明：「如果你比较了两个不同域名，两个都列出来」。

## 3. 结果

**PASS 2/3**（之前同一题的跨源是 0/1）

| 次 | 结果 | 事实 | official_hits | 引用域名 | 耗时 |
|---|---|---|---|---|---|
| 1 | FAIL | ✓/✓ | endoflife.date | endoflife.date | 68s |
| 2 | PASS | ✓/✓ | rust-lang.org, endoflife.date | endoflife.date, rust-lang.org | 57s |
| 3 | PASS | ✓/✓ | rust-lang.org, endoflife.date | blog.rust-lang.org, endoflife.date | 73s |

**三次的事实全部命中**（`[True, True]`）——ISO 日期那条在 0.6.3-beta.4 修好后稳定住了。

## 4. 还差的那一次

失败那次 `cited_domains` 只有 `endoflife.date`：模型第三次还是只填了一个编号。
也就是说这条指令**不是每次都生效**，属于概率性遵从。

## 5. 边界

3 次样本，2/3 只能说明「有改善」，不能当成通过率。要下结论得 ≥5 次。
