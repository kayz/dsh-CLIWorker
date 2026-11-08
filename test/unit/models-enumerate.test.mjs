import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createFakeContext } from '../helpers/ctx.mjs'
import { main } from '../../lib/cli.mjs'
import * as enumerateCommand from '../../lib/commands/models/enumerate.mjs'

const AT = '2026-01-01T00:00:00Z'
const FILE = path.resolve('tmp-models-enumerate-config.json')
const STATE = path.resolve('tmp-models-enumerate-state')

const MODEL_KEYS = [
  'aliases',
  'allowed',
  'availability',
  'capabilities',
  'cli',
  'deprecated',
  'id',
  'identity',
  'key',
  'level',
  'level_source',
  'prices',
  'provider',
  'schema',
  'source',
  'vendor',
].sort()

function model(provider, id, overrides = {}) {
  const key = `${provider}:${id}`
  return {
    schema: 'cliworker.model/v1',
    key,
    id,
    cli: `${provider}-cli`,
    provider,
    vendor: `vendor-${provider}`,
    aliases: [],
    allowed: false,
    level: null,
    level_source: null,
    availability: { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null },
    identity: 'unverified',
    capabilities: { context_tokens: 128000, readonly: false, stdin: true },
    prices: { input_per_mtok: 1, output_per_mtok: 2, source: 'manual' },
    source: { kind: 'manual', ref: 'test', at: AT },
    deprecated: false,
    ...overrides,
  }
}

function config({ manual = [], allow = [], levels = {}, aliases = {}, deprecated = {} } = {}) {
  return {
    schema: 'cliworker.config/v2',
    state_dir: STATE,
    secrets: {},
    discovery: {
      extra_dirs: [],
      wsl: false,
      probe_unknown: false,
      unknown_patterns: [],
      cli_overrides: { example: { cli: 'example-cli' }, other: { cli: 'other-cli' } },
    },
    catalog: { allow, levels, aliases, deprecated, manual },
    pools: [],
    policy: {},
  }
}

function setup(payload) {
  const ctx = createFakeContext({ files: { [FILE]: JSON.stringify(payload) }, platform: process.platform })
  const original = ctx.fs.statSync
  ctx.fs.statSync = (name) => ({ ...original(name), mtimeMs: Date.parse(AT) })
  return ctx
}

function readBody(ctx) {
  return JSON.parse(ctx.stdout.text())
}

async function run(ctx, args) {
  const before = ctx.stdout.text().length
  const result = await main(['models', 'enumerate', ...args, '--config', FILE], ctx)
  return { result, body: JSON.parse(ctx.stdout.text().slice(before)) }
}

test('[AC-041] enumerate projects configured models in key order with the shared model shape', async () => {
  const ctx = setup(config({
    manual: [model('example', 'zeta'), model('example', 'alpha')],
    allow: ['example:alpha'],
  }))

  const first = await run(ctx, [])
  assert.equal(first.result.exitCode, 0)
  assert.equal(ctx.stderr.text(), '')
  assert.deepEqual(Object.keys(first.body), ['schema', 'models'])
  assert.equal(first.body.schema, 'cliworker.models/v1')
  assert.deepEqual(first.body.models.map((row) => row.key), ['example:alpha', 'example:zeta'])
  for (const row of first.body.models) assert.deepEqual(Object.keys(row).sort(), MODEL_KEYS)
  assert.equal(first.body.models[0].allowed, true)
  assert.equal(first.body.models[0].availability.reason, null)
  assert.equal(first.body.models[1].allowed, false)
  assert.equal(first.body.models[1].availability.reason, 'not_allowed')
  assert.equal(first.body.models[1].source.kind, 'manual')
  assert.equal(first.body.models[1].source.at, AT)

  const stable = await run(ctx, [])
  assert.deepEqual(stable.body, first.body)
})

test('[AC-041] enumerate honours --config and reads the selected configuration', async () => {
  const one = setup(config({ manual: [model('example', 'one')] }))
  const two = setup(config({ manual: [model('other', 'two'), model('other', 'another')] }))

  const first = await run(one, [])
  const second = await run(two, [])
  assert.deepEqual(first.body.models.map((row) => row.key), ['example:one'])
  assert.deepEqual(second.body.models.map((row) => row.key), ['other:another', 'other:two'])
})

test('[AC-041] enumerate merges catalog levels, aliases and allow without mutating the config', async () => {
  const record = model('example', 'alpha', {
    level: 'High',
    aliases: ['fast'],
    level_source: { kind: 'config', ref: `${FILE}#catalog.levels.example:alpha`, at: AT },
  })
  const payload = config({
    manual: [record],
    allow: ['fast'],
    levels: { 'example:alpha': 'High' },
    aliases: { quickest: 'example:alpha' },
  })
  const snapshot = JSON.stringify(payload)
  const ctx = setup(payload)

  const { result, body } = await run(ctx, [])
  assert.equal(result.exitCode, 0)
  assert.equal(body.models.length, 1)
  const row = body.models[0]
  assert.equal(row.level, 'High')
  assert.deepEqual(row.level_source, record.level_source)
  assert.deepEqual(row.aliases, ['fast', 'quickest'])
  assert.equal(row.allowed, true)
  assert.equal(JSON.stringify(payload), snapshot)
})

test('[AC-041] enumerate hides deprecated records by default and includes them with --full', async () => {
  const ctx = setup(config({
    manual: [
      model('example', 'current'),
      model('example', 'old', { deprecated: true, availability: { state: 'deprecated', reason: 'deprecated', at: null, ttl_s: null, evidence: null } }),
    ],
  }))

  const plain = await run(ctx, [])
  assert.equal(plain.result.exitCode, 0)
  assert.deepEqual(plain.body.models.map((row) => row.key), ['example:current'])

  const full = await run(ctx, ['--full'])
  assert.equal(full.result.exitCode, 0)
  assert.deepEqual(full.body.models.map((row) => row.key), ['example:current', 'example:old'])
  assert.equal(full.body.models[1].deprecated, true)
  assert.equal(full.body.models[1].availability.state, 'deprecated')
})

test('[AC-041] enumerate rejects unknown options, bad records and missing config with the shared errors', async () => {
  assert.deepEqual(enumerateCommand.route, { cmd: 'models', sub: 'enumerate' })

  const unknown = await run(setup(config({ manual: [model('example', 'one')] })), ['--bogus'])
  assert.equal(unknown.result.exitCode, 2)
  assert.equal(unknown.body.ok, false)
  assert.equal(unknown.body.error.code, 'E_REQUEST_INVALID')

  const bad = await run(setup(config({ manual: [{ schema: 'cliworker.model/v1' }] })), [])
  assert.equal(bad.result.exitCode, 3)
  assert.equal(bad.body.error.code, 'E_CONFIG')

  const missing = createFakeContext({ files: {}, platform: process.platform })
  const missingResult = await main(['models', 'enumerate', '--config', FILE], missing)
  assert.equal(missingResult.exitCode, 3)
  assert.equal(readBody(missing).error.code, 'E_CONFIG')
})
