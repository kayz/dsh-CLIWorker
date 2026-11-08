import test from 'node:test'
import assert from 'node:assert/strict'
import { collectHealth } from '../../lib/health.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const config = JSON.stringify({ providers: {}, models: {} })

test('[AC-061] healthy facts and missing initial caches are aggregated', async () => {
  const ctx = createFakeContext({ files: { '/cw/config.json': config } })
  const result = await collectHealth({ ctx, configPath: '/cw/config.json', registration: 'ok' })
  assert.equal(result.status, 'ok')
  assert.equal(result.checks.length, 8)
  assert.equal(result.checks.find(x => x.id === 'inventory').detail, 'not generated')
  assert.equal(result.checks.find(x => x.id === 'probes').detail, 0)
})

test('[AC-061] faults are collected without exposing the config path', async () => {
  const ctx = createFakeContext({ env: { CLIWORKER_TEST_CLOCK_FILE: 'secret-path' } })
  const result = await collectHealth({ ctx, configPath: '/cw/missing.json', registration: 'failed' })
  assert.equal(result.status, 'degraded')
  assert.equal(result.checks.length, 8)
  assert.equal(result.checks.find(x => x.id === 'config').ok, false)
  assert.equal(result.checks.find(x => x.id === 'registration').ok, false)
  assert.equal(result.test_clock, true)
  assert.doesNotMatch(JSON.stringify(result), /secret-path|missing\.json/)
})

test('[AC-061] inventory age follows the injected clock and corrupt caches degrade', async () => {
  const raw = JSON.stringify({ providers: {}, models: {}, state_dir: '/cw/state' })
  const at = Date.parse('2026-11-07T00:00:00Z')
  const ctx = createFakeContext({ now: at, files: { '/cw/config.json': raw, '/cw/state/inventory.json': JSON.stringify({ schema: 'cliworker.inventory/v1', generated_at: new Date(at - 2000).toISOString(), entries: [] }) } })
  let report = await collectHealth({ ctx, configPath: '/cw/config.json', registration: 'ok' })
  assert.equal(report.checks.find(x => x.id === 'inventory').detail, 2000)
  await ctx.clock.advance(500)
  report = await collectHealth({ ctx, configPath: '/cw/config.json', registration: 'ok' })
  assert.equal(report.checks.find(x => x.id === 'inventory').detail, 2500)
  ctx.fs.writeFileSync('/cw/state/inventory.json', '{')
  ctx.fs.writeFileSync('/cw/state/probes.json', '{')
  report = await collectHealth({ ctx, configPath: '/cw/config.json', registration: 'ok' })
  assert.equal(report.status, 'degraded')
  assert.equal(report.checks.find(x => x.id === 'inventory').ok, false)
  assert.equal(report.checks.find(x => x.id === 'probes').ok, false)
  assert.equal(report.checks.length, 8)
})

test('[AC-061] invalid configuration and unavailable secrets degrade independently', async () => {
  for (const raw of ['{', JSON.stringify({ providers: {}, models: {}, _example: true }), JSON.stringify({ providers: {}, models: {}, token: 'secret-sentinel' })]) {
    const ctx = createFakeContext({ files: { '/cw/config.json': raw } })
    const report = await collectHealth({ ctx, configPath: '/cw/config.json', registration: 'ok' })
    assert.equal(report.checks.find(item => item.id === 'config').ok, false)
    assert.equal(report.checks.length, 8)
    assert.doesNotMatch(JSON.stringify(report), /secret-sentinel/)
  }
  const config = { schema: 'cliworker.config/v2', state_dir: '/cw/state', discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: {}, secrets: { a: { ref: 'env:ABSENT' } } }
  const ctx = createFakeContext({ files: { '/cw/config.json': JSON.stringify(config) } })
  const report = await collectHealth({ ctx, configPath: '/cw/config.json', registration: 'ok' })
  assert.equal(report.checks.find(item => item.id === 'secrets').ok, false)
  assert.equal(report.checks.find(item => item.id === 'config').ok, true)
})

test('[AC-061] unwritable probe and active lock are reported without removing the lock', async () => {
  const raw = { schema: 'cliworker.config/v2', state_dir: '/cw/state', discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: { lock_wait_ms: 0 }, secrets: {} }
  const ctx = createFakeContext({ files: { '/cw/config.json': JSON.stringify(raw) } })
  const lock = '/cw/state/state.lock'
  const originalWrite = ctx.fs.writeFileSync
  originalWrite(lock, JSON.stringify({ pid: process.pid, at: ctx.clock.now(), token: 'holder' }))
  ctx.fs.writeFileSync = (file, value, options) => {
    if (String(file).includes('.health-')) { const error = new Error(); error.code = 'EACCES'; throw error }
    if (String(file).endsWith('state.lock') && options?.flag === 'wx') { const error = new Error(); error.code = 'EEXIST'; throw error }
    return originalWrite(file, value, options)
  }
  const report = await collectHealth({ ctx, configPath: '/cw/config.json', registration: 'ok' })
  assert.equal(report.status, 'degraded')
  assert.equal(report.checks.find(item => item.id === 'state_dir').ok, false)
  assert.equal(report.checks.find(item => item.id === 'lock').ok, false)
  assert.equal(JSON.parse(ctx.fs.readFileSync(lock, 'utf8')).token, 'holder')
})

test('[AC-061] probe expiration uses the existing strict TTL boundary', async () => {
  const at = '2026-11-07T00:00:00.000Z'
  const raw = { schema: 'cliworker.config/v2', state_dir: '/cw/state', discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: { probe_ttl_s: 1 }, secrets: {} }
  const model = { schema: 'cliworker.model/v1', key: 'a', id: 'a', cli: 'cli', provider: 'p', vendor: 'v', aliases: [], allowed: false, level: null, level_source: null, availability: { state: 'callable', reason: null, at, ttl_s: null, evidence: { probe_id: 'p', cmd_redacted: 'cli', exit: 0, duration_ms: 1, nonce_ok: true, reported_model: 'a', tokens: null } }, identity: 'verified', capabilities: { context_tokens: 1, readonly: true, stdin: true }, prices: { input_per_mtok: 0, output_per_mtok: 0, source: 'manual' }, source: { kind: 'manual', ref: 'fixture', at }, deprecated: false }
  const ctx = createFakeContext({ now: Date.parse(at), files: { '/cw/config.json': JSON.stringify(raw), '/cw/state/probes.json': JSON.stringify([model]) } })
  await ctx.clock.advance(1000)
  let report = await collectHealth({ ctx, configPath: '/cw/config.json', registration: 'ok' })
  assert.equal(report.checks.find(item => item.id === 'probes').detail, 0)
  await ctx.clock.advance(1)
  report = await collectHealth({ ctx, configPath: '/cw/config.json', registration: 'ok' })
  assert.equal(report.checks.find(item => item.id === 'probes').ok, false)
  assert.equal(report.checks.find(item => item.id === 'probes').detail, 1)
})
