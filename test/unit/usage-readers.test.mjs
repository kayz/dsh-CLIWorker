import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createContext } from '../../lib/context.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'
import { readCodexReadings, parseCodexSession } from '../../lib/usage-readers/codex.mjs'
import { readClaudeReadings, parseClaudeEvents } from '../../lib/usage-readers/claude.mjs'
import { selectLatest } from '../../lib/usage-readers/index.mjs'
import { MODEL_KEY, POOL_ID, createWorkspace, usageRow } from '../fixtures/usage/harness.mjs'

const CODEX = fileURLToPath(new URL('../fixtures/usage/codex-session.jsonl', import.meta.url))
const CLAUDE = fileURLToPath(new URL('../fixtures/usage/claude-events.json', import.meta.url))

function realCtx() {
  return createContext({ env: {}, platform: 'linux' })
}

test('[AC-049] the codex fixture yields the four reading fields for both windows', () => {
  const readings = readCodexReadings(realCtx(), CODEX)
  assert.equal(readings.plan_window.length, 3)
  assert.equal(readings.plan_weekly.length, 3)
  assert.deepStrictEqual(selectLatest(readings.plan_window), {
    used_fraction: 0.5,
    reset_at: '2026-11-07T14:00:00Z',
    source: 'cli',
    at: '2026-11-07T10:00:00Z',
  })
  assert.deepStrictEqual(selectLatest(readings.plan_weekly), {
    used_fraction: 0.15,
    reset_at: '2026-11-14T00:00:00Z',
    source: 'cli',
    at: '2026-11-07T10:00:00Z',
  })
})

test('[AC-049] the claude fixture converts remaining percent and epoch seconds', () => {
  const readings = readClaudeReadings(realCtx(), CLAUDE)
  assert.equal(readings.plan_window.length, 2)
  assert.equal(readings.plan_weekly.length, 1)
  assert.deepStrictEqual(selectLatest(readings.plan_window), {
    used_fraction: 0.6,
    reset_at: '2026-11-07T14:00:00.000Z',
    source: 'cli',
    at: '2026-11-07T10:00:00Z',
  })
  assert.deepStrictEqual(selectLatest(readings.plan_weekly), {
    used_fraction: 0.125,
    reset_at: '2026-11-14T00:00:00Z',
    source: 'cli',
    at: '2026-11-07T09:30:00Z',
  })
})

test('[AC-049] token totals, bad events and unknown formats never become a zero reading', () => {
  const codex = readCodexReadings(realCtx(), CODEX)
  for (const reading of [...codex.plan_window, ...codex.plan_weekly]) {
    assert.ok(reading.used_fraction > 0 && reading.used_fraction <= 1)
    assert.deepStrictEqual(Object.keys(reading).sort(), ['at', 'reset_at', 'source', 'used_fraction'])
  }

  assert.deepStrictEqual(parseCodexSession('{"timestamp":"2026-11-07T10:00:00Z","payload":{"type":"message"}}'), {
    plan_window: [],
    plan_weekly: [],
  })
  assert.deepStrictEqual(parseClaudeEvents('{"events":[{"type":"usage_limit","scope":"unknown","used_percent":40}]}'), {
    plan_window: [],
    plan_weekly: [],
  })
  assert.deepStrictEqual(parseClaudeEvents('not json'), { plan_window: [], plan_weekly: [] })
})

test('[AC-049] the latest reading follows observation time, not file enumeration order', () => {
  const ctx = createFakeContext({
    files: {
      '/sessions/a-late.jsonl': '{"timestamp":"2026-11-07T10:00:00Z","payload":{"rate_limits":{"primary":{"used_percent":50,"window_minutes":300}}}}',
      '/sessions/z-early.jsonl': '{"timestamp":"2026-11-07T09:00:00Z","payload":{"rate_limits":{"primary":{"used_percent":25,"window_minutes":300}}}}',
    },
  })
  const readings = readCodexReadings(ctx, '/sessions')
  assert.equal(selectLatest(readings.plan_window).used_fraction, 0.5)
  assert.equal(readings.plan_window.length, 2)
})

test('[AC-049] the reader only opens the user-provided source', () => {
  const ctx = createFakeContext({
    files: {
      '/sessions/a.jsonl': '{"timestamp":"2026-11-07T10:00:00Z","payload":{"rate_limits":{"primary":{"used_percent":50}}}}',
      '/home/.codex/auth.json': '{"token":"must-not-be-read"}',
    },
  })
  readCodexReadings(ctx, '/sessions')
  assert.equal(ctx.fs.accessed.length > 0, true)
  assert.equal(ctx.exec.count, 0)
  const base = path.resolve('/sessions')
  for (const access of ctx.fs.accessed) {
    assert.equal(access.path.startsWith(base), true, access.path)
  }
})

test('[AC-049] importing a reading updates pools, and later commands read it back', async () => {
  const w = createWorkspace({
    mutate(config) {
      config.pools[0].capacity_mtok = {}
      config.pools[0].used_fraction = null
    },
  })
  try {
    w.writeUsage([
      usageRow({ idempotency_key: 'before-1', input_tokens: 1000000, output_tokens: 0, at: '2026-11-07T09:15:00Z' }),
      usageRow({ idempotency_key: 'before-2', input_tokens: 1000000, output_tokens: 0, at: '2026-11-07T09:45:00Z' }),
    ])

    const imported = await w.run(['usage', 'import', '--file', CLAUDE, '--cli', 'claude', '--pool', POOL_ID])
    assert.equal(imported.exitCode, 0)
    const pool = imported.body.pools.find((item) => item.id === POOL_ID)
    assert.equal(pool.used_fraction.value, 0.6)
    assert.equal(pool.used_fraction.source, 'cli')
    assert.equal(pool.used_fraction.at, '2026-11-07T10:00:00Z')
    assert.equal(pool.window.reset_source, 'cli')
    assert.equal(pool.capacity_mtok[MODEL_KEY].source, 'measured')
    assert.equal(pool.capacity_mtok[MODEL_KEY].value, 5)

    const usageBefore = fs.readFileSync(w.usagePath, 'utf8')
    const repeated = await w.run(['usage', 'import', '--file', CLAUDE, '--cli', 'claude', '--pool', POOL_ID])
    assert.equal(repeated.exitCode, 0)
    assert.equal(repeated.body.pools.find((item) => item.id === POOL_ID).used_fraction.at, '2026-11-07T10:00:00Z')
    assert.equal(fs.readFileSync(w.usagePath, 'utf8'), usageBefore)

    const list = await w.run(['pools', 'list'])
    assert.equal(list.exitCode, 0)
    assert.equal(list.body.pools[0].used_fraction.value, 0.6)

    const forecast = await w.run(['models', 'forecast', '--model', MODEL_KEY])
    assert.equal(forecast.exitCode, 0)
    assert.equal(forecast.body.forecast.status, 'known')
    assert.equal(forecast.body.forecast.remaining_mtok, 2)
  } finally {
    w.cleanup()
  }
})
