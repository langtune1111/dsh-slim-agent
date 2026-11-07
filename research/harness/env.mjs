/**
 * 环境快照：记录"这次评测跑在什么机器上"。探测失败一律记 null，不中断评测。
 */
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'

const safe = (fn, fallback = null) => { try { const v = fn(); return v === undefined ? fallback : v } catch { return fallback } }
const run = (cmd, args = [], timeout = 8000) => safe(() => execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }).trim(), null)
// Windows 上 npm/dsh 是 .cmd shim，execFile 跑不了，改用 shell
const runShell = (cmdline, timeout = 8000) => safe(() => execSync(cmdline, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }).trim(), null)

const linuxDistro = () => safe(() => {
  const t = readFileSync('/etc/os-release', 'utf8'); const o = {}
  for (const line of t.split('\n')) { const m = line.match(/^([A-Z_]+)="?(.*?)"?$/); if (m) o[m[1]] = m[2] }
  return { id: o.ID, name: o.NAME, version: o.VERSION, pretty: o.PRETTY_NAME, kernel: run('uname', ['-r']), arch: run('uname', ['-m']) }
})

const winOs = () => safe(() => ({
  caption: run('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).Caption']),
  version: run('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).Version']),
  build: run('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).BuildNumber'])
}))

export function captureEnv ({ cwd = process.cwd(), label = null } = {}) {
  const cpus = safe(() => os.cpus(), [])
  const git = safe(() => ({
    branch: run('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD']),
    commit: run('git', ['-C', cwd, 'rev-parse', 'HEAD']),
    short: run('git', ['-C', cwd, 'rev-parse', '--short', 'HEAD']),
    dirty: run('git', ['-C', cwd, 'status', '--porcelain']) !== ''
  }))
  return {
    label,
    capturedAt: new Date().toISOString(),
    hostname: safe(() => os.hostname()),
    platform: process.platform,
    arch: process.arch,
    osType: safe(() => os.type()),
    osRelease: safe(() => os.release()),
    distro: process.platform === 'linux' ? linuxDistro() : null,
    windows: process.platform === 'win32' ? winOs() : null,
    cpu: { model: cpus[0]?.model ?? null, cores: cpus.length, speedMHz: cpus[0]?.speed ?? null },
    memoryTotalBytes: safe(() => os.totalmem()),
    node: process.version,
    npm: process.platform === 'win32' ? runShell('npm --version') : run('npm', ['--version']),
    dsh: process.platform === 'win32' ? runShell('dsh --version') : run('dsh', ['--version']),
    locale: safe(() => Intl.DateTimeFormat().resolvedOptions().locale),
    timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    env: { DSH_HOME: process.env.DSH_HOME ?? null, LANG: process.env.LANG ?? null, TZ: process.env.TZ ?? null, PATH_ENTRIES: (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':').length },
    gpu: safe(() => {
      const out = run('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'])
      return out ? out.split('\n').map((l) => l.trim()) : null
    }),
    cwd,
    git
  }
}