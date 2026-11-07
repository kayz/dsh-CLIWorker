// Pure quota-pool arithmetic: quota shape normalization, pooled remaining capacity, reset
// resolution and three decimal rounding. Every time value is an explicit millisecond number;
// this module never reads a wall clock, never schedules work and never touches IO.

const DEFAULT_CACHE_READ_WEIGHT = 0
const DEFAULT_READING_TTL_S = 600
const HOUR_MS = 3_600_000

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function timeMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isoOrNull(ms) {
  return ms === null ? null : new Date(ms).toISOString()
}

function requireNow(now) {
  if (!Number.isFinite(now)) throw new TypeError('now must be a finite millisecond timestamp')
  return now
}

function clamp01(value) {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/** Round half away from zero to three decimals; `-0` becomes `0`; non-finite passes through. */
export function round3(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return value
  const magnitude = Number((Math.abs(number) * 1000).toPrecision(15))
  const rounded = Math.round(magnitude) / 1000
  const signed = number < 0 ? -rounded : rounded
  return signed + 0
}

/** Billed tokens of one ledger row, weighting cache reads by `cache_read_weight`. */
export function billedTokens(row, cache_read_weight = DEFAULT_CACHE_READ_WEIGHT) {
  if (!row || typeof row !== 'object') return 0
  if (typeof row.tokens === 'number' && Number.isFinite(row.tokens)) return row.tokens
  const weight = finiteNumber(cache_read_weight)
  const w = weight === null ? DEFAULT_CACHE_READ_WEIGHT : weight
  const input = finiteNumber(row.input_tokens) ?? 0
  const output = finiteNumber(row.output_tokens) ?? 0
  const written = finiteNumber(row.cache_write_tokens) ?? 0
  const read = finiteNumber(row.cache_read_tokens) ?? 0
  return input + output + written + w * read
}

/**
 * Normalizes the four legacy quota shapes. Fields are computed independently; missing parts are
 * null. `reason` is only set when nothing usable could be read.
 */
export function normalizeQuota(quota) {
  const source = quota && typeof quota === 'object' ? quota : {}
  let remaining_fraction = null
  let remaining_mtok = null
  let remaining_usd = null
  let reason = null

  const percent = finiteNumber(source.remaining_pct)
  if (percent !== null) remaining_fraction = clamp01(percent / 100)

  const remaining = finiteNumber(source.remaining)
  const unit = typeof source.unit === 'string' ? source.unit : null
  if (remaining !== null && unit === 'credits') {
    const rate = finiteNumber(source.credits_per_mtok)
    if (rate !== null && rate > 0) remaining_mtok = remaining / rate
    else if (remaining === 0) remaining_mtok = 0
    else reason = 'credits_conversion_missing'
  } else if (remaining !== null && unit === 'tokens') {
    remaining_mtok = remaining / 1e6
  }

  const usd = finiteNumber(source.remaining_usd)
  if (usd !== null) remaining_usd = usd

  const anyValue = remaining_fraction !== null || remaining_mtok !== null || remaining_usd !== null
  if (!anyValue && reason === null) reason = 'capacity_unknown'

  return { remaining_fraction, remaining_mtok, remaining_usd, reason }
}

/**
 * Reset time priority: cli > config > estimated rolling window > unknown.
 * Returns the ISO form of the resolved instant and where it came from.
 */
export function resolveResetAt({ cli = null, config = null, window = null, rows = [], now } = {}) {
  const nowMs = requireNow(now)

  const cliMs = timeMs(cli)
  if (cliMs !== null) return { reset_at: isoOrNull(cliMs), reset_source: 'cli' }

  const configMs = timeMs(config)
  if (configMs !== null) return { reset_at: isoOrNull(configMs), reset_source: 'config' }

  const win = window && typeof window === 'object' ? window : null
  const lengthS = win ? finiteNumber(win.length_s) : null
  if (win && win.anchor === 'rolling' && lengthS !== null && lengthS > 0) {
    const lower = nowMs - lengthS * 1000
    let earliest = null
    for (const row of Array.isArray(rows) ? rows : []) {
      const at = timeMs(row && row.at)
      if (at === null) continue
      if (at > lower && at <= nowMs && (earliest === null || at < earliest)) earliest = at
    }
    if (earliest !== null) return { reset_at: isoOrNull(earliest + lengthS * 1000), reset_source: 'estimated' }
  }

  return { reset_at: null, reset_source: 'unknown' }
}

function capacityFor(pool, model) {
  const map = pool && pool.capacity_mtok && typeof pool.capacity_mtok === 'object' ? pool.capacity_mtok : null
  if (!map) return null
  const raw = map[model]
  if (raw && typeof raw === 'object') return finiteNumber(raw.value)
  return finiteNumber(raw)
}

function readingFor(pool) {
  if (pool && pool.reading && typeof pool.reading === 'object') {
    const value = finiteNumber(pool.reading.value)
    const at = timeMs(pool.reading.at)
    if (value !== null && at !== null) return { value, at }
    return null
  }
  if (pool && pool.used_fraction && typeof pool.used_fraction === 'object') {
    const value = finiteNumber(pool.used_fraction.value)
    const at = timeMs(pool.used_fraction.at)
    if (value !== null && at !== null) return { value, at }
  }
  return null
}

function resetCandidates(pool) {
  const win = pool && pool.window && typeof pool.window === 'object' ? pool.window : null
  if (!win) return { window: null, cli: null, config: null }
  const source = win.reset_source ?? null
  if (source === 'cli') return { window: win, cli: win.reset_at ?? null, config: null }
  if (source === 'config' || source === null) return { window: win, cli: null, config: win.reset_at ?? null }
  return { window: win, cli: null, config: null }
}

function poolState(pool, rows, nowMs, ttlMs, cacheReadWeight) {
  const candidates = resetCandidates(pool)
  const resolved = resolveResetAt({
    cli: candidates.cli,
    config: candidates.config,
    window: candidates.window,
    rows,
    now: nowMs,
  })
  const resetMs = timeMs(resolved.reset_at)
  const crossed = resetMs !== null && nowMs >= resetMs
  const cliReset = crossed && resolved.reset_source === 'cli'
  const recheck = crossed && resolved.reset_source !== 'cli'
  const windowStart = candidates.window ? timeMs(candidates.window.start_at) : null
  const startMs = cliReset ? resetMs : windowStart

  const reading = readingFor(pool)
  const readingUsable = reading !== null
    && !(cliReset && reading.at < resetMs)
    && nowMs - reading.at <= ttlMs

  let used = null
  let reason = null
  const contributing = []

  if (readingUsable) {
    used = reading.value
    for (const row of rows) {
      const at = timeMs(row && row.at)
      if (at === null || at <= reading.at || at > nowMs) continue
      contributing.push(row)
    }
  } else {
    const relevant = []
    for (const row of rows) {
      const at = timeMs(row && row.at)
      if (at === null || at > nowMs) continue
      if (startMs !== null && at < startMs) continue
      relevant.push(row)
    }
    if (startMs === null && relevant.length > 0) {
      reason = 'window_unknown'
    } else {
      used = 0
      for (const row of relevant) contributing.push(row)
    }
  }

  if (reason === null) {
    for (const row of contributing) {
      const capacity = capacityFor(pool, row.model)
      if (capacity === null || capacity <= 0) {
        reason = 'ledger_capacity_unknown'
        break
      }
      used += billedTokens(row, cacheReadWeight) / (capacity * 1e6)
    }
  }

  return {
    used: reason === null && used !== null ? clamp01(used) : null,
    reason,
    startMs,
    resetMs,
    resetAt: resolved.reset_at,
    resetSource: resolved.reset_source,
    recheck,
  }
}

function poolDetail(pool, state, capacity, nowMs) {
  const known = state.used !== null
  const remainingFraction = known ? 1 - state.used : null
  return {
    pool_id: typeof pool.id === 'string' ? pool.id : String(pool.id ?? ''),
    remaining_mtok: known ? round3(capacity * remainingFraction) : null,
    remaining_fraction: known ? round3(remainingFraction) : null,
    used_fraction: known ? state.used : null,
    used_mtok: known ? capacity * state.used : null,
    reset_at: state.resetAt,
    reset_in_h: state.resetMs === null ? null : Math.max(0, round3((state.resetMs - nowMs) / HOUR_MS)),
    reset_source: state.resetSource,
    recheck: state.recheck,
  }
}

function modelResult(members, nowMs) {
  if (members.length === 0) {
    return { status: 'unknown', remaining_mtok: null, remaining_fraction: null, reason: 'capacity_unknown', pools: [] }
  }

  const details = members.map((member) => poolDetail(member.pool, member.state, member.capacity, nowMs))
  const unknown = members.find((member) => member.state.used === null)
  if (unknown) {
    return {
      status: 'unknown',
      remaining_mtok: null,
      remaining_fraction: null,
      reason: unknown.state.reason ?? 'capacity_unknown',
      pools: details,
    }
  }

  const remaining = members.map((member) => member.capacity * (1 - member.state.used))
  const fractions = members.map((member) => 1 - member.state.used)
  return {
    status: 'known',
    remaining_mtok: round3(Math.min(...remaining)),
    remaining_fraction: round3(Math.min(...fractions)),
    reason: null,
    pools: details,
  }
}

/** Per-model pool evaluation; the `pools` array keeps the spec detail shape. */
export function evaluatePools({
  models = [],
  pools = [],
  rows = [],
  now,
  reading_ttl_s = DEFAULT_READING_TTL_S,
  cache_read_weight = DEFAULT_CACHE_READ_WEIGHT,
} = {}) {
  const nowMs = requireNow(now)
  const ttl = finiteNumber(reading_ttl_s)
  const ttlMs = (ttl === null ? DEFAULT_READING_TTL_S : ttl) * 1000
  const poolList = Array.isArray(pools) ? pools : []
  const rowList = Array.isArray(rows) ? rows : []
  const modelList = Array.isArray(models) ? models : []

  const states = poolList.map((pool) => poolState(pool, rowList, nowMs, ttlMs, cache_read_weight))

  const evaluated = {}
  for (const model of modelList) {
    const members = []
    for (let index = 0; index < poolList.length; index += 1) {
      const capacity = capacityFor(poolList[index], model)
      if (capacity === null) continue
      members.push({ pool: poolList[index], state: states[index], capacity })
    }
    evaluated[model] = modelResult(members, nowMs)
  }
  return evaluated
}

/** Projection used by the golden fixtures: status, remaining and reason only. */
export function remainingForModels({
  models = [],
  pools = [],
  rows = [],
  now,
  reading_ttl_s = DEFAULT_READING_TTL_S,
  cache_read_weight = DEFAULT_CACHE_READ_WEIGHT,
} = {}) {
  const evaluated = evaluatePools({ models, pools, rows, now, reading_ttl_s, cache_read_weight })
  const projected = {}
  for (const model of Object.keys(evaluated)) {
    const item = evaluated[model]
    projected[model] = { status: item.status, remaining_mtok: item.remaining_mtok, reason: item.reason }
  }
  return projected
}
