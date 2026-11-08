// Pure selection policy. No IO, no clock, no environment: every input arrives in the argument
// and the result is computed from it alone. `selectPolicy` returns the exact golden shape
// ({selected, rejected}); `selectPolicyDetailed` carries the extra bookkeeping the orchestration
// needs (which pools rejected a candidate and the earliest reset among them).

const DEFAULT_RESERVE_FRACTION = 0.15
const MIN_RESET_H = 0.25

export const QUOTA_REASONS = Object.freeze(['quota_low', 'reserve_protected', 'quota_unknown_policy'])

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function fundingOf(entries) {
  return entries.some((entry) => entry.funding === 'plan') ? 'plan' : 'paid'
}

function priceOf(candidate) {
  const price = finite(candidate.price)
  return price === null ? 0 : price
}

function groupOf(candidate) {
  return typeof candidate.identity_group === 'string' && candidate.identity_group !== ''
    ? candidate.identity_group
    : null
}

function poolMapOf(pools) {
  const map = new Map()
  for (const pool of Array.isArray(pools) ? pools : []) {
    if (pool && typeof pool.id === 'string') map.set(pool.id, pool)
  }
  return map
}

/** Candidate pools: explicit per-candidate entries win, golden `pool_ids` resolve by id. */
export function candidatePools(candidate, pools) {
  const map = poolMapOf(pools)
  if (Array.isArray(candidate.pools)) {
    return candidate.pools
      .filter((entry) => entry && typeof entry.id === 'string')
      .map((entry) => ({ ...(map.get(entry.id) || {}), ...entry }))
  }
  const ids = Array.isArray(candidate.pool_ids) ? candidate.pool_ids : []
  const entries = []
  for (const id of ids) {
    const pool = map.get(id)
    if (pool) entries.push({ ...pool })
  }
  return entries
}

/**
 * One candidate against the current reservation picture. Returns the class ('A' for known plan,
 * 'B' for unknown plan admitted after known pools, 'C' for paid) or a quota rejection.
 */
function evaluateCandidate(candidate, context) {
  const { est, importance, reserveFraction, unknownPolicy, reserved, reserveMtok } = context
  const entries = candidatePools(candidate, context.pools)
  if (entries.length === 0) return { kind: 'A', urgency: 0, entries, funding: 'plan' }

  const states = []
  for (const entry of entries) {
    const cap = finite(entry.cap_mtok)
    const remaining = finite(entry.remaining_mtok)
    const occupied = (reserved.get(entry.id) || 0) * (cap === null ? 0 : cap)
    const base = remaining === null ? null : remaining - occupied - reserveMtok
    const reserve = importance !== 'high' && entry.funding === 'plan' && cap !== null && cap > 0
      ? reserveFraction * cap
      : 0
    let kind = 'ok'
    if (cap === null || cap <= 0 || remaining === null) kind = 'unknown'
    else if (base < est) kind = 'low'
    else if (base - reserve < est) kind = 'reserve'
    states.push({ entry, cap, remaining, base, reserve, kind })
  }

  const low = states.filter((item) => item.kind === 'low')
  if (low.length > 0) return { reason: 'quota_low', pools: low.map((item) => item.entry), entries }
  const reserve = states.filter((item) => item.kind === 'reserve')
  if (reserve.length > 0) return { reason: 'reserve_protected', pools: reserve.map((item) => item.entry), entries }

  const unknownPlan = states.filter((item) => item.kind === 'unknown' && item.entry.funding === 'plan')
  if (unknownPlan.length > 0) {
    if (unknownPolicy === 'reject') {
      return { reason: 'quota_unknown_policy', pools: unknownPlan.map((item) => item.entry), entries }
    }
    return { kind: 'B', entries, funding: fundingOf(entries) }
  }

  const unknownPaid = states.filter((item) => item.kind === 'unknown')
  if (unknownPaid.length > 0 && !entries.some((entry) => entry.funding === 'plan')) {
    return { reason: 'quota_low', pools: unknownPaid.map((item) => item.entry), entries }
  }

  if (entries.some((entry) => entry.funding === 'plan')) {
    const plan = states.filter((item) => item.entry.funding === 'plan')
    const urgency = Math.min(...plan.map((item) => {
      const reset = finite(item.entry.reset_in_h)
      const denominator = reset === null ? MIN_RESET_H : Math.max(reset, MIN_RESET_H)
      return (finite(item.entry.remaining_mtok) || 0) / denominator
    }))
    return { kind: 'A', urgency, entries, funding: 'plan' }
  }

  return { kind: 'C', entries, funding: 'paid' }
}

function compareClassA(left, right) {
  if (left.urgency !== right.urgency) return right.urgency - left.urgency
  const price = priceOf(left.candidate) - priceOf(right.candidate)
  if (price !== 0) return price
  return left.candidate.key < right.candidate.key ? -1 : left.candidate.key > right.candidate.key ? 1 : 0
}

function compareClassC(left, right) {
  const price = priceOf(left.candidate) - priceOf(right.candidate)
  if (price !== 0) return price
  return left.candidate.key < right.candidate.key ? -1 : left.candidate.key > right.candidate.key ? 1 : 0
}

function compareKey(left, right) {
  return left.candidate.key < right.candidate.key ? -1 : left.candidate.key > right.candidate.key ? 1 : 0
}

function earliestReset(pools) {
  let best = null
  let bestMs = null
  for (const pool of pools) {
    if (!pool || typeof pool.reset_at !== 'string') continue
    const ms = Date.parse(pool.reset_at)
    if (!Number.isFinite(ms)) continue
    if (bestMs === null || ms < bestMs) {
      bestMs = ms
      best = pool.reset_at
    }
  }
  return best
}

/**
 * The full computation: selection order, de-duplication by identity group, progressive
 * reservation of every pool a selected candidate touches, and the quota rejection bookkeeping.
 */
export function selectPolicyDetailed(input = {}) {
  const candidates = Array.isArray(input.candidates) ? input.candidates : []
  const pools = Array.isArray(input.pools) ? input.pools : []
  const policy = input.policy || {}
  const count = Number.isInteger(input.count) && input.count > 0 ? input.count : 1
  const importance = input.importance === 'high' ? 'high' : 'normal'
  const reserveFraction = finite(policy.reserve_fraction_for_high)
  const unknownPolicy = policy.unknown_policy === 'reject' ? 'reject' : 'after_known'
  const reserveMtok = finite(input.reserve_mtok) || 0

  const reserved = new Map()
  const initial = input.reserved_fractions && typeof input.reserved_fractions === 'object'
    ? input.reserved_fractions
    : {}
  for (const id of Object.keys(initial)) {
    const value = finite(initial[id])
    if (value !== null && value > 0) reserved.set(id, value)
  }

  const contextFor = (candidate) => ({
    est: finite(candidate.est_mtok) ?? finite(input.est_mtok) ?? 0,
    importance,
    reserveFraction: reserveFraction === null ? DEFAULT_RESERVE_FRACTION : reserveFraction,
    unknownPolicy,
    reserved,
    reserveMtok,
    pools,
  })

  const selected = []
  const rejected = []
  const rejectedKeys = new Set()
  const quotaPools = []
  const chosenKeys = new Set()
  const usedGroups = new Set()

  function reject(candidate, reason, poolList) {
    if (rejectedKeys.has(candidate.key)) return
    rejectedKeys.add(candidate.key)
    rejected.push({ key: candidate.key, reason, pools: poolList.map((pool) => pool.id) })
    for (const pool of poolList) quotaPools.push(pool)
  }

  const ranked = []
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.key !== 'string') continue
    const view = evaluateCandidate(candidate, contextFor(candidate))
    if (view.reason) {
      reject(candidate, view.reason, view.pools)
      continue
    }
    ranked.push({ candidate, kind: view.kind, urgency: view.urgency })
  }

  const classA = ranked.filter((item) => item.kind === 'A').sort(compareClassA)
  const classB = ranked.filter((item) => item.kind === 'B').sort(compareKey)
  const classC = ranked.filter((item) => item.kind === 'C').sort(compareClassC)
  const ordered = [...classA, ...classB, ...classC]

  function accept(item, view) {
    const { candidate } = item
    const context = contextFor(candidate)
    const est = context.est
    for (const entry of candidatePools(candidate, pools)) {
      const cap = finite(entry.cap_mtok)
      if (cap === null || cap <= 0) continue
      const share = est / cap
      reserved.set(entry.id, (reserved.get(entry.id) || 0) + share)
    }
    selected.push({ key: candidate.key, funding: view.funding })
    chosenKeys.add(candidate.key)
    const group = groupOf(candidate)
    if (group !== null) usedGroups.add(group)
  }

  function pick(onlyDistinct) {
    for (const item of ordered) {
      if (selected.length >= count) return
      if (chosenKeys.has(item.candidate.key)) continue
      const group = groupOf(item.candidate)
      if (onlyDistinct && group !== null && usedGroups.has(group)) continue
      const view = evaluateCandidate(item.candidate, contextFor(item.candidate))
      if (view.reason) {
        reject(item.candidate, view.reason, view.pools)
        continue
      }
      accept(item, view)
    }
  }

  pick(true)
  pick(false)

  return {
    selected,
    rejected,
    retry_after: earliestReset(quotaPools),
  }
}

/**
 * The golden-facing entry point: exactly `{selected:[{key,funding}], rejected:[{key,reason}]}`,
 * so the six policy fixtures compare with deepStrictEqual and nothing extra leaks in.
 */
export function selectPolicy(input = {}) {
  const detailed = selectPolicyDetailed(input)
  return {
    selected: detailed.selected.map((item) => ({ key: item.key, funding: item.funding })),
    rejected: detailed.rejected.map((item) => ({ key: item.key, reason: item.reason })),
  }
}
