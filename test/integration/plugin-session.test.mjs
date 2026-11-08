import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessions, isLoopbackRequest } from '../../lib/http/security.mjs'

test('AC-059 loopback components are independently required', () => {
  const req = (remoteAddress, host, origin) => ({ socket: { remoteAddress }, headers: { host, origin } })
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isLoopbackRequest(req(address, '[::1]:3000', 'http://localhost:3000')), true)
  }
  for (const [address, host, origin] of [
    ['192.0.2.1', 'localhost', undefined], ['127.0.0.1', 'localhost.example', undefined],
    ['127.0.0.1', '', undefined], ['127.0.0.1', 'localhost', 'null'],
    ['127.0.0.1', 'localhost', 'http://user@localhost'],
  ]) assert.equal(isLoopbackRequest(req(address, host, origin)), false)
  assert.equal(isLoopbackRequest({ headers: { host: 'localhost', 'x-forwarded-for': '127.0.0.1' } }), false)
})

test('AC-059 session expiry, isolation and CSRF binding', () => {
  let now = 1000
  const clock = { now: () => now }
  const store = createSessions(clock, 2)
  const first = store.issue()
  const second = store.issue()
  assert.equal(Buffer.from(first.session, 'base64url').length, 32)
  assert.notEqual(first.session, second.session)
  assert.equal(first.expires_at, new Date(3000).toISOString())
  assert.equal(store.validCsrf(first.session, first.csrf), true)
  assert.equal(store.validCsrf(first.session, second.csrf), false)
  assert.equal(createSessions(clock, 2).valid(first.session), false)
  now = 3000
  assert.equal(store.valid(first.session), false)
})
