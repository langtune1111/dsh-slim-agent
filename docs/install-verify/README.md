# 安装验证记录（Windows + Debian）

> 验证日期：2026-11-06　插件版本：`dsh-slim-agent@0.4.0-beta.1`

## 结论

| 环境 | DSH 版本 | 安装 | 在「模式」菜单里可选 | 截图 |
|---|---|---|---|---|
| **Debian 13.7** | `0.2.1-rc.5` | ✅ | ✅ | [debian-mode-menu.png](debian-mode-menu.png) |
| **Windows 11** | `0.2.1-rc.5`（隔离安装） | ✅ | ✅ | [windows-mode-menu.png](windows-mode-menu.png) |
| Windows 11 | `0.1.2-rc.1`（机器上原有的全局 CLI） | ⚠️ 装得上但**跑不起来** | ❌ | — |

## 截图里能看到什么

两张图都是 DSH Web 的「新会话 → 模式」下拉菜单，菜单里出现了插件注册的条目：

> **中小模型·轻量知识增强 (8K Slim)**
> 消费级显卡上的 1.7B-8B 本地小模型：8K 上下文下兼具免 Key 联网线索与必要代码工具，主代理 5 工具白名单，子代理并发默认 1。

## 安装命令（两边一致）

```bash
dsh plugin --profile <profile> add ./dsh-slim-agent-0.4.0-beta.1.tgz
# web 形态还需要把 web-app 加进 bundles
dsh plugin --profile <profile> add @deepseek-ai/dsh-web-app@0.2.1-rc.5
```

## 复现步骤

### Debian (0.2.1-rc.5)

```bash
npm i -g pnpm                     # 该机器原本没有 pnpm
dsh plugin --profile slimdeb add /root/slim/slim.tgz
dsh plugin --profile slimdeb add @deepseek-ai/dsh-web-app@0.2.1-rc.5
# package.json 的 dsh.profile.bundles 加入 @deepseek-ai/dsh-web-app
dsh --profile slimdeb --port 9713 --host 192.168.101.244
```

`--host 0.0.0.0` 会被拒绝，必须绑定具体网卡 IP。

### Windows (0.2.1-rc.5，隔离安装)

机器上原有的 `dsh` 是 **0.1.2-rc.1**，不支持 0.2.x 的 preset 机制，因此另装了一份隔离的 0.2.1：

```powershell
npm i @deepseek-ai/dsh@0.2.1-rc.5 --prefix E:\tmp\dsh021
E:\tmp\dsh021\node_modules\.bin\dsh plugin --profile slim021 add E:\tmp\slim.tgz
E:\tmp\dsh021\node_modules\.bin\dsh plugin --profile slim021 add @deepseek-ai/dsh-web-app@0.2.1-rc.5
E:\tmp\dsh021\node_modules\.bin\dsh --profile slim021 --port 9711
```

## Windows 0.1.2-rc.1 为什么不行

装是装上了（`~/.dsh/cordis.patch.yml` 里写入了预设声明，`--dump-config` 能看到 `preset-local-slim-agent`），但运行时报：

```
@deepseek-ai/dsh-agent-preset: Cannot find package '@deepseek-ai/dsh-agent-preset'
→ 装上该包后：this.ctx.agentPresets.register is not a function
```

`agentPresets` 服务是 0.2.x 才有的，0.1.2 的宿主没有，所以预设注册必然失败。
**要用这个插件，Windows 上的 DSH 必须 ≥ 0.2.1-rc.5。**

## 已知的小问题

- 预设被注册了两次：全局 `~/.dsh/cordis.patch.yml` 的托管块 + 插件运行时的 `apply()` 各注册一次，
  日志会打印 `Duplicate agent preset: local-slim-agent`。功能不受影响，但应当去重（待修）。
- `pnpm` 的 store 不能放在 exFAT 卷（`G:`）上，否则 `EISDIR: illegal operation on a directory, symlink`。
  需要指向 NTFS，例如 `--store-dir C:\Users\<user>\AppData\Local\pnpm\store`。

## 环境清理说明

- Windows：测试用的 `slimwin` profile 已删除；`slim021` 保留可复现。
- Windows：`~/.dsh/cordis.patch.yml` 已还原为安装前状态（与备份 sha256 一致）。
- Debian：`slimdeb` profile 保留；测试用 web 服务已停止。

## 桌面端安装记录（2026-11-06 22:0x）

`dsh plugin --profile desktop add` 会被拒绝：

```
error: profile "desktop" is managed exclusively by the Electron application
```

因此按以下方式手工装入桌面 profile：

1. 解包 `dsh-slim-agent-0.4.0-beta.1.tgz` 到 `~/.dsh/profiles/desktop/node_modules/dsh-slim-agent`
2. `~/.dsh/profiles/desktop/package.json`：
   - `dependencies` 增加 `"dsh-slim-agent": "0.4.0-beta.1"`
   - `dsh.profile.bundles` 追加 `"dsh-slim-agent"`
3. 删除 `~/.dsh/cordis.patch.yml` 里 0.3.x 时代的旧托管块（与新版插件重复注册同一个 preset id）
4. 用新版 `preset-core.mjs` 覆盖 `~/.dsh/.agent-presets/_slim-code/core.mjs`（两者 sha256 一致）
5. **重启桌面应用**后生效

回滚：备份在 `G:\temp\desktop-profile-backup-<时间戳>\`（package.json / cordis.patch.yml / pnpm-lock.yaml）。