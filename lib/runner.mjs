// run --lease executor: lease lookup and consumption checks, config snapshot verification,
// secret injection, async provider execution, event normalisation and pre/post usage booking.
//
// The module is pure orchestration: it never reads fd 0 by itself (the command passes a reader),
// never writes stdout directly (the command passes the event writer), and every state access goes
// through the existing store/leases/usage/lock modules. It never terminates the process and no
// provider argv is ever guessed here.

import path from 'node:path'
import { createHash } from 'node:crypto'

import { createExec } from './exec.mjs'
import { resolveSecret } from './secrets/index.mjs'
import { redactString } from './redact.mjs'
import { codedError } from './output.mjs'
import { writeAudit } from './audit.mjs'
import { readLeaseState, isExpired, DEFAULT_TIMEOUT_MS } from './leases.mjs'
import { lockFilePath, withLock } from './lock.mjs'
import { readJson, atomicWriteJson } from './store.mjs'
import { readUsageLedger, writeUsageRow } from './usage.mjs'
import { listModels } from './catalog.mjs'
import { billedTokens } from './pools.mjs'
import { estimateCost } from './forecast.mjs'

const PROVIDER_CODES = new Set(['E_PROVIDER_AUTH', 'E_PROVIDER_QUOTA', 'E_PROVIDER_FAILED'])
const LEASE_ID_RE = /^l_[A-Za-z0-9]+$/
const DIGEST_RE = /^[0-9a-f]{64}$/

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]))
  }
  return value
}

/** SHA-256 over `[normalised state_dir, sorted effective config]`, lowercase hex. */
export function configDigest(config) {
  let home = path.resolve(config._home)
  if (process.platform === 'win32') home = home.toLowerCase()
  return createHash('sha256').update(JSON.stringify([home, sortedJson(config)]), 'utf8').digest('hex')
}

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** The four usage fields a provider may report; null when input/output are not both known. */
function usageOf(value) {
  if (!isObject(value)) return null
  const input = tokenCount(value.input_tokens)
  const output = tokenCount(value.output_tokens)
  if (input === null || output === null) return null
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: tokenCount(value.cache_read_tokens) ?? 0,
    cache_write_tokens: tokenCount(value.cache_write_tokens) ?? 0,
  }
}

function eventUsage(usage) {
  return { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens }
}

/**
 * Parses one provider stdout buffer into the pieces the event stream needs. Only explicit JSON
 * events are interpreted; every other non-empty line is preserved as output text. A provider may
 * not report unknown usage: without both input and output tokens the run is not booked as success.
 */
function decodeProviderOutput(stdout) {
  const texts = []
  let reportedUsage = null
  let finalText = null
  let finalUsage = null
  let providerCode = null

  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      texts.push(line)
      continue
    }
    if (!isObject(event) || typeof event.type !== 'string') {
      texts.push(line)
      continue
    }
    if (event.type === 'text' && typeof event.text === 'string') {
      texts.push(event.text)
      continue
    }
    if (event.type === 'usage') {
      const usage = usageOf(event.usage)
      if (usage !== null) reportedUsage = usage
      continue
    }
    if (event.type === 'result') {
      if (typeof event.text === 'string') finalText = event.text
      const usage = usageOf(event.usage)
      if (usage !== null) finalUsage = usage
      continue
    }
    if (event.type === 'error') {
      providerCode = typeof event.code === 'string' && event.code !== '' ? event.code : 'E_PROVIDER_FAILED'
      continue
    }
    texts.push(line)
  }

  return {
    texts,
    finalText: finalText === null ? (texts.length === 0 ? '' : texts.join('\n')) : finalText,
    usage: finalUsage ?? reportedUsage,
    providerCode,
  }
}

function providerError(code, message) {
  return codedError(code, message)
}

/** Throws the registry-mapped provider failure; auth and quota also persist availability. */
async function failProvider({ ctx, config, stateDir, lease, result, startedAt, reason, code }) {
  const blocked = code === 'E_PROVIDER_AUTH' || code === 'E_PROVIDER_QUOTA'
  if (blocked) {
    await markBlocked({
      ctx,
      config,
      stateDir,
      lease,
      exit: result ? result.code : null,
      durationMs: Math.max(0, ctx.clock.now() - startedAt),
      reason: code === 'E_PROVIDER_AUTH' ? 'auth' : 'quota',
    }).catch(() => {
      // Availability writeback is secondary evidence; the provider failure code must not be masked.
    })
  }
  throw providerError(code, reason)
}

/**
 * Records a blocked availability for the lease's model, preserving every other probe record and
 * the full model/v1 shape. Runs under the existing state lock; never stores provider stderr.
 */
async function markBlocked({ ctx, config, stateDir, lease, exit, durationMs, reason }) {
  await withLock(ctx, lockFilePath(stateDir), async () => {
    const file = path.join(stateDir, 'probes.json')
    let records
    try {
      records = readJson(ctx, file, [])
    } catch {
      throw codedError('E_CONFIG', 'probe cache cannot be read')
    }
    if (!Array.isArray(records)) throw codedError('E_CONFIG', 'probe cache has an invalid shape')
    const index = records.findIndex((item) => isObject(item) && item.key === lease.model_key)
    let record
    if (index >= 0) {
      record = structuredClone(records[index])
    } else {
      const catalog = listModels(config, { models: [], ctx })
      const found = catalog.find((item) => item.key === lease.model_key)
      if (!found) return
      record = structuredClone(found)
    }
    record.availability = {
      state: 'blocked',
      reason,
      at: ctx.clock.nowIso(),
      ttl_s: Number.isInteger(record.availability?.ttl_s) ? record.availability.ttl_s : (config.policy?.probe_ttl_s ?? null),
      evidence: {
        probe_id: `run:${lease.lease_id}`,
        cmd_redacted: providerOf(config, lease),
        exit: Number.isInteger(exit) ? exit : null,
        duration_ms: Number.isFinite(durationMs) ? durationMs : 0,
        nonce_ok: false,
        reported_model: null,
        tokens: null,
      },
    }
    if (index >= 0) records[index] = record
    else records.push(record)
    await atomicWriteJson(ctx, file, records)
  }, { policy: config.policy })
}

/** The provider call recorded by the selection that created this lease. */
function providerMaterial(state, lease) {
  const requests = Array.isArray(state.requests) ? state.requests : []
  const ordered = lease.request_id === ''
    ? requests
    : [...requests].sort((left, right) => {
      const leftMatch = left.request_id === lease.request_id ? 0 : 1
      const rightMatch = right.request_id === lease.request_id ? 0 : 1
      return leftMatch - rightMatch
    })
  for (const request of ordered) {
    const models = request && request.full && Array.isArray(request.full.models) ? request.full.models : []
    for (const model of models) {
      if (!isObject(model) || model.lease_id !== lease.lease_id) continue
      const detail = isObject(model.detail) ? model.detail : null
      const call = detail && isObject(detail.direct_call) ? detail.direct_call : null
      if (call === null) break
      if (detail.model_key !== lease.model_key) break
      if (typeof call.command !== 'string' || call.command === '') break
      if (!Array.isArray(call.args) || !call.args.every((arg) => typeof arg === 'string')) break
      if (typeof call.cwd !== 'string') break
      return { detail, call }
    }
  }
  return null
}

function modelRecordOf(config, lease) {
  const models = isObject(config.models) ? config.models : null
  const record = models && isObject(models[lease.model_key]) ? models[lease.model_key] : null
  return record
}

function providerOf(config, lease) {
  const record = modelRecordOf(config, lease)
  if (record && typeof record.provider === 'string' && record.provider !== '') return record.provider
  const colon = lease.model_key.indexOf(':')
  return colon > 0 ? lease.model_key.slice(0, colon) : lease.model_key
}

/**
 * Resolves the declared secret once and builds the child environment: the source variable and any
 * value equal to the secret are removed, then only `env_names` receive the value. The caller's
 * ctx.env and the recorded call are never mutated.
 */
function prepareEnvironment(ctx, config, cli, call) {
  const names = Array.isArray(call.env_names)
    ? call.env_names.filter((name) => typeof name === 'string' && name !== '')
    : []
  let secret = null
  if (names.length > 0) {
    secret = resolveSecret(ctx, config, cli)
    if (typeof secret !== 'string' || secret === '') {
      throw codedError('E_SECRET_BACKEND', 'secret backend unavailable')
    }
  }

  const env = { ...ctx.env }
  if (secret !== null) {
    const declared = new Set(names.map((name) => (ctx.platform === 'win32' ? name.toLowerCase() : name)))
    for (const key of Object.keys(env)) {
      const normalized = ctx.platform === 'win32' ? key.toLowerCase() : key
      if (declared.has(normalized)) {
        delete env[key]
        continue
      }
      if (typeof env[key] === 'string' && env[key].includes(secret)) delete env[key]
    }
    for (const name of names) env[name] = secret
  }
  return { env, secrets: secret === null ? [] : [secret] }
}

/** Used fraction of the first leased pool with a known reading; null when nothing is usable. */
function poolFractions(config, lease, usage) {
  const leased = new Set((Array.isArray(lease.pools) ? lease.pools : []).map((item) => item.id))
  for (const pool of Array.isArray(config.pools) ? config.pools : []) {
    if (!isObject(pool) || !leased.has(pool.id)) continue
    const reading = isObject(pool.used_fraction) && Number.isFinite(pool.used_fraction.value)
      ? pool.used_fraction.value
      : null
    const raw = isObject(pool.capacity_mtok) ? pool.capacity_mtok[lease.model_key] : undefined
    const capacity = isObject(raw) ? raw.value : raw
    if (reading === null || typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity <= 0) continue
    const before = Math.min(1, Math.max(0, reading))
    const used = billedTokens({
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      cache_write_tokens: usage.cache_write_tokens,
    }, config.policy ? config.policy.cache_read_weight : 0)
    const after = Math.min(1, Math.max(0, before + used / (capacity * 1e6)))
    return { before, after }
  }
  return { before: null, after: null }
}

function preUsage(lease, { at, fractions }) {
  return {
    lease_id: lease.lease_id,
    idempotency_key: `${lease.lease_id}:pre`,
    model: lease.model_key,
    pools: lease.pools.map((pool) => pool.id),
    kind: 'task',
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: 0,
    pool_fraction_before: fractions.before,
    pool_fraction_after: fractions.before,
    at,
  }
}

function postUsage(lease, { at, usage, fractions, prices }) {
  return {
    lease_id: lease.lease_id,
    idempotency_key: `${lease.lease_id}:post`,
    model: lease.model_key,
    pools: lease.pools.map((pool) => pool.id),
    kind: 'task',
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    cache_write_tokens: usage.cache_write_tokens,
    cost_usd: estimateCost({ input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, prices }),
    pool_fraction_before: fractions.before,
    pool_fraction_after: fractions.after,
    at,
  }
}

/** A config view whose _home is the explicit --state-dir; everything else is inherited. */
function stateConfigFor(config, stateDir) {
  const view = Object.create(config)
  Object.defineProperty(view, '_home', { value: stateDir })
  return view
}

function isConsumed(ctx, config, leaseId) {
  const ledger = readUsageLedger({ ctx, config })
  return ledger.rows.some((row) => isObject(row) && row.idempotency_key === `${leaseId}:post`)
}

/**
 * Executes one lease end to end. Returns after the terminal result event is written; every failure
 * throws a registry-coded error and leaves the event stream to the command's error handler.
 */
export async function runLease({ ctx, config, stateDir, leaseId, readInput, writer }) {
  if (!LEASE_ID_RE.test(leaseId)) throw codedError('E_REQUEST_INVALID', 'run requires a valid --lease')
  if (typeof stateDir !== 'string' || stateDir === '') {
    throw codedError('E_REQUEST_INVALID', 'run requires --state-dir')
  }
  const state = stateConfigFor(config, path.resolve(stateDir))
  const digest = configDigest(config)

  const findLease = () => {
    const current = readLeaseState(ctx, state)
    const lease = current.leases.find((item) => item.lease_id === leaseId)
    return { current, lease: lease || null }
  }

  const validateLease = ({ lease }) => {
    if (!lease) throw codedError('E_LEASE_UNKNOWN', `lease ${leaseId} is not in the state directory`)
    if (isExpired(lease, ctx.clock.now())) {
      throw codedError('E_LEASE_EXPIRED', `lease ${leaseId} expired at ${lease.expires_at}`, { retryable: true })
    }
    if (typeof lease.config_digest !== 'string' || !DIGEST_RE.test(lease.config_digest) || lease.config_digest !== digest) {
      throw codedError('E_LEASE_CONFIG_MISMATCH', 'configuration changed after the lease was issued')
    }
    if (isConsumed(ctx, state, leaseId)) {
      throw codedError('E_LEASE_CONSUMED', `lease ${leaseId} was already run`)
    }
    return lease
  }

  const initialLease = validateLease(findLease())
  const timeoutMs = Number.isInteger(initialLease.call?.timeout_ms) && initialLease.call.timeout_ms > 0
    ? initialLease.call.timeout_ms
    : DEFAULT_TIMEOUT_MS
  const staleMs = Math.max(
    timeoutMs + 60_000,
    Number.isFinite(config.policy?.lock_stale_ms) ? config.policy.lock_stale_ms : 0
  )
  const lockPolicy = { ...(isObject(config.policy) ? config.policy : {}), lock_stale_ms: staleMs }

  return withLock(ctx, lockFilePath(path.resolve(stateDir), leaseId), async () => {
    const snapshot = findLease()
    const lease = validateLease(snapshot)
    const material = providerMaterial(snapshot.current, lease)
    if (material === null) {
      throw codedError('E_PROVIDER_FAILED', 'lease has no recorded provider call')
    }
    const { call } = material
    const { env, secrets } = prepareEnvironment(ctx, config, providerOf(config, lease), call)
    const input = typeof readInput === 'function' ? readInput() : ''
    const startedAt = ctx.clock.now()
    const preAt = ctx.clock.nowIso()
    const exec = createExec({
      clock: ctx.clock,
      env: ctx.env,
      fs: ctx.fs,
      platform: ctx.platform,
      nodePath: process.execPath,
    })
    const result = await exec.runAsync(call.command, call.args, {
      cwd: call.cwd,
      input,
      env,
      timeout: timeoutMs,
    })

    if (result.error_code === 'E_TIMEOUT') {
      throw codedError('E_TIMEOUT', `run exceeded timeout_ms and its process tree was killed`, { retryable: true })
    }

    const decoded = decodeProviderOutput(result.stdout)
    if (decoded.providerCode !== null) {
      const code = PROVIDER_CODES.has(decoded.providerCode) ? decoded.providerCode : 'E_PROVIDER_FAILED'
      await failProvider({
        ctx,
        config: state,
        stateDir: path.resolve(stateDir),
        lease,
        result,
        startedAt,
        reason: code === 'E_PROVIDER_FAILED'
          ? 'provider reported a failure'
          : `provider reported ${code}`,
        code,
      })
    }
    if (!result.ok) {
      await failProvider({
        ctx,
        config: state,
        stateDir: path.resolve(stateDir),
        lease,
        result,
        startedAt,
        reason: 'provider exited unsuccessfully',
        code: 'E_PROVIDER_FAILED',
      })
    }
    if (decoded.usage === null) {
      throw codedError('E_PROVIDER_FAILED', 'provider output has no usable usage')
    }

    const usage = decoded.usage
    const fractions = poolFractions(config, lease, usage)
    const prices = isObject(config.models) && isObject(config.models[lease.model_key])
      ? config.models[lease.model_key].prices
      : undefined
    const postAt = ctx.clock.nowIso()

    await writeUsageRow({ ctx, config: state, input: preUsage(lease, { at: preAt, fractions }) })
    await writeUsageRow({
      ctx,
      config: state,
      input: postUsage(lease, { at: postAt, usage, fractions, prices }),
    })

    // One audit row per executed lease, written only after the run is fully booked so the row
    // describes an outcome rather than an attempt. It goes through the same ctx seams as the
    // ledger, and the effective secret is registered for redaction in case it reaches the detail.
    writeAudit(ctx, path.resolve(stateDir), {
      entry: 'cli',
      action: 'run',
      result: 'ok',
      detail: { lease_id: lease.lease_id, model: lease.model_key },
    }, { secrets })

    for (const text of decoded.texts) writer.text(redactString(text, secrets))
    if (decoded.texts.length === 0 && decoded.finalText !== '') {
      writer.text(redactString(decoded.finalText, secrets))
    }
    writer.usage(eventUsage(usage))
    writer.result(redactString(decoded.finalText, secrets), eventUsage(usage))
    return undefined
  }, { policy: lockPolicy })
}
