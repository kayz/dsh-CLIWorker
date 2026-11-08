import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { learnCapacity } from '../../lib/capacity.mjs'
import { MODEL_KEY, POOL_ID, createWorkspace, poolRecord, usageRow } from '../fixtures/usage/harness.mjs'

const GOLDEN = JSON.parse(fs.readFileSync(new URL('../../contracts/golden/capacity.json', import.meta.url), 'utf8'))
const CLAUDE = fileURLToPath(new URL('../fixtures/usage/claude-events.json', import.meta.url))

function closeTo(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`)
}

function reading(at, fraction, extra = {}) {
  return { at, fraction, ...extra }
}

test('[AC-050] golden capacity file still has five cases', () => {
  assert.equal(GOLDEN.cases.length, 5)
})

for (const item of GOLDEN.cases) {
  test(`[AC-050] ${item.id}`, () => {
    assert.deepStrictEqual(learnCapacity(item.input), item.expected)
  })
}

test('[AC-050] a delta of exactly 0.01 is kept', () => {
  const actual = learnCapacity({
    readings: [reading('2026-11-07T00:00:00Z', 0.5), reading('2026-11-07T01:00:00Z', 0.51)],
    rows: [{ at: '2026-11-07T00:30:00Z', tokens: 100000 }],
  })
  assert.equal(actual.k, 1)
  assert.equal(actual.confidence, 'low')
  assert.equal(actual.source, 'measured')
  closeTo(actual.capacity_mtok, 10, 'exact threshold')
})

test('[AC-050] a delta below 0.01 discards the pair and its tokens', () => {
  const actual = learnCapacity({
    readings: [reading('2026-11-07T00:00:00Z', 0.5), reading('2026-11-07T01:00:00Z', 0.505)],
    rows: [{ at: '2026-11-07T00:30:00Z', tokens: 100000 }],
  })
  assert.equal(actual, null)
})

test('[AC-050] no usable pair yields null rather than a fabricated capacity', () => {
  assert.equal(learnCapacity({ readings: [reading('2026-11-07T00:00:00Z', 0.5)], rows: [] }), null)
  assert.equal(learnCapacity({
    readings: [reading('2026-11-07T00:00:00Z', 0), reading('2026-11-07T01:00:00Z', 0.5)],
    rows: [],
  }), null)
})

test('[AC-050] the interval is (previous, current] and a boundary row counts once', () => {
  const actual = learnCapacity({
    readings: [reading('2026-11-07T00:00:00Z', 0), reading('2026-11-07T01:00:00Z', 0.5)],
    rows: [
      { at: '2026-11-07T00:00:00Z', tokens: 999999 },
      { at: '2026-11-07T01:00:00Z', tokens: 500000 },
      { at: '2026-11-07T01:00:01Z', tokens: 777777 },
    ],
  })
  assert.equal(actual.k, 1)
  closeTo(actual.capacity_mtok, 1, 'boundary tokens')
})

test('[AC-050] a negative reset pair is dropped without bridging across it', () => {
  const actual = learnCapacity({
    readings: [
      reading('2026-11-07T00:00:00Z', 0),
      reading('2026-11-07T01:00:00Z', 0.1),
      reading('2026-11-07T02:00:00Z', 0.05),
      reading('2026-11-07T03:00:00Z', 0.3),
    ],
    rows: [
      { at: '2026-11-07T00:30:00Z', tokens: 100000 },
      { at: '2026-11-07T01:30:00Z', tokens: 900000 },
      { at: '2026-11-07T02:30:00Z', tokens: 500000 },
    ],
  })
  assert.equal(actual.k, 2)
  closeTo(actual.capacity_mtok, 600000 / 0.35 / 1e6, 'kept intervals only')
})

test('[AC-050] different pools, models and windows never mix', () => {
  const readings = [
    reading('2026-11-07T00:00:00Z', 0, { pool: 'a', window: 'w1' }),
    reading('2026-11-07T00:00:00Z', 0, { pool: 'b', window: 'w1' }),
    reading('2026-11-07T01:00:00Z', 0.5, { pool: 'a', window: 'w1' }),
    reading('2026-11-07T01:00:00Z', 0.5, { pool: 'b', window: 'w1' }),
  ]
  const rows = [
    { at: '2026-11-07T00:30:00Z', tokens: 1000000, model: 'm1', pools: ['a'] },
    { at: '2026-11-07T00:30:00Z', tokens: 3000000, model: 'm1', pools: ['b'] },
  ]
  const a = learnCapacity({ readings, rows, pool: 'a', model: 'm1', window: 'w1' })
  const b = learnCapacity({ readings, rows, pool: 'b', model: 'm1', window: 'w1' })
  assert.equal(a.k, 1)
  assert.equal(b.k, 1)
  closeTo(a.capacity_mtok, 2, 'pool a')
  closeTo(b.capacity_mtok, 6, 'pool b')

  const otherModel = learnCapacity({
    readings: [reading('2026-11-07T00:00:00Z', 0), reading('2026-11-07T01:00:00Z', 0.5)],
    rows: [
      { at: '2026-11-07T00:30:00Z', tokens: 1000000, model: 'm1' },
      { at: '2026-11-07T00:31:00Z', tokens: 4000000, model: 'm2' },
    ],
    model: 'm2',
  })
  closeTo(otherModel.capacity_mtok, 8, 'model isolation')

  const otherWindow = learnCapacity({
    readings,
    rows,
    window: 'w2',
  })
  assert.equal(otherWindow, null)
})

test('[AC-050] imported readings write measured capacity, and forecast consumes it', async () => {
  const w = createWorkspace({
    mutate(config) {
      config.pools = [poolRecord({ capacity_mtok: {}, used_fraction: null })]
    },
  })
  try {
    w.writeUsage([
      usageRow({ idempotency_key: 'before-1', input_tokens: 1000000, output_tokens: 0, at: '2026-11-07T09:15:00Z' }),
      usageRow({ idempotency_key: 'before-2', input_tokens: 1000000, output_tokens: 0, at: '2026-11-07T09:45:00Z' }),
    ])

    const imported = await w.run(['usage', 'import', '--file', CLAUDE, '--cli', 'claude', '--pool', POOL_ID])
    assert.equal(imported.exitCode, 0)
    assert.equal(imported.stderr, '')
    const pool = imported.body.pools.find((item) => item.id === POOL_ID)
    assert.equal(pool.used_fraction.value, 0.6)
    assert.equal(pool.used_fraction.source, 'cli')
    assert.equal(pool.used_fraction.at, '2026-11-07T10:00:00Z')
    assert.equal(pool.window.reset_source, 'cli')
    assert.deepStrictEqual(pool.capacity_mtok[MODEL_KEY], {
      value: 5,
      source: 'measured',
      confidence: 'low',
    })

    const state = w.readPools()
    assert.deepStrictEqual(state[0].capacity_mtok[MODEL_KEY], {
      value: 5,
      source: 'measured',
      confidence: 'low',
    })

    const forecast = await w.run(['models', 'forecast', '--model', MODEL_KEY])
    assert.equal(forecast.exitCode, 0)
    assert.equal(forecast.body.forecast.status, 'known')
    assert.equal(forecast.body.forecast.remaining_mtok, 2)
  } finally {
    w.cleanup()
  }
})

test('[AC-050] the traceability shard names the capacity test', () => {
  const shard = JSON.parse(fs.readFileSync(new URL('../traceability/T-021.json', import.meta.url), 'utf8'))
  assert.equal(shard.task, 'T-021')
  assert.equal(shard.milestone, 'M4')
  assert.deepStrictEqual(shard.entries.map((entry) => entry.ac), ['AC-049', 'AC-050'])
  const entry = shard.entries.find((item) => item.ac === 'AC-050')
  assert.deepStrictEqual(entry.files, ['test/unit/capacity.test.mjs'])
  assert.equal(entry.status, 'covered')
  assert.equal(Object.hasOwn(shard, 'baseline'), false)
})

test('[AC-050] a config capacity is not overwritten by measurement', async () => {
  const w = createWorkspace({
    mutate(config) {
      config.pools = [poolRecord({ used_fraction: null })]
    },
  })
  try {
    w.writeUsage([
      usageRow({ idempotency_key: 'before-1', input_tokens: 1000000, output_tokens: 0, at: '2026-11-07T09:15:00Z' }),
      usageRow({ idempotency_key: 'before-2', input_tokens: 1000000, output_tokens: 0, at: '2026-11-07T09:45:00Z' }),
    ])
    const imported = await w.run(['usage', 'import', '--file', CLAUDE, '--cli', 'claude', '--pool', POOL_ID])
    assert.equal(imported.exitCode, 0)
    const pool = imported.body.pools.find((item) => item.id === POOL_ID)
    assert.deepStrictEqual(pool.capacity_mtok[MODEL_KEY], { value: 10, source: 'config' })
  } finally {
    w.cleanup()
  }
})

test('[AC-050] a shared pool with several models keeps capacity unknown', async () => {
  const w = createWorkspace({
    mutate(config) {
      config.pools = [poolRecord({ capacity_mtok: {}, used_fraction: null })]
    },
  })
  try {
    w.writeUsage([
      usageRow({ idempotency_key: 'a-1', input_tokens: 1000000, at: '2026-11-07T09:15:00Z' }),
      usageRow({ idempotency_key: 'b-1', model: 'other:model', input_tokens: 1000000, at: '2026-11-07T09:45:00Z' }),
    ])
    const imported = await w.run(['usage', 'import', '--file', CLAUDE, '--cli', 'claude', '--pool', POOL_ID])
    assert.equal(imported.exitCode, 0)
    const pool = imported.body.pools.find((item) => item.id === POOL_ID)
    assert.deepStrictEqual(pool.capacity_mtok, {})
  } finally {
    w.cleanup()
  }
})
