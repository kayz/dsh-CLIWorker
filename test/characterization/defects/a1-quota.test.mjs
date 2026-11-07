import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const V01 = process.env.CLIWORKER_V01_ROOT
  ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))

test('[repro] [AC-005] a percentage quota turns the forecast into unknown', async () => {
  const { forecast } = await import(pathToFileURL(path.join(V01, 'lib', 'forecast.mjs')).href)
  const now = Date.UTC(2026, 0, 1, 12, 0, 0)
  const records = [1, 2, 3].map((step) => ({
    model: 'claude-quick',
    at: new Date(now - step * 10 * 60_000).toISOString(),
    cost_usd: 0.5,
  }))

  const percent = forecast({ records, model: 'claude-quick', quota: { remaining_pct: 5 }, now })
  assert.equal(percent.risk, 'unknown')
  assert.equal(percent.tasks_left, null)
  assert.equal('remaining_fraction' in percent, false)
  assert.equal('risk_basis' in percent, false)

  const credits = forecast({ records, model: 'claude-quick', quota: { remaining: 1, unit: 'credits' }, now })
  assert.equal(credits.risk, 'unknown')
  assert.equal('reason' in credits, false)
})
test('[fixed] [AC-015] live forecast reads percentage and credits quotas', async () => {
  const { buildForecast } = await import('../../../lib/forecast.mjs')
  const samples = [
    { mtok: 0.2, cost_usd: null },
    { mtok: 0.2, cost_usd: null },
    { mtok: 0.2, cost_usd: null },
  ]

  const percent = buildForecast({ quota: { remaining_pct: 5 }, samples, usage: 'Normal', now: 0 })
  assert.equal(percent.remaining_fraction, 0.05)
  assert.equal(percent.remaining_mtok, null)
  assert.equal(percent.tasks_left, null)
  assert.equal(percent.tasks_left_basis, 'none')
  assert.equal(percent.risk, 'low_reserve')
  assert.equal(percent.risk_basis, 'fraction')

  const credits = buildForecast({ quota: { remaining: 1, unit: 'credits' }, samples: [], usage: 'Normal', now: 0 })
  assert.equal(credits.reason, 'credits_conversion_missing')
  assert.equal(credits.risk, 'unknown')
  assert.equal(credits.risk_basis, 'none')
  assert.equal(credits.status, 'unknown')
})
