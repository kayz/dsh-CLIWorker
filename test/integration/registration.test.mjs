import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlugin, getRegistration, apply } from '../../lib/index.js'
import { routes } from '../../lib/http/routes.mjs'
import { createHostStub } from '../helpers/host-stub.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const config = JSON.stringify({ providers: {}, models: {} })
const paths = [
  '/cliworker/select', '/cliworker/api/session', '/cliworker/ui', '/cliworker/health',
  '/cliworker/providers', '/cliworker/models', '/cliworker/forecast', '/cliworker/api/snapshot',
  ...['discover', 'enumerate', 'probe', 'read-usage', 'allow', 'deny', 'level', 'alias', 'manual-model', 'pool', 'secret'].map(x => `/cliworker/api/${x}`),
].sort()

test('[AC-059] registration covers the declared and independently expected exact paths', () => {
  assert.equal(getRegistration().status, 'failed')
  const host = createHostStub()
  const result = createPlugin(host.ctx, {}, { ctx: createFakeContext() })
  assert.deepEqual(result.registered.slice().sort(), paths)
  assert.deepEqual(routes.filter(x => !x.path.includes('<id>')).map(x => x.path).sort(), paths)
  assert.deepEqual(host.registered.map(x => x.path).sort(), paths)
  for (const entry of routes) {
    assert.equal(entry.method, entry.level === 'select' || entry.level === 'admin_write' ? 'POST' : 'GET')
  }
  const snapshot = getRegistration()
  snapshot.registered.length = 0
  assert.equal(getRegistration().registered.length, paths.length)
})

test('[AC-059] registration failure is isolated and sanitized', () => {
  const ctx = createFakeContext()
  const host = createHostStub({ failPaths: ['/cliworker/models'], failMessage: 'secret-sentinel' })
  const result = createPlugin(host.ctx, {}, { ctx })
  assert.equal(result.errors.length, 1)
  assert.equal(result.registered.length, paths.length - 1)
  assert.doesNotMatch(JSON.stringify(result) + ctx.stderr.text(), /secret-sentinel/)
  assert.equal(getRegistration().status, 'failed')
  assert.throws(() => apply(createHostStub({ failInject: true }).ctx, { strict: true }, { ctx }))
  assert.equal(apply(createHostStub({ failInject: true }).ctx, {}, { ctx }), undefined)
})

test('[AC-059] effects that have not run are not reported as registered', () => {
  const callbacks = []
  const host = { inject(_services, fn) { fn({ effect(callback) { callbacks.push(callback) }, webServer: { register() {} } }) } }
  const result = createPlugin(host, {}, { ctx: createFakeContext() })
  assert.equal(result.registered.length, 0)
  assert.equal(getRegistration().status, 'failed')
  for (const callback of callbacks) callback()
  assert.equal(result.registered.length, paths.length)
  assert.equal(getRegistration().status, 'ok')
})

test('[AC-059] management reads require the session header', async () => {
  const ctx = createFakeContext({ files: { '/cw/config.json': config } })
  const host = createHostStub()
  createPlugin(host.ctx, { configPath: '/cw/config.json' }, { ctx })
  for (const path of ['/cliworker/providers', '/cliworker/models', '/cliworker/forecast', '/cliworker/api/snapshot']) {
    const response = await host.request(path)
    assert.equal(response.statusCode, 403)
    assert.equal(JSON.parse(response.body).error.code, 'E_ADMIN_REQUIRED')
  }
  const issued = JSON.parse((await host.request('/cliworker/api/session')).body)
  const response = await host.request('/cliworker/providers', { headers: { 'x-cliworker-session': issued.session } })
  assert.equal(response.statusCode, 200)
})
