import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  buildForecast,
  burnMtokPerHour,
  classifyRisk,
  confidenceFor,
  etaExhaust,
  quantileForUsage,
  round3,
} from '../../lib/forecast.mjs'

function loadGolden(name) {
  return JSON.parse(fs.readFileSync(new URL(`../../contracts/golden/forecast/${name}`, import.meta.url), 'utf8'))
}

const CALLS = {
  classify_risk: (input) => classifyRisk(input),
  quantile_for_usage: (input) => ({ value: quantileForUsage(input.samples, input.usage) }),
  confidence: (input) => ({ confidence: confidenceFor(input.n, input.cv) }),
  burn_mtok_per_hour: (input) => ({ value: burnMtokPerHour(input) }),
  eta_exhaust: (input) => etaExhaust({
    now: Date.parse(input.now),
    remaining_mtok: input.remaining_mtok,
    burn_mtok_per_hour: input.burn_mtok_per_hour,
    reset_at: input.reset_at,
  }),
  round3: (input) => ({ value: round3(input.value) }),
}

const GOLDEN = [
  { file: 'thresholds.json', count: 21, label: 'thresholds' },
  { file: 'quantiles.json', count: 15, label: 'quantiles' },
  { file: 'confidence.json', count: 11, label: 'confidence' },
  { file: 'burn-eta.json', count: 14, label: 'burn-eta' },
]

for (const golden of GOLDEN) {
  const data = loadGolden(golden.file)
  for (const item of data.cases) {
    test(`[AC-017] ${item.id}`, () => {
      assert.deepStrictEqual(CALLS[item.fn](item.input), item.expected, item.id)
    })
  }
  test(`[AC-017] ${golden.label} golden case count`, () => {
    assert.equal(data.cases.length, golden.count)
  })
}

test('[AC-017] usage quantiles drive tasks left', () => {
  const samples = [
    { mtok: 0.1, cost_usd: null },
    { mtok: 0.2, cost_usd: null },
    { mtok: 0.3, cost_usd: null },
  ]
  const quota = { remaining: 3000000, unit: 'tokens' }
  const now = Date.parse('2026-11-07T10:00:00.000Z')

  const heavy = buildForecast({ quota, samples, usage: 'Heavy', now })
  const normal = buildForecast({ quota, samples, usage: 'Normal', now })
  const light = buildForecast({ quota, samples, usage: 'Light', now })

  assert.equal(heavy.tasks_left, 10)
  assert.equal(normal.tasks_left, 15)
  assert.equal(light.tasks_left, 30)
  assert.deepStrictEqual(normal.tokens_per_task, { p25: 0.1, p50: 0.2, p90: 0.3, n: 3 })
})

test('[AC-017] confidence follows coefficient of variation', () => {
  const now = Date.parse('2026-11-07T10:00:00.000Z')
  const quota = { remaining: 20000000, unit: 'tokens' }

  const spread = []
  for (let index = 0; index < 19; index += 1) spread.push({ mtok: 1, cost_usd: null })
  spread.push({ mtok: 100, cost_usd: null })

  const flat = []
  for (let index = 0; index < 20; index += 1) flat.push({ mtok: 1, cost_usd: null })

  assert.equal(buildForecast({ quota, samples: spread, usage: 'Normal', now }).confidence, 'medium')
  assert.equal(buildForecast({ quota, samples: flat, usage: 'Normal', now }).confidence, 'high')
})

test('[AC-017] buildForecast ignores the wall clock', () => {
  const original = Date.now
  Date.now = () => { throw new Error('wall clock read') }
  try {
    const actual = buildForecast({ quota: { remaining_pct: 15 }, samples: [], usage: 'Normal', now: 0 })
    assert.equal(actual.remaining_fraction, 0.15)
    assert.equal(actual.risk, 'ok')
  } finally {
    Date.now = original
  }
})

test('[AC-017] buildForecast rejects a non-finite now', () => {
  assert.throws(() => buildForecast({ now: Number.NaN }), TypeError)
})
