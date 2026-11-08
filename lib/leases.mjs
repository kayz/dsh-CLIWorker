// Lease reservation and request replay. The whole state lives in one JSON file under the
// configuration state_dir, guarded by the existing state lock. Reads and writes go through
// ctx.fs / store, time through ctx.clock, and nothing here probes, forecasts or records usage.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, atomicWriteJson } from './store.mjs'
import { codedError } from './output.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const BIN = path.join(REPO_ROOT, 'bin', 'cliworker.mjs')
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

export const DEFAULT_LEASE_TTL_S = 7200
export const DEFAULT_TIMEOUT_MS = 1_800_000
export const CALL_OUTPUT = 'cliworker.event/v1'

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(message) {
  return codedError('E_CONFIG', message)
}

export function leaseStateFile(config) {
  if (!config || typeof config._home !== 'string' || config._home === '') {
    throw invalid('lease state needs a resolved state_dir')
  }
  return path.join(config._home, 'leases.json')
}

function validPool(entry) {
  return isObject(entry)
    && typeof entry.id === 'string'
    && typeof entry.fraction === 'number'
    && Number.isFinite(entry.fraction)
    && entry.fraction >= 0
}

function validLease(value) {
  return isObject(value)
    && typeof value.lease_id === 'string'
    && typeof value.handle_id === 'string'
    && typeof value.model_key === 'string'
    && typeof value.expires_at === 'string'
    && AT_RE.test(value.expires_at)
    && Number.isFinite(Date.parse(value.expires_at))
    && Array.isArray(value.pools)
    && value.pools.every(validPool)
    && isObject(value.call)
}

function validRequest(value) {
  return isObject(value)
    && typeof value.request_id === 'string'
    && value.request_id !== ''
    && isObject(value.agentline)
    && isObject(value.full)
    && isObject(value.draft)
}

/** Strict read: a missing file is empty state, damaged content fails instead of resetting. */
export function readLeaseState(ctx, config) {
  const file = leaseStateFile(config)
  let stored
  try {
    stored = readJson(ctx, file, null)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw invalid('lease state cannot be read or is not valid JSON')
  }
  if (stored === null) return { leases: [], requests: [] }
  if (!isObject(stored) || !Array.isArray(stored.leases) || !Array.isArray(stored.requests)) {
    throw invalid('lease state has an invalid shape')
  }
  for (const lease of stored.leases) {
    if (!validLease(lease)) throw invalid('lease state contains an invalid lease')
  }
  for (const request of stored.requests) {
    if (!validRequest(request)) throw invalid('lease state contains an invalid request index entry')
  }
  return stored
}

export function leaseExpiresMs(lease) {
  const ms = Date.parse(lease && lease.expires_at)
  return Number.isFinite(ms) ? ms : null
}

/** Only an expires_at strictly earlier than now is expired; equality is still valid. */
export function isExpired(lease, now) {
  const ms = leaseExpiresMs(lease)
  return ms !== null && ms < now
}

/** Fractions reserved by still-valid leases, summed per pool id. */
export function effectiveReservations(state, now) {
  const reserved = new Map()
  for (const lease of state.leases) {
    if (isExpired(lease, now)) continue
    for (const pool of lease.pools) {
      reserved.set(pool.id, (reserved.get(pool.id) || 0) + pool.fraction)
    }
  }
  return reserved
}

export function findRequest(state, requestId) {
  if (typeof requestId !== 'string' || requestId === '') return null
  return state.requests.find((entry) => entry.request_id === requestId) || null
}

/** handle_id -> model key, from live leases and from every stored first result. */
export function handleModelMap(state) {
  const map = new Map()
  for (const lease of state.leases) map.set(lease.handle_id, lease.model_key)
  for (const request of state.requests) {
    const models = request.full && Array.isArray(request.full.models) ? request.full.models : []
    for (const model of models) {
      const detail = model && isObject(model.detail) ? model.detail : null
      if (detail && typeof detail.model_key === 'string' && typeof model.handle_id === 'string') {
        map.set(model.handle_id, detail.model_key)
      }
    }
  }
  return map
}

/**
 * Allocates unique ids from ctx.random() (never from a model or provider name). Callers pass the
 * shared `taken` set so the whole batch, including stored ids, stays collision free.
 */
export function allocateId(ctx, prefix, taken) {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const value = Number(ctx.random())
    const seed = Number.isFinite(value) ? Math.floor(value * 0x100000000) : attempt + 1
    let text = ''
    let state = seed >>> 0
    do {
      text += state.toString(36)
      state = (state * 1103515245 + 12345) >>> 0
    } while (text.length < 10)
    const id = `${prefix}_${text.slice(0, 10)}`
    if (!taken.has(id)) {
      taken.add(id)
      return id
    }
  }
  throw codedError('E_INTERNAL', 'cannot allocate a unique lease identifier')
}

export function leaseTtlSeconds(config) {
  const value = config && config.policy ? config.policy.lease_ttl_s : undefined
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_LEASE_TTL_S
}

export function timeoutMsFor(request) {
  const value = request ? request.timeout_ms : undefined
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS
}

/** expires_at_i = selected_at + lease_ttl_s*1000 + i*timeout_ms, i from zero. */
export function expiresAtFor({ selectedAt, index, leaseTtlS, timeoutMs }) {
  return new Date(selectedAt + leaseTtlS * 1000 + index * timeoutMs).toISOString()
}

/** The run wrapper call: absolute node + bin, no provider argv, no model, no secret. */
export function buildCall({ config, request, leaseId }) {
  const stateDir = typeof config._home === 'string' ? path.resolve(config._home) : ''
  const configFile = typeof config._file === 'string' ? path.resolve(config._file) : ''
  return {
    command: process.execPath,
    args: [BIN, 'run', '--lease', leaseId, '--state-dir', stateDir, '--config', configFile],
    cwd: typeof request.cwd === 'string' ? request.cwd : '',
    input: 'stdin',
    output: CALL_OUTPUT,
    timeout_ms: timeoutMsFor(request),
  }
}

export function buildHandle({ request, level, label, leaseId, handleId, expiresAt, call }) {
  return {
    schema: 'cliworker.handle/v1',
    handle_id: handleId,
    lease_id: leaseId,
    level,
    label,
    readonly: request.require_readonly === true,
    expires_at: expiresAt,
    call,
  }
}

/**
 * Drops expired leases (freeing their reservation only) while keeping the request index, then
 * appends the new leases and the first result for this request id in one atomic write. A failed
 * write rejects; no success is ever returned for an uncommitted batch.
 */
export async function commitSelection({ ctx, config, state, request, now, leases, agentline, full, draft }) {
  const live = state.leases.filter((lease) => !isExpired(lease, now))
  const requests = state.requests.slice()
  if (typeof request.request_id === 'string' && request.request_id !== '') {
    requests.push({ request_id: request.request_id, agentline, full, draft })
  }
  const next = { leases: [...live, ...leases], requests }
  await atomicWriteJson(ctx, leaseStateFile(config), next)
  return next
}
