import { arg } from '../_util.mjs'
import { codedError } from '../../output.mjs'
import { normalizeUsageRow, readUsageLedger, writeUsageRow } from '../../usage.mjs'
import { learnCapacity } from '../../capacity.mjs'
import { readCliReadings, selectLatest } from '../../usage-readers/index.mjs'
import { effectivePools, updateStatePools } from '../pools/state.mjs'

export const route = { cmd: 'usage', sub: 'import' }

function invalid(message) {
  return codedError('E_REQUEST_INVALID', message)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readText(ctx, file) {
  try {
    return String(ctx.fs.readFileSync(file, 'utf8'))
  } catch {
    throw invalid('usage import file is not readable')
  }
}

function parseUsageRows(text) {
  const rows = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.trim() === '') continue
    let value
    try {
      value = JSON.parse(line)
    } catch {
      throw invalid('usage import file contains invalid JSON')
    }
    if (!isObject(value)) throw invalid('usage import file contains a non-object row')
    rows.push(value)
  }
  return rows
}

async function importLedgerRows({ ctx, config, file }) {
  const parsed = parseUsageRows(readText(ctx, file))
  const prepared = parsed.map((row) => {
    if (typeof row.idempotency_key !== 'string' || row.idempotency_key === '') {
      throw invalid('imported usage rows require an idempotency_key')
    }
    return normalizeUsageRow(row, ctx)
  })

  const records = []
  for (const row of prepared) {
    const result = await writeUsageRow({ ctx, config, input: row })
    records.push(result.row)
  }
  return { ok: true, records }
}

async function importCliReading({ ctx, config, file, cli, poolId }) {
  const pool = Array.isArray(config.pools) ? config.pools.find((item) => item.id === poolId) : null
  if (!pool) throw invalid('usage import requires a configured pool')
  if (pool.cli !== cli) throw invalid('configured pool belongs to another CLI')
  if (pool.kind !== 'plan_window' && pool.kind !== 'plan_weekly') {
    throw invalid('configured pool has no CLI window')
  }

  const parsed = readCliReadings(ctx, cli, file)
  const readings = parsed[pool.kind]
  if (!Array.isArray(readings) || readings.length === 0) {
    // No trusted reading: keep the previous observation untouched.
    return { ok: true, pools: effectivePools(ctx, config) }
  }
  const latest = selectLatest(readings)
  if (latest === null) return { ok: true, pools: effectivePools(ctx, config) }

  const ledger = readUsageLedger({ ctx, config })
  const poolRows = ledger.rows.filter(
    (row) => isObject(row) && Array.isArray(row.pools) && row.pools.includes(poolId)
  )
  const models = [...new Set(poolRows.map((row) => row.model).filter((key) => typeof key === 'string' && key !== ''))]
  const learned = models.length === 1
    ? learnCapacity({
      readings,
      rows: poolRows,
      model: models[0],
      cache_read_weight: config.policy ? config.policy.cache_read_weight : 0,
    })
    : null

  const pools = await updateStatePools({ ctx, config }, (list) => {
    const target = list.find((item) => item.id === poolId)
    if (!target) throw invalid('configured pool is missing')
    target.used_fraction = { value: latest.used_fraction, source: 'cli', at: latest.at }
    if (latest.reset_at !== null && isObject(target.window)) {
      target.window.reset_at = latest.reset_at
      target.window.reset_source = 'cli'
    }
    if (learned !== null) {
      const capacity = isObject(target.capacity_mtok) ? target.capacity_mtok : {}
      const current = capacity[models[0]]
      if (!(isObject(current) && current.source === 'config')) {
        target.capacity_mtok = {
          ...capacity,
          [models[0]]: {
            value: learned.capacity_mtok,
            source: learned.source,
            confidence: learned.confidence,
          },
        }
      }
    }
    return list
  })

  const body = { ok: true, pools }
  if (ledger.legacy) body.warnings = [{ code: 'W_LEGACY_USAGE' }]
  return body
}

export async function run({ argv, ctx, config }) {
  const file = arg(argv, '--file')
  if (typeof file !== 'string' || file === '') throw invalid('usage import requires --file')
  const cli = arg(argv, '--cli')
  const poolId = arg(argv, '--pool')

  if (cli) {
    if (typeof poolId !== 'string' || poolId === '') throw invalid('usage import --cli requires --pool')
    return importCliReading({ ctx, config, file, cli, poolId })
  }
  if (typeof poolId === 'string' && poolId !== '') throw invalid('usage import --pool requires --cli')
  return importLedgerRows({ ctx, config, file })
}
