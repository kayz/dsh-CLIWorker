import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { selectModels, usageSamples } from '../../lib/select.mjs'
import { buildForecast } from '../../lib/forecast.mjs'
import { HANDLE_SCHEMA, HEAVY_REJECT_RISKS, SELECTION_SCHEMA, heavyRejection } from '../../lib/select-draft.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const STATUS = { claude: { state: 'callable' } }
const HANDLE_KEYS = [
  'adapter',
  'call',
  'forecast',
  'id',
  'identity',
  'identity_group',
  'key',
  'level',
  'prices',
  'provider',
  'quota',
  'readonly',
  'schema',
  'vendor',
]

function singleConfig() {
  return {
    providers: { claude: { cli: 'claude', readonly: true } },
    models: { quick: { provider: 'claude', id: 'q', level: 'Quick', identity: 'verified' } },
  }
}

/** Twelve models of one provider; four of them never clear the pre-filter, so eight remain. */
function twelveConfig() {
  const models = {}
  for (let i = 0; i < 12; i += 1) {
    models[`m${i}`] = {
      provider: 'claude',
      id: `m${i}`,
      level: 'Quick',
      identity: 'verified',
      prices: { input_per_mtok: i + 1, output_per_mtok: 1 },
    }
  }
  models.m0.level = 'Top'
  models.m1.deprecated = true
  models.m2.identity = 'unverified'
  return { providers: { claude: { cli: 'claude', readonly: true } }, models }
}

function goldenCases() {
  const file = path.join(ROOT, 'contracts', 'golden', 'quota-shapes.json')
  const golden = JSON.parse(fs.readFileSync(file, 'utf8'))
  return golden.cases.filter((item) => item.expected && item.expected.risk)
}

/** One Quick model per golden case, each on its own provider with that case's quota. */
function goldenFixture(cases) {
  const providers = {}
  const models = {}
  const quotas = {}
  const byKey = {}
  cases.forEach((item, index) => {
    providers[`p${index}`] = { cli: `p${index}`, readonly: true }
    models[`m-${item.id}`] = { provider: `p${index}`, id: `x${index}`, level: 'Quick', identity: 'verified' }
    quotas[`p${index}`] = item.input.quota
    byKey[`m-${item.id}`] = item
  })
  const status = {}
  for (const provider of Object.keys(providers)) status[provider] = { state: 'callable' }
  const ctx = {
    forecast: (args) => buildForecast({
      quota: args.quota,
      samples: byKey[args.model].input.samples,
      usage: args.usage,
      now: 0,
    }),
  }
  return { config: { providers, models, quotas }, status, ctx, cases }
}

test('[AC-020] a handle carries call but never cli', () => {
  const result = selectModels(singleConfig(), { level: 'Quick' }, { status: STATUS })

  assert.equal(result.ok, true)
  assert.equal(result.schema, SELECTION_SCHEMA)
  const handle = result.models[0]
  assert.equal(handle.schema, HANDLE_SCHEMA)
  assert.deepEqual(Object.keys(handle).sort(), HANDLE_KEYS)
  assert.equal('cli' in handle, false)
  assert.equal('call' in handle, true)
  assert.deepEqual(result.calls[0], handle.call)
})

test('[AC-020] forecast runs once per model that clears the pre-filter, whatever count and usage are', () => {
  const observed = []
  for (const usage of ['Normal', 'Light', 'Heavy']) {
    for (const count of [1, 3, 8]) {
      const seen = []
      const ctx = {
        forecast: (args) => {
          seen.push(args.model)
          return { risk: 'ok', tasks_left: 9 }
        },
      }
      selectModels(twelveConfig(), { level: 'Quick', count, usage, exclude: ['m3'] }, { status: STATUS, ctx })
      observed.push({ usage, count, size: seen.length, unique: new Set(seen).size })
    }
  }

  assert.deepEqual(observed, observed.map((item) => ({ ...item, size: 8, unique: 8 })))
})

test('[AC-020] every forecast call receives model, prices, quota, records, usage and now', () => {
  const records = [{ model: 'm4', input_tokens: 1000, output_tokens: 0, cost_usd: 0.2 }]
  const now = 1_700_000_000_000
  const seen = []
  const ctx = {
    now: () => now,
    forecast: (args) => {
      seen.push(args)
      return { risk: 'ok', tasks_left: 9 }
    },
  }
  const config = twelveConfig()

  selectModels(config, { level: 'Quick', count: 1, exclude: ['m3'] }, { status: STATUS, usage: records, ctx })

  assert.equal(seen.length, 8)
  for (const args of seen) {
    assert.equal(typeof args.model, 'string')
    assert.deepEqual(args.prices, config.models[args.model].prices)
    assert.equal(args.records, records)
    assert.equal(args.usage, 'Normal')
    assert.equal(args.now, now)
    assert.ok(Object.prototype.hasOwnProperty.call(args, 'quota'))
  }
})

test('[AC-020] without ctx.forecast the default buildForecast path is used', () => {
  const now = 1_700_000_000_000
  const records = [
    { model: 'quick', input_tokens: 1_000_000, output_tokens: 500_000, cost_usd: 2 },
    { model: 'quick', input_tokens: 1_000_000, output_tokens: 500_000, cost_usd: 2 },
    { model: 'quick', input_tokens: 1_000_000, output_tokens: 500_000, cost_usd: 2 },
  ]
  const ctx = { now: () => now }

  const result = selectModels(singleConfig(), { level: 'Quick' }, { status: STATUS, usage: records, ctx })

  assert.equal(result.models.length, 1)
  assert.equal(result.models[0].forecast.schema, 'cliworker.forecast/v1')
  assert.equal(typeof result.models[0].forecast.risk, 'string')
})

test('[AC-020] usageSamples filters by model and projects tokens and cost', () => {
  const records = [
    { model: 'a', input_tokens: 1_000_000, output_tokens: 500_000, cost_usd: 2 },
    { model: 'b', input_tokens: 10, output_tokens: 0, cost_usd: 1 },
    { model: 'a', input_tokens: 0, output_tokens: 0 },
    { model: 'a', input_tokens: 10, output_tokens: 0, cost_usd: '5' },
  ]

  assert.deepEqual(usageSamples(records, 'a'), [
    { mtok: 1.5, cost_usd: 2 },
    { mtok: null, cost_usd: null },
    { mtok: 0.00001, cost_usd: null },
  ])
  assert.deepEqual(usageSamples('not-an-array', 'a'), [])
  assert.deepEqual(usageSamples(undefined, 'a'), [])
})

test('[AC-021] Heavy rejects exactly the risky golden cases and Normal and Light reject none', () => {
  const cases = goldenCases()
  const { config, status, ctx } = goldenFixture(cases)
  const bad = HEAVY_REJECT_RISKS
  const expected = cases
    .filter((item) => bad.includes(item.expected.risk))
    .map((item) => `m-${item.id}`)
    .sort()
  assert.ok(expected.length >= 5)

  const heavy = selectModels(config, { level: 'Quick', count: 10, usage: 'Heavy' }, { status, ctx })
  const rejected = heavy.rejected
    .filter((item) => item.reason === 'E_FORECAST_EXHAUSTION')
    .map((item) => item.key)
    .sort()
  assert.deepEqual(rejected, expected)
  assert.equal(heavy.rejected.length, expected.length)
  assert.deepEqual(
    heavy.models.map((item) => item.key).sort(),
    cases.map((item) => `m-${item.id}`).filter((key) => !expected.includes(key)).sort()
  )

  for (const usage of ['Normal', 'Light']) {
    const result = selectModels(config, { level: 'Quick', count: 10, usage }, { status, ctx })
    assert.deepEqual(result.rejected.filter((item) => item.reason === 'E_FORECAST_EXHAUSTION'), [])
    assert.equal(result.rejected.length, 0)
    assert.equal(result.models.length, cases.length)
  }
})

test('[AC-021] heavyRejection follows the risk list and the Heavy-only rule', () => {
  const forecast = (risk) => ({ risk })

  for (const risk of ['exhausted', 'critical', 'low_reserve']) {
    assert.deepEqual(heavyRejection({ key: 'k', usage: 'Heavy', forecast: forecast(risk) }), {
      key: 'k',
      reason: 'E_FORECAST_EXHAUSTION',
      forecast: forecast(risk),
    })
  }
  assert.equal(heavyRejection({ key: 'k', usage: 'Heavy', forecast: forecast('ok') }), null)
  assert.equal(heavyRejection({ key: 'k', usage: 'Heavy', forecast: forecast('unknown') }), null)
  assert.equal(heavyRejection({ key: 'k', usage: 'Heavy', forecast: undefined }), null)
  assert.equal(heavyRejection({ key: 'k', usage: 'Normal', forecast: forecast('exhausted') }), null)
  assert.equal(heavyRejection({ key: 'k', usage: 'Light', forecast: forecast('critical') }), null)
  assert.deepEqual(HEAVY_REJECT_RISKS, ['exhausted', 'critical', 'low_reserve'])
})

test('[AC-021] a real usage ledger row keeps the q-usd model selectable under Heavy', () => {
  const item = goldenCases().find((entry) => entry.id === 'q-usd')
  const key = 'golden-q-usd'
  const config = {
    providers: { claude: { cli: 'claude', readonly: true } },
    models: { [key]: { provider: 'claude', id: 'q-usd', level: 'Quick', identity: 'verified' } },
    quotas: { claude: item.input.quota },
  }
  const usage = item.input.samples.map((sample) => ({ model: key, cost_usd: sample.cost_usd }))

  const result = selectModels(config, { level: 'Quick', usage: 'Heavy' }, { status: STATUS, usage })

  assert.equal(result.rejected.length, 0)
  assert.equal(result.models.length, 1)
  assert.equal(result.models[0].forecast.risk, 'ok')
  assert.equal(result.models[0].forecast.tasks_left, item.expected.tasks_left)
})
