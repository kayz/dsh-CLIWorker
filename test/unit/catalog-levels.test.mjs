import test from 'node:test'
import assert from 'node:assert/strict'
import { listModels, selectModels } from '../../lib/catalog.mjs'

const at = '2026-01-01T00:00:00Z'
const row = (kind, level) => ({ schema: 'cliworker.model/v1', key: 'a', id: 'a', cli: 'x', provider: 'x', vendor: 'x', aliases: [], allowed: false, level, level_source: kind ? { kind, ref: kind, at } : null, availability: { state: 'callable', reason: null, at, ttl_s: 60, evidence: { probe: true } }, identity: 'verified', capabilities: { context_tokens: 0, readonly: false, stdin: false }, prices: { input_per_mtok: 0, output_per_mtok: 0, source: 'x' }, source: { kind: 'manual', ref: 'x', at }, deprecated: false })
const config = levels => ({ catalog: { manual: [], allow: ['a'], levels, aliases: {}, deprecated: {} } })
const ctx = { clock: { nowIso: () => at } }

test('[AC-046] explicit, measured and CLI level priority', () => {
  const input = [row('measured', 'High'), row('cli', 'Quick')]
  const original = structuredClone(input)
  assert.equal(listModels(config({ a: 'top' }), { models: input, ctx })[0].level, 'Top')
  assert.deepEqual(listModels(config({}), { models: input, ctx })[0].level_source, { kind: 'measured', ref: 'measured', at })
  assert.deepEqual(listModels(config({}), { models: [input[1]], ctx })[0].level_source, { kind: 'cli', ref: 'cli', at })
  assert.deepEqual(input, original)
  const unassigned = listModels(config({}), { models: [row(null, null)], ctx })
  assert.deepEqual(selectModels(unassigned).rejected, [{ key: 'a', reason: 'level_unassigned' }])
})
