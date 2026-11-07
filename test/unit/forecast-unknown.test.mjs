import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { buildForecast } from '../../lib/forecast.mjs'
import { validate } from '../../lib/contract/validate.mjs'

const schema = JSON.parse(fs.readFileSync(new URL('../../contracts/schemas/forecast.v1.schema.json', import.meta.url), 'utf8'))
const registry = JSON.parse(fs.readFileSync(new URL('../../contracts/registry.snapshot.json', import.meta.url), 'utf8'))
const REASONS = registry.forecast_reasons

function noSampleForecast(quota) {
  return buildForecast({ quota, samples: [], usage: 'Normal', now: 0 })
}

test('[AC-018] assumed estimate never becomes the risk basis', () => {
  const actual = noSampleForecast({ remaining_pct: 50, remaining: 2000000, unit: 'tokens' })

  assert.equal(validate(schema, actual).ok, true)
  assert.equal(actual.remaining_fraction, 0.5)
  assert.equal(actual.remaining_mtok, 2)
  assert.equal(actual.tasks_left, null)
  assert.equal(actual.tasks_left_basis, 'none')
  assert.equal(actual.tasks_left_assumed, 4)
  assert.equal(actual.confidence, 'none')
  assert.equal(actual.risk, 'ok')
  assert.equal(actual.risk_basis, 'fraction')
  assert.equal(actual.reason, 'no_samples')
})

test('[AC-018] capacity without a fraction leaves the risk unknown', () => {
  const actual = noSampleForecast({ remaining: 2000000, unit: 'tokens' })

  assert.equal(validate(schema, actual).ok, true)
  assert.equal(actual.remaining_mtok, 2)
  assert.equal(actual.remaining_fraction, null)
  assert.equal(actual.tasks_left, null)
  assert.equal(actual.tasks_left_assumed, 4)
  assert.equal(actual.risk, 'unknown')
  assert.equal(actual.risk_basis, 'none')
  assert.equal(actual.confidence, 'none')
  assert.equal(actual.reason, 'no_samples')
  assert.equal(actual.status, 'known')
})

test('[AC-018] credits without a rate stay unknown with a registered reason', () => {
  const actual = noSampleForecast({ remaining: 1, unit: 'credits' })

  assert.equal(validate(schema, actual).ok, true)
  assert.equal(actual.status, 'unknown')
  assert.equal(actual.risk, 'unknown')
  assert.equal(actual.risk_basis, 'none')
  assert.equal(actual.reason, 'credits_conversion_missing')
  assert.equal(actual.tasks_left_assumed, null)
  assert.equal(REASONS.includes(actual.reason), true)
})

test('[AC-018] an empty quota is unknown with a registered reason', () => {
  const actual = noSampleForecast({})

  assert.equal(validate(schema, actual).ok, true)
  assert.equal(actual.status, 'unknown')
  assert.equal(actual.risk, 'unknown')
  assert.equal(actual.risk_basis, 'none')
  assert.equal(actual.tasks_left_basis, 'none')
  assert.equal(actual.reason, 'capacity_unknown')
  assert.equal(REASONS.includes(actual.reason), true)
})

test('[AC-018] no sample input claims a tasks-based risk', () => {
  const quotaShapes = [
    {},
    null,
    { remaining_pct: 50 },
    { remaining_pct: 12 },
    { remaining_pct: 0 },
    { remaining: 2000000, unit: 'tokens' },
    { remaining: 0, unit: 'tokens' },
    { remaining: 1, unit: 'credits' },
    { remaining: 0, unit: 'credits' },
    { remaining: 1, unit: 'credits', credits_per_mtok: 1000 },
    { remaining_usd: 3 },
    { remaining_usd: 0 },
  ]

  for (const quota of quotaShapes) {
    const actual = noSampleForecast(quota)
    assert.equal(validate(schema, actual).ok, true, JSON.stringify(quota))
    assert.equal(actual.status === 'unknown' || actual.tasks_left === null, true, JSON.stringify(quota))
    assert.notEqual(actual.tasks_left_basis, 'assumed', JSON.stringify(quota))
    if (actual.tasks_left === null) assert.notEqual(actual.risk_basis, 'tasks', JSON.stringify(quota))
    if (actual.risk_basis !== 'fraction') {
      assert.equal(actual.risk === 'ok' || actual.risk === 'critical', false, JSON.stringify(quota))
    }
    if (actual.reason !== null) assert.equal(REASONS.includes(actual.reason), true, JSON.stringify(quota))
  }
})
