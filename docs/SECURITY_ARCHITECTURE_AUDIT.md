# 安全架构审计（阶段 0）

> 审计对象：`dsh-slim-agent@0.5.1-beta.1`（DSH 0.2.1-rc.5）
> 审计方式：通读源码 + 在 Debian 测试机实测 DSH 扩展点行为
> 分支：`feature/agent-security-guard`（从 `7031510` 拉出，工作区 clean）

---

## 0. 一句话结论

DSH 宿主已经提供了**文件系统层面的沙箱与审批**，`dsh-slim-agent` 提供了**工具白名单与预算**。
两者都**没有**解决本项目的核心命题：

> 当模型已经被外部内容说服、主动提出危险工具调用时，谁能拦住它？

现有实现回答不了：白名单看的是「有没有这个工具」，而不是「这次调用该不该发生」；
子代理甚至直接跳过白名单（见 C1）。因此新项目要做的是**执行层的授权与数据流治理**，
而不是再写一遍沙箱。

---

## A. DSH 宿主原生提供的能力（复用，不重写）

| 能力 | 载体 | 边界与说明 |
|---|---|---|
| 文件沙箱 | `@deepseek-ai/dsh-sandbox`、`dsh-sandbox-policy` | 三档 `read-only / workspace-write / danger-full-access`；**边界 = 会话 cwd**；`workspaceRoot` 仅兜底无 cwd 的会话 |
| 文件系统收敛 | `@deepseek-ai/dsh-fs-sandbox` | 对 fs 类工具做 containment，越界写入被宿主拦 |
| 权限预设 | `@deepseek-ai/dsh-permission-presets` | 预设 = 沙箱档位 + 审批策略；`custom`/`auto` 为保留名 |
| 审批 | `@deepseek-ai/dsh-user-approval`、approval gate | 支持 `ask → allowed-once`，审批结果可审计 |
| 工具执行钩子 | `@deepseek-ai/dsh-tools` | `tools/pre-execute`（可 `allow/deny/cancel/ask`）、`tools/execute`（环绕）、`tools/post-execute`（`accept/block` + `additionalContexts`）、`tools/result`（只读观察） |
| 会话事件 | `@deepseek-ai/dsh-session` | `session/event`（post-commit 观察）、`session/disposed` |
| 子代理 | `@deepseek-ai/dsh-subagent` | `startActivation`，子会话 header 带 `origin: 'subagent'`、`delegationDepth` |
| 提示词装配 | `@deepseek-ai/dsh-system-prompt` | `system-prompt/assemble` waterfall，可增减 `sections/tools` |

**注意（避免把宿主能力包装成创新）**：项目文档与 PPT 中，上述能力一律表述为"复用宿主能力"，
本项目的创新点只在 C/D 两节。

---

## B. 当前 `dsh-slim-agent` 已实现的安全相关能力

| 项 | 位置 | 说明 |
|---|---|---|
| 主代理工具白名单（装配期） | `preset-core.mjs:900-928` | `assemble` 钩子里按 `allow` 集合过滤工具；异常时 `withoutTools()` **fail-closed**（`:888-898`） |
| 主代理工具白名单（执行期） | `preset-core.mjs:937+` | `tools/pre-execute` 兜住"中途动态注册"的越界工具（注释记录：实测工具数从 6 变 8） |
| 调用预算 | `maxToolCalls` / `maxSearches` / `convergeMode` | 控制"用量"，**不控制"该不该"** |
| 审计 | `auditFile`（默认 `~/.dsh/slim-agent-audit.jsonl`） | 记录 converge / budget / final_answer 等事件；无统一决策模型 |
| bash 沙箱依赖 | `preset-core.mjs:517,548` | 通过 `ctx.subprocess.spawn` 走宿主沙箱；`bash: 'local'` 时才允许非沙箱执行 |
| 子代理 | `preset-core.mjs:820-886` | `startActivation({ provider:'spawn', maxDepth:1 })`，靠**提示词**约束子代理（软约束） |

---

## C. 当前项目缺失的安全能力（本项目的靶子）

### C1（严重）子代理完全绕过主代理白名单

`preset-core.mjs:910-911`：

```js
const isChild = header !== undefined && (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0)
if (isChild) return assembled          // 装配期：子代理不做任何过滤
```

`preset-core.mjs:941`：

```js
if (isChild) return next()             // 执行期：子代理直接放行
```

**后果**：主代理被限制在 5 个工具，但一次 `subagent` 调用就能拿到宿主给出的全部工具面；
子代理继承的 `cwd` 与主代理相同，因此文件边界也相同。这条路径在现有实现里**没有任何策略约束**。

### C2 没有"内容来源"概念

`web_search` / `web_fetch` / 外部文件的内容进入上下文时，只有引用编号（`[S1]`），
没有"这是外部数据、不具备指令权限"的结构化标记。模型无法区分指令与数据，
系统也无法在审计里回答"这次危险调用是被哪个外部来源诱导的"。

### C3 没有跨工具数据流控制

`read` 一个文件、`bash` 里 `curl` 一次上传——两者单独看都在白名单内。
现有实现不追踪"读到的内容"是否出现在"外发参数"里，因此**组合式泄露不可见**。

### C4 权限是"预设级"的，不是"任务级"的

工具集合在预设里固定，一旦授予就贯穿整个会话与所有任务；
没有"这个任务只允许读 A 目录、不允许联网"的表达能力，也没有有效期与委派规则。

### C5 没有安全评测口径

`benchmark/` 测的是**任务完成度**（PASS/FAIL/超时），不测攻击、不区分
"模型自己拒绝" 与 "中间件拦截"。用它来宣称安全效果会得出错误结论。

### C6 审计不可用于安全追责

现有审计记录的是收敛/预算事件，缺少：调用决策、拒绝原因码、污点来源、参数摘要。
且没有脱敏约定（谁写日志、写哪些字段），存在把敏感内容写进日志的风险。

---

## D. 新项目真正需要新增的能力（Security Guard）

| 编号 | 能力 | 为什么现有机制替代不了 |
|---|---|---|
| D1 | **统一执行闸门 + 确定性策略引擎** | 白名单只回答"工具是否存在"；闸门回答"这次调用是否被授权"，且判定不依赖模型 |
| D2 | **任务级能力授权（Task-bound Capability）** | 预设级权限无法表达"本任务不允许联网"；也无法限制路径、次数、有效期 |
| D3 | **子代理权限收敛** | 直接修补 C1：子授权 = 父授权 ∩ 可委派集合，默认降级网络与 shell |
| D4 | **信任来源追踪（Trust Provenance）** | 修补 C2：外部内容打标、不获指令权限、可在审计里回溯影响链 |
| D5 | **跨工具数据流管控（Data Flow Guard）** | 修补 C3：敏感内容登记污点，外发参数命中即拒 |
| D6 | **可归因的安全评测** | 修补 C5：三臂对照 + `model_refused / guard_blocked / executed` 三分类 |
| D7 | **脱敏审计** | 修补 C6：只写哈希与长度，决策链完整可解释 |

**明确不做**（避免与宿主重复或过度承诺）：

- 不实现文件沙箱、不实现审批流（复用 DSH）
- 不做语义级"这句话是不是注入"的判定（MVP 只做来源标记与降权）
- 不宣称正则能识别一切敏感信息
- 不宣称能拦住一切外发（无内核级网络隔离，见 `THREAT_MODEL.md` 的残余风险）

---

## E. 落地约束（来自实测）

1. `tools/pre-execute` 的 `exec` 只保证 `{ callId, name, arguments, agent, parent, signal }`；
   `exec.agent` **可能为空**（早期预算实现踩过），因此 fallback 必须存在。
2. `exec.agent.session.header` 提供 `id / cwd / origin / delegationDepth`——任务级授权的分桶键用 `session.id`。
3. `tools/post-execute` 可用 `additionalContexts` 把上下文送进下一轮；是否真正送达需在阶段 1 用探针验证，失败则降级。
4. 子代理的 `startActivation` **不能**直接指定工具子集（`agentPreset` 需 provider 具备该能力），
   因此子代理隔离只能在调用层做（这正是 D3 的设计前提）。
5. 现有 36 项测试必须保持全绿，Guard 以独立插件挂载，不改 `preset-core.mjs` 逻辑。

---

## F. 下一步

阶段 1 实现 D1 的最小闭环：策略引擎 + 任务授权 + 脱敏审计 + 单测。
