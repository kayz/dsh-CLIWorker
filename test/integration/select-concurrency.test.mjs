// Cross-process selection: 50 real Node children block on one barrier file, then select against
// the same state directory at the same injected instant. Everything is coordinated with file
// events and the injected clock; the test never sleeps or waits on a fixed wall-clock delay.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { runSelection } from '../../lib/select.mjs'
import { createContext } from '../../lib/context.mjs'
import { loadConfig } from '../../lib/config.mjs'
import { createFakeClock } from '../helpers/clock.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const START = Date.parse('2026-11-07T00:00:00.000Z')
const CHILDREN = 50

const CHILD_SOURCE = `
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = process.env.CW_REPO
const barrier = process.env.CW_BARRIER
const out = process.env.CW_OUT
const { createContext } = await import(pathToFileURL(path.join(repo, 'lib', 'context.mjs')).href)
const { loadConfig } = await import(pathToFileURL(path.join(repo, 'lib', 'config.mjs')).href)
const { runSelection } = await import(pathToFileURL(path.join(repo, 'lib', 'select.mjs')).href)

function waitForBarrier() {
  return new Promise((resolve) => {
    const check = () => {
      if (!fs.existsSync(path.join(barrier, 'go'))) return
      watcher.close()
      resolve()
    }
    const watcher = fs.watch(barrier, () => {
      check()
    })
    fs.writeFileSync(path.join(barrier, 'ready-' + process.env.CW_ID), '')
    check()
  })
}

const ctx = createContext({ env: process.env, platform: process.platform })
const config = loadConfig({ file: process.env.CW_CONFIG, ctx })
await waitForBarrier()
try {
  const result = await runSelection({ ctx, config, request: JSON.parse(process.env.CW_REQUEST) })
  fs.writeFileSync(out, JSON.stringify({ ok: result.ok, error: result.error, agentline: result.agentline }))
} catch (error) {
  fs.writeFileSync(out, JSON.stringify({ ok: false, thrown: { code: error && error.code, message: error && error.message } }))
  process.exitCode = 1
}
`

function modelRecord(key, index) {
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
    level_source: { kind: 'config', ref: 'conc#catalog.levels', at },
    availability: { state: 'callable', reason: null, at, ttl_s: 86400, evidence: null },
    identity: 'verified',
    capabilities: { context_tokens: 100000, readonly: true, stdin: true },
    prices: { input_per_mtok: index + 1, output_per_mtok: 1, source: 'config' },
    source: { kind: 'manual', ref: 'conc#catalog.manual', at },
    deprecated: false,
  }
}

/**
 * One shared plan pool over models with different capacities, plus a paid pool so a candidate is
 * never rejected for a missing funding class.
 */
function createFixture({ capacities, used = 0.5, leaseTtl = 7200 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-conc-select-'))
  const stateDir = path.join(root, 'state')
  fs.mkdirSync(stateDir, { recursive: true })
  const at = new Date(START).toISOString()
  const keys = Object.keys(capacities)
  const models = keys.map((key, index) => modelRecord(key, index))
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
      id: 'claude:plan-conc',
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
      capacity_mtok: Object.fromEntries(keys.map((key) => [key, { value: capacities[key], source: 'config' }])),
      used_fraction: { value: used, source: 'config', at },
      credits_per_mtok: null,
    }],
    policy: {
      lease_ttl_s: leaseTtl,
      reading_ttl_s: 600,
      lock_stale_ms: 60000,
      lock_wait_ms: 60000,
      lock_poll_ms: 5,
      reserve_fraction_for_high: 0.15,
      unknown_policy: 'after_known',
      usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 },
      cache_read_weight: 0,
    },
  }
  const configFile = path.join(root, 'config.json')
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8')
  const clockFile = path.join(root, 'clock.txt')
  fs.writeFileSync(clockFile, String(START), 'utf8')
  const barrier = path.join(root, 'barrier')
  fs.mkdirSync(barrier, { recursive: true })
  const ctx = createContext({
    clock: createFakeClock({ start: START }),
    env: {},
    platform: process.platform,
    exec: () => { throw new Error('selection must not execute a provider') },
    fetch: () => { throw new Error('selection must not touch the network') },
  })
  const loaded = loadConfig({ file: configFile, ctx })
  return {
    root,
    stateDir,
    configFile,
    clockFile,
    barrier,
    ctx,
    config: loaded,
    capacities,
    stateFile: path.join(stateDir, 'leases.json'),
    request(overrides = {}) {
      return {
        schema: 'cliworker.request/v1',
        level: 'Top',
        count: 2,
        usage: 'Normal',
        importance: 'high',
        cwd: root,
        ...overrides,
      }
    },
    readState() {
      return fs.existsSync(this.stateFile)
        ? JSON.parse(fs.readFileSync(this.stateFile, 'utf8'))
        : { leases: [], requests: [] }
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

function spawnChild(fixture, { id, request }, pending) {
  const out = path.join(fixture.root, `out-${id}.json`)
  const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD_SOURCE], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_TEST_CONTEXT: '',
      CLIWORKER_TEST_CLOCK_FILE: fixture.clockFile,
      CW_REPO: ROOT,
      CW_BARRIER: fixture.barrier,
      CW_CONFIG: fixture.configFile,
      CW_REQUEST: JSON.stringify(request),
      CW_OUT: out,
      CW_ID: id,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  let stdout = ''
  child.stdout.on('data', (chunk) => { stdout += String(chunk) })
  const entry = {
    child,
    out,
    done: new Promise((resolve) => {
      child.on('exit', (code) => {
        if (pending) {
          pending.exited += 1
          pending.errors.push(`${id}:${code}${stderr ? ` ${stderr.slice(0, 200)}` : ''}`)
        }
        resolve({ code, entry })
      })
    }),
    read() {
      assert.equal(fs.existsSync(out), true, `child ${id} produced no result: ${stderr || stdout}`)
      return JSON.parse(fs.readFileSync(out, 'utf8'))
    },
  }
  return entry
}

function waitForChildren(children) {
  return Promise.all(children.map((entry) => entry.done))
}

/** Waits until `goal` ready files exist, re-checking after every directory event. */
function waitForReady(dir, goal, pending) {
  return new Promise((resolve, reject) => {
    let watcher = null
    const check = () => {
      let names = []
      try {
        names = fs.readdirSync(dir)
      } catch {
        names = []
      }
      const ready = names.filter((name) => name.startsWith('ready-')).length
      if (ready >= goal) {
        if (watcher) watcher.close()
        resolve()
      } else if (pending.exited >= pending.total) {
        if (watcher) watcher.close()
        reject(new Error(`only ${ready}/${goal} children became ready: ${pending.errors.join(' | ')}`))
      }
    }
    try {
      watcher = fs.watch(dir, () => check())
    } catch {
      watcher = null
    }
    check()
  })
}

function openBarrier(fixture) {
  fs.writeFileSync(path.join(fixture.barrier, 'go'), '')
}

/** Clears ready markers and the gate so a later phase blocks on the barrier again. */
function resetBarrier(fixture) {
  for (const name of fs.readdirSync(fixture.barrier)) {
    fs.rmSync(path.join(fixture.barrier, name), { force: true })
  }
}

/** Per-model reserved fraction -> Mtok, checked against that model's remaining quota. */
function assertNoOversell(fixture, used) {
  const state = fixture.readState()
  let fraction = 0
  const byModel = new Map()
  for (const lease of state.leases) {
    for (const pool of lease.pools) {
      assert.equal(pool.id, 'claude:plan-conc')
      fraction += pool.fraction
      const capacity = fixture.capacities[lease.model_key]
      assert.ok(Number.isFinite(capacity), `lease ${lease.lease_id} has no known capacity`)
      const key = `${pool.id}\u0000${lease.model_key}`
      byModel.set(key, (byModel.get(key) || 0) + pool.fraction * capacity)
    }
  }
  for (const [key, reserved] of byModel) {
    const model = key.split('\u0000')[1]
    const remaining = fixture.capacities[model] * (1 - used)
    assert.ok(reserved <= remaining + 1e-9, `${model} reserved ${reserved} > remaining ${remaining}`)
  }
  assert.ok(fraction <= 1 - used + 1e-9, `shared pool reserved fraction ${fraction}`)
  return state
}

test('[AC-054] 50 concurrent processes never oversell a shared pool and replay safely', async () => {
  const fixture = createFixture({ capacities: { ma: 1000, mb: 2000, mc: 3000, md: 4000 } })
  const pending = { total: CHILDREN, exited: 0, errors: [] }
  const children = []
  try {
    const snapshots = []
    for (let index = 0; index < CHILDREN; index += 1) {
      const entry = spawnChild(fixture, {
        id: `p${index}`,
        request: fixture.request({ request_id: `conc-${index}` }),
      }, pending)
      entry.child.on('exit', () => {
        try {
          snapshots.push(assertNoOversell(fixture, 0.5))
        } catch (error) {
          if (error && (error.code === 'ENOENT' || error.code === 'EPERM' || error.code === 'EBUSY')) return
          pending.errors.push(error.message)
        }
      })
      children.push(entry)
    }

    await waitForReady(fixture.barrier, CHILDREN, pending)
    openBarrier(fixture)
    const exits = await waitForChildren(children)
    for (const { code, entry } of exits) assert.equal(code, 0, `every child must exit cleanly: ${JSON.stringify(entry.read())}`)

    const results = children.map((entry) => entry.read())
    for (const result of results) {
      assert.equal(result.ok, true, JSON.stringify(result.error || result.thrown))
      assert.equal(result.agentline.models.length, 2)
    }
    const state = assertNoOversell(fixture, 0.5)
    assert.equal(state.leases.length, CHILDREN * 2)
    for (const snapshot of snapshots) assert.ok(snapshot.leases.length <= CHILDREN * 2)

    // Same request id, concurrent then serial and after a restart: one result, one reservation.
    const before = fixture.readState().leases.length
    assert.ok(snapshots.length > 0, 'at least one committed snapshot was inspected')
    for (const snapshot of snapshots) assert.ok(snapshot.leases.length <= CHILDREN * 2)
    resetBarrier(fixture)
    const replayPending = { total: 8, exited: 0, errors: [] }
    const replayChildren = []
    for (let index = 0; index < 8; index += 1) {
      replayChildren.push(spawnChild(fixture, {
        id: `r${index}`,
        request: fixture.request({ request_id: 'replay-key' }),
      }, replayPending))
    }
    await waitForReady(fixture.barrier, replayChildren.length, replayPending)
    openBarrier(fixture)
    const replayExits = await waitForChildren(replayChildren)
    for (const { code } of replayExits) assert.equal(code, 0)
    const first = replayChildren[0].read()
    assert.equal(first.ok, true)
    for (const entry of replayChildren.slice(1)) {
      assert.deepStrictEqual(entry.read().agentline, first.agentline)
    }
    assert.equal(fixture.readState().leases.length, before + 2, 'replay must not add reservations')

    const serial = await runSelection({
      ctx: fixture.ctx,
      config: fixture.config,
      request: fixture.request({ request_id: 'replay-key' }),
    })
    assert.deepStrictEqual(serial.agentline, first.agentline)
    assert.equal(fixture.readState().leases.length, before + 2)

    const restart = spawnChild(fixture, { id: 'restart', request: fixture.request({ request_id: 'replay-key' }) })
    openBarrier(fixture)
    const restartExit = await waitForChildren([restart])
    assert.equal(restartExit[0].code, 0)
    assert.deepStrictEqual(restart.read().agentline, first.agentline)
    assert.equal(fixture.readState().leases.length, before + 2)

    // A new request id excludes the first handles and tops up with new models and reservations.
    const excluded = first.agentline.models.map((model) => model.handle_id)
    assert.equal(new Set(excluded).size, 2)
    const topUp = await runSelection({
      ctx: fixture.ctx,
      config: fixture.config,
      request: fixture.request({ request_id: 'top-up', count: 2, exclude_handles: excluded }),
    })
    assert.equal(topUp.ok, true)
    assert.equal(topUp.agentline.models.length, 2)
    for (const model of topUp.agentline.models) {
      assert.equal(excluded.includes(model.handle_id), false)
      assert.equal(excluded.includes(model.lease_id), false)
    }
    assert.equal(new Set(topUp.agentline.models.map((model) => model.handle_id)).size, 2)
    const afterTopUp = fixture.readState()
    assert.equal(afterTopUp.leases.length, before + 4, 'the original reservation stays held')
    assertNoOversell(fixture, 0.5)

    // Omitting request_id must not collide on one empty key.
    const one = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: fixture.request({ count: 1 }) })
    const two = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: fixture.request({ count: 1 }) })
    assert.equal(one.ok, true)
    assert.equal(two.ok, true)
    assert.notEqual(one.agentline.models[0].handle_id, two.agentline.models[0].handle_id)
    assert.equal(fixture.readState().leases.length, before + 6)
  } finally {
    fixture.cleanup()
  }
})

test('[AC-054] lease expiry releases the reservation only after the instant passes', async () => {
  const fixture = createFixture({ capacities: { ma: 10 }, used: 0.95, leaseTtl: 1 })
  try {
    const request = (id) => fixture.request({ request_id: id, count: 1 })
    const first = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: request('ttl-1') })
    assert.equal(first.ok, true)
    const expiresAt = first.agentline.models[0].expires_at
    assert.equal(expiresAt, new Date(START + 1000).toISOString())

    fs.writeFileSync(fixture.clockFile, String(START + 1000), 'utf8')
    fixture.ctx.clock.setNow(START + 1000)
    const exact = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: request('ttl-2') })
    assert.equal(exact.ok, false, 'an expires_at equal to now still holds the reservation')
    assert.equal(exact.agentline.error.code, 'E_INSUFFICIENT_QUOTA')

    fs.writeFileSync(fixture.clockFile, String(START + 1001), 'utf8')
    fixture.ctx.clock.setNow(START + 1001)
    const later = await runSelection({ ctx: fixture.ctx, config: fixture.config, request: request('ttl-3') })
    assert.equal(later.ok, true, 'one millisecond later the expired reservation is free')
    const state = fixture.readState()
    assert.equal(state.leases.length, 1)
    assert.equal(state.leases[0].lease_id, later.agentline.models[0].lease_id)
  } finally {
    fixture.cleanup()
  }
})

test('[AC-054] damaged state and a failed commit never produce a reservation', async () => {
  const damaged = createFixture({ capacities: { ma: 10 }, used: 0 })
  try {
    fs.writeFileSync(damaged.stateFile, '{not json', 'utf8')
    await assert.rejects(
      () => runSelection({ ctx: damaged.ctx, config: damaged.config, request: damaged.request({ request_id: 'bad' }) }),
      (error) => error && error.code === 'E_CONFIG'
    )
    assert.equal(fs.readFileSync(damaged.stateFile, 'utf8'), '{not json')
  } finally {
    damaged.cleanup()
  }

  const failing = createFixture({ capacities: { ma: 10 }, used: 0 })
  try {
    const realFs = failing.ctx.fs
    failing.ctx.fs = {
      ...realFs,
      renameSync() {
        const error = new Error('simulated commit failure')
        error.code = 'EIO'
        throw error
      },
    }
    await assert.rejects(
      () => runSelection({ ctx: failing.ctx, config: failing.config, request: failing.request({ request_id: 'io' }) }),
      (error) => error && error.code === 'EIO'
    )
    assert.equal(fs.existsSync(failing.stateFile), false, 'no half-committed lease state')
  } finally {
    failing.cleanup()
  }
})
