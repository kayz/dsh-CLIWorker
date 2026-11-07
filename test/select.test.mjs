import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { selectModels, listModels } from '../lib/select.mjs'
import { forecast, estimateCost } from '../lib/forecast.mjs'

function config() {
  return {
    providers: {
      claude: { cli: 'claude', adapter: 'claude', readonly: true },
      codebuddy: { cli: 'codebuddy', adapter: 'codebuddy', readonly: true },
      codex: { cli: 'codex', adapter: 'codex', readonly: true },
    },
    models: {
      a: { provider: 'claude', id: 'a', tier: 'top', identity: 'verified', identity_group: 'a', vendor: 'anthropic', prices: { input_per_mtok: 10, output_per_mtok: 20 } },
      b: { provider: 'codebuddy', id: 'b', tier: 'top', identity: 'verified', identity_group: 'b', vendor: 'tencent', prices: { input_per_mtok: 0, output_per_mtok: 0 } },
      old: { provider: 'codebuddy', id: 'old', tier: 'top', identity: 'verified', identity_group: 'old', vendor: 'tencent', deprecated: true },
      unverified: { provider: 'codex', id: 'u', tier: 'top', identity: 'unverified', identity_group: 'u', vendor: 'openai' },
    },
    quotas: {},
  }
}

test('deprecated and unverified models never enter candidates', () => {
  const status = { claude: { state: 'callable' }, codebuddy: { state: 'callable' }, codex: { state: 'callable' } }
  const r = selectModels(config(), { tier: 'top', count: 3 }, { status })
  assert.deepEqual(r.models.map((m) => m.key).sort(), ['a', 'b'])
  assert.ok(r.rejected.some((x) => x.key === 'old' && /availability/.test(x.reason)))
  assert.ok(r.rejected.some((x) => x.key === 'unverified' && x.reason === 'identity_unverified'))
})

test('read-only requirement rejects providers without it', () => {
  const c = config()
  c.models.b.readonly = false
  const status = { claude: { state: 'callable' }, codebuddy: { state: 'callable' }, codex: { state: 'callable' } }
  const r = selectModels(c, { tier: 'top', count: 3, require_readonly: true }, { status })
  assert.deepEqual(r.models.map((m) => m.key), ['a'])
  assert.ok(r.rejected.some((x) => x.key === 'b' && x.reason === 'readonly_unavailable'))
})

test('forecast is unknown without samples and deterministic with fixed samples', () => {
  assert.equal(forecast({ records: [], model: 'a' }).status, 'unknown')
  const now = Date.parse('2026-11-07T00:00:00Z')
  const records = [
    { model: 'a', at: '2026-11-06T23:00:00Z', input_tokens: 1_000_000, output_tokens: 0, cost_usd: 10 },
    { model: 'a', at: '2026-11-06T23:30:00Z', input_tokens: 1_000_000, output_tokens: 0, cost_usd: 10 },
  ]
  const f = forecast({ records, model: 'a', now, quota: { remaining_usd: 100 } })
  assert.equal(f.status, 'known')
  assert.equal(f.burn_per_task, 10)
  assert.equal(f.tasks_left, 10)
  assert.equal(f.risk, 'ok')
  assert.equal(estimateCost({ input_tokens: 1_000_000, output_tokens: 0, prices: { input_per_mtok: 10, output_per_mtok: 20 } }), 10)
})

test('models list hides deprecated by default, includes with flag', () => {
  const status = { claude: { state: 'callable' }, codebuddy: { state: 'callable' }, codex: { state: 'callable' } }
  const a = listModels(config(), { status })
  assert.ok(!a.some((m) => m.key === 'old'))
  const b = listModels(config(), { status, includeDeprecated: true })
  assert.ok(b.some((m) => m.key === 'old' && m.deprecated))
})
