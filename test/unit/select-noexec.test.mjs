import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { run as modelsSelect } from '../../lib/commands/models/select.mjs'
import { run as adminSelect } from '../../lib/commands/admin/select.mjs'
import { createContext } from '../../lib/context.mjs'
import { loadConfig } from '../../lib/config.mjs'
import { createFakeClock } from '../helpers/clock.mjs'

const START = Date.parse('2026-11-07T00:00:00.000Z')
const AT = new Date(START).toISOString()
const COUNT = 50

function modelRecord(index) {
  const key = `m${String(index).padStart(2, '0')}`
  return {
    schema: 'cliworker.model/v1',
    key,
    id: key,
    cli: process.execPath,
    provider: 'claude',
    vendor: 'anthropic',
    aliases: [],
    allowed: false,
    level: 'Top',
    level_source: { kind: 'config', ref: 'fixture#catalog.levels', at: AT },
    availability: { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null },
    identity: 'verified',
    capabilities: { context_tokens: 100000, readonly: true, stdin: true },
    prices: { input_per_mtok: index + 1, output_per_mtok: 1, source: 'config' },
    source: { kind: 'manual', ref: 'fixture#catalog.manual', at: AT },
    deprecated: false,
  }
}

function probeRecord(model, at) {
  return {
    ...model,
    availability: {
      state: 'callable',
      reason: null,
      at: new Date(at).toISOString(),
      ttl_s: 3600,
      evidence: {
        probe_id: `probe-${model.key}`,
        cmd_redacted: 'node',
        exit: 0,
        duration_ms: 1,
        nonce_ok: true,
        reported_model: model.key,
        tokens: null,
      },
    },
  }
}

function createFixture({ withProbe = true, probeAt = START, level = 'Top' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-noexec-'))
  const stateDir = path.join(root, 'state')
  fs.mkdirSync(stateDir, { recursive: true })
  const models = Array.from({ length: COUNT }, (_, index) => {
    const record = modelRecord(index)
    return level === 'Top' ? record : { ...record, level, level_source: { ...record.level_source, ref: 'fixture#levels' } }
  })
  const keys = models.map((item) => item.key)
  const config = {
    schema: 'cliworker.config/v2',
    state_dir: 'state',
    secrets: {},
    discovery: {
      extra_dirs: [],
      wsl: false,
      probe_unknown: false,
      unknown_patterns: [],
      cli_overrides: { claude: { cli: process.execPath, args_prefix: [], readonly: true, env_names: [] } },
    },
    catalog: {
      allow: keys,
      levels: Object.fromEntries(keys.map((key) => [key, models.find((item) => item.key === key).level])),
      aliases: {},
      deprecated: {},
      manual: models,
    },
    pools: [
      {
        id: 'claude:plan',
        cli: 'claude',
        kind: 'plan_window',
        funding: 'plan',
        window: {
          length_s: 18000,
          anchor: 'rolling',
          start_at: new Date(START - 3600_000).toISOString(),
          reset_at: new Date(START + 3600_000).toISOString(),
          reset_source: 'config',
        },
        capacity_mtok: Object.fromEntries(keys.map((key) => [key, { value: 100, source: 'config' }])),
        used_fraction: { value: 0, source: 'config', at: AT },
        credits_per_mtok: null,
      },
    ],
    policy: {
      lease_ttl_s: 7200,
      reading_ttl_s: 600,
      lock_stale_ms: 30000,
      lock_wait_ms: 5000,
      lock_poll_ms: 10,
      reserve_fraction_for_high: 0.15,
      unknown_policy: 'after_known',
      usage_estimate_mtok: { Heavy: 2, Normal: 1, Light: 0.1 },
      cache_read_weight: 0,
    },
  }
  const file = path.join(root, 'config.json')
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
  if (withProbe) {
    fs.writeFileSync(
      path.join(stateDir, 'probes.json'),
      JSON.stringify(models.map((model) => probeRecord(model, probeAt)), null, 2),
      'utf8'
    )
  }
  const clock = createFakeClock({ start: START })
  const execCalls = []
  const fetchCalls = []
  const forecastKeys = []
  const ctx = createContext({
    clock,
    env: {},
    platform: process.platform,
    exec: (...args) => {
      execCalls.push(args)
      throw new Error('exec is forbidden during selection')
    },
    fetch: (...args) => {
      fetchCalls.push(args)
      throw new Error('fetch is forbidden during selection')
    },
    now: () => START,
  })
  ctx.forecastObserver = (key) => forecastKeys.push(key)
  const loaded = loadConfig({ file, ctx })
  return {
    root,
    stateDir,
    ctx,
    config: loaded,
    execCalls,
    fetchCalls,
    forecastKeys,
    request(overrides = {}) {
      return {
        schema: 'cliworker.request/v1',
        request_id: 'r-noexec',
        level: 'Top',
        count: 1,
        usage: 'Normal',
        importance: 'high',
        cwd: root,
        ...overrides,
      }
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

function invoke(fixture, request) {
  return modelsSelect({
    argv: ['models', 'select', '--request', JSON.stringify(request)],
    ctx: fixture.ctx,
    config: fixture.config,
  })
}

test('[AC-055] a 50-model selection never executes a provider or touches the network', async () => {
  const fixture = createFixture()
  try {
    const probesFile = path.join(fixture.stateDir, 'probes.json')
    const probesBefore = fs.readFileSync(probesFile, 'utf8')
    const mtimeBefore = fs.statSync(probesFile).mtimeMs

    const result = await invoke(fixture, fixture.request({ request_id: 'r-one' }))
    assert.equal(result.ok, true)
    assert.equal(result.models.length, 1)
    assert.deepStrictEqual(fixture.execCalls, [])
    assert.deepStrictEqual(fixture.fetchCalls, [])
    assert.equal(fixture.forecastKeys.length, COUNT, 'one forecast per pre-filtered model')
    assert.equal(new Set(fixture.forecastKeys).size, COUNT)
    assert.equal(fs.readFileSync(probesFile, 'utf8'), probesBefore)
    assert.equal(fs.statSync(probesFile).mtimeMs, mtimeBefore)
    assert.equal(fs.existsSync(path.join(fixture.stateDir, 'pools.json')), false)
    assert.equal(fs.existsSync(path.join(fixture.stateDir, 'usage.jsonl')), false)

    fixture.forecastKeys.length = 0
    const second = await adminSelect({
      argv: ['admin', 'select', '--request', JSON.stringify(fixture.request({ request_id: 'r-two' }))],
      ctx: fixture.ctx,
      config: fixture.config,
    })
    assert.equal(second.ok, true)
    assert.deepStrictEqual(fixture.execCalls, [])
    assert.deepStrictEqual(fixture.fetchCalls, [])
    assert.equal(fixture.forecastKeys.length, COUNT)
    assert.equal(new Set(fixture.forecastKeys).size, COUNT)
  } finally {
    fixture.cleanup()
  }
})

test('[AC-055] a missing probe cache is a rejection, not a probe', async () => {
  const fixture = createFixture({ withProbe: false })
  try {
    await assert.rejects(
      () => invoke(fixture, fixture.request()),
      (error) => error && error.code === 'E_NO_CANDIDATE'
    )
    assert.deepStrictEqual(fixture.execCalls, [])
    assert.deepStrictEqual(fixture.fetchCalls, [])
    assert.equal(fs.existsSync(path.join(fixture.stateDir, 'probes.json')), false)
  } finally {
    fixture.cleanup()
  }
})

test('[AC-055] a stale probe cache is rejected without refreshing it', async () => {
  const fixture = createFixture({ probeAt: START - 3_601_000 })
  try {
    const file = path.join(fixture.stateDir, 'probes.json')
    const before = fs.readFileSync(file, 'utf8')
    await assert.rejects(
      () => invoke(fixture, fixture.request()),
      (error) => error && error.code === 'E_NO_CANDIDATE'
    )
    assert.deepStrictEqual(fixture.execCalls, [])
    assert.deepStrictEqual(fixture.fetchCalls, [])
    assert.equal(fs.readFileSync(file, 'utf8'), before)
  } finally {
    fixture.cleanup()
  }
})

test('[AC-055] a level mismatch and a full-view gate still never execute anything', async () => {
  const mismatched = createFixture({ level: 'High' })
  try {
    const fixture = createFixture({ level: 'Top' })
    try {
      await assert.rejects(
        () => invoke(mismatched, mismatched.request({ level: 'Top' })),
        (error) => error && error.code === 'E_NO_CANDIDATE'
      )
      assert.deepStrictEqual(mismatched.execCalls, [])
      assert.deepStrictEqual(mismatched.fetchCalls, [])
      await assert.rejects(
        () => invoke(fixture, fixture.request({ view: 'full' })),
        (error) => error && error.code === 'E_VIEW_FORBIDDEN'
      )
      assert.deepStrictEqual(fixture.execCalls, [])
      assert.deepStrictEqual(fixture.fetchCalls, [])
      assert.equal(fs.existsSync(path.join(fixture.stateDir, 'leases.json')), false)
    } finally {
      fixture.cleanup()
    }
  } finally {
    mismatched.cleanup()
  }
})

test('[AC-055] the CLI draft view is projected from the cached result without any probe', async () => {
  const fixture = createFixture()
  try {
    const result = await modelsSelect({
      argv: ['models', 'select', '--level', 'Top', '--request-id', 'r-draft', '--count', '1'],
      ctx: fixture.ctx,
      config: fixture.config,
    })
    assert.equal(result.ok, true)
    assert.equal(result.models.length, 1)
    const model = result.models[0]
    for (const field of ['key', 'provider', 'id', 'level', 'prices', 'quota', 'forecast', 'call']) {
      assert.ok(Object.hasOwn(model, field), `draft model is missing ${field}`)
    }
    assert.equal(Object.hasOwn(model, 'cli'), false)
    assert.ok(result.warnings.some((warning) => warning.code === 'W_DRAFT_DEPRECATED'))
    assert.deepStrictEqual(fixture.execCalls, [])
    assert.deepStrictEqual(fixture.fetchCalls, [])
  } finally {
    fixture.cleanup()
  }
})
