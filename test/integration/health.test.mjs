import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlugin } from '../../lib/index.js'
import { main } from '../../lib/cli.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'
import { createHostStub } from '../helpers/host-stub.mjs'

test('[AC-061] HTTP health and doctor agree for healthy and missing config', async () => {
  for (const valid of [true, false]) {
    const files = valid ? { '/cw/config.json': JSON.stringify({ providers: {}, models: {} }) } : {}
    const ctx = createFakeContext({ files })
    const host = createHostStub()
    createPlugin(host.ctx, { configPath: '/cw/config.json' }, { ctx })
    const http = await host.request('/cliworker/health')
    const cli = await main(['doctor', '--config', '/cw/config.json'], ctx)
    const output = JSON.parse(ctx.stdout.text())
    const report = valid ? output : JSON.parse(output.error.message)
    assert.equal(http.statusCode, valid ? 200 : 503)
    assert.equal(cli.exitCode, valid ? 0 : 9)
    if (!valid) assert.equal(output.error.code, 'E_HEALTH_DEGRADED')
    assert.deepEqual(report, JSON.parse(http.body))
  }
})
