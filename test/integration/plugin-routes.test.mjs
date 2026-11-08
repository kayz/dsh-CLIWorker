import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlugin } from '../../lib/index.js'
import { createHostStub } from '../helpers/host-stub.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'
import { createFlow } from '../helpers/flow.mjs'
import { setup, withFixture } from '../flows/steps/http-select.mjs'
import { getCode } from '../../lib/contract/registry.mjs'

test('[AC-059] actual bootstrap routes require all loopback components', async () => {
  const host = createHostStub()
  createPlugin(host.ctx, {}, { ctx: createFakeContext() })
  for (const path of ['/cliworker/api/session', '/cliworker/ui']) {
    for (const options of [{ remoteAddress: '192.0.2.1' }, { host: 'localhost.example' }, { origin: 'http://example.com' }]) {
      const response = await host.request(path, options)
      assert.equal(response.statusCode, 403)
      assert.equal(JSON.parse(response.body).error.code, 'E_LOOPBACK_ONLY')
    }
    assert.equal((await host.request(path)).statusCode, 200)
  }
})

test('[AC-059] privileged select views are gated for direct and wrapped bodies', async () => {
  const host = createHostStub()
  createPlugin(host.ctx, {}, { ctx: createFakeContext() })
  for (const body of [{ view: 'full' }, { compat: 'draft' }, {}, { request: { view: 'full' }, schema: 'cliworker.request/v1' }]) {
    const response = await host.request('/cliworker/select', { method: 'POST', body })
    assert.equal(response.statusCode, 403)
    assert.equal(JSON.parse(response.body).error.code, 'E_VIEW_FORBIDDEN')
  }
})

test('[AC-059] known job exact route applies management guard before handler', async () => {
  const host = createHostStub()
  let calls = 0
  const path = '/cliworker/api/jobs/job1'
  createPlugin(host.ctx, {}, { ctx: createFakeContext(), jobIds: ['job1'], handlers: { [path]: () => { calls++; return { ok: true } } } })
  assert.equal((await host.request(path)).statusCode, 403)
  assert.equal(calls, 0)
  const { session } = JSON.parse((await host.request('/cliworker/api/session')).body)
  assert.equal((await host.request(path, { headers: { 'x-cliworker-session': session } })).statusCode, 200)
  assert.equal(calls, 1)
})

test('[AC-059] authenticated full and draft selection use the production chain', async () => {
  const flow = createFlow()
  try {
    await withFixture(flow, async () => {
      const request = setup(flow)
      const { session } = JSON.parse((await request('/cliworker/api/session')).body)
      for (const fields of [{ view: 'full' }, { compat: 'draft' }]) {
        const response = await request('/cliworker/select', { method: 'POST', headers: { 'x-cliworker-session': session }, body: { schema: 'cliworker.request/v1', level: 'Top', cwd: flow.root, ...fields } })
        assert.equal(response.statusCode, 200)
        const body = JSON.parse(response.body)
        assert.equal(body.ok, true)
        if (fields.compat) assert.ok(body.warnings.some(w => w.code === 'W_DRAFT_DEPRECATED'))
        else assert.ok(body.models[0].detail)
      }
      assert.deepEqual(flow.scan().hits, [])
    })
  } finally { flow.cleanup() }
})

test('[AC-059] gate errors match the registry and strict error envelope shape', async () => {
  const ctx = createFakeContext({ files: { '/cw/config.json': JSON.stringify({ providers: {}, models: {} }) } })
  const host = createHostStub(), readonly = createHostStub()
  createPlugin(host.ctx, { configPath: '/cw/config.json' }, { ctx })
  createPlugin(readonly.ctx, { configPath: '/cw/config.json', readonly: true }, { ctx })
  const a = JSON.parse((await host.request('/cliworker/api/session')).body)
  const b = JSON.parse((await readonly.request('/cliworker/api/session')).body)
  const cases = [
    ['E_LOOPBACK_ONLY', await host.request('/cliworker/ui', { host: 'evil.example' })],
    ['E_VIEW_FORBIDDEN', await host.request('/cliworker/select', { method: 'POST', body: {} })],
    ['E_ADMIN_REQUIRED', await host.request('/cliworker/providers')],
    ['E_CSRF', await host.request('/cliworker/api/pool', { method: 'POST', headers: { 'x-cliworker-session': a.session }, body: '{' })],
    ['E_READONLY', await readonly.request('/cliworker/api/pool', { method: 'POST', headers: { 'x-cliworker-session': b.session }, body: '{' })],
  ]
  for (const [code, response] of cases) {
    const body = JSON.parse(response.body), registry = getCode(code)
    assert.equal(response.statusCode, registry.http_status)
    assert.deepEqual(Object.keys(body).sort(), ['error', 'ok'])
    assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message', 'retry_after', 'retryable'])
    assert.equal(body.ok, false)
    assert.equal(body.error.code, code)
    assert.equal(body.error.retryable, registry.retryable)
    assert.equal(body.error.retry_after, null)
  }
})

test('[AC-059] each management read gates invalid and expired sessions and allows a readonly session', async () => {
  const raw = { schema: 'cliworker.config/v2', state_dir: '/cw/state', discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: { session_ttl_s: 1 }, secrets: {} }
  const ctx = createFakeContext({ files: { '/cw/config.json': JSON.stringify(raw) } })
  const host = createHostStub()
  let calls = 0
  const snapshot = '/cliworker/api/snapshot', job = '/cliworker/api/jobs/known'
  const handlers = { [snapshot]: () => { calls++; return { ok: true } }, [job]: () => { calls++; return { ok: true } } }
  createPlugin(host.ctx, { configPath: '/cw/config.json', readonly: true }, { ctx, jobIds: ['known'], handlers })
  const paths = ['/cliworker/providers', '/cliworker/models', '/cliworker/forecast', snapshot, job]
  const { session } = JSON.parse((await host.request('/cliworker/api/session')).body)
  for (const path of paths) {
    for (const headers of [{}, { 'x-cliworker-session': 'unknown' }]) {
      const result = await host.request(path, { headers })
      assert.equal(result.statusCode, 403)
      assert.equal(JSON.parse(result.body).error.code, 'E_ADMIN_REQUIRED')
    }
    assert.equal((await host.request(path, { headers: { 'x-cliworker-session': session } })).statusCode, 200)
  }
  assert.equal(calls, 2)
  await ctx.clock.advance(1000)
  for (const path of paths) {
    const response = await host.request(path, { headers: { 'x-cliworker-session': session } })
    assert.equal(response.statusCode, 403)
    assert.equal(JSON.parse(response.body).error.code, 'E_ADMIN_REQUIRED')
  }
  assert.equal(calls, 2)
})
