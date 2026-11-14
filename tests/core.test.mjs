import test from 'node:test'
import assert from 'node:assert/strict'
import { classifySource, guessYear, AsyncSemaphore, trimBudgetMap, MAX_BUDGET_KEYS, pickFetchTarget } from '../preset-core.mjs'

test('classifySource: 区分源码仓库、社区讨论、文档站、百科', () => {
  assert.equal(classifySource('https://github.com/nodejs/node/releases/tag/v22.0.0'), '[源码仓库]')
  assert.equal(classifySource('https://github.com/nodejs/node/issues/123'), '[社区讨论]')
  assert.equal(classifySource('https://stackoverflow.com/questions/1'), '[社区问答]')
  assert.equal(classifySource('https://en.wikipedia.org/wiki/JavaScript'), '[百科]')
  assert.equal(classifySource('https://docs.python.org/3/whatsnew/3.13.html'), '[文档站]')
  assert.equal(classifySource('https://some-blog.example.com/post'), '[其他]')
  assert.equal(classifySource('not a url'), '[其他]')
})

test('classifySource: GitHub 不再被一律当作官方权威', () => {
  // 旧实现把 github.com 整体标成 [官方/权威]；新实现按用途区分
  assert.notEqual(classifySource('https://github.com/randomuser/toy-project'), '[官方/权威]')
  assert.equal(classifySource('https://github.com/randomuser/toy-project'), '[源码仓库]')
})

test('guessYear: 取最后一个年份，且只认 2020-2039', () => {
  assert.equal(guessYear('Released in 2023, updated 2024'), ' (2024)')
  assert.equal(guessYear('no year here'), '')
  assert.equal(guessYear('ancient 1999'), '')
})

test('AsyncSemaphore: 并发上限为 1 时严格串行', async () => {
  const sem = new AsyncSemaphore(1)
  const log = []
  const worker = async (id, ms) => {
    await sem.acquire()
    log.push('start-' + id)
    await new Promise((r) => setTimeout(r, ms))
    log.push('end-' + id)
    sem.release()
  }
  await Promise.all([worker('A', 30), worker('B', 5)])
  assert.deepEqual(log, ['start-A', 'end-A', 'start-B', 'end-B'])
})

test('AsyncSemaphore: release 多余调用不会把计数打成负数', () => {
  const sem = new AsyncSemaphore(2)
  sem.release()
  sem.release()
  assert.equal(sem.current, 0)
})

test('AsyncSemaphore: release 后同一 tick 内 acquire 不得超发（交接式许可）', async () => {
  // 复现微任务竞态：A 持锁 → B 排队 → A.release() → 同一 tick 里 C 抢锁。
  // 旧实现 release() 先把 current 减到 0 再唤醒 B，B 在微任务里才 +=1，
  // 这中间 C 会直接抢到许可，随后 B 醒来再 +=1 → current 变成 2 > capacity。
  const sem = new AsyncSemaphore(1)
  let active = 0
  let peak = 0
  const job = async () => {
    await sem.acquire()
    active += 1
    peak = Math.max(peak, active)
    await new Promise((r) => setImmediate(r))
    active -= 1
    sem.release()
  }

  await sem.acquire() // A 拿住许可
  const b = job() // B 排队
  await Promise.resolve() // 让 B 进入 waiters
  sem.release() // A 交还许可：旧实现此刻把 current 减到 0，B 还在微任务里没醒来
  const c = job() // C 在同一个 tick 里同步抢锁 —— 竞态窗口就在这一行

  await Promise.race([
    Promise.all([b, c]),
    new Promise((_, rej) => setTimeout(() => rej(new Error('semaphore deadlock')), 2000)),
  ])
  assert.equal(peak, 1, '并发峰值必须是 1，实测 ' + peak)
  assert.equal(sem.current, 0, '全部结束计数应归零，实测 ' + sem.current)
})

test('trimBudgetMap: 超过上限按插入顺序淘汰最旧的 key（预算表不会无限增长）', () => {
  const m = new Map()
  for (let i = 0; i < MAX_BUDGET_KEYS + 6; i += 1) m.set('s' + i, i)
  trimBudgetMap(m)
  assert.equal(m.size, MAX_BUDGET_KEYS)
  assert.equal(m.has('s0'), false, '最旧的 key 应被淘汰')
  assert.equal(m.has('s' + (MAX_BUDGET_KEYS + 5)), true, '最新的 key 必须保留')
})

test('pickFetchTarget: 通用打分降级聚合站，不依赖产品白名单', () => {
  const items = [
    { url: 'https://blog.csdn.net/x/article/details/1', title: 'csdn' },
    { url: 'https://www.runoob.com/x.html', title: 'runoob' },
    { url: 'https://example-unknown-tool.dev/releases', title: 'releases' },
  ]
  assert.equal(pickFetchTarget(items).url, 'https://example-unknown-tool.dev/releases')
  // 只有聚合站时退化为第一条，不乱挑
  const onlyBad = [{ url: 'https://blog.csdn.net/a' }, { url: 'https://zhuanlan.zhihu.com/p/1' }]
  assert.equal(pickFetchTarget(onlyBad).url, 'https://blog.csdn.net/a')
  // 空列表不炸
  assert.equal(pickFetchTarget([]), undefined)
})
