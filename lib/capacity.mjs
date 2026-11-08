// Capacity learning: a pure projection of reading pairs plus billed ledger tokens. The module never
// reads the golden file, never guesses a vendor capacity and never returns a pseudo-zero result.

import { billedTokens } from './pools.mjs'

const MIN_DELTA = 0.01
const DELTA_EPSILON = 1e-9

function inGroup(item, key, wanted) {
  if (wanted === null || wanted === undefined) return true
  return item[key] === undefined || item[key] === wanted
}

function rowInGroup(row, { pool, model, window }) {
  if (model !== null && model !== undefined && row.model !== undefined && row.model !== model) return false
  if (pool !== null && pool !== undefined) {
    if (Array.isArray(row.pools) && !row.pools.includes(pool)) return false
    if (typeof row.pool === 'string' && row.pool !== pool) return false
  }
  if (window !== null && window !== undefined && row.window !== undefined && row.window !== window) return false
  return true
}

/**
 * Learns capacity in Mtok from adjacent readings whose usage fraction rose by at least 0.01.
 * Only adjacent pairs count: a discarded pair is never bridged to a later reading. Each kept pair
 * owns rows in (previous->at, current->at]; a boundary row belongs to exactly one pair. Returns
 * null when no usable pair or no billed tokens remain, so callers keep any existing capacity.
 *
 * Optional pool/model/window selectors filter only tagged inputs; untagged inputs are assumed to
 * have been isolated by the caller.
 */
export function learnCapacity({
  readings = [],
  rows = [],
  pool = null,
  model = null,
  window = null,
  cache_read_weight = 0,
} = {}) {
  const points = (Array.isArray(readings) ? readings : [])
    .filter((item) => item !== null && typeof item === 'object')
    .filter((item) => inGroup(item, 'pool', pool) && inGroup(item, 'model', model) && inGroup(item, 'window', window))
    .map((item) => ({
      at: Date.parse(item.at),
      fraction: Number(item.fraction === undefined ? item.used_fraction : item.fraction),
    }))
    .filter((item) => Number.isFinite(item.at) && Number.isFinite(item.fraction) && item.fraction >= 0 && item.fraction <= 1)
    .sort((left, right) => left.at - right.at)

  if (points.length < 2) return null

  const ledgerRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => row !== null && typeof row === 'object' && rowInGroup(row, { pool, model, window }))

  let tokens = 0
  let fraction = 0
  let k = 0

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (!(current.at > previous.at)) continue
    const delta = current.fraction - previous.fraction
    if (!(delta + DELTA_EPSILON >= MIN_DELTA)) continue

    let pairTokens = 0
    for (const row of ledgerRows) {
      const at = Date.parse(row.at)
      if (!Number.isFinite(at)) continue
      if (at > previous.at && at <= current.at) pairTokens += billedTokens(row, cache_read_weight)
    }

    tokens += pairTokens
    fraction += delta
    k += 1
  }

  if (k === 0 || !(tokens > 0) || !(fraction > 0)) return null
  const capacity_mtok = tokens / fraction / 1e6
  if (!Number.isFinite(capacity_mtok) || capacity_mtok <= 0) return null

  return {
    capacity_mtok,
    k,
    confidence: k < 3 ? 'low' : k < 10 ? 'medium' : 'high',
    source: 'measured',
  }
}
