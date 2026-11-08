import test from 'node:test'
import assert from 'node:assert/strict'
import { listModels, filterAllowed, selectModels, resolveModel } from '../../lib/catalog.mjs'

const at = '2026-01-01T00:00:00Z'
function model(key) {
  return { schema: 'cliworker.model/v1', key, id: key, cli: 'example', provider: 'example', vendor: 'example', aliases: [], allowed: true, level: 'High', level_source: { kind: 'cli', ref: 'cli', at }, availability: { state: 'callable', reason: null, at, ttl_s: 60, evidence: { probe: true } }, identity: 'verified', capabilities: { context_tokens: 1, readonly: false, stdin: true }, prices: { input_per_mtok: 0, output_per_mtok: 1, source: 'test' }, source: { kind: 'manual', ref: 'test', at }, deprecated: false }
}
const config = allow => ({ catalog: { manual: [], allow, levels: {}, aliases: { alias: 'a' }, deprecated: {} } })

test('[AC-045] whitelist filters candidates and downstream callbacks', () => {
  const input = [model('a'), model('b')]
  const original = structuredClone(input)
  const rows = listModels(config(['b']), { models: input })
  assert.deepEqual(input, original)
  assert.equal(resolveModel(rows, 'alias').key, 'a')
  assert.deepEqual(selectModels(rows).models.map(x => x.key), ['b'])
  assert.deepEqual(selectModels(rows).rejected, [])
  const calls = []
  for (const row of filterAllowed(rows)) calls.push(row.key)
  assert.deepEqual(calls, ['b'])
  assert.deepEqual(selectModels(listModels(config([]), { models: input })).models, [])
})

test('[AC-045] the same allowed records feed each downstream callback', () => {
  const rows = listModels(config(['b']), { models: [model('a'), model('b')] })
  const counts = { a: [0, 0, 0], b: [0, 0, 0] }
  const callbacks = [0, 1, 2].map(index => item => { counts[item.key][index] += 1 })
  for (const item of filterAllowed(rows)) for (const callback of callbacks) callback(item)
  assert.deepEqual(counts, { a: [0, 0, 0], b: [1, 1, 1] })
  assert.equal(rows.find(item => item.key === 'a').allowed, false)
})

test('[AC-045] aliases do not bypass denial and conflicts fail without mutation', () => {
  const input = [model('a'), model('b')]
  const cfg = config(['alias'])
  assert.deepEqual(selectModels(listModels(cfg, { models: input })).models.map(item => item.key), ['a'])
  cfg.catalog.allow = []
  assert.deepEqual(selectModels(listModels(cfg, { models: input })), { models: [], rejected: [] })
  const before = structuredClone(input)
  cfg.catalog.aliases = { b: 'a' }
  assert.throws(() => listModels(cfg, { models: input }), { code: 'E_CONFIG' })
  assert.deepEqual(input, before)
})
