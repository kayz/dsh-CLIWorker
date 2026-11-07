import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createHostStub } from '../helpers/host-stub.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts', 'host', 'dsh-host.v1.json'), 'utf8'))

function echoHandler(req, res) {
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ remoteAddress: req.socket.remoteAddress, host: req.headers.host, origin: req.headers.origin }))
}

test('[AC-008] the host contract names the stub-controlled inputs', () => {
  assert.equal(SPEC.contract, 'dsh-host')
  assert.equal(SPEC.version, 1)
  assert.deepEqual(SPEC.stub_controllable_inputs.slice().sort(), ['host', 'origin', 'remoteAddress'])
  assert.deepEqual(SPEC.registration.kind, ['exact'])
  assert.deepEqual(SPEC.plugin_exports.getRegistration.status, ['ok', 'failed'])
  assert.equal(SPEC.plugin_exports.apply.strict_throws_on_errors, true)
  assert.deepEqual(SPEC.request.required, ['socket.remoteAddress', 'headers'])
  assert.deepEqual(SPEC.response.required, ['statusCode', 'setHeader', 'end'])
})

test('[AC-008] register validates kind, path and handler', () => {
  const stub = createHostStub()
  stub.ctx.inject(['webServer'], (httpCtx) => {
    for (const bad of [
      { kind: 'prefix', path: '/y', handler: () => {} },
      { kind: 'exact', path: 'y', handler: () => {} },
      { kind: 'exact', path: '/y', handler: 1 },
      null,
    ]) {
      assert.throws(() => httpCtx.webServer.register(bad), TypeError)
    }
    httpCtx.webServer.register({ kind: 'exact', path: '/ok', handler: echoHandler })
  })
  assert.deepEqual(stub.registered, [{ kind: 'exact', path: '/ok' }])
})

test('[AC-008] failPaths rejects the registration and records nothing', () => {
  const stub = createHostStub({ failPaths: ['/boom'], failMessage: 'stub says no' })
  assert.throws(
    () => stub.ctx.inject(['webServer'], (httpCtx) => {
      httpCtx.webServer.register({ kind: 'exact', path: '/boom', handler: echoHandler })
    }),
    (error) => error.message.includes('/boom') && error.message.includes('stub says no')
  )
  assert.deepEqual(stub.registered, [])

  const all = createHostStub({ failPaths: ['*'] })
  assert.throws(
    () => all.ctx.inject(['webServer'], (httpCtx) => {
      httpCtx.webServer.register({ kind: 'exact', path: '/any', handler: echoHandler })
    }),
    /\/any/
  )
})

test('[AC-008] failInject throws out of inject', () => {
  const stub = createHostStub({ failInject: true })
  assert.throws(() => stub.ctx.inject(['webServer'], () => {}), /inject/)
  assert.deepEqual(stub.injectCalls, [['webServer']])
})

test('[AC-008] request controls remoteAddress, host and origin', async () => {
  const stub = createHostStub()
  stub.ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(() => httpCtx.webServer.register({ kind: 'exact', path: '/x', handler: echoHandler }), 'x')
  })

  const defaults = await stub.request('/x')
  assert.equal(defaults.statusCode, 200)
  assert.equal(defaults.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(defaults.body), { remoteAddress: '127.0.0.1', host: 'localhost' })

  const forged = await stub.request('/x', { remoteAddress: '10.0.0.5', host: 'evil.test', origin: 'http://evil.test' })
  assert.deepEqual(JSON.parse(forged.body), { remoteAddress: '10.0.0.5', host: 'evil.test', origin: 'http://evil.test' })

  assert.throws(() => stub.handlerFor('/missing'), /no handler registered/)
})

test('[AC-008] effect records the label and propagates errors', () => {
  const stub = createHostStub()
  stub.ctx.inject(['webServer'], (httpCtx) => {
    const value = httpCtx.effect(() => 'value', 'cliworker: test')
    assert.equal(value, 'value')
    assert.throws(() => httpCtx.effect(() => { throw new Error('effect boom') }, 'cliworker: bad'), /effect boom/)
  })
  assert.deepEqual(stub.effects, ['cliworker: test', 'cliworker: bad'])
  assert.deepEqual(stub.injectCalls, [['webServer']])
})
