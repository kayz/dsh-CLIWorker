import test from 'node:test'
import assert from 'node:assert/strict'

import { evaluatePools, resolveResetAt } from '../../lib/pools.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const NOW = Date.parse('2026-11-07T10:00:00.000Z')

test('[AC-019] resolveResetAt prefers cli over config', () => {
  const resolved = resolveResetAt({
    cli: '2026-11-07T12:00:00Z',
    config: '2026-11-08T00:00:00Z',
    now: NOW,
  })
  assert.deepStrictEqual(resolved, { reset_at: '2026-11-07T12:00:00.000Z', reset_source: 'cli' })
})

test('[AC-019] resolveResetAt falls back to config', () => {
  const resolved = resolveResetAt({ config: '2026-11-07T12:00:00Z', now: NOW })
  assert.deepStrictEqual(resolved, { reset_at: '2026-11-07T12:00:00.000Z', reset_source: 'config' })
})

test('[AC-019] resolveResetAt estimates a rolling window', () => {
  const resolved = resolveResetAt({
    window: { anchor: 'rolling', length_s: 3600 },
    rows: [
      { at: '2026-11-07T08:00:00.000Z' },
      { at: '2026-11-07T09:30:00.000Z' },
      { at: '2026-11-07T09:10:00.000Z' },
    ],
    now: NOW,
  })
  assert.deepStrictEqual(resolved, { reset_at: '2026-11-07T10:10:00.000Z', reset_source: 'estimated' })
})

test('[AC-019] resolveResetAt is unknown without candidates', () => {
  assert.deepStrictEqual(resolveResetAt({ now: NOW }), { reset_at: null, reset_source: 'unknown' })
})

function pool(source) {
  return {
    id: 'p',
    window: {
      start_at: '2026-11-07T07:00:00.000Z',
      reset_at: '2026-11-07T12:00:00.000Z',
      reset_source: source,
    },
    capacity_mtok: { m: 10 },
    reading: { value: 0.5, at: '2026-11-07T11:50:01.000Z' },
  }
}

test('[AC-019] a cli reset clears usage and a config reset only asks for a recheck', async () => {
  const ctx = createFakeContext({ now: Date.parse('2026-11-07T11:59:59.000Z') })

  const before = evaluatePools({ models: ['m'], pools: [pool('cli')], rows: [], now: ctx.clock.now(), reading_ttl_s: 600 })
  assert.equal(before.m.pools[0].used_fraction, 0.5)
  assert.equal(before.m.pools[0].recheck, false)

  await ctx.clock.advance(2000)

  const after = evaluatePools({ models: ['m'], pools: [pool('cli')], rows: [], now: ctx.clock.now(), reading_ttl_s: 600 })
  assert.equal(after.m.pools[0].used_fraction, 0)
  assert.equal(after.m.pools[0].recheck, false)

  const kept = evaluatePools({ models: ['m'], pools: [pool('config')], rows: [], now: ctx.clock.now(), reading_ttl_s: 600 })
  assert.equal(kept.m.pools[0].used_fraction, 0.5)
  assert.equal(kept.m.pools[0].recheck, true)
})
