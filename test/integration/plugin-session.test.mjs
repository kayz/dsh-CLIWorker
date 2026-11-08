import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessions, isLoopbackRequest } from '../../lib/http/security.mjs'
import { createPlugin } from '../../lib/index.js'
import { createHostStub } from '../helpers/host-stub.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'
import { getCode } from '../../lib/contract/registry.mjs'

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

test('[AC-059] HTTP session has the exact schema and expires at its configured boundary', async () => {
  const config = { schema: 'cliworker.config/v2', state_dir: '/cw/state', discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: { session_ttl_s: 2 }, secrets: {} }
  const ctx = createFakeContext({ files: { '/cw/config.json': JSON.stringify(config) } })
  const host = createHostStub()
  createPlugin(host.ctx, { configPath: '/cw/config.json' }, { ctx })
  const response = await host.request('/cliworker/api/session')
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.headers['set-cookie'], undefined)
  const body = JSON.parse(response.body)
  assert.deepEqual(Object.keys(body).sort(), ['csrf', 'expires_at', 'schema', 'session'])
  assert.equal(body.schema, 'cliworker.session/v1')
  assert.equal(Buffer.from(body.session, 'base64url').length, 32)
  assert.equal(Buffer.from(body.csrf, 'base64url').length, 32)
  assert.equal(Date.parse(body.expires_at), ctx.clock.now() + 2000)
  const headers = { 'x-cliworker-session': body.session }
  assert.equal((await host.request('/cliworker/providers', { headers })).statusCode, 200)
  await ctx.clock.advance(2000)
  const expired = await host.request('/cliworker/providers', { headers })
  const error = JSON.parse(expired.body)
  const spec = getCode('E_ADMIN_REQUIRED')
  assert.equal(expired.statusCode, spec.http_status)
  assert.deepEqual(Object.keys(error).sort(), ['error', 'ok'])
  assert.deepEqual(Object.keys(error.error).sort(), ['code', 'message', 'retry_after', 'retryable'])
  assert.equal(error.error.code, spec.code)
  assert.equal(error.error.retryable, spec.retryable)
  assert.equal(error.error.retry_after, null)
})
