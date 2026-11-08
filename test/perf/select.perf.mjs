// Performance report for the cached selection path. This module is not a test file: the runner
// only discovers `*.test.mjs`, so `select.test.mjs` calls it. Numbers are reported, never gated.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { runSelection } from '../../lib/select.mjs'
import { createContext } from '../../lib/context.mjs'
import { loadConfig } from '../../lib/config.mjs'
import { createFakeClock } from '../helpers/clock.mjs'

const START = Date.parse('2026-11-07T00:00:00.000Z')
const MODEL_COUNT = 50
const WARMUP = 5
const SAMPLES = 30

function modelRecord(index) {
  const key = `p${String(index).padStart(2, '0')}`
  const at = new Date(START).toISOString()
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
    level_source: { kind: 'config', ref: 'perf#catalog.levels', at },
    availability: { state: 'callable', reason: null, at, ttl_s: 86400, evidence: null },
    identity: 'verified',
    capabilities: { context_tokens: 100000, readonly: true, stdin: true },
    prices: { input_per_mtok: index + 1, output_per_mtok: 1, source: 'config' },
    source: { kind: 'manual', ref: 'perf#catalog.manual', at },
    deprecated: false,
  }
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-perf-select-'))
  fs.mkdirSync(path.join(root, 'state'), { recursive: true })
  const at = new Date(START).toISOString()
  const models = Array.from({ length: MODEL_COUNT }, (_, index) => modelRecord(index))
  const keys = models.map((model) => model.key)
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
      levels: Object.fromEntries(keys.map((key) => [key, 'Top'])),
      aliases: {},
      deprecated: {},
      manual: models,
    },
    pools: [{
      id: 'claude:plan-perf',
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
      capacity_mtok: Object.fromEntries(keys.map((key) => [key, { value: 1000, source: 'config' }])),
      used_fraction: { value: 0, source: 'config', at },
      credits_per_mtok: null,
    }],
    policy: {
      lease_ttl_s: 7200,
      reading_ttl_s: 600,
      lock_stale_ms: 30000,
      lock_wait_ms: 5000,
      lock_poll_ms: 10,
      reserve_fraction_for_high: 0.15,
      unknown_policy: 'after_known',
      usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 },
      cache_read_weight: 0,
    },
  }
  const file = path.join(root, 'config.json')
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
  const ctx = createContext({
    clock: createFakeClock({ start: START }),
    env: {},
    platform: process.platform,
    exec: () => { throw new Error('perf selection must not execute a provider') },
    fetch: () => { throw new Error('perf selection must not touch the network') },
  })
  return { root, ctx, config: loadConfig({ file, ctx }) }
}

function percentile95(values) {
  const sorted = values.slice().sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil(sorted.length * 0.95))
  return sorted[rank - 1]
}

/** Runs the real cached selection path and returns the measurement report. */
export async function measureSelectPerformance() {
  const fixture = createFixture()
  let sequence = 0
  const run = () => {
    sequence += 1
    return runSelection({
      ctx: fixture.ctx,
      config: fixture.config,
      request: {
        schema: 'cliworker.request/v1',
        request_id: `perf-${sequence}`,
        level: 'Top',
        count: 1,
        usage: 'Normal',
        importance: 'high',
        cwd: fixture.root,
      },
    })
  }
  try {
    for (let index = 0; index < WARMUP; index += 1) {
      const result = await run()
      if (!result.ok) throw new Error('perf warmup selection failed')
    }
    const durations = []
    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now()
      const result = await run()
      const elapsed = performance.now() - started
      if (!result.ok) throw new Error('perf measured selection failed')
      if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('perf measured an invalid duration')
      durations.push(elapsed)
    }
    return {
      models: MODEL_COUNT,
      warmup: WARMUP,
      samples: durations.length,
      p95: percentile95(durations),
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
}
