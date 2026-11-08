import { normalizePrices, buildForecast } from './forecast.mjs'
import { billedTokens } from './pools.mjs'
import { systemNow } from './context.mjs'
import { SELECTION_SCHEMA, heavyRejection, draftHandle, draftSelection } from './select-draft.mjs'
import { readProbeModels } from './availability.mjs'
import { listModels as listDirectory } from './catalog.mjs'
import { readUsageLedger } from './usage.mjs'
import { effectivePools } from './commands/pools/state.mjs'
import { buildDirectCall } from './adapters/call.mjs'
import { withLock, lockFilePath } from './lock.mjs'
import { codedError } from './output.mjs'
import { getCode } from './contract/registry.mjs'
import { selectPolicyDetailed } from './policy.mjs'
import {
  allocateId,
  buildCall,
  buildHandle,
  commitSelection,
  effectiveReservations,
  expiresAtFor,
  findRequest,
  handleModelMap,
  leaseTtlSeconds,
  readLeaseState,
  timeoutMsFor,
} from './leases.mjs'

export const SCHEMA = SELECTION_SCHEMA
export const LEVELS = ['Top', 'High', 'Middle', 'Quick']
export const USAGES = ['Heavy', 'Normal', 'Light']

function normLevel(v) {
  const s = String(v || '').trim().toLowerCase()
  return LEVELS.find((x) => x.toLowerCase() === s) || null
}
function normUsage(v) {
  const s = String(v || '').trim().toLowerCase()
  return USAGES.find((x) => x.toLowerCase() === s) || 'Normal'
}

function vendorOf(provider) {
  const p = String(provider || '').toLowerCase()
  if (p.includes('claude')) return 'anthropic'
  if (p.includes('codex') || p.includes('openai')) return 'openai'
  if (p.includes('codebuddy') || p.includes('tencent')) return 'tencent'
  if (p.includes('cursor') || p.includes('xai') || p.includes('grok')) return 'xai'
  if (p.includes('gemini') || p.includes('google')) return 'google'
  return p
}

function levelOf(m) {
  if (m.level && LEVELS.includes(m.level)) return m.level
  if (m.tier === 'top') return 'Top'
  if (m.tier === 'advanced') return 'High'
  if (m.tier === 'standard') return 'Middle'
  return 'Quick'
}

function cliCall(config, model, request) {
  const p = config.providers?.[model.provider] || {}
  const id = model.id
  const cwd = request.cwd || '<workspace>'
  if (model.provider === 'claude') {
    return { command: p.cli, args: ['-p', '--model', id, '--output-format', 'stream-json', '--verbose'], input: 'stdin', cwd }
  }
  if (model.provider === 'codex') {
    return { command: p.cli, args: ['exec', '--model', id, '-s', 'read-only', '--skip-git-repo-check', '--json'], input: 'stdin', cwd }
  }
  if (model.provider === 'codebuddy') {
    return { command: p.cli, args: ['-p', '--model', id, '--output-format', 'stream-json', '--verbose'], input: 'stdin', cwd }
  }
  if (model.provider === 'cursor-wsl') {
    return { command: p.cli, args: ['-e', 'bash', '-lc', `cd '${cwd}' && agent -p --force --model '${id}'`], input: 'stdin', cwd }
  }
  if (model.provider === 'gemini') {
    return { command: p.cli, args: ['-m', id, '-p'], input: 'stdin', cwd }
  }
  return { command: p.cli || null, args: [], input: 'stdin', cwd }
}

/** Usage ledger rows of one model projected to the forecast sample shape. */
export function usageSamples(records = [], model) {
  if (!Array.isArray(records)) return []
  return records
    .filter((row) => row && row.model === model)
    .map((row) => {
      const mtok = billedTokens(row) / 1e6
      return {
        mtok: Number.isFinite(mtok) && mtok > 0 ? mtok : null,
        cost_usd: Number.isFinite(row.cost_usd) ? row.cost_usd : null,
      }
    })
}

function defaultForecast({ model, quota, records, usage, now }) {
  return buildForecast({ model, quota, samples: usageSamples(records, model), usage, now })
}

export function listModels(config, { status = {}, includeDeprecated = false } = {}) {
  return Object.entries(config.models).map(([key, m]) => {
    const st = status[m.provider] || { state: 'unavailable', detail: 'provider not checked' }
    const callable = st.state === 'callable' && !m.deprecated
    return {
      schema: 'cliworker.model/v1', key, provider: m.provider, id: m.id || key,
      vendor: m.vendor || vendorOf(m.provider), tier: m.tier || 'unknown', level: levelOf(m),
      identity: m.identity === 'verified' ? 'verified' : 'unverified',
      identity_group: m.identity_group || null,
      deprecated: !!m.deprecated, deprecated_reason: m.deprecated_reason || null,
      callable, availability: callable ? 'callable' : (m.deprecated ? 'deprecated' : st.state),
      readonly: m.readonly === undefined ? !!(config.providers?.[m.provider]?.readonly) : !!m.readonly,
      prices: normalizePrices(m), source: 'config',
      provider_detail: st.detail || null,
    }
  }).filter((m) => includeDeprecated || !m.deprecated)
}

export function selectModels(config, request = {}, { status = {}, usage = [], ctx, probeModels = [] } = {}) {
  const level = normLevel(request.level || request.tier)
  const usageKind = normUsage(request.usage)
  const models = listModels(config, { status, includeDeprecated: true })
  const count = Math.max(1, Number(request.count || 1))
  const requireVerified = request.require_verified !== false
  const requireReadonly = request.require_readonly === true
  const exclude = new Set(request.exclude || [])
  const allowed = request.candidates ? new Set(request.candidates) : null
  const rejected = []
  const records = Array.isArray(usage) ? usage : []

  let clock = null
  const currentNow = () => {
    if (clock === null) clock = typeof ctx?.now === 'function' ? ctx.now() : systemNow()
    return clock
  }
  const forecastFn = typeof ctx?.forecast === 'function' ? ctx.forecast : defaultForecast
  const cache = new Map()
  // One quota read and one forecast call per model that clears the pre-filter, cached by key:
  // ranking and handle building only ever see the cached entry.
  const forecastOf = (m) => {
    const hit = cache.get(m.key)
    if (hit) return hit
    const quota = config.quotas?.[m.provider] ?? null
    const entry = {
      quota,
      forecast: forecastFn({ model: m.key, prices: m.prices, quota, records, usage: usageKind, now: currentNow() }),
    }
    cache.set(m.key, entry)
    return entry
  }

  if (!level) {
    return draftSelection({ request, level: null, usage: usageKind, models: [], rejected, reason: 'E_LEVEL_REQUIRED', count: 0 })
  }

  const candidates = models.filter((m) => {
    if (exclude.has(m.key)) { rejected.push({ key: m.key, reason: 'excluded' }); return false }
    if (allowed && !allowed.has(m.key)) { rejected.push({ key: m.key, reason: 'not_in_workspace_order' }); return false }
    if (m.level !== level) { rejected.push({ key: m.key, reason: `level:${m.level}` }); return false }
    const probe = probeModels.find(p => p.key === m.key && p.provider === m.provider && p.id === m.id)
    if (probe && !m.deprecated) {
      const a = probe.availability
      if (probe.identity === 'mismatch') { rejected.push({ key: m.key, reason: 'identity_mismatch' }); return false }
      if (a.state !== 'callable') { rejected.push({ key: m.key, reason: a.state === 'deprecated' ? 'deprecated' : `availability_${a.state}` }); return false }
      const at = Date.parse(a.at)
      const probeNow = typeof ctx?.clock?.now === 'function' ? ctx.clock.now() : currentNow()
      if (!Number.isFinite(at) || !Number.isFinite(a.ttl_s) || a.ttl_s < 0 || probeNow - at > a.ttl_s * 1000) {
        rejected.push({ key: m.key, reason: 'availability_stale' }); return false
      }
      m.identity = probe.identity
      m.callable = true
    }
    if (!m.callable) { rejected.push({ key: m.key, reason: `availability:${m.availability}` }); return false }
    if (requireVerified && m.identity !== 'verified') { rejected.push({ key: m.key, reason: 'identity_unverified' }); return false }
    if (requireReadonly && !m.readonly) { rejected.push({ key: m.key, reason: 'readonly_unavailable' }); return false }
    const refused = heavyRejection({ key: m.key, usage: usageKind, forecast: forecastOf(m).forecast })
    if (refused) { rejected.push(refused); return false }
    return true
  })

  const rank = (m) => {
    const f = forecastOf(m).forecast
    const price = m.prices.input_per_mtok + m.prices.output_per_mtok
    const unknown = f.risk === 'unknown' ? 1 : 0
    if (usageKind === 'Heavy') return [unknown, -(f.tasks_left ?? -1), price, m.key]
    if (usageKind === 'Light') return [price, unknown, m.key]
    return [unknown, price, m.key]
  }
  candidates.sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    for (let i = 0; i < ra.length; i++) { if (ra[i] < rb[i]) return -1; if (ra[i] > rb[i]) return 1 }
    return 0
  })

  const picked = candidates.slice(0, count).map((m) => {
    const entry = forecastOf(m)
    return draftHandle({
      model: m,
      call: cliCall(config, m, request),
      forecast: entry.forecast,
      quota: entry.quota,
      adapter: config.providers?.[m.provider]?.adapter ?? null,
    })
  })
  return draftSelection({ request, level, usage: usageKind, models: picked, rejected, count })
}

// ---------------------------------------------------------------------------------------------
// v1 selection: read-only cache, quota policy, lock-protected leases and request replay.
// The legacy `selectModels` above stays untouched for the draft compatibility surface.
// ---------------------------------------------------------------------------------------------

const POLICY_DEFAULTS = {
  reserve_fraction_for_high: 0.15,
  unknown_policy: 'after_known',
  reading_ttl_s: 600,
  usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 },
}

const QUANTILE_KEY = { Heavy: 'p90', Normal: 'p50', Light: 'p25' }

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function policyFor(config) {
  const source = config && config.policy && typeof config.policy === 'object' ? config.policy : {}
  const estimates = source.usage_estimate_mtok && typeof source.usage_estimate_mtok === 'object'
    ? source.usage_estimate_mtok
    : POLICY_DEFAULTS.usage_estimate_mtok
  return {
    reserve_fraction_for_high: finite(source.reserve_fraction_for_high) ?? POLICY_DEFAULTS.reserve_fraction_for_high,
    unknown_policy: source.unknown_policy === 'reject' ? 'reject' : 'after_known',
    reading_ttl_s: finite(source.reading_ttl_s) ?? POLICY_DEFAULTS.reading_ttl_s,
    usage_estimate_mtok: { ...POLICY_DEFAULTS.usage_estimate_mtok, ...estimates },
  }
}

function estimateFor(forecast, policy, usage) {
  const key = QUANTILE_KEY[usage] || QUANTILE_KEY.Normal
  const quantile = forecast && forecast.tokens_per_task ? forecast.tokens_per_task[key] : null
  if (Number.isFinite(quantile) && quantile > 0) return quantile
  const assumed = finite(policy.usage_estimate_mtok[usage])
  const fallback = finite(policy.usage_estimate_mtok.Normal)
  if (assumed !== null && assumed > 0) return assumed
  return fallback !== null && fallback > 0 ? fallback : 0.5
}

function capacityOf(pool, key) {
  const map = pool && pool.capacity_mtok && typeof pool.capacity_mtok === 'object' ? pool.capacity_mtok : null
  if (!map) return null
  const raw = map[key]
  if (raw && typeof raw === 'object') return finite(raw.value)
  return finite(raw)
}

function legacyAvailability(model) {
  const state = model.deprecated
    ? 'deprecated'
    : model.callable === true
      ? 'callable'
      : typeof model.availability === 'string' && model.availability !== ''
        ? model.availability
        : 'unavailable'
  return { state, reason: null, at: null, ttl_s: null, evidence: null }
}

function availabilityFor(model, probe) {
  if (probe && probe.availability && typeof probe.availability === 'object') return probe.availability
  if (model.availability && typeof model.availability === 'object') return model.availability
  return legacyAvailability(model)
}

function availabilityRejection(availability, now) {
  const state = availability && typeof availability.state === 'string' ? availability.state : 'unverified'
  if (state === 'deprecated') return 'deprecated'
  if (state === 'blocked') return 'availability_blocked'
  if (state === 'unavailable') return 'availability_unavailable'
  if (state !== 'callable') return 'availability_unverified'
  const at = typeof availability.at === 'string' ? Date.parse(availability.at) : Number.NaN
  const ttl = availability.ttl_s
  if (!Number.isFinite(at) || !Number.isInteger(ttl) || ttl < 0) return 'availability_stale'
  if (now - at > ttl * 1000) return 'availability_stale'
  return null
}

function declaredCli(config, provider) {
  const overrides = config && config.discovery && typeof config.discovery.cli_overrides === 'object'
    ? config.discovery.cli_overrides
    : null
  const declared = overrides ? overrides[provider] : null
  if (declared && typeof declared.cli === 'string' && declared.cli !== '') return declared.cli
  const legacy = config && config.providers ? config.providers[provider] : null
  return legacy && typeof legacy.cli === 'string' && legacy.cli !== '' ? legacy.cli : null
}

function declaredAdapter(config, provider) {
  const overrides = config && config.discovery && typeof config.discovery.cli_overrides === 'object'
    ? config.discovery.cli_overrides
    : null
  const declared = overrides ? overrides[provider] : null
  if (declared && typeof declared.adapter === 'string') return declared.adapter
  const legacy = config && config.providers ? config.providers[provider] : null
  return legacy && typeof legacy.adapter === 'string' ? legacy.adapter : null
}

function modelReadonly(model) {
  if (model.capabilities && typeof model.capabilities.readonly === 'boolean') return model.capabilities.readonly
  return model.readonly === true
}

function poolDefinitions(ctx, config) {
  if (config && typeof config._home === 'string' && config._home !== '') return effectivePools(ctx, config)
  return Array.isArray(config && config.pools) ? structuredClone(config.pools) : []
}

function normalizeDirectory(config, probeModels, ctx) {
  const legacy = Array.isArray(config && config.warnings)
    && config.warnings.some((warning) => warning && warning.code === 'W_CONFIG_V1')
  const hasCatalog = !legacy && config && config.catalog && Array.isArray(config.catalog.manual)
  const rows = hasCatalog
    ? listDirectory(config, { models: [], ctx })
    : listModels(config, { status: {}, includeDeprecated: true })
  const probes = Array.isArray(probeModels) ? probeModels : []
  return rows.map((row) => {
    const probe = probes.find(
      (item) => item && item.key === row.key && item.provider === row.provider && item.id === row.id
    ) || null
    return {
      key: row.key,
      provider: row.provider,
      id: row.id,
      level: row.level && LEVELS.includes(row.level) ? row.level : null,
      prices: normalizePrices(row),
      vendor: row.vendor || vendorOf(row.provider),
      identity: probe && typeof probe.identity === 'string' ? probe.identity : (row.identity || 'unverified'),
      identity_group: probe && typeof probe.identity_group === 'string'
        ? probe.identity_group
        : row.identity_group || null,
      readonly: modelReadonly(row),
      allowed: hasCatalog ? row.allowed === true : true,
      deprecated: row.deprecated === true,
      availability: availabilityFor(row, probe),
    }
  })
}

function rejectionFor(model, request, now, excludedKeys, excludedModels) {
  if (excludedKeys.has(model.key)) return 'excluded'
  if (excludedModels.has(model.key)) return 'excluded'
  if (model.level === null) return 'level_unassigned'
  if (model.level !== request.level) return 'level_mismatch'
  if (model.deprecated) return 'deprecated'
  const availability = availabilityRejection(model.availability, now)
  if (availability !== null) return availability
  if (model.identity === 'mismatch') return 'identity_mismatch'
  if (request.require_verified !== false && model.identity !== 'verified') return 'identity_unverified'
  if (request.require_readonly === true && model.readonly !== true) return 'readonly_unavailable'
  return null
}

function staleReading(pool, now, ttlS) {
  const reading = pool && pool.used_fraction && typeof pool.used_fraction === 'object' ? pool.used_fraction : null
  if (!reading || typeof reading.at !== 'string') return false
  const at = Date.parse(reading.at)
  return Number.isFinite(at) && now - at > ttlS * 1000
}

function envelopeBase({ request, now }) {
  return {
    schema: SELECTION_SCHEMA,
    request_id: typeof request.request_id === 'string' ? request.request_id : '',
    level: request.level,
    usage: request.usage,
    count_requested: request.count,
    generated_at: new Date(now).toISOString(),
  }
}

function failureSelection({ request, now, count, rejected, warnings, error }) {
  const entry = getCode(error.code)
  return {
    ...envelopeBase({ request, now }),
    ok: false,
    count_returned: 0,
    models: [],
    calls: [],
    truncated: false,
    shortfall: count,
    rejected,
    warnings,
    error: {
      code: error.code,
      message: error.message,
      retryable: entry ? entry.retryable : false,
      retry_after: error.retry_after === undefined ? null : error.retry_after,
    },
  }
}

function successSelection({ request, now, handles, rejected, warnings }) {
  return {
    ...envelopeBase({ request, now }),
    ok: true,
    count_returned: handles.length,
    models: handles,
    calls: handles.map((handle) => handle.call),
    truncated: handles.length < request.count,
    shortfall: request.count - handles.length,
    rejected,
    warnings,
    error: null,
  }
}

function directCallFor(model, config, request, ctx) {
  const cli = declaredCli(config, model.provider)
  const built = buildDirectCall({
    model: { provider: model.provider, id: model.id, cli },
    config,
    cwd: typeof request.cwd === 'string' ? request.cwd : '',
    platform: ctx.platform,
    readonly: request.require_readonly === true,
  })
  if (!built.call) return { call: null, reason: built.reason || 'adapter_unverified' }
  return {
    call: {
      command: built.call.command,
      args: built.call.args,
      cwd: typeof built.call.cwd === 'string' ? built.call.cwd : '',
      input: 'stdin',
      env_names: Array.isArray(built.call.env_names) ? built.call.env_names : [],
    },
    reason: null,
  }
}

function draftCallOf(directCall) {
  return {
    command: directCall.command,
    args: [...directCall.args],
    cwd: directCall.cwd,
    input: 'stdin',
  }
}

function materialize(stored) {
  return {
    ok: stored.agentline.ok === true,
    error: stored.agentline.ok === true ? null : stored.agentline.error,
    agentline: structuredClone(stored.agentline),
    full: structuredClone(stored.full),
    draft: structuredClone(stored.draft),
  }
}

/** Appends request/view warnings without replacing the selection's own warnings. */
export function withWarnings(selection, extra) {
  const warnings = Array.isArray(selection.warnings) ? selection.warnings : []
  for (const warning of Array.isArray(extra) ? extra : []) {
    if (warnings.some((item) => item.code === warning.code && item.ref === warning.ref && item.field === warning.field)) continue
    warnings.push(warning)
  }
  selection.warnings = warnings
  return selection
}

/**
 * One selection request. Everything that decides or reserves happens inside the state lock:
 * replay lookup, cache read, quota snapshot, filtering, policy, reservation and one atomic commit.
 */
export async function runSelection({ ctx, config, request } = {}) {
  if (!LEVELS.includes(request && request.level)) throw codedError('E_LEVEL_REQUIRED', 'request needs a level')
  const normalized = {
    ...request,
    count: Number.isInteger(request.count) && request.count > 0 ? request.count : 1,
    usage: USAGES.includes(request.usage) ? request.usage : 'Normal',
    importance: request.importance === 'high' ? 'high' : 'normal',
  }
  return withLock(ctx, lockFilePath(config._home), async () => {
    const now = ctx.clock.now()
    const policy = policyFor(config)
    const legacyMode = Array.isArray(config.warnings)
      && config.warnings.some((warning) => warning && warning.code === 'W_CONFIG_V1')
    const state = readLeaseState(ctx, config)
    const replay = findRequest(state, normalized.request_id)
    if (replay) return { ...materialize(replay), legacy: legacyMode }

    const probeModels = typeof config._home === 'string' && config._home !== ''
      ? readProbeModels(config, { ctx })
      : []
    const pools = poolDefinitions(ctx, config)
    const ledger = readUsageLedger({ ctx, config })
    const excludedModels = new Set()
    const handleOwners = handleModelMap(state)
    for (const handleId of Array.isArray(normalized.exclude_handles) ? normalized.exclude_handles : []) {
      const key = handleOwners.get(handleId)
      if (typeof key === 'string') excludedModels.add(key)
    }
    const excludedKeys = new Set(Array.isArray(normalized.exclude) ? normalized.exclude : [])

    const directory = normalizeDirectory(config, probeModels, ctx)
    const refs = new Map()
    const refFor = (key) => {
      if (!refs.has(key)) refs.set(key, `c${refs.size + 1}`)
      return refs.get(key)
    }
    const internalRejected = []
    const rejectedKeys = new Set()
    const rejectModel = (model, reason) => {
      if (rejectedKeys.has(model.key)) return
      rejectedKeys.add(model.key)
      internalRejected.push({ key: model.key, ref: refFor(model.key), reason })
    }

    const forecastCache = new Map()
    let stale = false
    const forecastFor = (model) => {
      const hit = forecastCache.get(model.key)
      if (hit) return hit
      const relevant = pools.filter((pool) => capacityOf(pool, model.key) !== null)
      const relevantIds = new Set(relevant.map((pool) => pool.id))
      const rows = ledger.rows.filter((row) => row
        && (row.model === model.key
          || (Array.isArray(row.pools) && row.pools.some((id) => relevantIds.has(id)))))
      for (const pool of relevant) {
        if (staleReading(pool, now, policy.reading_ttl_s)) stale = true
      }
      const forecast = buildForecast({
        model: model.key,
        pools: relevant,
        rows,
        samples: usageSamples(ledger.rows, model.key),
        usage: normalized.usage,
        now,
        policy: config.policy || null,
        quota: config.quotas ? config.quotas[model.provider] ?? null : null,
      })
      const details = new Map()
      for (const item of forecast.pools) details.set(item.pool_id, item)
      const entries = relevant.map((pool) => ({
        id: pool.id,
        funding: pool.funding === 'paid' ? 'paid' : 'plan',
        remaining_mtok: details.has(pool.id) ? details.get(pool.id).remaining_mtok : null,
        cap_mtok: capacityOf(pool, model.key),
        reset_in_h: details.has(pool.id) ? details.get(pool.id).reset_in_h : null,
        reset_at: details.has(pool.id) ? details.get(pool.id).reset_at : null,
      }))
      const entry = {
        model,
        forecast,
        entries,
        est: estimateFor(forecast, policy, normalized.usage),
      }
      forecastCache.set(model.key, entry)
      if (typeof ctx.forecastObserver === 'function') ctx.forecastObserver(model.key)
      return entry
    }

    const candidates = []
    const selectedInfo = new Map()
    for (const model of directory) {
      if (!model.allowed) continue
      const reason = rejectionFor(model, normalized, now, excludedKeys, excludedModels)
      if (reason !== null) {
        rejectModel(model, reason)
        continue
      }
      const direct = directCallFor(model, config, normalized, ctx)
      if (!direct.call || direct.reason !== null) {
        rejectModel(model, direct.reason || 'adapter_unverified')
        continue
      }
      const entry = forecastFor(model)
      if (pools.length > 0 && entry.entries.length === 0) {
        rejectModel(model, 'quota_low')
        continue
      }
      const candidate = {
        key: model.key,
        price: entry.model.prices.input_per_mtok + entry.model.prices.output_per_mtok,
        identity_group: model.identity_group,
        est_mtok: entry.est,
        pools: entry.entries,
      }
      candidates.push(candidate)
      selectedInfo.set(model.key, { ...entry, direct })
    }

    const reservedFractions = Object.fromEntries(effectiveReservations(state, now))
    const decision = selectPolicyDetailed({
      count: normalized.count,
      importance: normalized.importance,
      policy: { unknown_policy: policy.unknown_policy, reserve_fraction_for_high: policy.reserve_fraction_for_high },
      reserve_mtok: 0,
      reserved_fractions: reservedFractions,
      candidates,
    })
    for (const item of decision.rejected) {
      const model = directory.find((row) => row.key === item.key)
      if (model) rejectModel(model, item.reason)
      else if (!rejectedKeys.has(item.key)) {
        rejectedKeys.add(item.key)
        internalRejected.push({ key: item.key, ref: refFor(item.key), reason: item.reason })
      }
    }

    const warnings = []
    if (ledger.legacy) warnings.push({ code: 'W_LEGACY_USAGE' })
    if (stale) warnings.push({ code: 'W_STALE_DATA' })
    const externalRejected = internalRejected.map((item) => ({ ref: item.ref, reason: item.reason }))

    if (decision.selected.length === 0) {
      const code = candidates.length > 0 ? 'E_INSUFFICIENT_QUOTA' : 'E_NO_CANDIDATE'
      const message = code === 'E_INSUFFICIENT_QUOTA'
        ? 'every candidate passed the non-quota filters but was quota rejected'
        : 'no candidate passed the non-quota filters'
      const error = { code, message, retry_after: decision.retry_after }
      const agentline = failureSelection({
        request: normalized,
        now,
        count: normalized.count,
        rejected: externalRejected,
        warnings,
        error,
      })
      const full = structuredClone(agentline)
      const draft = draftSelection({
        request: normalized,
        level: normalized.level,
        usage: normalized.usage,
        models: [],
        rejected: internalRejected.map((item) => ({ key: item.key, reason: item.reason })),
        reason: code,
        count: normalized.count,
      })
      await commitSelection({ ctx, config, state, request: normalized, now, leases: [], agentline, full, draft })
      return { ok: false, error: agentline.error, agentline, full, draft, legacy: legacyMode }
    }

    const taken = new Set()
    for (const lease of state.leases) {
      taken.add(lease.lease_id)
      taken.add(lease.handle_id)
    }
    for (const stored of state.requests) {
      for (const handle of stored.agentline.models) {
        if (handle && typeof handle.handle_id === 'string') taken.add(handle.handle_id)
        if (handle && typeof handle.lease_id === 'string') taken.add(handle.lease_id)
      }
    }

    const leaseTtlS = leaseTtlSeconds(config)
    const timeoutMs = timeoutMsFor(normalized)
    const handles = []
    const details = []
    const draftModels = []
    const leases = []
    for (let index = 0; index < decision.selected.length; index += 1) {
      const picked = decision.selected[index]
      const info = selectedInfo.get(picked.key)
      if (!info) continue
      const leaseId = allocateId(ctx, 'l', taken)
      const handleId = allocateId(ctx, 'h', taken)
      const expiresAt = expiresAtFor({ selectedAt: now, index, leaseTtlS, timeoutMs })
      const call = buildCall({ config, request: normalized, leaseId })
      const handle = buildHandle({
        request: normalized,
        level: normalized.level,
        label: `${normalized.level}-${handles.length + 1}`,
        leaseId,
        handleId,
        expiresAt,
        call,
      })
      const detail = {
        model_key: info.model.key,
        cli: declaredCli(config, info.model.provider) || info.model.provider,
        vendor: info.model.vendor,
        funding: picked.funding,
        pools: info.entries.map((entry) => entry.id),
        forecast: info.forecast,
        direct_call: info.direct.call,
      }
      const draftModel = draftHandle({
        model: {
          key: info.model.key,
          provider: info.model.provider,
          id: info.model.id,
          level: normalized.level,
          adapter: declaredAdapter(config, info.model.provider),
          identity: info.model.identity,
          identity_group: info.model.identity_group,
          vendor: info.model.vendor,
          readonly: info.model.readonly,
          prices: info.model.prices,
        },
        call: draftCallOf(info.direct.call),
        forecast: info.forecast,
        quota: config.quotas ? config.quotas[info.model.provider] ?? null : null,
        adapter: declaredAdapter(config, info.model.provider),
      })
      const pools = []
      for (const entry of info.entries) {
        const cap = finite(entry.cap_mtok)
        if (cap === null || cap <= 0) continue
        pools.push({ id: entry.id, fraction: info.est / cap })
      }
      handles.push(handle)
      details.push(detail)
      draftModels.push(draftModel)
      leases.push({
        lease_id: leaseId,
        handle_id: handleId,
        request_id: typeof normalized.request_id === 'string' ? normalized.request_id : '',
        model_key: info.model.key,
        selected_at: now,
        expires_at: expiresAt,
        call,
        funding: picked.funding,
        pools,
      })
    }

    const agentline = successSelection({
      request: normalized,
      now,
      handles,
      rejected: externalRejected,
      warnings,
    })
    const full = {
      ...structuredClone(agentline),
      models: handles.map((handle, index) => ({ ...structuredClone(handle), detail: details[index] })),
    }
    const draft = draftSelection({
      request: normalized,
      level: normalized.level,
      usage: normalized.usage,
      models: draftModels,
      rejected: internalRejected.map((item) => ({ key: item.key, reason: item.reason })),
      reason: null,
      count: normalized.count,
    })

    await commitSelection({
      ctx,
      config,
      state,
      request: normalized,
      now,
      leases,
      agentline,
      full,
      draft,
    })

    return { ok: true, error: null, agentline, full, draft, legacy: legacyMode }
  }, { policy: config.policy })
}
