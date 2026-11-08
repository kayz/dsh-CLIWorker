// Shared workspace for the T-021 unit tests: one temporary state dir, a valid v2 config and a
// fake clock. Commands run through the real main router; the ledger and state are real files.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { main } from '../../../lib/cli.mjs'
import { createContext } from '../../../lib/context.mjs'
import { createFakeClock } from '../../helpers/clock.mjs'
import { fakeStream } from '../../helpers/ctx.mjs'

export const MODEL_KEY = 'claude:test-model'
export const POOL_ID = 'claude:plan-5h'
export const READING_AT = '2026-11-07T10:00:00Z'
export const CLOCK_START = '2026-11-07T10:05:00Z'

export function modelRecord() {
  return {
    schema: 'cliworker.model/v1',
    key: MODEL_KEY,
    id: 'test-model',
    cli: 'claude',
    provider: 'claude',
    vendor: 'anthropic',
    aliases: [],
    allowed: true,
    level: 'Top',
    level_source: null,
    availability: { state: 'callable', reason: null, at: null, ttl_s: null, evidence: null },
    identity: 'verified',
    capabilities: { context_tokens: 200000, readonly: true, stdin: true },
    prices: { input_per_mtok: 0, output_per_mtok: 0, source: 'config' },
    source: { kind: 'manual', ref: 'config', at: '2026-11-01T00:00:00Z' },
    deprecated: false,
  }
}

export function poolRecord(overrides = {}) {
  return {
    id: POOL_ID,
    cli: 'claude',
    kind: 'plan_window',
    funding: 'plan',
    window: {
      length_s: 18000,
      anchor: 'rolling',
      start_at: '2026-11-07T08:00:00Z',
      reset_at: '2026-11-07T15:00:00Z',
      reset_source: 'config',
    },
    capacity_mtok: { [MODEL_KEY]: { value: 10, source: 'config' } },
    used_fraction: { value: 0.5, source: 'cli', at: READING_AT },
    credits_per_mtok: null,
    ...overrides,
  }
}

export function policyRecord(overrides = {}) {
  return {
    probe_ttl_s: 21600,
    lease_ttl_s: 7200,
    reading_ttl_s: 600,
    lock_stale_ms: 30000,
    lock_wait_ms: 5000,
    lock_poll_ms: 50,
    session_ttl_s: 43200,
    reserve_fraction_for_high: 0.15,
    unknown_policy: 'after_known',
    usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 },
    cache_read_weight: 0,
    probe_schedule: null,
    ...overrides,
  }
}

export function baseConfig(home) {
  return {
    schema: 'cliworker.config/v2',
    state_dir: home,
    secrets: {},
    discovery: {
      extra_dirs: [],
      wsl: false,
      probe_unknown: false,
      unknown_patterns: [],
      cli_overrides: { claude: { cli: 'claude' } },
    },
    catalog: {
      allow: [MODEL_KEY],
      levels: {},
      aliases: {},
      deprecated: {},
      manual: [modelRecord()],
    },
    pools: [poolRecord()],
    policy: policyRecord(),
  }
}

export function usageRow(overrides = {}) {
  return {
    schema: 'cliworker.usage/v1',
    idempotency_key: 'key-1',
    lease_id: 'lease-1',
    model: MODEL_KEY,
    pools: [POOL_ID],
    kind: 'task',
    input_tokens: 1000,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: 0.01,
    pool_fraction_before: null,
    pool_fraction_after: null,
    at: READING_AT,
    ...overrides,
  }
}

export function createWorkspace({ now = CLOCK_START, mutate } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-021-'))
  const home = path.join(root, 'state')
  fs.mkdirSync(home, { recursive: true })
  const configFile = path.join(root, 'config.json')
  const config = baseConfig(home)
  if (typeof mutate === 'function') mutate(config)
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8')

  const clock = createFakeClock({ start: Date.parse(now) })
  const ctx = createContext({
    env: { CLIWORKER_HOME: root },
    platform: process.platform,
    clock,
    stdout: fakeStream(),
    stderr: fakeStream(),
  })

  const usagePath = path.join(home, 'usage.jsonl')
  const poolsPath = path.join(home, 'pools.json')

  async function run(argv) {
    const outStart = ctx.stdout.text().length
    const errStart = ctx.stderr.text().length
    const result = await main([...argv, '--config', configFile], ctx)
    const stdout = ctx.stdout.text().slice(outStart)
    const stderr = ctx.stderr.text().slice(errStart)
    let body = null
    try {
      body = JSON.parse(stdout)
    } catch {
      body = null
    }
    return { exitCode: result.exitCode, body, stdout, stderr }
  }

  return {
    root,
    home,
    configFile,
    config,
    clock,
    ctx,
    usagePath,
    poolsPath,
    run,
    writeUsage(rows) {
      fs.writeFileSync(usagePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
    },
    writeUsageText(text) {
      fs.writeFileSync(usagePath, text, 'utf8')
    },
    readUsage() {
      try {
        return fs.readFileSync(usagePath, 'utf8')
      } catch {
        return null
      }
    },
    readPools() {
      try {
        return JSON.parse(fs.readFileSync(poolsPath, 'utf8'))
      } catch {
        return null
      }
    },
    readConfig() {
      return JSON.parse(fs.readFileSync(configFile, 'utf8'))
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}
