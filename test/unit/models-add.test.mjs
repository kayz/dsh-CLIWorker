import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createFakeContext } from '../helpers/ctx.mjs'
import { main } from '../../lib/cli.mjs'
import * as addCommand from '../../lib/commands/models/add.mjs'

const FILE = path.resolve('tmp-models-add-config.json')
const STATE = path.resolve('tmp-models-add-state')
const NOW = '2026-11-07T00:00:00.000Z'
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

function emptyConfig() {
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
    catalog: { allow: [], levels: {}, aliases: {}, deprecated: {}, manual: [] },
    pools: [],
    policy: {},
  }
}

function setup(payload = emptyConfig()) {
  const ctx = createFakeContext({ files: { [FILE]: JSON.stringify(payload) }, platform: process.platform })
  const original = ctx.fs.statSync
  ctx.fs.statSync = (name) => ({ ...original(name), mtimeMs: Date.parse(NOW) })
  return ctx
}

function readText(ctx) {
  return ctx.fs.readFileSync(FILE, 'utf8')
}

function readJson(ctx) {
  return JSON.parse(readText(ctx))
}

async function runAdd(ctx, args) {
  const before = ctx.stdout.text().length
  const result = await main(['models', 'add', ...args, '--config', FILE], ctx)
  return { result, body: JSON.parse(ctx.stdout.text().slice(before)) }
}

test('[AC-042] add appends one model record atomically and enumerate reads it back', async () => {
  const ctx = setup()
  const original = readJson(ctx)

  const { result, body } = await runAdd(ctx, ['--provider', 'example', '--id', 'new-model', '--level', 'high'])
  assert.equal(result.exitCode, 0)
  assert.equal(ctx.stderr.text(), '')
  assert.equal(body.schema, 'cliworker.models/v1')
  assert.deepEqual(body.models.map((row) => row.key), ['example:new-model'])
  const added = body.models[0]
  assert.deepEqual(Object.keys(added).sort(), MODEL_KEYS)
  assert.equal(added.level, 'High')
  assert.equal(added.allowed, false)
  assert.equal(added.availability.reason, 'not_allowed')

  const raw = readJson(ctx)
  assert.equal(raw.schema, 'cliworker.config/v2')
  assert.equal(raw.catalog.manual.length, 1)
  const stored = raw.catalog.manual[0]
  assert.equal(stored.schema, 'cliworker.model/v1')
  assert.equal(stored.key, 'example:new-model')
  assert.equal(stored.id, 'new-model')
  assert.equal(stored.provider, 'example')
  assert.equal(stored.cli, 'example-cli')
  assert.equal(stored.vendor, 'example')
  assert.equal(stored.level, 'High')
  assert.deepEqual(stored.level_source, {
    kind: 'config',
    ref: `${FILE}#catalog.levels.example:new-model`,
    at: NOW,
  })
  assert.deepEqual(stored.availability, { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null })
  assert.equal(stored.identity, 'unverified')
  assert.deepEqual(stored.capabilities, { context_tokens: 0, readonly: false, stdin: false })
  assert.deepEqual(stored.prices, { input_per_mtok: 0, output_per_mtok: 0, source: 'manual' })
  assert.deepEqual(stored.source, { kind: 'manual', ref: `${FILE}#catalog.manual.example:new-model`, at: NOW })
  assert.equal(stored.deprecated, false)
  assert.deepEqual(raw.catalog.allow, [])
  assert.equal(raw.catalog.levels['example:new-model'], 'High')
  assert.deepEqual(raw.discovery, original.discovery)
  assert.deepEqual(raw.pools, original.pools)
  assert.deepEqual(raw.policy, original.policy)
  assert.deepEqual([...ctx.fs.files.keys()].filter((name) => name.endsWith('.tmp')), [])

  // A new process-equivalent context reads the persisted record through enumerate.
  const after = createFakeContext({ files: { [FILE]: readText(ctx) }, platform: process.platform })
  const originalStat = after.fs.statSync
  after.fs.statSync = (name) => ({ ...originalStat(name), mtimeMs: Date.parse(NOW) })
  await main(['models', 'enumerate', '--config', FILE], after)
  const enumerated = JSON.parse(after.stdout.text())
  assert.deepEqual(enumerated.models.map((row) => row.key), ['example:new-model'])
  assert.equal(enumerated.models[0].level, 'High')
  assert.equal(enumerated.models[0].source.kind, 'manual')
})

test('[AC-042] add rejects an invalid level with E_BAD_LEVEL and keeps the file byte-identical', async () => {
  const ctx = setup()
  const before = readText(ctx)

  const { result, body } = await runAdd(ctx, ['--provider', 'example', '--id', 'new-model', '--level', 'Ultra'])
  assert.equal(result.exitCode, 2)
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'E_BAD_LEVEL')
  assert.equal(readText(ctx), before)
})

test('[AC-042] add rejects an unknown provider with E_UNKNOWN_MODEL and keeps the file byte-identical', async () => {
  const ctx = setup()
  const before = readText(ctx)

  const { result, body } = await runAdd(ctx, ['--provider', 'missing', '--id', 'new-model'])
  assert.equal(result.exitCode, 2)
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'E_UNKNOWN_MODEL')
  assert.equal(readText(ctx), before)
})

test('[AC-042] add treats a duplicate key as an explicit error and never duplicates records', async () => {
  const ctx = setup()
  const first = await runAdd(ctx, ['--provider', 'example', '--id', 'new-model'])
  assert.equal(first.result.exitCode, 0)
  const afterFirst = readText(ctx)

  const second = await runAdd(ctx, ['--provider', 'example', '--id', 'new-model'])
  assert.equal(second.result.exitCode, 3)
  assert.equal(second.body.error.code, 'E_CONFIG_EXISTS')
  assert.equal(readText(ctx), afterFirst)
  assert.equal(readJson(ctx).catalog.manual.length, 1)
})

test('[AC-042] add rejects missing or malformed arguments without touching the file', async () => {
  assert.deepEqual(addCommand.route, { cmd: 'models', sub: 'add' })
  const ctx = setup()
  const before = readText(ctx)

  const missingId = await runAdd(ctx, ['--provider', 'example'])
  assert.equal(missingId.result.exitCode, 2)
  assert.equal(missingId.body.error.code, 'E_REQUEST_INVALID')

  const unknownOption = await runAdd(ctx, ['--provider', 'example', '--id', 'x', '--bogus', 'y'])
  assert.equal(unknownOption.result.exitCode, 2)
  assert.equal(unknownOption.body.error.code, 'E_REQUEST_INVALID')

  const badId = await runAdd(ctx, ['--provider', 'example', '--id', 'bad id'])
  assert.equal(badId.result.exitCode, 2)
  assert.equal(badId.body.error.code, 'E_REQUEST_INVALID')

  assert.equal(readText(ctx), before)
})

test('[AC-042] add reports a write failure without changing the original configuration', async () => {
  const ctx = setup()
  const before = readText(ctx)
  ctx.fs.renameSync = () => {
    const error = new Error('rename failed')
    error.code = 'EIO'
    throw error
  }

  const { result, body } = await runAdd(ctx, ['--provider', 'example', '--id', 'new-model'])
  assert.equal(result.exitCode, 3)
  assert.equal(body.error.code, 'E_CONFIG')
  assert.equal(readText(ctx), before)
  assert.deepEqual([...ctx.fs.files.keys()].filter((name) => name.endsWith('.tmp')), [])
})
