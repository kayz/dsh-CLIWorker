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
import { createContext } from '../../lib/context.mjs'

const baseConfig = () => ({ schema: 'cliworker.config/v2', state_dir: '/cw/state', discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: {}, secrets: {} })

function probeRecord(at) {
  return { schema: 'cliworker.model/v1', key: 'a', id: 'a', cli: 'cli', provider: 'p', vendor: 'v', aliases: [], allowed: false, level: null, level_source: null, availability: { state: 'callable', reason: null, at, ttl_s: null, evidence: { probe_id: 'p', cmd_redacted: 'cli', exit: 0, duration_ms: 1, nonce_ok: true, reported_model: 'a', tokens: null } }, identity: 'verified', capabilities: { context_tokens: 1, readonly: true, stdin: true }, prices: { input_per_mtok: 0, output_per_mtok: 0, source: 'manual' }, source: { kind: 'manual', ref: 'fixture', at }, deprecated: false }
}

function unwritableState(ctx) {
  const original = ctx.fs.writeFileSync
  ctx.fs.writeFileSync = (file, value, options) => {
    if (String(file).includes('.health-')) { const error = new Error(); error.code = 'EACCES'; throw error }
    return original(file, value, options)
  }
}

function activeLock(ctx) {
  const lock = '/cw/state/state.lock'
  ctx.fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: ctx.clock.now(), token: 'holder' }))
  const original = ctx.fs.writeFileSync
  ctx.fs.writeFileSync = (file, value, options) => {
    if (String(file).endsWith('state.lock') && options?.flag === 'wx') { const error = new Error(); error.code = 'EEXIST'; throw error }
    return original(file, value, options)
  }
}

async function compareHealth(files, { env, failPaths = [], prepare, advance } = {}) {
  const httpCtx = createFakeContext({ files, env })
  const doctorCtx = createFakeContext({ files, env })
  for (const ctx of [httpCtx, doctorCtx]) {
    if (prepare) prepare(ctx)
    if (advance) await ctx.clock.advance(advance)
  }
  const host = createHostStub({ failPaths })
  createPlugin(host.ctx, { configPath: '/cw/config.json' }, { ctx: httpCtx })
  const response = await host.request('/cliworker/health')
  const result = await runDoctor({ argv: ['doctor', '--config', '/cw/config.json'], ctx: doctorCtx, hostCtx: createHostStub({ failPaths }).ctx })
  const output = JSON.parse(doctorCtx.stdout.text())
  const report = result.exitCode === 0 ? output : JSON.parse(output.error.message)
  delete report.warnings
  assert.equal(result.exitCode, report.status === 'ok' ? 0 : 9)
  if (report.status !== 'ok') assert.equal(output.error.code, 'E_HEALTH_DEGRADED')
  assert.equal(response.statusCode, report.status === 'ok' ? 200 : 503)
  assert.deepEqual(report, JSON.parse(response.body))
  return report
}

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

test('[AC-061] HTTP health and doctor agree across the degraded fault matrix', async (t) => {
  const valid = JSON.stringify(baseConfig())
  const scenarios = [
    { name: 'healthy baseline', files: { '/cw/config.json': valid } },
    { name: 'missing config', files: {} },
    { name: 'corrupt config', files: { '/cw/config.json': '{' } },
    { name: 'example config', files: { '/cw/config.json': JSON.stringify({ ...baseConfig(), _example: true }) } },
    { name: 'inline secret config', files: { '/cw/config.json': JSON.stringify({ ...baseConfig(), token: 'secret-sentinel' }) } },
    { name: 'corrupt inventory', files: { '/cw/config.json': valid, '/cw/state/inventory.json': '{' } },
    { name: 'invalid inventory timestamp', files: { '/cw/config.json': valid, '/cw/state/inventory.json': JSON.stringify({ schema: 'cliworker.inventory/v1', generated_at: '2026-02-31T00:00:00Z', entries: [] }) } },
    { name: 'corrupt probes', files: { '/cw/config.json': valid, '/cw/state/probes.json': '{' } },
    { name: 'expired probes', files: { '/cw/config.json': JSON.stringify({ ...baseConfig(), policy: { probe_ttl_s: 1 } }), '/cw/state/probes.json': JSON.stringify([probeRecord('2026-11-07T00:00:00.000Z')]) }, advance: 1001 },
    { name: 'unwritable state dir', files: { '/cw/config.json': valid }, prepare: unwritableState },
    { name: 'active lock', files: { '/cw/config.json': JSON.stringify({ ...baseConfig(), policy: { lock_wait_ms: 0 } }) }, prepare: activeLock },
    { name: 'unavailable secret backend', files: { '/cw/config.json': JSON.stringify({ ...baseConfig(), secrets: { a: { ref: 'env:ABSENT' } } }) } },
    { name: 'single route registration failure', files: { '/cw/config.json': valid }, failPaths: ['/cliworker/models'] },
    { name: 'file test clock', files: { '/cw/config.json': valid }, env: { CLIWORKER_TEST_CLOCK_FILE: '/cw/clock' } },
    { name: 'multiple faults', files: { '/cw/config.json': JSON.stringify({ ...baseConfig(), secrets: { a: { ref: 'env:ABSENT' } } }), '/cw/state/inventory.json': '{' }, failPaths: ['/cliworker/models'] },
  ]
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const report = await compareHealth(scenario.files, scenario)
      assert.equal(report.checks.length, 8)
      const degraded = report.checks.filter(check => !check.ok).map(check => check.id)
      if (scenario.name === 'healthy baseline') assert.deepEqual(degraded, [])
      else assert.ok(degraded.length > 0, `${scenario.name} must report the injected fault`)
      if (scenario.name === 'single route registration failure') assert.deepEqual(degraded, ['registration'])
      if (scenario.name === 'multiple faults') assert.deepEqual(degraded.sort(), ['inventory', 'registration', 'secrets'])
      if (scenario.name === 'file test clock') assert.equal(report.test_clock, true)
    })
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

test('[AC-061] doctor degrades when registration effects have not run', async () => {
  const ctx = createFakeContext({ files: { '/cw/config.json': JSON.stringify({ providers: {}, models: {} }) } })
  const hostCtx = { inject(_services, fn) { fn({ effect() {}, webServer: { register() {} } }) } }
  const result = await runDoctor({ argv: ['doctor', '--config', '/cw/config.json'], ctx, hostCtx })
  assert.equal(result.exitCode, 9)
  const report = JSON.parse(JSON.parse(ctx.stdout.text()).error.message)
  assert.equal(report.registration, 'failed')
  assert.equal(report.checks.find(item => item.id === 'registration').ok, false)
})

test('[AC-061] file clock cases degrade HTTP and CLI consistently', async () => {
  for (const contents of ['1794000000000', 'invalid', null]) {
    const flow = createFlow()
    try {
      const clockFile = path.join(flow.root, 'clock.txt')
      if (contents !== null) fs.writeFileSync(clockFile, contents, 'utf8')
      const env = { ...flow.env, CLIWORKER_TEST_CLOCK_FILE: clockFile }
      const host = createHostStub()
      createPlugin(host.ctx, { configPath: flow.config_path }, { ctx: createContext({ env }) })
      const response = await host.request('/cliworker/health')
      const result = flow.run(['doctor', '--config', flow.config_path], { env: { CLIWORKER_TEST_CLOCK_FILE: clockFile } })
      assert.equal(response.statusCode, 503)
      assert.equal(result.code, 9)
      assert.equal(result.json.error.code, 'E_HEALTH_DEGRADED')
      const report = JSON.parse(result.json.error.message)
      assert.equal(report.test_clock, true)
      assert.ok(report.warnings.some(w => w.code === 'W_TEST_CLOCK'))
      delete report.warnings
      assert.deepEqual(report, JSON.parse(response.body))
    } finally { flow.cleanup() }
  }
})
