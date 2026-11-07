import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { normalizeQuota, remainingForModels } from '../../lib/pools.mjs'
import { buildForecast } from '../../lib/forecast.mjs'

const shapes = JSON.parse(fs.readFileSync(new URL('../../contracts/golden/quota-shapes.json', import.meta.url), 'utf8'))
const pools = JSON.parse(fs.readFileSync(new URL('../../contracts/golden/b44.json', import.meta.url), 'utf8'))

for (const item of shapes.cases) {
  test(`[AC-015] ${item.id}`, () => {
    const actual = buildForecast({
      quota: item.input.quota,
      samples: item.input.samples,
      usage: item.input.usage,
      now: 0,
    })
    for (const key of Object.keys(item.expected)) {
      assert.deepStrictEqual(actual[key], item.expected[key], `${item.id} ${key}`)
    }
  })
}

test('[AC-015] golden case count', () => {
  assert.equal(shapes.cases.length, 9)
})

test('[AC-015] normalizeQuota percentage shape', () => {
  assert.deepStrictEqual(normalizeQuota({ remaining_pct: 5 }), {
    remaining_fraction: 0.05,
    remaining_mtok: null,
    remaining_usd: null,
    reason: null,
  })
  assert.deepStrictEqual(normalizeQuota({ remaining_pct: 240 }), {
    remaining_fraction: 1,
    remaining_mtok: null,
    remaining_usd: null,
    reason: null,
  })
})

test('[AC-015] normalizeQuota credits shape', () => {
  assert.deepStrictEqual(normalizeQuota({ remaining: 2, unit: 'credits', credits_per_mtok: 1000 }), {
    remaining_fraction: null,
    remaining_mtok: 0.002,
    remaining_usd: null,
    reason: null,
  })
  assert.deepStrictEqual(normalizeQuota({ remaining: 1, unit: 'credits' }), {
    remaining_fraction: null,
    remaining_mtok: null,
    remaining_usd: null,
    reason: 'credits_conversion_missing',
  })
  assert.deepStrictEqual(normalizeQuota({ remaining: 0, unit: 'credits' }), {
    remaining_fraction: null,
    remaining_mtok: 0,
    remaining_usd: null,
    reason: null,
  })
})

test('[AC-015] normalizeQuota tokens shape', () => {
  assert.deepStrictEqual(normalizeQuota({ remaining: 2500000, unit: 'tokens' }), {
    remaining_fraction: null,
    remaining_mtok: 2.5,
    remaining_usd: null,
    reason: null,
  })
})

test('[AC-015] normalizeQuota usd shape', () => {
  assert.deepStrictEqual(normalizeQuota({ remaining_usd: 3 }), {
    remaining_fraction: null,
    remaining_mtok: null,
    remaining_usd: 3,
    reason: null,
  })
})

test('[AC-015] normalizeQuota missing shape', () => {
  assert.deepStrictEqual(normalizeQuota({}), {
    remaining_fraction: null,
    remaining_mtok: null,
    remaining_usd: null,
    reason: 'capacity_unknown',
  })
  assert.deepStrictEqual(normalizeQuota(null), {
    remaining_fraction: null,
    remaining_mtok: null,
    remaining_usd: null,
    reason: 'capacity_unknown',
  })
})

for (const item of pools.cases) {
  test(`[AC-016] ${item.id}`, () => {
    const actual = remainingForModels({
      models: item.input.models,
      pools: item.input.pools,
      rows: item.input.rows,
      now: Date.parse(item.input.now),
      reading_ttl_s: item.input.reading_ttl_s,
    })
    assert.deepStrictEqual(actual, item.expected, item.id)
  })
}

test('[AC-016] golden case count', () => {
  assert.equal(pools.cases.length, 9)
})
