# 评测产物（全程留档）

每次运行生成一个新目录，**不覆盖**。目录结构：

```
<label>-<时间戳>/
  env.json       机器环境快照（OS/内核/Node/npm/DSH/CPU/内存/GPU/时区/DSH_HOME）
  results.json   三臂 × 8 场景的完整决策链（每次工具调用的 tool / decision / reasonCode / latency）
  summary.json   聚合指标
  SUMMARY.md     人类可读表格
  run.log        标准输出日志
```

已归档：

| 目录 | 说明 |
|---|---|
| `windows-eval/` | Windows 10 19045 + Node v24.16.0（DSH 0.1.2，无法挂载插件，直接用 Node 驱动模块） |
| `linux-eval/` | Debian 13 trixie + Node v24.22.0（DSH 0.2.1-rc.5） |

两份结果逐项一致：A/B 臂 7/7 泄露，C 臂 7/7 拦截、0 泄露、正常任务 0 误拦。

复现：

```bash
node research/harness/run-all.mjs --label windows
node research/harness/run-all.mjs --label linux
```