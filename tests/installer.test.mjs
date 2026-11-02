import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
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

test('install: autoInstall=false 时完全不写盘', () => {
  withHome((home) => {
    const result = install(logger, { autoInstall: false })
    assert.equal(result.ok, false)
    assert.equal(result.skipped, 'autoInstall-disabled')
    assert.equal(existsSync(join(home, 'cordis.patch.yml')), false)
  })
})