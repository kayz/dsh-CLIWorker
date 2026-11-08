import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlugin } from '../../lib/index.js'
import { createHostStub } from '../helpers/host-stub.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

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
