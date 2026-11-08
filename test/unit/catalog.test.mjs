import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createFakeContext } from '../helpers/ctx.mjs'
import { main } from '../../lib/cli.mjs'
import { loadConfig } from '../../lib/config.mjs'
import { listModels, filterAllowed, selectModels, resolveModel, managementView, writeCatalog } from '../../lib/catalog.mjs'

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

test('[AC-045] management projection preserves the directory and state', () => {
  const rows = listModels(config(['b']), { models: [model('a'), model('b')] })
  const snapshot = structuredClone(rows)
  const view = managementView(rows)
  assert.equal(view[0].availability.reason, 'not_allowed')
  assert.equal(view[0].availability.state, 'callable')
  assert.deepEqual(rows, snapshot)
})

function setup() {
  const file = path.resolve('catalog-test-config.json')
  const raw = { schema: 'cliworker.config/v2', state_dir: path.resolve('catalog-test-state'), discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: { short: 'a' }, deprecated: {} }, pools: [], policy: {}, secrets: {} }
  const ctx = createFakeContext({ files: { [file]: JSON.stringify(raw) }, platform: process.platform })
  const originalStat = ctx.fs.statSync
  ctx.fs.statSync = name => ({ ...originalStat(name), mtimeMs: Date.parse(at) })
  return { file, raw, ctx, config: loadConfig({ file, ctx }), models: [model('a'), model('b')] }
}

test('[AC-045] locked management writes canonical keys and keeps other fields', async () => {
  const state = setup()
  const invoke = (op, args) => writeCatalog(op, args, state)
  assert.deepEqual(await invoke('allow', ['short']), { ok: true })
  await invoke('allow', ['a'])
  let raw = JSON.parse(state.ctx.fs.readFileSync(state.file, 'utf8'))
  assert.deepEqual(raw.catalog.allow, ['a'])
  assert.deepEqual(raw.discovery, state.raw.discovery)
  await invoke('level', ['short', 'top'])
  await invoke('alias', ['other', 'a'])
  await invoke('deny', ['short'])
  await invoke('deny', ['a'])
  raw = JSON.parse(state.ctx.fs.readFileSync(state.file, 'utf8'))
  assert.deepEqual(raw.catalog.allow, [])
  assert.equal(raw.catalog.levels.a, 'Top')
  assert.equal(raw.catalog.aliases.other, 'a')
  const before = JSON.stringify(raw)
  await assert.rejects(invoke('alias', ['b', 'a']), { code: 'E_REQUEST_INVALID' })
  assert.equal(JSON.stringify(JSON.parse(state.ctx.fs.readFileSync(state.file, 'utf8'))), before)
})

test('[AC-045] CLI routes report missing upstream without calling providers', async () => {
  for (const args of [['list'], ['allow', 'a'], ['deny', 'a'], ['level', 'a', 'High'], ['alias', 'alias', 'a']]) {
    const state = setup()
    const result = await main(['models', ...args, '--config', state.file], state.ctx)
    assert.notEqual(result.exitCode, 0)
    assert.equal(JSON.parse(state.ctx.stdout.text()).error.code, 'E_CONFIG')
    assert.equal(state.ctx.exec.count, 0)
    assert.equal(state.ctx.fetch.calls.length, 0)
  }
})

test('[AC-045] write failures preserve the original configuration', async () => {
  const state = setup()
  const before = state.ctx.fs.readFileSync(state.file, 'utf8')
  state.ctx.fs.renameSync = () => { throw new Error('write failure') }
  await assert.rejects(writeCatalog('allow', ['a'], state), { code: 'E_CONFIG' })
  assert.equal(state.ctx.fs.readFileSync(state.file, 'utf8'), before)
  const v1 = setup()
  v1.ctx.fs.writeFileSync(v1.file, JSON.stringify({ providers: {}, models: {} }))
  const old = v1.ctx.fs.readFileSync(v1.file, 'utf8')
  await assert.rejects(writeCatalog('allow', ['a'], v1), { code: 'E_CONFIG' })
  assert.equal(v1.ctx.fs.readFileSync(v1.file, 'utf8'), old)
})

test('[AC-045] argument errors are returned before accessing the upstream', async () => {
  for (const [args, code] of [[['level', 'a'], 'E_LEVEL_REQUIRED'], [['level', 'a', 'bad'], 'E_LEVEL_UNKNOWN'], [['alias', 'a'], 'E_REQUEST_INVALID'], [['allow', 'a', '--bad'], 'E_REQUEST_INVALID']]) {
    const state = setup()
    const before = state.ctx.fs.readFileSync(state.file, 'utf8')
    const result = await main(['models', ...args, '--config', state.file], state.ctx)
    assert.notEqual(result.exitCode, 0)
    assert.equal(JSON.parse(state.ctx.stdout.text()).error.code, code)
    assert.equal(state.ctx.fs.readFileSync(state.file, 'utf8'), before)
  }
})
