import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../../lib/config.mjs'
import { createContext } from '../../lib/context.mjs'
import { buildForecast } from '../../lib/forecast.mjs'
import { selectModels } from '../../lib/select.mjs'

const fixtures = fileURLToPath(new URL('../fixtures/config/', import.meta.url))

for (const name of ['v1.json', 'v1-no-schema.json']) {
  test(`[AC-034] ${name} loads as v2 without changing its source`, () => {
    const file = path.join(fixtures, name)
    const before = fs.readFileSync(file)
    const config = loadConfig({ file, ctx: createContext() })
    assert.equal(config.schema, 'cliworker.config/v2')
    assert.ok(config.warnings.some((warning) => warning.code === 'W_CONFIG_V1'))
    assert.deepEqual(fs.readFileSync(file), before)
  })
}

test('[AC-034] pool snapshots preserve known and unknown balances independently', () => {
  const clock = { nowIso: () => '2026-01-01T00:00:00.000Z', now: () => Date.parse('2026-01-01T00:00:00.000Z') }
  const config = loadConfig({ file: path.join(fixtures, 'v1.json'), ctx: createContext({ clock }) })
  const pool = (id) => config.pools.find(item => item.id === id)
  assert.equal(pool('claude:plan_window').used_fraction.value, 0.25)
  assert.deepEqual(pool('claude:plan_window').capacity_mtok, {})
  assert.equal(pool('codex:credits').capacity_mtok['codex:beta'].value, 2)
  assert.equal(pool('credits:credits').capacity_mtok['credits:gamma'].value, 2)
  assert.equal(pool('credits:credits').credits_per_mtok, 10)
  for (const [id, model] of [['unknown:credits', 'unknown:delta'], ['usd:prepaid_usd', 'usd:epsilon'], ['both:credits', 'both:zeta'], ['both:prepaid_usd', 'both:zeta']]) {
    const item = pool(id)
    assert.deepEqual(item.capacity_mtok, {})
    assert.equal(item.used_fraction, null)
    assert.equal(item.credits_per_mtok, null)
    assert.equal(item.window, null)
    const forecast = buildForecast({ model, pools: [item], now: clock.now() })
    assert.equal(forecast.status, 'unknown')
    assert.equal(forecast.risk, 'unknown')
    assert.equal(forecast.reason, 'capacity_unknown')
    assert.equal(forecast.remaining_mtok, null)
    assert.equal(forecast.tasks_left, null)
  }
  assert.deepEqual(config.quotas.claude, { remaining_pct: 75 })
  assert.deepEqual(config.quotas.codex, { remaining: 2000000, unit: 'tokens' })
  assert.deepEqual(config.quotas.both, {})
  assert.equal(Object.keys(config).includes('quotas'), false)
})

test('[AC-034] CLI output preserves draft and source state directory across directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-v2-'))
  try {
    const source = path.join(fixtures, 'v1.json')
    const before = fs.readFileSync(source)
    const target = path.join(dir, 'v2.json')
    const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../../bin/cliworker.mjs', import.meta.url)), 'config', 'migrate', '--in', source, '--out', target], { encoding: 'utf8' })
    assert.equal(cli.status, 0, cli.stderr || cli.stdout)
    assert.equal(cli.stderr, '')
    assert.ok(JSON.parse(cli.stdout).warnings.some(item => item.code === 'W_CONFIG_V1'))
    const clock = { nowIso: () => '2026-01-01T00:00:00.000Z', now: () => Date.parse('2026-01-01T00:00:00.000Z') }
    const ctx = createContext({ clock })
    const first = loadConfig({ file: source, ctx })
    const second = loadConfig({ file: target, ctx })
    assert.equal(first._home, second._home)
    assert.deepEqual(second.warnings, [])
    const status = Object.fromEntries(Object.keys(first.providers).map(key => [key, { state: 'callable' }]))
    const request = { level: 'High', count: 10 }
    const options = { status, ctx, usage: [] }
    const selection = selectModels(first, request, options)
    assert.deepEqual(selection, selectModels(second, request, options))
    assert.deepEqual(selection.models.map(item => item.key), ['claude:alpha', 'codex:beta'])
    assert.ok(selection.models.every(item => item.call.command))
    assert.ok(selection.rejected.some(item => item.reason === 'availability:deprecated'))
    assert.deepEqual(fs.readFileSync(source), before)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
