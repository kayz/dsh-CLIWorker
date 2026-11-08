// Source-aware usage ledger for HTTP providers. It reuses the cliworker.usage/v1 row, the
// existing usage.jsonl path, the shared state lock and the existing idempotency_key. The only
// source distinction lives in the model key and in the existing pool membership, so the official
// channel and a CLI channel can never share a pool by accident.

import path from 'node:path'
import { lockFilePath, withLock } from '../lock.mjs'
import { codedError } from '../output.mjs'
import { appendJsonl, readJsonl } from '../store.mjs'
import { estimateCost } from '../forecast.mjs'
import { usageFile } from '../commands/_util.mjs'

const KINDS = new Set(['task', 'probe', 'manual'])
const UNSAFE_CHANNELS = new Set(['__proto__', 'constructor', 'prototype'])

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(message) {
  return codedError('E_REQUEST_INVALID', message)
}

function tokenValue(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function randomPart(ctx) {
  return Math.floor(Number(ctx.random()) * 0x100000000).toString(36).padStart(7, '0')
}

function rowId(ctx) {
  return `u_${randomPart(ctx)}${randomPart(ctx)}${randomPart(ctx)}${randomPart(ctx)}`
}

/** The channel prefix of a source model key, or null for a legacy unprefixed key. */
export function channelOfKey(key) {
  if (typeof key !== 'string') return null
  const index = key.indexOf(':')
  return index > 0 ? key.slice(0, index) : null
}

/**
 * The ledger model key. It always carries the declared provider identity, so the same underlying
 * model reached through a CLI and through an HTTP channel produces two different keys.
 */
export function sourceModelKey(descriptor, model) {
  if (!isObject(descriptor) || typeof descriptor.provider !== 'string' || descriptor.provider === '') {
    throw invalid('provider is required')
  }
  if (UNSAFE_CHANNELS.has(descriptor.provider)) throw invalid('provider is invalid')
  const id = isObject(model) && typeof model.id === 'string' && model.id !== ''
    ? model.id
    : isObject(model) && typeof model.key === 'string' && model.key !== ''
      ? model.key
      : null
  if (id === null) throw invalid('model id is required')
  const prefix = `${descriptor.provider}:`
  return id.startsWith(prefix) ? id : `${prefix}${id}`
}

/** Pool ids whose existing capacity map contains exactly this source model key. */
export function poolsFor(config, sourceKey) {
  const pools = config && Array.isArray(config.pools) ? config.pools : []
  const result = []
  for (const pool of pools) {
    if (!isObject(pool) || !isObject(pool.capacity_mtok)) continue
    if (!Object.hasOwn(pool.capacity_mtok, sourceKey)) continue
    result.push(String(pool.id))
  }
  return result
}

/**
 * Rejects a pool that mixes this source with another channel before any paid request. Existing
 * membership is compared through the real model keys, not through a display label.
 */
export function assertChannelIsolation(config, { descriptor, model, sourceKey } = {}) {
  const key = sourceKey === undefined ? sourceModelKey(descriptor, model) : sourceKey
  const own = descriptor && typeof descriptor.provider === 'string' ? descriptor.provider : null
  if (own === null || own === '') throw invalid('provider is required')
  const pools = config && Array.isArray(config.pools) ? config.pools : []

  for (const pool of pools) {
    if (!isObject(pool) || !isObject(pool.capacity_mtok)) continue
    if (!Object.hasOwn(pool.capacity_mtok, key)) continue
    for (const other of Object.keys(pool.capacity_mtok)) {
      if (other === key) continue
      const otherChannel = channelOfKey(other)
      const mixed = descriptor.transport === 'http'
        ? otherChannel !== own
        : otherChannel !== null && otherChannel !== own
      if (mixed) throw invalid(`pool ${String(pool.id)} mixes provider channels`)
    }
  }
  return key
}

function resultUsage(value) {
  if (!isObject(value) || value.known !== true) return null
  const input = tokenValue(value.input_tokens)
  const output = tokenValue(value.output_tokens)
  if (input === null || output === null) return null
  return { input, output }
}

/**
 * Commits one logical HTTP consumption. Replays and concurrent commits with the same source model
 * key and idempotency_key append exactly one row; two different sources with the same original
 * idempotency_key each keep their own row. A damaged ledger or a failed append throws and never
 * rewrites the existing bytes.
 */
export async function commitHttpUsage(
  config,
  { ctx, descriptor, model, result, kind = 'task', lease_id = '', idempotency_key } = {}
) {
  if (!ctx || !ctx.fs || !ctx.clock) throw invalid('usage commit requires ctx')
  if (typeof idempotency_key !== 'string' || idempotency_key === '') throw invalid('idempotency_key is required')
  if (!KINDS.has(kind)) throw invalid('kind is invalid')
  if (typeof lease_id !== 'string') throw invalid('lease_id must be a string')

  const sourceKey = assertChannelIsolation(config, { descriptor, model })
  const usage = resultUsage(result && result.usage)
  if (usage === null) return { recorded: null, written: false, reason: 'usage_unknown' }

  const pools = poolsFor(config, sourceKey)
  const file = usageFile(config, ctx)
  const row = {
    schema: 'cliworker.usage/v1',
    id: rowId(ctx),
    idempotency_key,
    lease_id,
    model: sourceKey,
    pools,
    kind,
    input_tokens: usage.input,
    output_tokens: usage.output,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: estimateCost({
      input_tokens: usage.input,
      output_tokens: usage.output,
      prices: model && model.prices,
    }),
    pool_fraction_before: null,
    pool_fraction_after: null,
    at: ctx.clock.nowIso(),
  }

  return withLock(ctx, lockFilePath(path.dirname(file)), async () => {
    const rows = readJsonl(ctx, file)
    const existing = rows.find((item) => item && item.model === sourceKey && item.idempotency_key === idempotency_key)
    if (existing) return { recorded: existing.id, written: false, row: existing }
    appendJsonl(ctx, file, row)
    return { recorded: row.id, written: true, row }
  }, { policy: config && config.policy })
}
