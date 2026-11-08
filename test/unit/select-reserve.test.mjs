import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { selectPolicy, selectPolicyDetailed } from '../../lib/policy.mjs'
import { runSelection } from '../../lib/select.mjs'
import { createContext } from '../../lib/context.mjs'
import { loadConfig } from '../../lib/config.mjs'
import { createFakeClock } from '../helpers/clock.mjs'

const START = Date.parse('2026-11-07T00:00:00.000Z')
const AT = new Date(START).toISOString()

function planPool(id, { cap = 10, used = 0, resetInH = 1 } = {}) {
  return {
    id,
    cli: 'claude',
    kind: 'plan_window',
    funding: 'plan',
    window: {
      length_s: 18000,
      anchor: 'rolling',
      start_at: new Date(START - 3600_000).toISOString(),
      reset_at: new Date(START + resetInH * 3600_000).toISOString(),
      reset_source: 'config',
    },
    capacity_mtok: { 'claude:a': { value: cap, source: 'config' } },
    used_fraction: { value: used, source: 'config', at: AT },
    credits_per_mtok: null,
  }
}

function modelRecord(key, level = 'Top') {
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
    level_source: { kind: 'config', ref: 'fixture#catalog.levels', at: AT },
    availability: { state: 'callable', reason: null, at: AT, ttl_s: 86400, evidence: null },
    identity: 'verified',
    capabilities: { context_tokens: 100000, readonly: true, stdin: true },
    prices: { input_per_mtok: 1, output_per_mtok: 1, source: 'config' },
    source: { kind: 'manual', ref: 'fixture#catalog.manual', at: AT },
    deprecated: false,
  }
}

function createFixture({ models = [modelRecord('claude:a')], pools = [planPool('claude:plan')], reserve = 0.15 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-reserve-'))
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
      lease_ttl_s: 600,
      reading_ttl_s: 600,
      lock_stale_ms: 30000,
      lock_wait_ms: 5000,
      lock_poll_ms: 10,
      reserve_fraction_for_high: reserve,
      unknown_policy: 'after_known',
      usage_estimate_mtok: { Heavy: 1, Normal: 1, Light: 1 },
      cache_read_weight: 0,
    },
  }
  const file = path.join(root, 'config.json')
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
  const clock = createFakeClock({ start: START })
  const ctx = createContext({ clock, env: {}, platform: process.platform })
  const loaded = loadConfig({ file, ctx })
  return {
    root,
    ctx,
    config: loaded,
    clock,
    request: (overrides = {}) => ({
      schema: 'cliworker.request/v1',
      request_id: 'r-reserve',
      level: 'Top',
      count: 1,
      usage: 'Normal',
      importance: 'high',
      cwd: root,
      ...overrides,
    }),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

test('[AC-052] a normal request loses to the reserve while high is selected', () => {
  const input = {
    est_mtok: 1,
    count: 1,
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0.15 },
    pools: [{ id: 'p', funding: 'plan', remaining_mtok: 2, cap_mtok: 10, reset_in_h: 1 }],
    candidates: [{ key: 'a', pool_ids: ['p'], price: 1, identity_group: null }],
  }
  assert.deepStrictEqual(selectPolicyDetailed({ ...input, importance: 'normal' }).rejected, [
    { key: 'a', reason: 'reserve_protected', pools: ['p'] },
  ])
  assert.deepStrictEqual(selectPolicyDetailed({ ...input, importance: 'high' }).selected, [
    { key: 'a', funding: 'plan' },
  ])
})

test('[AC-052] a zero reserve fraction lets the normal request through', () => {
  const result = selectPolicy({
    est_mtok: 1,
    count: 1,
    importance: 'normal',
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0 },
    pools: [{ id: 'p', funding: 'plan', remaining_mtok: 2, cap_mtok: 10, reset_in_h: 1 }],
    candidates: [{ key: 'a', pool_ids: ['p'], price: 1, identity_group: null }],
  })
  assert.deepStrictEqual(result, { selected: [{ key: 'a', funding: 'plan' }], rejected: [] })
})

test('[AC-052] existing reservations are deducted for high as well', () => {
  const base = {
    est_mtok: 1,
    count: 1,
    importance: 'high',
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0.15 },
    pools: [{ id: 'p', funding: 'plan', remaining_mtok: 2, cap_mtok: 10, reset_in_h: 1 }],
    candidates: [{ key: 'a', pool_ids: ['p'], price: 1, identity_group: null }],
  }
  assert.deepStrictEqual(selectPolicyDetailed({ ...base, reserved_fractions: { p: 0.2 } }).rejected[0].reason, 'quota_low')
  assert.deepStrictEqual(selectPolicyDetailed({ ...base, reserved_fractions: { p: 0.1 } }).selected, [
    { key: 'a', funding: 'plan' },
  ])
})

test('[AC-052] available exactly equal to the estimate passes, one milli-mtok less fails', () => {
  const base = {
    est_mtok: 1,
    count: 1,
    importance: 'high',
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0.15 },
    candidates: [{ key: 'a', pool_ids: ['p'], price: 1, identity_group: null }],
  }
  const exact = selectPolicy({
    ...base,
    pools: [{ id: 'p', funding: 'plan', remaining_mtok: 1, cap_mtok: 10, reset_in_h: 1 }],
  })
  assert.deepStrictEqual(exact.selected, [{ key: 'a', funding: 'plan' }])
  const short = selectPolicy({
    ...base,
    pools: [{ id: 'p', funding: 'plan', remaining_mtok: 0.999, cap_mtok: 10, reset_in_h: 1 }],
  })
  assert.deepStrictEqual(short.rejected, [{ key: 'a', reason: 'quota_low' }])
})

test('[AC-052] one insufficient pool blocks the handle even when another has room', async () => {
  const models = [modelRecord('claude:a')]
  const pools = [planPool('claude:plan-a', { cap: 10, used: 0.5 }), planPool('claude:plan-b', { cap: 10, used: 0.99 })]
  for (const importance of ['normal', 'high']) {
    const fixture = createFixture({ models, pools })
    try {
      const result = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: fixture.request({ importance }) })
      assert.equal(result.ok, false)
      assert.equal(result.agentline.error.code, 'E_INSUFFICIENT_QUOTA')
      assert.deepStrictEqual(result.agentline.models, [])
    } finally {
      fixture.cleanup()
    }
  }
})

test('[AC-052] the configured reserve fraction decides whether a handle is produced', async () => {
  const models = [modelRecord('claude:a')]
  const pools = [planPool('claude:plan', { cap: 10, used: 0.8 })]

  const normal = createFixture({ models, pools, reserve: 0.15 })
  try {
    const result = await runSelection({ ctx: normal.ctx, config: normal.config, request: normal.request({ importance: 'normal' }) })
    assert.equal(result.ok, false)
    assert.equal(result.agentline.error.code, 'E_INSUFFICIENT_QUOTA')
    assert.deepStrictEqual(result.agentline.models, [])
  } finally {
    normal.cleanup()
  }

  const high = createFixture({ models, pools, reserve: 0.15 })
  try {
    const result = await runSelection({ ctx: high.ctx, config: high.config, request: high.request({ importance: 'high' }) })
    assert.equal(result.ok, true)
    assert.equal(result.agentline.models.length, 1)
  } finally {
    high.cleanup()
  }

  const disabled = createFixture({ models, pools, reserve: 0 })
  try {
    const result = await runSelection({ ctx: disabled.ctx, config: disabled.config, request: disabled.request({ importance: 'normal' }) })
    assert.equal(result.ok, true)
    assert.equal(result.agentline.models.length, 1)
  } finally {
    disabled.cleanup()
  }
})
