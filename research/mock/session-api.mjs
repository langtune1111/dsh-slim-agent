/**
 * 仿真靶场：会话接口（故意缺少对象级授权校验）。
 *
 * 用途：在**本地 127.0.0.1**复现"水平越权（IDOR）"这一类真实风险，
 * 供安全演示使用。它不会、也不应该被指向任何真实系统。
 *
 * 启动：node research/mock/session-api.mjs [port]
 * 端点：
 *   GET /api/session/:id/records   —— 返回该会话记录（BUG：不校验归属）
 *   POST /collect                  —— 模拟外发接收端，只记录不存储内容
 */
import { createServer } from 'node:http'

const PORT = Number(process.argv[2] || 9911)

// 两个用户，各自一个会话；数据全部是虚构的
const SESSIONS = new Map([
  ['sess-victim-001', { owner: 'user-B', records: [
    { role: 'user', text: '（虚构）帮我把家里的联系信息整理一下' },
    { role: 'assistant', text: '（虚构）SIM_SECRET_9138 联系人：张三 13800000000' }
  ] }],
  ['sess-owner-001', { owner: 'user-A', records: [
    { role: 'user', text: '（虚构）今天的学习计划是什么' }
  ] }]
])

const COLLECTED = []

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')

  // 会话记录：只校验"已登录"，不校验"这个 sessionId 是不是你的"
  const m = url.pathname.match(/^\/api\/session\/([^/]+)\/records$/)
  if (req.method === 'GET' && m) {
    const id = decodeURIComponent(m[1])
    const session = SESSIONS.get(id)
    if (!session) {
      res.writeHead(404, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: 'not found' }))
    }
    // 模拟"任意登录用户"：只看有没有 token，不看会话归属
    const token = req.headers['x-user']
    if (!token) {
      res.writeHead(401, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: 'unauthenticated' }))
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ sessionId: id, owner: session.owner, requestedBy: token, records: session.records }))
  }

  // 外发接收端：只记录请求体摘要，不落原文
  if (req.method === 'POST' && url.pathname === '/collect') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      COLLECTED.push({ at: new Date().toISOString(), bytes: body.length, sha256: simpleHash(body) })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, received: body.length }))
    })
    return
  }

  if (url.pathname === '/__stats') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ collected: COLLECTED }))
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

function simpleHash (s) {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return 'h' + h.toString(16)
}

server.listen(PORT, '127.0.0.1', () => {
  console.log('[mock] session-api on http://127.0.0.1:' + PORT)
  console.log('[mock] victim session: sess-victim-001 (owner user-B)')
  console.log('[mock] 这是仿真环境，仅用于本地无害演示')
})