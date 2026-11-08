import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runSelection as select } from '../../lib/select.mjs'
import { scanView } from '../../lib/contract/scan.mjs'
import { isExpired, effectiveReservations } from '../../lib/leases.mjs'
import { validate } from '../../lib/contract/validate.mjs'
import { createContext } from '../../lib/context.mjs'
import { loadConfig } from '../../lib/config.mjs'
import { createFakeClock } from '../helpers/clock.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCHEMA_DIR = path.join(ROOT, 'contracts', 'schemas')
const START = Date.parse('2026-11-07T00:00:00.000Z')
const forbidden = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/agentline-forbidden.json'), 'utf8'))

async function runSelection(options) {
  const result = await select(options)
  const config = options.config
  const scan = scanView(result.agentline, {
    forbidden,
    catalog: { models: config.catalog.manual },
    wrapper: { command: process.execPath, bin: path.join(ROOT, 'bin/cliworker.mjs'), state_dir: config._home, config: config._file },
  })
  assert.deepEqual(scan, { ok: true, hits: [] })
  return result
}

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8'))
}

function iso(ms) {
  return new Date(ms).toISOString()
}

function modelRecord(key, { level = 'Top', at = START, ttl = 86400, identity = 'verified' } = {}) {
  return {
    schema: 'cliworker.model/v1',
    key,
    id: key,
    cli: process.execPath,
    provider: 'claude',
    vendor: 'anthropic',
    aliases: [],
    allowed: false,
    level,
    level_source: { kind: 'config', ref: 'fixture#catalog.levels', at: iso(START) },
    availability: { state: 'callable', reason: null, at: iso(at), ttl_s: ttl, evidence: null },
    identity,
    capabilities: { context_tokens: 100000, readonly: true, stdin: true },
    prices: { input_per_mtok: 1, output_per_mtok: 1, source: 'config' },
    source: { kind: 'manual', ref: 'fixture#catalog.manual', at: iso(START) },
    deprecated: false,
  }
}

function planPool(id, keys, { cap = 10, remaining = 5, resetInH = 1 } = {}) {
  return {
    id,
    cli: 'claude',
    kind: 'plan_window',
    funding: 'plan',
    window: {
      length_s: 18000,
      anchor: 'rolling',
      start_at: iso(START - 3600_000),
      reset_at: iso(START + resetInH * 3600_000),
      reset_source: 'config',
    },
    capacity_mtok: Object.fromEntries(keys.map((key) => [key, { value: cap, source: 'config' }])),
    used_fraction: { value: 1 - remaining / cap, source: 'config', at: iso(START) },
    credits_per_mtok: null,
  }
}

function paidPool(id, keys, { cap = 100, remaining = 100 } = {}) {
  return { ...planPool(id, keys, { cap, remaining }), funding: 'paid', kind: 'prepaid_usd', window: null }
}

function usageRow(model, tokens, at) {
  return {
    schema: 'cliworker.usage/v1',
    id: `u_${model}_${tokens}`,
    idempotency_key: `key_${model}_${tokens}`,
    lease_id: '',
    model,
    pools: [],
    kind: 'task',
    input_tokens: tokens,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: 0,
    pool_fraction_before: null,
    pool_fraction_after: null,
    at: iso(at),
  }
}

function createFixture({
  models,
  pools = [],
  policy = {},
  rows = [],
  start = START,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-shape-'))
  fs.mkdirSync(path.join(root, 'state'), { recursive: true })
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
      allow: models.map((item) => item.key),
      levels: Object.fromEntries(models.map((item) => [item.key, item.level])),
      aliases: {},
      deprecated: {},
      manual: models,
    },
    pools,
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
      ...policy,
    },
  }
  if (rows.length > 0) {
    fs.writeFileSync(path.join(root, 'state', 'usage.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
  }
  const file = path.join(root, 'config.json')
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
  const clock = createFakeClock({ start })
  const ctx = createContext({ clock, env: {}, platform: process.platform })
  const loaded = loadConfig({ file, ctx })
  return {
    root,
    file,
    stateDir: path.join(root, 'state'),
    ctx,
    clock,
    config: loaded,
    request(overrides = {}) {
      return {
        schema: 'cliworker.request/v1',
        request_id: 'r-shape',
        level: 'Top',
        count: 1,
        usage: 'Normal',
        importance: 'high',
        cwd: root,
        ...overrides,
      }
    },
    readState() {
      const stateFile = path.join(root, 'state', 'leases.json')
      return fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { leases: [], requests: [] }
    },
    resetLeases() {
      fs.rmSync(path.join(root, 'state', 'leases.json'), { force: true })
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

test('[AC-053] [AC-056] a shortfall reports truncation while still returning the handles it has', async () => {
  const models = [modelRecord('m1'), modelRecord('m2'), modelRecord('m3')]
  const pools = [planPool('p1', ['m1', 'm2', 'm3'], { cap: 10, remaining: 1.5 })]
  const fixture = createFixture({ models, pools })
  try {
    const result = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: fixture.request({ count: 3 }) })
    assert.equal(result.ok, true)
    assert.equal(result.agentline.count_returned, 1)
    assert.equal(result.agentline.truncated, true)
    assert.equal(result.agentline.shortfall, 2)
    assert.equal(result.agentline.models.length, 1)
    assert.equal(result.agentline.calls.length, 1)
    assert.deepStrictEqual(result.agentline.calls[0], result.agentline.models[0].call)
    assert.equal(validate(loadSchema('selection-ok.v1.schema.json'), result.agentline, { loadSchema }).ok, true)

    const state = fixture.readState()
    const reserved = effectiveReservations(state, START)
    for (const [id, fraction] of reserved) {
      assert.ok(fraction <= 0.15 + 1e-12, `pool ${id} reserved ${fraction} of its capacity`)
    }
  } finally {
    fixture.cleanup()
  }
})

test('[AC-053] a full selection has no shortfall', async () => {
  const models = [modelRecord('m1'), modelRecord('m2')]
  const pools = [planPool('p1', ['m1', 'm2'], { cap: 10, remaining: 100 })]
  const fixture = createFixture({ models, pools })
  try {
    const result = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: fixture.request({ count: 2 }) })
    assert.equal(result.ok, true)
    assert.equal(result.agentline.truncated, false)
    assert.equal(result.agentline.shortfall, 0)
    assert.equal(result.agentline.calls.length, 2)
    for (let index = 0; index < 2; index += 1) {
      assert.deepStrictEqual(result.agentline.calls[index], result.agentline.models[index].call)
    }
  } finally {
    fixture.cleanup()
  }
})

test('[AC-053] zero candidates split uniquely into E_INSUFFICIENT_QUOTA and E_NO_CANDIDATE', async () => {
  const insufficient = createFixture({
    models: [modelRecord('m1')],
    pools: [planPool('p1', ['m1'], { cap: 10, remaining: 0.5 })],
  })
  try {
    const result = await runSelection({ ctx: insufficient.ctx, config: insufficient.config, request: insufficient.request() })
    assert.equal(result.ok, false)
    assert.equal(result.agentline.error.code, 'E_INSUFFICIENT_QUOTA')
    assert.equal(result.agentline.error.retryable, true)
    assert.equal(result.agentline.error.retry_after, iso(START + 3600_000))
    assert.deepStrictEqual(result.agentline.models, [])
    assert.deepStrictEqual(result.agentline.calls, [])
    assert.equal(result.agentline.truncated, false)
    assert.equal(result.agentline.shortfall, 1)
    assert.equal(validate(loadSchema('selection-failed.v1.schema.json'), result.agentline, { loadSchema }).ok, true)
  } finally {
    insufficient.cleanup()
  }

  const none = createFixture({
    models: [modelRecord('m1', { level: 'High' })],
    pools: [planPool('p1', ['m1'], { cap: 10, remaining: 5 })],
  })
  try {
    const result = await runSelection({ ctx: none.ctx, config: none.config, request: none.request({ level: 'Top' }) })
    assert.equal(result.ok, false)
    assert.equal(result.agentline.error.code, 'E_NO_CANDIDATE')
    assert.equal(result.agentline.error.retryable, false)
    assert.equal(validate(loadSchema('selection-failed.v1.schema.json'), result.agentline, { loadSchema }).ok, true)
  } finally {
    none.cleanup()
  }
})

test('[AC-053] mixed non-quota and quota rejections stay E_INSUFFICIENT_QUOTA', async () => {
  const models = [modelRecord('m1', { level: 'High' }), modelRecord('m2')]
  const pools = [planPool('p1', ['m1', 'm2'], { cap: 10, remaining: 0.5 })]
  const fixture = createFixture({ models, pools })
  try {
    const result = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: fixture.request() })
    assert.equal(result.agentline.error.code, 'E_INSUFFICIENT_QUOTA')
    assert.deepStrictEqual(result.agentline.rejected.map((item) => item.reason), ['level_mismatch', 'quota_low'])
  } finally {
    fixture.cleanup()
  }
})

test('[AC-053] retry_after is the earliest reset of quota-rejected pools only', async () => {
  // A known-insufficient plan pool is not masked by a paid pool with room.
  const models = [modelRecord('m1')]
  const pools = [
    planPool('p1', ['m1'], { cap: 10, remaining: 0.5, resetInH: 3 }),
    paidPool('paid', ['m1'], { cap: 100, remaining: 100 }),
  ]
  const fixture = createFixture({ models, pools })
  try {
    const result = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: fixture.request({ count: 1 }) })
    assert.equal(result.ok, false)
    assert.equal(result.agentline.error.code, 'E_INSUFFICIENT_QUOTA')
    assert.equal(result.agentline.error.retry_after, iso(START + 3 * 3600_000))
  } finally {
    fixture.cleanup()
  }

  const earlier = createFixture({
    models: [modelRecord('m1')],
    pools: [planPool('p1', ['m1'], { cap: 10, remaining: 0.5, resetInH: 2 })],
  })
  try {
    const failed = await runSelection({ ctx: earlier.ctx, config: earlier.config, request: earlier.request() })
    assert.equal(failed.agentline.error.code, 'E_INSUFFICIENT_QUOTA')
    assert.equal(failed.agentline.error.retry_after, iso(START + 2 * 3600_000))
  } finally {
    earlier.cleanup()
  }
})

test('[AC-053] Heavy, Normal and Light estimates come from p90, p50 and p25', async () => {
  const rows = [
    usageRow('m1', 100000, START - 3000),
    usageRow('m1', 200000, START - 2000),
    usageRow('m1', 300000, START - 1000),
  ]
  const cases = [
    ['Light', true],
    ['Normal', true],
    ['Heavy', false],
  ]
  for (const [usage, expected] of cases) {
    const fixture = createFixture({
      models: [modelRecord('m1')],
      pools: [planPool('p1', ['m1'], { cap: 10, remaining: 0.25 })],
      rows,
    })
    try {
      const result = await runSelection({
        ctx: fixture.ctx,
        config: fixture.config,
        request: fixture.request({ usage, importance: 'high' }),
      })
      assert.equal(result.ok, expected, `${usage}: ${JSON.stringify(result.agentline.error)}`)
      if (!expected) assert.equal(result.agentline.error.code, 'E_INSUFFICIENT_QUOTA')
    } finally {
      fixture.cleanup()
    }
  }
})

test('[AC-053] a sample-poor model falls back to the configured assumption', async () => {
  const rejected = createFixture({
    models: [modelRecord('m1')],
    pools: [planPool('p1', ['m1'], { cap: 10, remaining: 0.4 })],
    policy: { usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 } },
  })
  try {
    const result = await runSelection({ ctx: rejected.ctx, config: rejected.config, request: rejected.request({ importance: 'high' }) })
    assert.equal(result.ok, false)
    assert.equal(result.agentline.error.code, 'E_INSUFFICIENT_QUOTA')
  } finally {
    rejected.cleanup()
  }

  const accepted = createFixture({
    models: [modelRecord('m1')],
    pools: [planPool('p1', ['m1'], { cap: 10, remaining: 0.4 })],
    policy: { usage_estimate_mtok: { Heavy: 2, Normal: 0.2, Light: 0.1 } },
  })
  try {
    const result = await runSelection({ ctx: accepted.ctx, config: accepted.config, request: accepted.request({ importance: 'high' }) })
    assert.equal(result.ok, true)
  } finally {
    accepted.cleanup()
  }
})

test('[AC-053] unknown plan capacity is a policy choice, never a fabricated balance', async () => {
  const ghost = { ...usageRow('ghost', 100000, START - 1000), pools: ['unknown-pool'] }
  const rows = [ghost]
  const models = [modelRecord('known'), modelRecord('unknown-model-x')]
  const pools = [
    planPool('known-pool', ['known'], { cap: 10, remaining: 5 }),
    {
      ...planPool('unknown-pool', ['unknown-model-x'], { cap: 10, remaining: 5 }),
      used_fraction: { value: 0.5, source: 'config', at: iso(START - 2000) },
    },
  ]
  // The ghost row names unknown-pool but has no capacity there, so the pool reads as unknown.
  const afterKnown = createFixture({ models, pools, rows })
  try {
    const result = await runSelection({ ctx: afterKnown.ctx, config: afterKnown.config, request: afterKnown.request({ count: 2 }) })
    assert.equal(result.ok, true)
    assert.equal(result.agentline.count_returned, 2)
  } finally {
    afterKnown.cleanup()
  }

  const rejected = createFixture({ models, pools, rows, policy: { unknown_policy: 'reject' } })
  try {
    const result = await runSelection({ ctx: rejected.ctx, config: rejected.config, request: rejected.request({ count: 2 }) })
    assert.equal(result.ok, true)
    assert.equal(result.agentline.count_returned, 1)
    assert.deepStrictEqual(result.agentline.rejected.map((item) => item.reason), ['quota_unknown_policy'])
  } finally {
    rejected.cleanup()
  }

  const onlyUnknown = createFixture({ models: [modelRecord('unknown-model-x')], pools: [pools[1]], rows, policy: { unknown_policy: 'reject' } })
  try {
    const result = await runSelection({ ctx: onlyUnknown.ctx, config: onlyUnknown.config, request: onlyUnknown.request({ count: 1 }) })
    assert.equal(result.ok, false)
    assert.equal(result.agentline.error.code, 'E_INSUFFICIENT_QUOTA')
    assert.deepStrictEqual(result.agentline.rejected.map((item) => item.reason), ['quota_unknown_policy'])
  } finally {
    onlyUnknown.cleanup()
  }
})

test('[AC-053] expires_at is selected_at plus the lease TTL plus the per-position timeout', async () => {
  const models = [modelRecord('m1'), modelRecord('m2'), modelRecord('m3')]
  const pools = [planPool('p1', ['m1', 'm2', 'm3'], { cap: 10, remaining: 100 })]
  const fixture = createFixture({ models, pools, policy: { lease_ttl_s: 100 } })
  try {
    const result = await runSelection({
      ctx: fixture.ctx,
      config: fixture.config,
      request: fixture.request({ count: 3, timeout_ms: 7 }),
    })
    assert.equal(result.ok, true)
    const expected = result.agentline.models.map((handle, index) =>
      iso(START + 100 * 1000 + index * 7))
    assert.deepStrictEqual(result.agentline.models.map((handle) => handle.expires_at), expected)
    assert.deepStrictEqual(result.agentline.models.map((handle) => handle.label), ['Top-1', 'Top-2', 'Top-3'])
  } finally {
    fixture.cleanup()
  }
})

test('[AC-053] a callable TTL accepts the exact boundary and rejects one millisecond past it', async () => {
  for (const [offset, expected] of [[1000, true], [1001, false]]) {
    const fixture = createFixture({
      models: [modelRecord('m1', { at: START - offset, ttl: 1 })],
      pools: [planPool('p1', ['m1'], { cap: 10, remaining: 5 })],
    })
    try {
      const result = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: fixture.request() })
      assert.equal(result.ok, expected, `offset ${offset}`)
      if (!expected) {
        assert.equal(result.agentline.error.code, 'E_NO_CANDIDATE')
        assert.deepStrictEqual(result.agentline.rejected.map((item) => item.reason), ['availability_stale'])
      }
    } finally {
      fixture.cleanup()
    }
  }
})

test('[AC-053] lease expiry is strict: equality still reserves, one millisecond later releases', async () => {
  const fixture = createFixture({
    models: [modelRecord('m1')],
    pools: [planPool('p1', ['m1'], { cap: 10, remaining: 1.5 })],
    policy: { lease_ttl_s: 1 },
  })
  try {
    const first = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: fixture.request({ request_id: 'r-first' }) })
    assert.equal(first.ok, true)
    assert.equal(fixture.readState().leases.length, 1)
    const expiresAt = first.agentline.models[0].expires_at
    assert.equal(expiresAt, iso(START + 1000))

    fixture.clock.setNow(START + 1000)
    const exact = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: fixture.request({ request_id: 'r-exact' }) })
    assert.equal(exact.ok, false, 'an expires_at equal to now is still valid')
    assert.equal(exact.agentline.error.code, 'E_INSUFFICIENT_QUOTA')

    const firstLease = first.agentline.models[0].lease_id
    fixture.clock.setNow(START + 1001)
    const replay = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: fixture.request({ request_id: 'r-first' }) })
    assert.equal(replay.ok, true)
    assert.equal(replay.agentline.models[0].expires_at, expiresAt, 'replay must not extend the original handle')
    assert.equal(fixture.readState().leases.length, 1, 'replay adds no reservation')

    const later = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: fixture.request({ request_id: 'r-later' }) })
    assert.equal(later.ok, true, 'the reclaimed reservation frees the room')
    const state = fixture.readState()
    assert.equal(state.leases.some((lease) => lease.lease_id === firstLease), false, 'the expired lease is reclaimed')
    assert.equal(state.leases.length, 1)
  } finally {
    fixture.cleanup()
  }
})

test('[AC-053] the expiry predicate and reservation sum ignore only strictly older leases', () => {
  const now = START
  const state = {
    leases: [
      { lease_id: 'l_a', handle_id: 'h_a', model_key: 'm1', expires_at: iso(now), call: {}, pools: [{ id: 'p', fraction: 0.1 }] },
      { lease_id: 'l_b', handle_id: 'h_b', model_key: 'm1', expires_at: iso(now - 1), call: {}, pools: [{ id: 'p', fraction: 0.2 }] },
    ],
    requests: [],
  }
  assert.equal(isExpired(state.leases[0], now), false)
  assert.equal(isExpired(state.leases[1], now), true)
  assert.equal(effectiveReservations(state, now).get('p'), 0.1)
})
