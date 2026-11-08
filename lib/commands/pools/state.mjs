// Runtime pool state under state_dir/pools.json. The file is an array of existing pool objects,
// not a new config schema: reads overlay config pools by id, and writes replace that array
// atomically under the existing state lock.

import path from 'node:path'
import { atomicWriteJson, readJson } from '../../store.mjs'
import { withLock, lockFilePath } from '../../lock.mjs'
import { codedError } from '../../output.mjs'

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stateError(message) {
  return codedError('E_CONFIG', message)
}

export function poolsStateFile(config) {
  return path.join(config._home, 'pools.json')
}

function validReading(value) {
  if (!isObject(value)) return false
  return typeof value.value === 'number'
    && Number.isFinite(value.value)
    && value.value >= 0
    && value.value <= 1
    && typeof value.source === 'string'
    && typeof value.at === 'string'
    && Number.isFinite(Date.parse(value.at))
}

/** Reads the state array; a missing file is null, anything malformed fails as E_CONFIG. */
export function readStatePools(ctx, config) {
  let value
  try {
    value = readJson(ctx, poolsStateFile(config), null)
  } catch {
    throw stateError('pool state cannot be read or is not valid JSON')
  }
  if (value === null) return null
  if (!Array.isArray(value)) throw stateError('pool state must be an array of pools')
  for (const pool of value) {
    if (!isObject(pool) || typeof pool.id !== 'string' || pool.id === '') {
      throw stateError('pool state contains an invalid pool entry')
    }
    if (pool.used_fraction !== undefined && pool.used_fraction !== null && !validReading(pool.used_fraction)) {
      throw stateError('pool state contains an invalid reading')
    }
  }
  return value
}

/**
 * Config pools are authoritative: state entries are applied only when id, cli and kind match, so a
 * deleted or unrelated pool can never be resurrected. Config capacity keeps priority over a
 * measured value for the same model.
 */
export function mergePools(configPools, statePools) {
  const configured = Array.isArray(configPools) ? configPools : []
  const byId = new Map()
  for (const pool of Array.isArray(statePools) ? statePools : []) {
    if (isObject(pool)) byId.set(pool.id, pool)
  }

  return configured.map((base) => {
    const result = structuredClone(base)
    const state = byId.get(base.id)
    if (!isObject(state) || state.cli !== base.cli || state.kind !== base.kind) return result

    const sameWindow = base.window === state.window
      || (isObject(base.window) && isObject(state.window) && base.window.length_s === state.window.length_s)
    if (!sameWindow) return result

    if (isObject(state.used_fraction)) result.used_fraction = structuredClone(state.used_fraction)

    if (isObject(base.window) && isObject(state.window) && state.window.reset_source === 'cli') {
      const resetAt = state.window.reset_at
      if (typeof resetAt === 'string' && Number.isFinite(Date.parse(resetAt))) {
        result.window = { ...result.window, reset_at: resetAt, reset_source: 'cli' }
      }
    }

    if (isObject(state.capacity_mtok)) {
      const merged = isObject(result.capacity_mtok) ? { ...result.capacity_mtok } : {}
      for (const [model, entry] of Object.entries(state.capacity_mtok)) {
        if (!isObject(entry) || typeof entry.value !== 'number' || !Number.isFinite(entry.value)) continue
        if (isObject(merged[model]) && merged[model].source === 'config') continue
        merged[model] = { ...entry }
      }
      result.capacity_mtok = merged
    }

    return result
  })
}

/** Effective pools: config order and definitions, overlaid with matching runtime observations. */
export function effectivePools(ctx, config) {
  return mergePools(config.pools, readStatePools(ctx, config))
}

/**
 * Runs `mutate` over the merged pool array under the state lock and persists the whole array with
 * one atomic write. `mutate` may change the array in place or return a new one.
 */
export async function updateStatePools({ ctx, config }, mutate) {
  return withLock(
    ctx,
    lockFilePath(config._home),
    async () => {
      const merged = mergePools(config.pools, readStatePools(ctx, config))
      const next = await mutate(merged)
      const value = Array.isArray(next) ? next : merged
      await atomicWriteJson(ctx, poolsStateFile(config), value)
      return value
    },
    { policy: config.policy }
  )
}
