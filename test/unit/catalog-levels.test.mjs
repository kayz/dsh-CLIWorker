import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validate } from '../../lib/contract/validate.mjs'
import { listModels, selectModels, resolveModel } from '../../lib/catalog.mjs'

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

test('[AC-046] configuration evidence is retained and invalid values fail', () => {
  const configured = row('config', 'Top')
  configured.level_source = { kind: 'config', ref: 'config#catalog.levels.a', at }
  assert.deepEqual(listModels(config({ a: 'top' }), { models: [configured], ctx })[0].level_source, configured.level_source)
  for (const invalid of [null, '', 'unknown', 0, undefined]) {
    assert.throws(() => listModels(config({ a: invalid }), { models: [row('cli', 'High')], ctx }), { code: 'E_CONFIG' })
  }
  const fileConfig = config({ a: 'High' })
  fileConfig._file = 'config.json'
  assert.throws(() => listModels(fileConfig, { models: [row('cli', 'High')], ctx: { ...ctx, fs: { statSync() { throw new Error('read failed') } } } }), { code: 'E_CONFIG' })
})

test('[AC-046] equal priority uses newest evidence and rejects ties in conflict', () => {
  const older = row('measured', 'High')
  const newer = row('measured', 'Top')
  newer.level_source.at = '2026-02-01T00:00:00Z'
  for (const input of [[older, newer], [newer, older]]) assert.equal(listModels(config({}), { models: input, ctx })[0].level, 'Top')
  newer.level_source.at = at
  assert.throws(() => listModels(config({}), { models: [older, newer], ctx }), { code: 'E_CONFIG' })
})

test('[AC-046] deprecation preserves evidence and invalid metadata is rejected', () => {
  const input = row(null, null)
  const cfg = config({})
  cfg.catalog.deprecated.a = true
  const result = listModels(cfg, { models: [input], ctx })[0]
  assert.equal(result.availability.state, 'deprecated')
  assert.deepEqual(result.availability.evidence, { probe: true })
  assert.deepEqual(selectModels([result]).rejected, [{ key: 'a', reason: 'deprecated' }])
  assert.equal(input.availability.state, 'callable')
  for (const value of [-1, NaN, Infinity, '0']) {
    const bad = row('cli', 'High')
    bad.prices.input_per_mtok = value
    assert.throws(() => listModels(config({}), { models: [bad], ctx }), { code: 'E_CONFIG' })
  }
})

test('[AC-046] every level normalizes and output satisfies model/v1', () => {
  const schema = JSON.parse(readFileSync(new URL('../../contracts/schemas/model.v1.schema.json', import.meta.url), 'utf8'))
  for (const [input, expected] of [['TOP', 'Top'], ['high', 'High'], ['MiDdLe', 'Middle'], ['quick', 'Quick']]) {
    const original = row('cli', 'High')
    const actual = listModels(config({ a: input }), { models: [original], ctx })[0]
    assert.equal(actual.level, expected)
    assert.deepEqual(actual.capabilities, { context_tokens: 0, readonly: false, stdin: false })
    assert.deepEqual(actual.prices, { input_per_mtok: 0, output_per_mtok: 0, source: 'x' })
    assert.deepEqual(actual.source, { kind: 'manual', ref: 'x', at })
    assert.equal(validate(schema, actual).ok, true)
  }
})

test('[AC-046] aliases resolve without duplicate candidates and reject invalid mappings', () => {
  const a = row('cli', 'High')
  const b = { ...structuredClone(a), key: 'b', id: 'b' }
  a.aliases = ['short']
  const cfg = config({})
  cfg.catalog.aliases = { short: 'a' }
  const models = listModels(cfg, { models: [a, b], ctx })
  assert.strictEqual(resolveModel(models, 'short'), resolveModel(models, 'a'))
  assert.equal(models.length, 2)
  for (const aliases of [{ '': 'a' }, { a: 'a' }, { b: 'a' }, { missing: 'unknown' }, { short: 'b' }, { one: 'two', two: 'a' }, { one: 'two', two: 'one' }]) {
    const before = structuredClone(aliases)
    cfg.catalog.aliases = aliases
    assert.throws(() => listModels(cfg, { models: [a, b], ctx }), { code: 'E_CONFIG' })
    assert.deepEqual(aliases, before)
  }
})

test('[AC-046] configuration time comes from the file metadata', () => {
  const cfg = config({ a: 'Quick' })
  cfg._file = 'configuration.json'
  const modified = '2026-03-02T00:00:00.000Z'
  const actual = listModels(cfg, { models: [row('cli', 'High')], ctx: { ...ctx, fs: { statSync: () => ({ mtimeMs: Date.parse(modified) }) } } })[0]
  assert.deepEqual(actual.level_source, { kind: 'config', ref: 'configuration.json#catalog.levels.a', at: modified })
})

test('[AC-046] malformed catalog configuration fails without mutating input', () => {
  const input = row('cli', 'High')
  const before = structuredClone(input)
  for (const [key, value] of [['allow', [42]], ['levels', null], ['aliases', []], ['deprecated', { a: 'true' }]]) {
    const cfg = config({})
    cfg.catalog[key] = value
    assert.throws(() => listModels(cfg, { models: [input], ctx }), { code: 'E_CONFIG' })
  }
  assert.deepEqual(input, before)
})
