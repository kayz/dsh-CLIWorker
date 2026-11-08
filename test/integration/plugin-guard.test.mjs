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
import { secretAction } from '../../lib/secrets/index.mjs'

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

test('[AC-060] each registered write rejects invalid and expired sessions, mismatched csrf, and oversize bodies', async () => {
  const raw = { schema: 'cliworker.config/v2', state_dir: '/cw/state', discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: { session_ttl_s: 2 }, secrets: {} }
  const ctx = createFakeContext({ files: { '/cw/config.json': JSON.stringify(raw) } })
  const host = createHostStub()
  createPlugin(host.ctx, { configPath: '/cw/config.json' }, { ctx })
  const first = JSON.parse((await host.request('/cliworker/api/session')).body)
  const second = JSON.parse((await host.request('/cliworker/api/session')).body)
  const huge = 'x'.repeat(2_000_001)
  for (const entry of routes.filter(x => x.level === 'admin_write')) {
    const call = (headers, body) => host.request(entry.path, { method: 'POST', headers, body })
    const unknown = await call({ 'x-cliworker-session': 'unknown' }, '{')
    assert.equal(JSON.parse(unknown.body).error.code, 'E_ADMIN_REQUIRED')
    const mismatch = await call({ 'x-cliworker-session': first.session, 'x-cliworker-csrf': second.csrf }, '{')
    assert.equal(JSON.parse(mismatch.body).error.code, 'E_CSRF')
    const over = await call({ 'x-cliworker-session': first.session, 'x-cliworker-csrf': first.csrf }, huge)
    assert.equal(over.statusCode, 400)
    assert.equal(JSON.parse(over.body).error.code, 'E_REQUEST_INVALID')
  }
  await ctx.clock.advance(2000)
  for (const entry of routes.filter(x => x.level === 'admin_write')) {
    const expired = await host.request(entry.path, { method: 'POST', headers: { 'x-cliworker-session': first.session, 'x-cliworker-csrf': first.csrf }, body: '{' })
    assert.equal(JSON.parse(expired.body).error.code, 'E_ADMIN_REQUIRED')
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

test('[AC-060] remaining operation seams run only after authorization and JSON parsing', async () => {
  const paths = ['discover', 'enumerate', 'probe', 'read-usage', 'secret'].map(name => `/cliworker/api/${name}`)
  const calls = []
  const handlers = Object.fromEntries(paths.map(path => [path, ({ body }) => { calls.push({ path, body }); return { ok: true } }]))
  const ctx = createFakeContext({ files: { '/cw/config.json': JSON.stringify({ providers: {}, models: {} }) } })
  const host = createHostStub()
  createPlugin(host.ctx, { configPath: '/cw/config.json' }, { ctx, handlers })
  const token = JSON.parse((await host.request('/cliworker/api/session')).body)
  for (const path of paths) {
    const rejected = await host.request(path, { method: 'POST', body: '{}' })
    assert.equal(JSON.parse(rejected.body).error.code, 'E_ADMIN_REQUIRED')
    const malformed = await host.request(path, { method: 'POST', body: '{', headers: { 'x-cliworker-session': token.session, 'x-cliworker-csrf': token.csrf } })
    assert.equal(JSON.parse(malformed.body).error.code, 'E_REQUEST_INVALID')
  }
  assert.equal(calls.length, 0)
  for (const path of paths) {
    const response = await host.request(path, { method: 'POST', body: {}, headers: { 'x-cliworker-session': token.session, 'x-cliworker-csrf': token.csrf } })
    assert.equal(response.statusCode, 200)
  }
  assert.deepEqual(calls.map(call => call.path), paths)
})

test('[AC-060] management writes dispatch to their real capabilities', async () => {
  const raw = {
    schema: 'cliworker.config/v2', state_dir: '/cw/state', discovery: { cli_overrides: {} },
    catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: {},
    secrets: { example: { ref: 'session:test' } },
  }
  const usage = { schema: 'cliworker.usage/v1', id: 'u_1', idempotency_key: 'seed:1', lease_id: '', model: 'example:one', pools: [], kind: 'manual', input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0, pool_fraction_before: null, pool_fraction_after: null, at: '2026-11-07T00:00:00.000Z' }
  const ctx = createFakeContext({ files: { '/cw/config.json': JSON.stringify(raw), '/cw/state/usage.jsonl': `${JSON.stringify(usage)}\n` }, env: { PATH: '' } })
  const host = createHostStub()
  createPlugin(host.ctx, { configPath: '/cw/config.json' }, { ctx })
  const tokens = JSON.parse((await host.request('/cliworker/api/session')).body)
  const call = (path, body) => host.request(path, { method: 'POST', headers: { 'x-cliworker-session': tokens.session, 'x-cliworker-csrf': tokens.csrf }, body })

  // T-025: discover/enumerate/probe/read-usage became asynchronous jobs. The POST now only accepts
  // the job and returns `{ job_id }`; the outcome is observed through the instance-specific job
  // endpoint. That endpoint publishes the job envelope (job_id/status/at/last_error), not the
  // business payload, so the dispatch is verified by a succeeded job plus, for discover, the
  // inventory artifact the job writes.
  const runJob = async (path, body) => {
    const accepted = await call(path, body)
    assert.equal(accepted.statusCode, 200)
    const acceptedBody = JSON.parse(accepted.body)
    assert.deepEqual(Object.keys(acceptedBody), ['job_id'])
    assert.match(acceptedBody.job_id, /^[A-Za-z0-9_-]+$/)
    await ctx.clock.advance(0)
    await new Promise(resolve => setImmediate(resolve))
    const response = await host.request(`/cliworker/api/jobs/${acceptedBody.job_id}`, { headers: { 'x-cliworker-session': tokens.session } })
    assert.equal(response.statusCode, 200)
    const state = JSON.parse(response.body)
    assert.deepEqual(Object.keys(state).sort(), ['at', 'job_id', 'last_error', 'status'])
    assert.equal(state.job_id, acceptedBody.job_id)
    assert.equal(state.status, 'succeeded')
    assert.equal(state.last_error, null)
    return { job_id: acceptedBody.job_id, at: state.at }
  }

  const discover = await runJob('/cliworker/api/discover', {})
  const inventory = JSON.parse(ctx.fs.readFileSync('/cw/state/inventory.json', 'utf8'))
  assert.equal(inventory.schema, 'cliworker.inventory/v1')
  assert.equal(inventory.generated_at, discover.at)

  await runJob('/cliworker/api/enumerate', { full: true })
  await runJob('/cliworker/api/probe', {})
  await runJob('/cliworker/api/read-usage', {})

  const secret = await call('/cliworker/api/secret', { cli: 'example', value: 'guard-secret-sentinel' })
  assert.equal(secret.statusCode, 200)
  assert.deepEqual(JSON.parse(secret.body), { ok: true, state: 'set' })
  assert.equal(secretAction(ctx, raw, 'example', 'get'), 'guard-secret-sentinel')
  assert.doesNotMatch(secret.body, /guard-secret-sentinel/)

  for (const [path, body] of [
    ['/cliworker/api/discover', { full: 'yes' }],
    ['/cliworker/api/enumerate', { full: 1 }],
    ['/cliworker/api/secret', {}],
    ['/cliworker/api/secret', { cli: 'example' }],
    ['/cliworker/api/secret', { cli: 'example', action: 'rotate', value: 'x' }],
  ]) {
    const response = await call(path, body)
    assert.equal(response.statusCode, 400)
    assert.equal(JSON.parse(response.body).error.code, 'E_REQUEST_INVALID')
  }
})
