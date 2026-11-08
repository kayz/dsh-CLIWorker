import { listModels, resolveModel } from '../../catalog.mjs'
import { buildForecast } from '../../forecast.mjs'
import { billedTokens, evaluatePools } from '../../pools.mjs'
import { readUsageLedger } from '../../usage.mjs'
import { arg } from '../_util.mjs'
import { effectivePools } from '../pools/state.mjs'

export const route = { cmd: 'models', sub: 'forecast' }

const DEFAULT_TTL_S = 600

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isLegacy(config) {
  return Array.isArray(config?.warnings) && config.warnings.some((warning) => warning.code === 'W_CONFIG_V1')
}

/** The canonical model key when the catalog can resolve it; otherwise the caller's spelling. */
function canonicalModel(config, ctx, key) {
  if (typeof key !== 'string' || key === '') return ''
  if (isLegacy(config)) return key
  const models = listModels(config, { models: [], ctx })
  const resolved = resolveModel(models, key)
  return resolved ? resolved.key : key
}

function quotaFor(config, model) {
  if (model === '') return null
  const entry = config.models ? config.models[model] : null
  const provider = entry ? entry.provider : null
  return provider && config.quotas ? config.quotas[provider] ?? null : null
}

function poolCapacity(pool, model) {
  const map = isObject(pool) && isObject(pool.capacity_mtok) ? pool.capacity_mtok : null
  if (map === null) return null
  const entry = map[model]
  if (isObject(entry)) return finiteNumber(entry.value)
  return finiteNumber(entry)
}

function taskSamples(rows, model, cacheReadWeight) {
  const samples = []
  for (const row of rows) {
    if (!isObject(row) || row.model !== model || row.kind !== 'task') continue
    samples.push({
      mtok: billedTokens(row, cacheReadWeight) / 1e6,
      cost_usd: finiteNumber(row.cost_usd),
    })
  }
  return samples
}

/**
 * Builds cliworker.forecast/v1 for one model. Each configured pool is evaluated against only the
 * rows that name it; known pools are then frozen into a fresh reading at `now` so buildForecast
 * never re-adds another pool's rows to them. Unknown pools keep their rows so the engine can
 * preserve ledger_capacity_unknown / window_unknown.
 */
function buildModelForecast({ config, model, pools, rows, now, policy }) {
  const ttl = finiteNumber(policy?.reading_ttl_s) ?? DEFAULT_TTL_S
  const weight = finiteNumber(policy?.cache_read_weight) ?? 0
  const quota = quotaFor(config, model)
  const samples = taskSamples(rows, model, weight)

  if (pools.length === 0) {
    return { forecast: buildForecast({ model, quota, rows: [], samples, now, policy }), stale: false }
  }

  const relevant = pools.filter((pool) => poolCapacity(pool, model) !== null)
  if (relevant.length === 0) {
    return { forecast: buildForecast({ model, pools, rows: [], samples, now, policy }), stale: false }
  }

  const known = []
  const unknown = []
  const unknownRows = []
  let stale = false

  for (const pool of relevant) {
    const poolRows = rows.filter(
      (row) => isObject(row) && Array.isArray(row.pools) && row.pools.includes(pool.id)
    )
    const entry = evaluatePools({
      models: [model],
      pools: [pool],
      rows: poolRows,
      now,
      reading_ttl_s: ttl,
      cache_read_weight: weight,
    })[model]
    const detail = entry && Array.isArray(entry.pools) ? entry.pools[0] : null
    if (entry && entry.status === 'known' && detail && Number.isFinite(detail.used_fraction)) {
      const source = isObject(pool.used_fraction) && typeof pool.used_fraction.source === 'string'
        ? pool.used_fraction.source
        : 'config'
      known.push({
        ...structuredClone(pool),
        used_fraction: { value: detail.used_fraction, source, at: new Date(now).toISOString() },
      })
    } else {
      unknown.push(pool)
      unknownRows.push(...poolRows)
    }

    const readingAt = isObject(pool.used_fraction) && typeof pool.used_fraction.at === 'string'
      ? Date.parse(pool.used_fraction.at)
      : Number.NaN
    if (Number.isFinite(readingAt) && now - readingAt > ttl * 1000) stale = true
  }

  const forecast = buildForecast({
    model,
    pools: [...known, ...unknown],
    rows: [...new Set(unknownRows)],
    samples,
    quota,
    now,
    policy,
  })
  return { forecast, stale }
}

export async function run({ argv, ctx, config }) {
  const requested = arg(argv, '--model', null)
  const model = canonicalModel(config, ctx, requested)
  const now = ctx.clock.now()
  const policy = isObject(config.policy) ? config.policy : null
  const ledger = readUsageLedger({ ctx, config })
  const pools = effectivePools(ctx, config)
  const { forecast, stale } = buildModelForecast({
    config,
    model,
    pools,
    rows: ledger.rows,
    now,
    policy,
  })

  const warnings = []
  if (ledger.legacy) warnings.push({ code: 'W_LEGACY_USAGE' })
  if (stale) warnings.push({ code: 'W_STALE_DATA' })

  const body = { schema: 'cliworker.forecast/v1', forecast }
  if (warnings.length > 0) body.warnings = warnings
  return body
}
