import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { commitProbeUsage, probeModels } from '../../lib/probe.mjs'
import { readProbeModels } from '../../lib/availability.mjs'
import { selectModels } from '../../lib/select.mjs'
import { evaluatePools } from '../../lib/pools.mjs'
import { setup } from '../fixtures/probe/helpers.mjs'
import { createFakeClock } from '../helpers/clock.mjs'

// These are local-stub integration regressions, not T-015 / real-vendor evidence. The helper
// injects a fake clock so the probe records, ledger timestamps and TTL boundary are deterministic
// and no wall clock is read.

function useFakeClock(f) {
  const clock = createFakeClock()
  f.ctx.clock = clock
  f.ctx.now = () => clock.now()
  return clock
}

function readRows(f) {
  return fs.readFileSync(path.join(f.dir, 'usage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
}

function readRecord(f) {
  const records = readProbeModels(f.config, { ctx: f.ctx })
  assert.equal(records.length, 1, 'exactly one canonical model is probed')
  return records[0]
}

function readInvocations(f) {
  if (!fs.existsSync(f.count)) return []
  return fs.readFileSync(f.count, 'utf8').trim().split('\n').filter(Boolean)
}

function selectConfig(model) {
  return {
    providers: { claude: { cli: 'claude' } },
    models: { [model.key]: { ...model, readonly: true } },
    quotas: {},
  }
}

test('[AC-048] local stub probe writes a clock-stamped record and one usage row', async () => {
  const f = setup()
  try {
    const clock = useFakeClock(f)
    await clock.advance(1234)
    const [model] = await probeModels(f.config, { ctx: f.ctx })

    const record = readRecord(f)
    assert.equal(record.key, 'claude:one')
    assert.equal(record.availability.state, 'callable')
    assert.equal(record.availability.at, clock.nowIso())
    assert.equal(record.availability.evidence.nonce_ok, true)
    assert.equal(record.availability.evidence.duration_ms, 0)

    const rows = readRows(f)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].schema, 'cliworker.usage/v1')
    assert.equal(rows[0].kind, 'probe')
    assert.equal(rows[0].lease_id, '')
    assert.equal(rows[0].idempotency_key, `probe:${record.availability.evidence.probe_id}`)
    assert.equal(rows[0].at, clock.nowIso())
    assert.equal(rows[0].model, model.key)
    assert.deepEqual(rows[0].pools, ['pool'])
    assert.equal(rows[0].input_tokens + rows[0].output_tokens, 10)
    assert.equal(typeof rows[0].cost_usd, 'number')
  } finally { f.cleanup() }
})

test('[AC-048] local stub fresh record is reused by selection without another probe', async () => {
  const f = setup()
  try {
    useFakeClock(f)
    const [model] = await probeModels(f.config, { ctx: f.ctx })
    const records = readProbeModels(f.config, { ctx: f.ctx })
    const invocations = readInvocations(f)
    assert.deepEqual(invocations, ['one'])

    const selection = selectModels(selectConfig(model), { level: 'Quick' }, {
      // The provider status is unusable, so success proves the fresh cache record was used.
      status: { claude: { state: 'unavailable' } },
      usage: readRows(f),
      ctx: f.ctx,
      probeModels: records,
    })
    assert.equal(selection.models.length, 1)
    assert.equal(selection.models[0].key, 'claude:one')
    assert.deepEqual(selection.rejected, [])

    // Reading and selecting must not run the CLI, write a row or move the probe timestamp.
    assert.deepEqual(readInvocations(f), invocations)
    assert.equal(readRows(f).length, 1)
    const after = readRecord(f)
    assert.equal(after.availability.evidence.probe_id, records[0].availability.evidence.probe_id)
    assert.equal(after.availability.at, records[0].availability.at)
  } finally { f.cleanup() }
})

test('[AC-048] local stub expired record is replaced by a new probe with a new id and row', async () => {
  const f = setup()
  try {
    const clock = useFakeClock(f)
    const [firstModel] = await probeModels(f.config, { ctx: f.ctx })
    const first = readRecord(f)

    await clock.advance(10001)
    const stale = selectModels(selectConfig(firstModel), { level: 'Quick' }, {
      status: { claude: { state: 'unavailable' } },
      ctx: f.ctx,
      probeModels: readProbeModels(f.config, { ctx: f.ctx }),
    })
    assert.ok(stale.rejected.some((row) => row.key === 'claude:one' && row.reason === 'availability_stale'))

    const [secondModel] = await probeModels(f.config, { ctx: f.ctx })
    const second = readRecord(f)
    assert.notEqual(second.availability.evidence.probe_id, first.availability.evidence.probe_id)
    assert.equal(second.availability.at, clock.nowIso())
    assert.equal(readRows(f).length, 2)
    assert.deepEqual(readInvocations(f), ['one', 'one'])

    const fresh = selectModels(selectConfig(secondModel), { level: 'Quick' }, {
      status: { claude: { state: 'unavailable' } },
      ctx: f.ctx,
      probeModels: [second],
    })
    assert.equal(fresh.models.length, 1)
    assert.equal(fresh.models[0].key, 'claude:one')
  } finally { f.cleanup() }
})

test('[AC-048] local stub a failed probe with reported usage is still booked', async () => {
  const f = setup('auth')
  try {
    useFakeClock(f)
    const [model] = await probeModels(f.config, { ctx: f.ctx })
    assert.equal(model.availability.state, 'blocked')
    assert.equal(model.availability.reason, 'auth')
    const rows = readRows(f)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].kind, 'probe')
    assert.equal(rows[0].model, 'claude:one')
    assert.equal(rows[0].input_tokens + rows[0].output_tokens, 10)
    assert.deepEqual(rows[0].pools, ['pool'])
  } finally { f.cleanup() }
})

test('[AC-048] local stub a timed-out first attempt and its retry book one row', async () => {
  const f = setup()
  try {
    useFakeClock(f)
    let calls = 0
    f.ctx.exec = (command, args, options) => {
      calls += 1
      if (calls === 1) return { ok: false, code: null, stdout: '', stderr: '', error: '', error_code: 'E_TIMEOUT' }
      const nonce = String(options.input).trim().split(/\s+/).at(-1)
      return {
        ok: true,
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          type: 'result',
          model: 'claude:one',
          text: nonce,
          usage: { input_tokens: 5, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0 },
        }),
      }
    }

    const [model] = await probeModels(f.config, { ctx: f.ctx })
    assert.equal(calls, 2)
    assert.equal(model.availability.state, 'callable')
    assert.equal(model.availability.evidence.exit, 0)
    assert.deepEqual(model.availability.evidence.tokens, {
      input_tokens: 5, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0,
    })

    const rows = readRows(f)
    assert.equal(rows.length, 1, 'both attempts belong to one logical probe row')
    assert.equal(rows[0].idempotency_key, `probe:${model.availability.evidence.probe_id}`)
    assert.equal(rows[0].input_tokens, 5)
    assert.equal(rows[0].output_tokens, 2)
  } finally { f.cleanup() }
})

test('[AC-048] local stub records one row and replays its id', async () => {
  const f = setup()
  try {
    f.config.catalog.allow.push('alias')
    await probeModels(f.config, { ctx: f.ctx })
    const file = path.join(f.dir, 'usage.jsonl')
    const row = JSON.parse(fs.readFileSync(file, 'utf8').trim())
    assert.equal(row.kind, 'probe')
    assert.equal(row.model, 'claude:one')
    assert.deepEqual(row.pools, ['pool'])
    assert.equal(row.input_tokens + row.output_tokens, 10)
    assert.equal(await commitProbeUsage(f.config, { ctx: f.ctx, row }), row.id)
    assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1)
    assert.deepEqual(readInvocations(f), ['one'])
  } finally { f.cleanup() }
})

test('[AC-048] local stub concurrent replay keeps one row', async () => {
  const f = setup()
  try {
    await probeModels(f.config, { ctx: f.ctx })
    const file = path.join(f.dir, 'usage.jsonl')
    const row = JSON.parse(fs.readFileSync(file, 'utf8').trim())
    const ids = await Promise.all([commitProbeUsage(f.config, { ctx: f.ctx, row }), commitProbeUsage(f.config, { ctx: f.ctx, row })])
    assert.deepEqual(ids, [row.id, row.id])
    assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1)
  } finally { f.cleanup() }
})

test('[AC-048] local stub malformed ledger fails rather than being overwritten', async () => {
  const f = setup()
  try {
    fs.writeFileSync(path.join(f.dir, 'usage.jsonl'), '{bad\n', 'utf8')
    await assert.rejects(probeModels(f.config, { ctx: f.ctx }))
    assert.equal(fs.existsSync(path.join(f.dir, 'probes.json')), false)
  } finally { f.cleanup() }
})

test('[AC-048] local stub known pool usage increases by billed tokens over capacity', async () => {
  const f = setup()
  try {
    const clock = useFakeClock(f)
    const now = clock.now()
    const pool = { ...f.config.pools[0], window: { start_at: new Date(now - 60000).toISOString() } }
    const unrelated = { id: 'unrelated', capacity_mtok: { 'claude:other': 1 }, window: { start_at: new Date(now - 60000).toISOString() } }
    const before = evaluatePools({ models: ['claude:one', 'claude:other'], pools: [pool, unrelated], rows: [], now })
    await probeModels(f.config, { ctx: f.ctx })
    const rows = readRows(f)
    // Evaluate each pool against its own ledger rows, as pool membership determines charging.
    const after = evaluatePools({ models: ['claude:one'], pools: [pool], rows: rows.filter(row => row.pools.includes('pool')), now: clock.now() })
    const other = evaluatePools({ models: ['claude:other'], pools: [unrelated], rows: rows.filter(row => row.pools.includes('unrelated')), now: clock.now() })
    assert.equal(after['claude:one'].pools[0].used_fraction - before['claude:one'].pools[0].used_fraction, 10 / 1e6)
    assert.equal(other['claude:other'].pools[0].used_fraction, before['claude:other'].pools[0].used_fraction)
  } finally { f.cleanup() }
})
