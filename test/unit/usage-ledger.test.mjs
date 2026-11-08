import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { createContext } from '../../lib/context.mjs'
import { loadConfig } from '../../lib/config.mjs'
import { readUsageLedger, writeUsageRow } from '../../lib/usage.mjs'
import { createFakeClock } from '../helpers/clock.mjs'
import { fakeStream } from '../helpers/ctx.mjs'
import { drive } from '../fixtures/store/drive.mjs'
import { leakScan, makeSentinel } from '../helpers/leak-scan.mjs'
import {
  CLOCK_START,
  MODEL_KEY,
  POOL_ID,
  READING_AT,
  createWorkspace,
  poolRecord,
  usageRow,
} from '../fixtures/usage/harness.mjs'

function lines(text) {
  return String(text ?? '').split(/\r?\n/).filter((line) => line.trim() !== '')
}

function configOf(w) {
  return loadConfig({ file: w.configFile, ctx: w.ctx })
}

function reopen(w) {
  const clock = createFakeClock({ start: Date.parse(CLOCK_START) })
  return createContext({
    env: { CLIWORKER_HOME: w.root },
    platform: process.platform,
    clock,
    stdout: fakeStream(),
    stderr: fakeStream(),
  })
}

test('[AC-049] a serial retry with the same key returns the first id and appends once', async () => {
  const w = createWorkspace()
  try {
    const first = await w.run(['usage', 'record', '--json', JSON.stringify(usageRow({ idempotency_key: 'serial-1' }))])
    assert.equal(first.exitCode, 0)
    assert.equal(first.stderr, '')
    const firstId = first.body.recorded.id
    assert.equal(typeof firstId, 'string')
    assert.equal(lines(w.readUsage()).length, 1)

    const second = await w.run(['usage', 'record', '--json', JSON.stringify(usageRow({
      idempotency_key: 'serial-1',
      input_tokens: 999999,
      at: '2026-11-07T11:00:00Z',
    }))])
    assert.equal(second.exitCode, 0)
    assert.equal(second.body.recorded.id, firstId)
    assert.equal(second.body.recorded.input_tokens, 1000)
    assert.equal(second.body.recorded.at, READING_AT)
    assert.equal(lines(w.readUsage()).length, 1)

    const summary = await w.run(['usage', 'summary'])
    assert.equal(summary.exitCode, 0)
    assert.equal(summary.body.records.length, 1)
    assert.equal(summary.body.records[0].id, firstId)
  } finally {
    w.cleanup()
  }
})

test('[AC-049] concurrent writes with one key produce one physical row and one id', async () => {
  const w = createWorkspace()
  try {
    const config = configOf(w)
    const input = usageRow({ idempotency_key: 'concurrent-1' })
    const results = await drive(
      w.clock,
      Promise.all([
        writeUsageRow({ ctx: w.ctx, config, input }),
        writeUsageRow({ ctx: w.ctx, config, input: { ...input } }),
      ]),
      { step: 50 }
    )
    assert.equal(results[0].row.id, results[1].row.id)
    assert.equal(lines(w.readUsage()).length, 1)
    const ledger = readUsageLedger({ ctx: w.ctx, config })
    assert.equal(ledger.rows.length, 1)
  } finally {
    w.cleanup()
  }
})

test('[AC-049] a fresh process replaying the key receives the stored id', async () => {
  const w = createWorkspace()
  try {
    const first = await w.run(['usage', 'record', '--json', JSON.stringify(usageRow({ idempotency_key: 'restart-1' }))])
    assert.equal(first.exitCode, 0)
    const id = first.body.recorded.id

    const ctx2 = reopen(w)
    const config2 = loadConfig({ file: w.configFile, ctx: ctx2 })
    const replay = await writeUsageRow({
      ctx: ctx2,
      config: config2,
      input: usageRow({ idempotency_key: 'restart-1', output_tokens: 7777 }),
    })
    assert.equal(replay.created, false)
    assert.equal(replay.row.id, id)
    assert.equal(replay.row.output_tokens, 0)
    assert.equal(lines(w.readUsage()).length, 1)
  } finally {
    w.cleanup()
  }
})

test('[AC-049] different keys stay distinct and both count', async () => {
  const w = createWorkspace()
  try {
    await w.run(['usage', 'record', '--json', JSON.stringify(usageRow({ idempotency_key: 'one' }))])
    await w.run(['usage', 'record', '--json', JSON.stringify(usageRow({ idempotency_key: 'two' }))])
    const summary = await w.run(['usage', 'summary'])
    assert.equal(lines(w.readUsage()).length, 2)
    assert.equal(summary.body.records.length, 2)
    assert.notEqual(summary.body.records[0].id, summary.body.records[1].id)
  } finally {
    w.cleanup()
  }
})

test('[AC-049] historical duplicate keys read as the first row without rewriting the file', async () => {
  const w = createWorkspace()
  try {
    w.writeUsage([
      usageRow({ idempotency_key: 'dup-1', at: '2026-11-07T08:00:00Z', input_tokens: 10 }),
      usageRow({ idempotency_key: 'dup-1', at: '2026-11-07T09:00:00Z', input_tokens: 20 }),
    ])
    const before = w.readUsage()
    const config = configOf(w)
    const ledger = readUsageLedger({ ctx: w.ctx, config })
    assert.equal(ledger.rows.length, 1)
    assert.equal(ledger.rows[0].at, '2026-11-07T08:00:00Z')
    assert.equal(ledger.rows[0].input_tokens, 10)
    assert.equal(w.readUsage(), before)

    const summary = await w.run(['usage', 'summary'])
    assert.equal(summary.body.records.length, 1)
  } finally {
    w.cleanup()
  }
})

test('[AC-049] keyless legacy rows stay independent and raise W_LEGACY_USAGE', async () => {
  const w = createWorkspace()
  try {
    w.writeUsage([
      { model: MODEL_KEY, at: '2026-11-07T08:00:00Z', input_tokens: 1 },
      { model: MODEL_KEY, at: '2026-11-07T08:00:00Z', input_tokens: 1 },
    ])
    const before = w.readUsage()
    const summary = await w.run(['usage', 'summary'])
    assert.equal(summary.exitCode, 0)
    assert.equal(summary.body.records.length, 2)
    assert.deepStrictEqual(summary.body.warnings, [{ code: 'W_LEGACY_USAGE' }])
    assert.equal(w.readUsage(), before)
  } finally {
    w.cleanup()
  }
})

test('[AC-049] a missing ledger is empty while broken JSONL fails as a state error', async () => {
  const w = createWorkspace()
  try {
    const empty = await w.run(['usage', 'summary'])
    assert.equal(empty.exitCode, 0)
    assert.deepStrictEqual(empty.body.records, [])

    w.writeUsageText('{bad\n')
    const broken = await w.run(['usage', 'summary'])
    assert.notEqual(broken.exitCode, 0)
    assert.equal(broken.body.ok, false)
    assert.equal(broken.body.error.code, 'E_CONFIG')
    assert.equal(broken.body.records, undefined)
  } finally {
    w.cleanup()
  }
})

test('[AC-049] a read failure is not mistaken for an empty ledger', async () => {
  const w = createWorkspace()
  try {
    w.writeUsage([usageRow({ idempotency_key: 'read-1' })])
    const original = w.ctx.fs.readFileSync
    w.ctx.fs = {
      ...fs,
      readFileSync(target, options) {
        if (String(target).endsWith('usage.jsonl')) {
          const error = new Error('denied')
          error.code = 'EACCES'
          throw error
        }
        return original(target, options)
      },
    }
    const summary = await w.run(['usage', 'summary'])
    assert.notEqual(summary.exitCode, 0)
    assert.equal(summary.body.error.code, 'E_CONFIG')
  } finally {
    w.cleanup()
  }
})

test('[AC-049] an append failure never reports a successful commit', async () => {
  const w = createWorkspace()
  try {
    w.ctx.fs = {
      ...fs,
      appendFileSync() {
        const error = new Error('denied')
        error.code = 'EACCES'
        throw error
      },
    }
    const result = await w.run(['usage', 'record', '--json', JSON.stringify(usageRow({ idempotency_key: 'fail-1' }))])
    assert.notEqual(result.exitCode, 0)
    assert.equal(result.body.ok, false)
    assert.equal(w.readUsage(), null)
  } finally {
    w.cleanup()
  }
})

test('[AC-049] a recorded row has every usage/v1 field, correct types and the clock time', async () => {
  const w = createWorkspace()
  try {
    const input = usageRow({ idempotency_key: 'fields-1' })
    delete input.at
    const result = await w.run(['usage', 'record', '--json', JSON.stringify(input)])
    assert.equal(result.exitCode, 0)
    const row = result.body.recorded
    assert.deepStrictEqual(Object.keys(row).sort(), [
      'at',
      'cache_read_tokens',
      'cache_write_tokens',
      'cost_usd',
      'id',
      'idempotency_key',
      'input_tokens',
      'kind',
      'lease_id',
      'model',
      'output_tokens',
      'pool_fraction_after',
      'pool_fraction_before',
      'pools',
      'schema',
    ])
    assert.equal(row.schema, 'cliworker.usage/v1')
    assert.equal(row.at, w.clock.nowIso())
    for (const key of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']) {
      assert.equal(Number.isInteger(row[key]) && row[key] >= 0, true, key)
    }
    assert.equal(typeof row.cost_usd, 'number')
    assert.equal(Number.isFinite(row.cost_usd), true)
    assert.equal(row.pool_fraction_before, null)
    assert.equal(row.pool_fraction_after, null)

    const bad = await w.run(['usage', 'record', '--json', JSON.stringify(usageRow({ input_tokens: -1 }))])
    assert.equal(bad.exitCode, 2)
    assert.equal(bad.body.error.code, 'E_REQUEST_INVALID')

    const badTime = await w.run(['usage', 'record', '--json', JSON.stringify(usageRow({ at: 'not-a-time' }))])
    assert.equal(badTime.exitCode, 2)
    assert.equal(badTime.body.error.code, 'E_REQUEST_INVALID')

    const badJson = await w.run(['usage', 'record', '--json', '{bad'])
    assert.equal(badJson.exitCode, 1)
    assert.equal(badJson.body.error.code, 'E_INTERNAL')
  } finally {
    w.cleanup()
  }
})

test('[AC-049] usage import is idempotent and pools set updates config by id', async () => {
  const w = createWorkspace()
  try {
    const file = path.join(w.root, 'import-rows.jsonl')
    fs.writeFileSync(file, [
      JSON.stringify(usageRow({ idempotency_key: 'import-1' })),
      JSON.stringify(usageRow({ idempotency_key: 'import-1', input_tokens: 2 })),
    ].join('\n') + '\n', 'utf8')

    const first = await w.run(['usage', 'import', '--file', file])
    assert.equal(first.exitCode, 0)
    assert.equal(lines(w.readUsage()).length, 1)
    const id = first.body.records[0].id

    const second = await w.run(['usage', 'import', '--file', file])
    assert.equal(second.exitCode, 0)
    assert.equal(second.body.records[0].id, id)
    assert.equal(lines(w.readUsage()).length, 1)

    const pool = w.config.pools[0]
    const changed = { ...pool, used_fraction: { value: 0.4, source: 'cli', at: READING_AT } }
    const set = await w.run(['pools', 'set', '--json', JSON.stringify(changed)])
    assert.equal(set.exitCode, 0)
    assert.equal(set.body.pools[0].used_fraction.value, 0.4)
    assert.equal(w.readConfig().pools[0].used_fraction.value, 0.4)

    const list = await w.run(['pools', 'list'])
    assert.equal(list.exitCode, 0)
    assert.equal(list.body.pools[0].id, POOL_ID)
    assert.equal(list.body.pools[0].used_fraction.value, 0.4)

    const badJson = await w.run(['pools', 'set', '--json', '{bad'])
    assert.equal(badJson.exitCode, 2)
    assert.equal(badJson.body.error.code, 'E_REQUEST_INVALID')

    const unknown = await w.run(['pools', 'set', '--json', JSON.stringify({ ...pool, id: 'missing:pool' })])
    assert.equal(unknown.exitCode, 2)
    assert.equal(unknown.body.error.code, 'E_REQUEST_INVALID')

    const badImport = path.join(w.root, 'bad.jsonl')
    fs.writeFileSync(badImport, '{bad\n', 'utf8')
    const invalid = await w.run(['usage', 'import', '--file', badImport])
    assert.equal(invalid.exitCode, 2)
    assert.equal(invalid.body.error.code, 'E_REQUEST_INVALID')

    const unknownPool = await w.run(['usage', 'import', '--file', file, '--cli', 'codex', '--pool', 'missing:pool'])
    assert.equal(unknownPool.exitCode, 2)
    assert.equal(unknownPool.body.error.code, 'E_REQUEST_INVALID')
  } finally {
    w.cleanup()
  }
})

test('[AC-049] forecast uses a fresh reading, the 600s boundary and then the ledger with W_STALE_DATA', async () => {
  const w = createWorkspace()
  try {
    w.writeUsage([
      usageRow({ idempotency_key: 'ledger-before', input_tokens: 1000000, at: '2026-11-07T09:30:00Z' }),
      usageRow({ idempotency_key: 'ledger-after', input_tokens: 500000, at: '2026-11-07T10:02:00Z' }),
    ])

    const fresh = await w.run(['models', 'forecast', '--model', MODEL_KEY])
    assert.equal(fresh.exitCode, 0)
    assert.equal(fresh.body.forecast.status, 'known')
    assert.equal(fresh.body.forecast.remaining_mtok, 4.5)

    w.clock.setNow(Date.parse('2026-11-07T10:10:00Z'))
    const boundary = await w.run(['models', 'forecast', '--model', MODEL_KEY])
    assert.equal(boundary.body.forecast.remaining_mtok, 4.5)
    assert.equal((boundary.body.warnings ?? []).some((item) => item.code === 'W_STALE_DATA'), false)

    await w.clock.advance(1000)
    const stale = await w.run(['models', 'forecast', '--model', MODEL_KEY])
    assert.equal(stale.exitCode, 0)
    assert.equal(stale.body.forecast.remaining_mtok, 8.5)
    assert.equal((stale.body.warnings ?? []).some((item) => item.code === 'W_STALE_DATA'), true)

    assert.equal(w.readConfig().pools[0].used_fraction.at, READING_AT)
    assert.equal(w.readPools(), null)
  } finally {
    w.cleanup()
  }
})

test('[AC-049] rows from an unrelated pool do not change the target forecast', async () => {
  const w = createWorkspace({
    mutate(config) {
      config.pools = [
        poolRecord(),
        poolRecord({
          id: 'other:plan',
          capacity_mtok: { 'other:model': { value: 5, source: 'config' } },
          used_fraction: { value: 0.9, source: 'cli', at: READING_AT },
        }),
      ]
    },
  })
  try {
    w.writeUsage([
      usageRow({ idempotency_key: 'before', input_tokens: 1000000, at: '2026-11-07T09:30:00Z' }),
      usageRow({ idempotency_key: 'after', input_tokens: 500000, at: '2026-11-07T10:02:00Z' }),
      usageRow({
        idempotency_key: 'other',
        model: 'other:model',
        pools: ['other:plan'],
        input_tokens: 4000000,
        at: '2026-11-07T10:01:00Z',
      }),
    ])
    const result = await w.run(['models', 'forecast', '--model', MODEL_KEY])
    assert.equal(result.body.forecast.remaining_mtok, 4.5)
  } finally {
    w.cleanup()
  }
})

test('[AC-049] a shared pool bills another model with its own capacity', async () => {
  const w = createWorkspace({
    mutate(config) {
      config.pools = [poolRecord({
        capacity_mtok: {
          [MODEL_KEY]: { value: 10, source: 'config' },
          'other:model': { value: 2, source: 'config' },
        },
      })]
    },
  })
  try {
    w.writeUsage([
      usageRow({ idempotency_key: 'target', input_tokens: 500000, at: '2026-11-07T10:02:00Z' }),
      usageRow({
        idempotency_key: 'other',
        model: 'other:model',
        input_tokens: 500000,
        at: '2026-11-07T10:03:00Z',
      }),
    ])
    const result = await w.run(['models', 'forecast', '--model', MODEL_KEY])
    // 0.5 reading + 0.5/10 target + 0.5/2 other = 0.8 used -> 2 Mtok left.
    assert.equal(result.body.forecast.remaining_mtok, 2)
  } finally {
    w.cleanup()
  }
})

test('[AC-049] a row whose model has no capacity keeps ledger_capacity_unknown', async () => {
  const w = createWorkspace()
  try {
    w.writeUsage([
      usageRow({
        idempotency_key: 'ghost',
        model: 'ghost:model',
        input_tokens: 1000000,
        at: '2026-11-07T10:02:00Z',
      }),
    ])
    const result = await w.run(['models', 'forecast', '--model', MODEL_KEY])
    assert.equal(result.exitCode, 0)
    assert.equal(result.body.forecast.status, 'unknown')
    assert.equal(result.body.forecast.reason, 'ledger_capacity_unknown')
    assert.equal(result.body.forecast.remaining_mtok, null)
  } finally {
    w.cleanup()
  }
})

test('[AC-049] an estimated reset does not clear usage while a CLI reset does', async () => {
  const estimated = createWorkspace({
    mutate(config) {
      config.pools = [poolRecord({
        used_fraction: null,
        window: {
          length_s: 18000,
          anchor: 'rolling',
          start_at: '2026-11-07T08:00:00Z',
          reset_at: '2026-11-07T09:45:00Z',
          reset_source: 'estimated',
        },
      })]
    },
  })
  const cli = createWorkspace({
    mutate(config) {
      config.pools = [poolRecord({
        used_fraction: null,
        window: {
          length_s: 18000,
          anchor: 'rolling',
          start_at: '2026-11-07T08:00:00Z',
          reset_at: '2026-11-07T09:45:00Z',
          reset_source: 'cli',
        },
      })]
    },
  })
  try {
    for (const w of [estimated, cli]) {
      w.writeUsage([
        usageRow({ idempotency_key: 'before-reset', input_tokens: 1000000, at: '2026-11-07T09:30:00Z' }),
        usageRow({ idempotency_key: 'after-reset', input_tokens: 500000, at: '2026-11-07T10:02:00Z' }),
      ])
    }
    const estimatedResult = await estimated.run(['models', 'forecast', '--model', MODEL_KEY])
    const cliResult = await cli.run(['models', 'forecast', '--model', MODEL_KEY])
    assert.equal(estimatedResult.body.forecast.remaining_mtok, 8.5)
    assert.equal(cliResult.body.forecast.remaining_mtok, 9.5)
  } finally {
    estimated.cleanup()
    cli.cleanup()
  }
})

test('[AC-049] command output, errors and state never contain a sentinel secret', async () => {
  const w = createWorkspace()
  try {
    const sentinel = makeSentinel('SECRET')
    const badFile = path.join(w.root, 'sentinel.jsonl')
    fs.writeFileSync(badFile, `{"model":"${sentinel}"\n`, 'utf8')

    const importResult = await w.run(['usage', 'import', '--file', badFile])
    assert.equal(importResult.exitCode, 2)
    const setResult = await w.run(['pools', 'set', '--json', JSON.stringify({ id: 'missing:pool', secret: sentinel })])
    assert.equal(setResult.exitCode, 2)

    const scan = leakScan({
      sentinels: [{ label: 'SECRET', value: sentinel }],
      stdout: [w.ctx.stdout.text(), importResult.stdout, setResult.stdout],
      stderr: [w.ctx.stderr.text(), importResult.stderr, setResult.stderr],
      state_dir: w.home,
    })
    assert.equal(scan.ok, true, JSON.stringify(scan.hits))
  } finally {
    w.cleanup()
  }
})

test('[AC-049] corrupt pool state and corrupt configuration fail as E_CONFIG', async () => {
  const w = createWorkspace()
  try {
    fs.writeFileSync(path.join(w.home, 'pools.json'), '{bad\n', 'utf8')
    const list = await w.run(['pools', 'list'])
    assert.notEqual(list.exitCode, 0)
    assert.equal(list.body.error.code, 'E_CONFIG')

    const forecast = await w.run(['models', 'forecast', '--model', MODEL_KEY])
    assert.notEqual(forecast.exitCode, 0)
    assert.equal(forecast.body.error.code, 'E_CONFIG')

    fs.writeFileSync(w.configFile, '{bad\n', 'utf8')
    const brokenConfig = await w.run(['models', 'forecast', '--model', MODEL_KEY])
    assert.notEqual(brokenConfig.exitCode, 0)
    assert.equal(brokenConfig.body.error.code, 'E_CONFIG')
  } finally {
    w.cleanup()
  }
})

test('[AC-049] the traceability shard names both usage test files', () => {
  const shard = JSON.parse(fs.readFileSync(new URL('../traceability/T-021.json', import.meta.url), 'utf8'))
  assert.equal(shard.task, 'T-021')
  assert.equal(shard.milestone, 'M4')
  const entry = shard.entries.find((item) => item.ac === 'AC-049')
  assert.deepStrictEqual(entry.files, [
    'test/unit/usage-ledger.test.mjs',
    'test/unit/usage-readers.test.mjs',
  ])
  assert.equal(entry.status, 'covered')
  assert.equal(Object.hasOwn(shard, 'baseline'), false)
})
