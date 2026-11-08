import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { commitProbeUsage, probeModels } from '../../lib/probe.mjs'
import { setup } from '../fixtures/probe/helpers.mjs'
import { evaluatePools } from '../../lib/pools.mjs'

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
    assert.equal(fs.readFileSync(f.count, 'utf8'), 'one\n')
  } finally { f.cleanup() }
})

test('[AC-048] concurrent replay keeps one row', async () => {
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

test('[AC-048] malformed ledger fails rather than being overwritten', async () => {
  const f = setup()
  try {
    fs.writeFileSync(path.join(f.dir, 'usage.jsonl'), '{bad\n', 'utf8')
    await assert.rejects(probeModels(f.config, { ctx: f.ctx }))
    assert.equal(fs.existsSync(path.join(f.dir, 'probes.json')), false)
  } finally { f.cleanup() }
})

test('[AC-048] known pool usage increases by billed tokens over capacity', async () => {
  const f = setup()
  try {
    const now = f.ctx.clock.now()
    const pool = { ...f.config.pools[0], window: { start_at: new Date(now - 60000).toISOString() } }
    const unrelated = { id: 'unrelated', capacity_mtok: { 'claude:other': 1 }, window: { start_at: new Date(now - 60000).toISOString() } }
    const before = evaluatePools({ models: ['claude:one', 'claude:other'], pools: [pool, unrelated], rows: [], now })
    await probeModels(f.config, { ctx: f.ctx })
    const rows = fs.readFileSync(path.join(f.dir, 'usage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    // Evaluate each pool against its own ledger rows, as pool membership determines charging.
    const after = evaluatePools({ models: ['claude:one'], pools: [pool], rows: rows.filter(row => row.pools.includes('pool')), now: f.ctx.clock.now() })
    const other = evaluatePools({ models: ['claude:other'], pools: [unrelated], rows: rows.filter(row => row.pools.includes('unrelated')), now: f.ctx.clock.now() })
    assert.equal(after['claude:one'].pools[0].used_fraction - before['claude:one'].pools[0].used_fraction, 10 / 1e6)
    assert.equal(other['claude:other'].pools[0].used_fraction, before['claude:other'].pools[0].used_fraction)
  } finally { f.cleanup() }
})
