import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlugin } from '../../lib/index.js'
import { main } from '../../lib/cli.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'
import { createHostStub } from '../helpers/host-stub.mjs'
import { createFlow } from '../helpers/flow.mjs'
import * as doctorStep from '../flows/steps/doctor.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { run as runDoctor } from '../../lib/commands/doctor.mjs'

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

test('[AC-061] doctor flow invokes the real CLI on a new state directory', async () => {
  const flow = createFlow()
  try { await doctorStep.run(flow) } finally { flow.cleanup() }
})

test('[AC-061] real doctor reports test clock warning in the degraded envelope', () => {
  const flow = createFlow()
  try {
    const file = path.join(flow.root, 'clock.txt')
    fs.writeFileSync(file, 'invalid', 'utf8')
    const result = flow.run(['doctor', '--config', flow.config_path], { env: { CLIWORKER_TEST_CLOCK_FILE: file } })
    assert.equal(result.code, 9)
    assert.equal(result.json.error.code, 'E_HEALTH_DEGRADED')
    assert.deepEqual(Object.keys(result.json).sort(), ['error', 'ok'])
    const report = JSON.parse(result.json.error.message)
    assert.equal(report.test_clock, true)
    assert.ok(report.warnings.some(item => item.code === 'W_TEST_CLOCK'))
    assert.equal(report.checks.length, 8)
  } finally { flow.cleanup() }
})

test('[AC-061] health reports this plugin instance registration failure', async () => {
  const ctx = createFakeContext({ files: { '/cw/config.json': JSON.stringify({ providers: {}, models: {} }) } })
  const host = createHostStub({ failPaths: ['/cliworker/models'] })
  createPlugin(host.ctx, { configPath: '/cw/config.json' }, { ctx })
  const response = await host.request('/cliworker/health')
  assert.equal(response.statusCode, 503)
  const report = JSON.parse(response.body)
  assert.equal(report.registration, 'failed')
  assert.equal(report.checks.find(x => x.id === 'registration').ok, false)
})

test('[AC-061] doctor and health agree when equivalent registrations fail', async () => {
  const files = { '/cw/config.json': JSON.stringify({ providers: {}, models: {} }) }
  const httpCtx = createFakeContext({ files })
  const host = createHostStub({ failPaths: ['/cliworker/models'] })
  createPlugin(host.ctx, { configPath: '/cw/config.json' }, { ctx: httpCtx })
  const response = await host.request('/cliworker/health')
  const doctorCtx = createFakeContext({ files })
  const result = await runDoctor({ argv: ['doctor', '--config', '/cw/config.json'], ctx: doctorCtx, hostCtx: createHostStub({ failPaths: ['/cliworker/models'] }).ctx })
  assert.equal(result.exitCode, 9)
  const error = JSON.parse(doctorCtx.stdout.text())
  assert.equal(error.error.code, 'E_HEALTH_DEGRADED')
  assert.deepEqual(JSON.parse(error.error.message), JSON.parse(response.body))
})
