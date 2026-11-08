import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createSessions } from '../../lib/http/security.mjs'
import { gateRequest, readJson } from '../../lib/http/guard.mjs'
import { routes } from '../../lib/http/routes.mjs'

test('AC-060 write gates take precedence without reading the request body', () => {
  let now = 0
  const sessions = createSessions({ now: () => now }, 1)
  const one = sessions.issue()
  const two = sessions.issue()
  for (const route of routes.filter((entry) => entry.level === 'admin_write')) {
    const req = (headers) => ({ headers, on() { throw new Error('body was read') } })
    assert.equal(gateRequest(route, req({}), sessions, true), 'E_ADMIN_REQUIRED')
    assert.equal(gateRequest(route, req({ 'x-cliworker-session': one.session }), sessions, true), 'E_READONLY')
    assert.equal(gateRequest(route, req({ 'x-cliworker-session': one.session }), sessions, false), 'E_CSRF')
    assert.equal(gateRequest(route, req({ 'x-cliworker-session': one.session, 'x-cliworker-csrf': two.csrf }), sessions, false), 'E_CSRF')
    assert.equal(gateRequest(route, req({ 'x-cliworker-session': one.session, 'x-cliworker-csrf': one.csrf }), sessions, false), null)
  }
  now = 1000
  assert.equal(gateRequest({ level: 'admin_write' }, { headers: { 'x-cliworker-session': one.session } }, sessions, true), 'E_ADMIN_REQUIRED')
})

test('AC-060 oversized and malformed bodies reject without destroying the stream', async () => {
  for (const body of ['{', 'x'.repeat(2_000_001)]) {
    const req = new EventEmitter()
    const result = readJson(req)
    req.emit('data', Buffer.from(body))
    req.emit('end')
    await assert.rejects(result)
  }
  const unfinished = new EventEmitter()
  const oversized = readJson(unfinished)
  unfinished.emit('data', Buffer.alloc(2_000_001))
  await assert.rejects(oversized)
})
