import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createSessions } from '../../lib/http/security.mjs'
import { gateRequest, readJson } from '../../lib/http/guard.mjs'
import { routes } from '../../lib/http/routes.mjs'
import { createPlugin } from '../../lib/index.js'
import { createHostStub } from '../helpers/host-stub.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'
import { createFlow } from '../helpers/flow.mjs'
import * as httpSelect from '../flows/steps/http-select.mjs'
import * as httpAdmin from '../flows/steps/http-admin.mjs'

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

test('[AC-060] registered write routes reject in order before parsing malformed bodies', async () => {
  for (const readonly of [true, false]) {
    const host = createHostStub()
    const ctx = createFakeContext({ files: { '/cw/config.json': JSON.stringify({ providers: {}, models: {} }) } })
    createPlugin(host.ctx, { configPath: '/cw/config.json', readonly }, { ctx })
    const tokens = JSON.parse((await host.request('/cliworker/api/session')).body)
    for (const entry of routes.filter(x => x.level === 'admin_write')) {
      const call = headers => host.request(entry.path, { method: 'POST', headers, body: '{' })
      const noSession = await call({})
      assert.equal(JSON.parse(noSession.body).error.code, 'E_ADMIN_REQUIRED')
      const noCsrf = await call({ 'x-cliworker-session': tokens.session })
      assert.equal(JSON.parse(noCsrf.body).error.code, readonly ? 'E_READONLY' : 'E_CSRF')
      if (!readonly) {
        const malformed = await call({ 'x-cliworker-session': tokens.session, 'x-cliworker-csrf': tokens.csrf })
        assert.equal(JSON.parse(malformed.body).error.code, 'E_REQUEST_INVALID')
      }
    }
  }
})

test('[AC-060] first write with the issued session and csrf updates the real pool configuration', async () => {
  const pool = { id: 'p', cli: 'example', kind: 'credits', funding: 'paid', window: null, capacity_mtok: {}, used_fraction: null, credits_per_mtok: null }
  const raw = { schema: 'cliworker.config/v2', state_dir: '/cw/state', discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [pool], policy: {}, secrets: {} }
  const ctx = createFakeContext({ files: { '/cw/config.json': JSON.stringify(raw) } })
  const host = createHostStub()
  createPlugin(host.ctx, { configPath: '/cw/config.json' }, { ctx })
  const tokens = JSON.parse((await host.request('/cliworker/api/session')).body)
  const updated = { ...pool, credits_per_mtok: 5 }
  const response = await host.request('/cliworker/api/pool', { method: 'POST', body: updated, headers: { 'x-cliworker-session': tokens.session, 'x-cliworker-csrf': tokens.csrf } })
  assert.equal(response.statusCode, 200)
  assert.equal(JSON.parse(ctx.fs.readFileSync('/cw/config.json', 'utf8')).pools[0].credits_per_mtok, 5)
})

test('[AC-060] first write can add a real model to the directory', async () => {
  const raw = { schema: 'cliworker.config/v2', state_dir: '/cw/state', discovery: { cli_overrides: { example: { cli: 'example' } } }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: {}, secrets: {} }
  const ctx = createFakeContext({ files: { '/cw/config.json': JSON.stringify(raw) } })
  const host = createHostStub()
  createPlugin(host.ctx, { configPath: '/cw/config.json' }, { ctx })
  const tokens = JSON.parse((await host.request('/cliworker/api/session')).body)
  const response = await host.request('/cliworker/api/manual-model', { method: 'POST', body: { provider: 'example', id: 'one', level: 'Top' }, headers: { 'x-cliworker-session': tokens.session, 'x-cliworker-csrf': tokens.csrf } })
  assert.equal(response.statusCode, 200)
  assert.equal(JSON.parse(ctx.fs.readFileSync('/cw/config.json', 'utf8')).catalog.manual[0].key, 'example:one')
})

test('[AC-060] HTTP flow steps exercise the real plugin and scan recorded responses', async () => {
  const flow = createFlow()
  try {
    await httpSelect.run(flow)
    await httpAdmin.run(flow)
    assert.ok(flow.scan().scanned.http > 0)
    assert.deepEqual(flow.scan().hits, [])
  } finally { flow.cleanup() }
})
