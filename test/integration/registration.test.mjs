import test from 'node:test'
import assert from 'node:assert/strict'

import { createPlugin, getRegistration, apply } from '../../lib/index.js'
import { createHostStub } from '../helpers/host-stub.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const ROUTES = ['/cliworker/forecast', '/cliworker/models', '/cliworker/providers', '/cliworker/select']

const CONFIG = JSON.stringify({
  providers: { p1: { cli: 'p1cli' } },
  models: { m1: { provider: 'p1', id: 'm1', tier: 'top', identity: 'verified', prices: { input_per_mtok: 1000, output_per_mtok: 0 } } },
})

function okExec() {
  return { ok: true, code: 0, stdout: '1.2.3', stderr: '', error: null }
}

test('[AC-008] getRegistration reports a failed placeholder before the plugin is applied', () => {
  const before = getRegistration()
  assert.equal(before.status, 'failed')
  assert.deepEqual(before.registered, [])
  assert.deepEqual(before.errors, [{ path: null, message: 'plugin not applied' }])
})

test('[AC-008] createPlugin registers the four routes and reports ok', () => {
  const stub = createHostStub()
  const report = createPlugin(stub.ctx, {}, { ctx: createFakeContext() })

  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.registered.slice().sort(), ROUTES)
  assert.deepEqual(stub.registered.map((item) => item.path).sort(), ROUTES)
  assert.deepEqual(stub.injectCalls, [['webServer']])

  const registration = getRegistration()
  assert.equal(registration.status, 'ok')
  assert.equal(registration.registered.length, 4)
  assert.deepEqual(registration.errors, [])
})

test('[AC-008] a failing route is reported without blocking the others', () => {
  const stub = createHostStub({ failPaths: ['/cliworker/models'], failMessage: 'boom' })
  const ctx = createFakeContext()
  const report = createPlugin(stub.ctx, {}, { ctx })

  assert.equal(report.errors.length, 1)
  assert.equal(report.errors[0].path, '/cliworker/models')
  assert.ok(report.errors[0].message.includes('boom'))
  assert.equal(report.registered.length, 3)
  assert.equal(report.registered.includes('/cliworker/models'), false)

  assert.equal(getRegistration().status, 'failed')
  assert.equal(getRegistration().errors.length, 1)
  assert.ok(ctx.stderr.text().includes('/cliworker/models'))
})

test('[AC-008] an inject failure is reported with a null path', () => {
  const report = createPlugin(createHostStub({ failInject: true }).ctx, {}, { ctx: createFakeContext() })
  assert.equal(report.errors.length, 1)
  assert.equal(report.errors[0].path, null)
  assert.deepEqual(report.registered, [])
  assert.equal(getRegistration().status, 'failed')
})

test('[AC-008] apply throws in strict mode and stays quiet otherwise', () => {
  const nonStrict = createFakeContext()
  assert.equal(apply(createHostStub({ failPaths: ['*'] }).ctx, {}, { ctx: nonStrict }), undefined)
  assert.equal(getRegistration().status, 'failed')
  assert.deepEqual(getRegistration().registered, [])

  let thrown = null
  try {
    apply(createHostStub({ failPaths: ['/cliworker/select'] }).ctx, { strict: true }, { ctx: createFakeContext() })
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown, 'strict mode must throw')
  assert.ok(thrown.message.startsWith('cliworker: route registration failed'))
  assert.ok(thrown.message.includes('/cliworker/select'))
  assert.equal(thrown.registration.status, 'failed')

  apply(createHostStub().ctx, { strict: true }, { ctx: createFakeContext() })
  assert.equal(getRegistration().status, 'ok')
})

test('[AC-008] a registered handler round-trips through the injected ctx', async () => {
  const ctx = createFakeContext({ files: { '/cw/config.json': CONFIG }, exec: okExec })
  const stub = createHostStub()
  createPlugin(stub.ctx, { configPath: '/cw/config.json' }, { ctx })

  const providers = await stub.request('/cliworker/providers')
  assert.equal(providers.statusCode, 200)
  const providerBody = JSON.parse(providers.body)
  assert.equal(providerBody.ok, true)
  assert.equal(providerBody.providers.p1.state, 'callable')

  const models = await stub.request('/cliworker/models')
  const modelBody = JSON.parse(models.body)
  assert.equal(modelBody.ok, true)
  assert.deepEqual(modelBody.models.map((model) => model.key), ['m1'])
  assert.ok(ctx.exec.count >= 1)

  const forecast = await stub.request('/cliworker/forecast', { url: '/cliworker/forecast?model=m1' })
  const forecastBody = JSON.parse(forecast.body)
  assert.equal(forecastBody.ok, true)
  assert.equal(forecastBody.forecast.status, 'unknown')

  const broken = createFakeContext({ files: {}, exec: okExec })
  const brokenStub = createHostStub()
  createPlugin(brokenStub.ctx, { configPath: '/cw/nope.json' }, { ctx: broken })
  const failed = await brokenStub.request('/cliworker/providers')
  assert.equal(failed.statusCode, 500)
  assert.equal(JSON.parse(failed.body).ok, false)
})
