import { systemNow } from './context.mjs'
import { round3, normalizeQuota, evaluatePools } from './pools.mjs'

export { round3 }

export const DEFAULT_PRICES = { input_per_mtok: 0, output_per_mtok: 0 }

export function normalizePrices(m = {}) {
  const p = m.prices || {}
  return {
    input_per_mtok: Number(p.input_per_mtok ?? DEFAULT_PRICES.input_per_mtok),
    output_per_mtok: Number(p.output_per_mtok ?? DEFAULT_PRICES.output_per_mtok),
  }
}

export function estimateCost({ input_tokens = 0, output_tokens = 0, prices = DEFAULT_PRICES }) {
  const p = { ...DEFAULT_PRICES, ...prices }
  return (Number(input_tokens) / 1e6) * p.input_per_mtok + (Number(output_tokens) / 1e6) * p.output_per_mtok
}

/**
 * Deterministic, intentionally simple forecast. Unknown is a first-class state.
 * @deprecated Superseded by buildForecast; kept until lib/select.mjs migrates (T-007).
 */
export function forecast({ records = [], model, prices, quota = null, now = systemNow() } = {}) {
  const rows = records.filter((r) => !model || r.model === model)
  const samples = rows.map((r) => ({
    at: Date.parse(r.at || 0), input: Number(r.input_tokens || 0), output: Number(r.output_tokens || 0),
    cost: Number(r.cost_usd ?? estimateCost({ input_tokens: r.input_tokens, output_tokens: r.output_tokens, prices })),
  })).filter((r) => Number.isFinite(r.at) && r.at > 0)
  if (!samples.length) {
    return { status: 'unknown', samples: 0, reason: 'no usage samples', burn_per_task: null, tasks_left: null, eta_hours: null, confidence: 'none' }
  }
  const recent = samples.filter((r) => now - r.at <= 24 * 3600_000)
  const use = recent.length ? recent : samples.slice(-10)
  const burn = use.reduce((a, r) => a + r.cost, 0) / use.length
  const tokens = use.reduce((a, r) => a + r.input + r.output, 0) / use.length
  const spanHours = Math.max(1 / 60, (now - Math.min(...use.map((r) => r.at))) / 3600_000)
  const burnPerHour = use.reduce((a, r) => a + r.cost, 0) / spanHours
  let tasksLeft = null
  let etaHours = null
  if (quota && Number.isFinite(Number(quota.remaining_usd)) && burn > 0) {
    tasksLeft = Math.floor(Number(quota.remaining_usd) / burn)
    etaHours = burnPerHour > 0 ? Number(quota.remaining_usd) / burnPerHour : null
  } else if (quota && Number.isFinite(Number(quota.remaining)) && Number(quota.remaining) > 0 && tokens > 0 && quota.unit === 'tokens') {
    tasksLeft = Math.floor(Number(quota.remaining) / tokens)
  }
  const confidence = use.length >= 5 ? 'medium' : 'low'
  const risk = tasksLeft == null ? 'unknown' : tasksLeft <= 0 ? 'exhausted' : tasksLeft <= 2 ? 'critical' : tasksLeft <= 5 ? 'low_reserve' : 'ok'
  return {
    status: 'known', samples: use.length, burn_per_task: round(burn), tokens_per_task: Math.round(tokens),
    burn_per_hour: round(burnPerHour), tasks_left: tasksLeft, eta_hours: etaHours == null ? null : round(etaHours),
    confidence, risk,
  }
}

function round(n) { return Math.round(n * 1e6) / 1e6 }

const HOUR_MS = 3_600_000

const USAGE_P = { Heavy: 0.9, Normal: 0.5, Light: 0.25 }

export const DEFAULT_POLICY = {
  reading_ttl_s: 600,
  cache_read_weight: 0,
  usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 },
}

function requireNow(now) {
  if (!Number.isFinite(now)) throw new TypeError('now must be a finite millisecond timestamp')
  return now
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return null
}

function usageWeight(usage) {
  return Object.prototype.hasOwnProperty.call(USAGE_P, usage) ? USAGE_P[usage] : USAGE_P.Normal
}

/** Nearest-rank quantile of the finite samples for a usage class; fewer than three samples is null. */
export function quantileForUsage(samples, usage) {
  const values = (Array.isArray(samples) ? samples : []).filter((item) => Number.isFinite(item))
  const n = values.length
  if (n < 3) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const rank = Math.ceil(usageWeight(usage) * n) - 1
  return sorted[rank]
}

/** Confidence from sample count, downgraded when the coefficient of variation exceeds one. */
export function confidenceFor(n, cv) {
  const count = Number.isFinite(n) ? n : 0
  if (count <= 0) return 'none'
  if (count < 5) return 'low'
  if (count < 20) return 'medium'
  return Number.isFinite(cv) && cv > 1 ? 'medium' : 'high'
}

/** Risk from tasks left (tasks or usd basis) first, then the remaining fraction. */
export function classifyRisk({ tasks_left = null, tasks_left_basis = 'none', remaining_fraction = null } = {}) {
  if (Number.isFinite(tasks_left) && (tasks_left_basis === 'tasks' || tasks_left_basis === 'usd')) {
    const risk = tasks_left <= 0 ? 'exhausted' : tasks_left <= 2 ? 'critical' : tasks_left <= 5 ? 'low_reserve' : 'ok'
    return { risk, risk_basis: tasks_left_basis }
  }
  if (Number.isFinite(remaining_fraction)) {
    const risk = remaining_fraction <= 0 ? 'exhausted' : remaining_fraction < 0.05 ? 'critical' : remaining_fraction < 0.15 ? 'low_reserve' : 'ok'
    return { risk, risk_basis: 'fraction' }
  }
  return { risk: 'unknown', risk_basis: 'none' }
}

/** Burn rate in Mtok per hour, clamped to at least one minute of elapsed time. */
export function burnMtokPerHour({ used_mtok = 0, hours_since_window_start = 0 } = {}) {
  const used = Number.isFinite(used_mtok) ? used_mtok : 0
  const hours = Number.isFinite(hours_since_window_start) ? hours_since_window_start : 0
  return round3(used / Math.max(hours, 1 / 60))
}

/** Exhaustion instant and whether it lands strictly before the reset. */
export function etaExhaust({ now, remaining_mtok = 0, burn_mtok_per_hour = 0, reset_at = null } = {}) {
  const nowMs = requireNow(now)
  const remaining = Number.isFinite(remaining_mtok) ? remaining_mtok : 0
  const burn = Number.isFinite(burn_mtok_per_hour) ? burn_mtok_per_hour : 0
  const resetMs = typeof reset_at === 'string' ? Date.parse(reset_at) : Number.NaN
  const hasReset = Number.isFinite(resetMs)

  let etaMs = null
  if (remaining <= 0) etaMs = nowMs
  else if (burn > 0) etaMs = nowMs + Math.round((remaining / burn) * HOUR_MS)

  let exhausts = null
  if (hasReset) exhausts = etaMs === null ? false : etaMs < resetMs

  return { eta_exhaust_at: etaMs === null ? null : new Date(etaMs).toISOString(), exhausts_before_reset: exhausts }
}

function coefficientOfVariation(values) {
  if (!Array.isArray(values) || values.length < 2) return null
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  if (mean === 0) return null
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}

function mergePolicy(policy) {
  const overrides = policy && typeof policy === 'object' ? policy : {}
  const merged = { ...DEFAULT_POLICY, ...overrides }
  const estimates = merged.usage_estimate_mtok && typeof merged.usage_estimate_mtok === 'object'
    ? merged.usage_estimate_mtok
    : DEFAULT_POLICY.usage_estimate_mtok
  merged.usage_estimate_mtok = estimates
  return merged
}

function effectiveWindowStart(poolList, detail, nowMs) {
  const pool = poolList.find((item) => item && String(item.id ?? '') === detail.pool_id) ?? null
  const window = pool && pool.window && typeof pool.window === 'object' ? pool.window : null
  if (detail.reset_source === 'cli' && typeof detail.reset_at === 'string') {
    const resetMs = Date.parse(detail.reset_at)
    if (Number.isFinite(resetMs) && nowMs >= resetMs) return resetMs
  }
  if (window && typeof window.start_at === 'string') {
    const startMs = Date.parse(window.start_at)
    if (Number.isFinite(startMs)) return startMs
  }
  return null
}

/**
 * The cliworker.forecast/v1 projection: remaining capacity, task estimate, risk, confidence,
 * burn and exhaustion time. All time arrives through `now`; nothing is read from the clock.
 */
export function buildForecast({
  model = '',
  quota = null,
  pools = null,
  rows = [],
  samples = [],
  usage = 'Normal',
  now,
  policy = null,
} = {}) {
  const nowMs = requireNow(now)
  const settings = mergePolicy(policy)
  const poolList = Array.isArray(pools) ? pools : []
  const sampleList = Array.isArray(samples) ? samples : []

  let remaining_mtok = null
  let remaining_fraction = null
  let remaining_usd = null
  let fractionForRisk = null
  let quotaReason = null
  let evaluated = null

  if (poolList.length > 0) {
    evaluated = evaluatePools({
      models: [model],
      pools: poolList,
      rows,
      now: nowMs,
      reading_ttl_s: settings.reading_ttl_s,
      cache_read_weight: settings.cache_read_weight,
    })
    const entry = evaluated[model]
    if (entry) {
      remaining_mtok = entry.remaining_mtok
      remaining_fraction = entry.remaining_fraction
      quotaReason = entry.reason
      const fractions = entry.pools
        .filter((item) => Number.isFinite(item.used_fraction))
        .map((item) => 1 - item.used_fraction)
      if (fractions.length > 0) fractionForRisk = Math.min(...fractions)
    }
    if (quota && Number.isFinite(quota.remaining_usd)) remaining_usd = quota.remaining_usd
  } else {
    const normalized = normalizeQuota(quota)
    remaining_mtok = normalized.remaining_mtok
    remaining_fraction = normalized.remaining_fraction
    remaining_usd = normalized.remaining_usd
    quotaReason = normalized.reason
  }
  if (fractionForRisk === null) fractionForRisk = remaining_fraction

  const tokenSeries = []
  const costSeries = []
  for (const sample of sampleList) {
    if (!sample || typeof sample !== 'object') continue
    if (Number.isFinite(sample.mtok)) tokenSeries.push(sample.mtok)
    if (Number.isFinite(sample.cost_usd)) costSeries.push(sample.cost_usd)
  }

  const tokens_per_task = {
    p25: quantileForUsage(tokenSeries, 'Light'),
    p50: quantileForUsage(tokenSeries, 'Normal'),
    p90: quantileForUsage(tokenSeries, 'Heavy'),
    n: tokenSeries.length,
  }

  const tokenQuantile = quantileForUsage(tokenSeries, usage)
  const costQuantile = quantileForUsage(costSeries, usage)

  let tasks_left = null
  let tasks_left_basis = 'none'
  if (remaining_mtok !== null && tokenQuantile !== null && tokenQuantile > 0) {
    tasks_left = Math.floor(remaining_mtok / tokenQuantile)
    tasks_left_basis = 'tasks'
  } else if (remaining_usd !== null && costQuantile !== null && costQuantile > 0) {
    tasks_left = Math.floor(remaining_usd / costQuantile)
    tasks_left_basis = 'usd'
  }

  const estimate = finiteNumber(settings.usage_estimate_mtok[usage])
    ?? finiteNumber(settings.usage_estimate_mtok.Normal)
    ?? DEFAULT_POLICY.usage_estimate_mtok.Normal
  let tasks_left_assumed = null
  if (tasks_left === null && remaining_mtok !== null && estimate > 0) {
    tasks_left_assumed = Math.floor(remaining_mtok / estimate)
  }

  let { risk, risk_basis } = classifyRisk({ tasks_left, tasks_left_basis, remaining_fraction: fractionForRisk })
  if (risk === 'unknown' && (remaining_mtok === 0 || remaining_usd === 0)) {
    risk = 'exhausted'
    risk_basis = 'none'
  }

  if (tasks_left !== null && tasks_left < 0) tasks_left = 0
  if (tasks_left_assumed !== null && tasks_left_assumed < 0) tasks_left_assumed = 0

  let cv = null
  if (tasks_left !== null) cv = coefficientOfVariation(tasks_left_basis === 'usd' ? costSeries : tokenSeries)
  const confidence = confidenceFor(sampleList.length, cv)

  const known = remaining_mtok !== null || remaining_fraction !== null || remaining_usd !== null
  const status = known ? 'known' : 'unknown'
  if (!known) {
    risk = 'unknown'
    risk_basis = 'none'
  }

  let reason = null
  if (!known) {
    reason = quotaReason ?? 'capacity_unknown'
  } else if (tasks_left === null) {
    const onlyUsd = remaining_mtok === null && remaining_fraction === null && remaining_usd !== null
    reason = onlyUsd ? 'usd_samples_missing' : 'no_samples'
  }

  let burn_mtok_per_hour = null
  let eta_exhaust_at = null
  let exhausts_before_reset = null
  let poolDetails = []

  if (evaluated && evaluated[model]) {
    poolDetails = evaluated[model].pools
    if (status === 'known') {
      let pick = null
      for (const item of poolDetails) {
        if (item.remaining_mtok === null) continue
        if (pick === null || item.remaining_mtok < pick.remaining_mtok) pick = item
      }
      if (pick) {
        const startMs = effectiveWindowStart(poolList, pick, nowMs)
        if (startMs !== null) {
          burn_mtok_per_hour = burnMtokPerHour({
            used_mtok: pick.used_mtok,
            hours_since_window_start: (nowMs - startMs) / HOUR_MS,
          })
          const eta = etaExhaust({
            now: nowMs,
            remaining_mtok: pick.remaining_mtok,
            burn_mtok_per_hour,
            reset_at: pick.reset_at,
          })
          eta_exhaust_at = eta.eta_exhaust_at
          exhausts_before_reset = eta.exhausts_before_reset
        }
      }
    }
  }

  const burn_per_task = costSeries.length > 0
    ? round3(costSeries.reduce((total, value) => total + value, 0) / costSeries.length)
    : null

  return {
    schema: 'cliworker.forecast/v1',
    status,
    model,
    remaining_mtok: remaining_mtok === null ? null : round3(remaining_mtok),
    remaining_fraction: remaining_fraction === null ? null : round3(remaining_fraction),
    pools: poolDetails.map((item) => ({
      pool_id: item.pool_id,
      remaining_mtok: item.remaining_mtok,
      remaining_fraction: item.remaining_fraction,
      reset_at: item.reset_at,
      reset_in_h: item.reset_in_h,
      reset_source: item.reset_source,
    })),
    tokens_per_task,
    tasks_left,
    tasks_left_basis,
    tasks_left_assumed,
    burn_mtok_per_hour,
    eta_exhaust_at,
    exhausts_before_reset,
    risk,
    risk_basis,
    confidence,
    reason,
    burn_per_task,
    samples: sampleList.length,
  }
}
