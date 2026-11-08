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
