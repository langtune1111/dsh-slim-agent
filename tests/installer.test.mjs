import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { install } from '../index.js'

const logger = { info() {}, warn() {} }

function withHome(run) {
  const home = mkdtempSync(join(tmpdir(), 'slim-home-'))
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return run(home)
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    rmSync(home, { recursive: true, force: true })
  }
}

test('install: 写入 core.mjs 与托管声明块', () => {
  withHome((home) => {
    const result = install(logger)
    assert.equal(result.ok, true)
    assert.ok(existsSync(join(home, '.agent-presets', '_slim-code', 'core.mjs')))
    const patch = readFileSync(join(home, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, /preset-local-slim-agent/)
    assert.match(patch, /prefix: \|-/)
    assert.doesNotMatch(patch, /text:/, '声明里不得使用 persona.text（会被 DSH 静默丢弃）')
  })
})

test('install: 重复执行幂等，不产生第二份声明块', () => {
  withHome((home) => {
    install(logger)
    const first = readFileSync(join(home, 'cordis.patch.yml'), 'utf8')
    const second = install(logger)
    const after = readFileSync(join(home, 'cordis.patch.yml'), 'utf8')
    assert.equal(second.unchanged, true)
    assert.equal(after, first)
    assert.equal(after.match(/preset-local-slim-agent/g).length, 1)
  })
})

test('install: 覆盖前生成 .bak 备份', () => {
  withHome((home) => {
    install(logger)
    // 人为改动，触发第二次真实写入
    const patchPath = join(home, 'cordis.patch.yml')
    const before = readFileSync(patchPath, 'utf8')
    writeFileSync(patchPath, before + '\n# user line\n', 'utf8')
    install(logger)
    assert.ok(existsSync(patchPath + '.bak'))
  })
})

test('install: 单边残缺标记（只有 BEGIN 或只有 END）时拒绝写入，防止截断配置', () => {
  withHome((home) => {
    const patchPath = join(home, 'cordis.patch.yml')

    // 1. 只有 BEGIN，没有 END
    writeFileSync(patchPath, '# user header\n# --- dsh-slim-agent managed block (auto-generated; do not edit) ---\n# user tail\n', 'utf8')
    const res1 = install(logger)
    assert.equal(res1.ok, false)
    assert.equal(res1.error, 'corrupted-markers')
    assert.match(readFileSync(patchPath, 'utf8'), /# user tail/, '不得损坏原文件内容')

    // 2. 只有 END，没有 BEGIN
    writeFileSync(patchPath, '# user header\n# --- end dsh-slim-agent managed block ---\n# user tail\n', 'utf8')
    const res2 = install(logger)
    assert.equal(res2.ok, false)
    assert.equal(res2.error, 'corrupted-markers')
    assert.match(readFileSync(patchPath, 'utf8'), /# user tail/, '不得损坏原文件内容')
  })
})

test('install: autoInstall=false 时完全不写盘', () => {
  withHome((home) => {
    const result = install(logger, { autoInstall: false })
    assert.equal(result.ok, false)
    assert.equal(result.skipped, 'autoInstall-disabled')
    assert.equal(existsSync(join(home, 'cordis.patch.yml')), false)
  })
})

test('install: 备份写入失败时硬熔断中止，绝不修改原文件', () => {
  withHome((home) => {
    const patchPath = join(home, 'cordis.patch.yml')
    writeFileSync(patchPath, '# original user content\n', 'utf8')

    // 创建同名 .bak 目录，使得 writeFileSync(backup, ...) 必定抛错（EISDIR/EPERM）
    const backupPath = patchPath + '.bak'
    mkdirSync(backupPath)

    const res = install(logger)
    assert.equal(res.ok, false)
    assert.equal(res.error, 'backup-failed')
    assert.equal(readFileSync(patchPath, 'utf8'), '# original user content\n', '原文件必须完好无损')
  })
})