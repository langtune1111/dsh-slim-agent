import test from 'node:test'
import assert from 'node:assert/strict'
import { classifySource, guessYear, AsyncSemaphore } from '../preset-core.mjs'

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