// Idempotent usage ledger over state_dir/usage.jsonl. Every write goes through the existing state
// lock: strict read, look up the idempotency key, assign the first id, append exactly once. Reads
// deduplicate by key without rewriting the file, and rows written before keys existed stay
// independent. All IO is through ctx.fs, all time through ctx.clock.

import { appendJsonl, readJsonl } from './store.mjs'
import { withLock, lockFilePath } from './lock.mjs'
import { codedError } from './output.mjs'
import { usageFile } from './commands/_util.mjs'

export const USAGE_SCHEMA = 'cliworker.usage/v1'

const KINDS = new Set(['task', 'probe', 'manual'])
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

function invalid(message) {
  return codedError('E_REQUEST_INVALID', message)
}

function stateError(message) {
  return codedError('E_CONFIG', message)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isToken(value) {
  return Number.isInteger(value) && value >= 0
}

function isFraction(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
}

function isIsoTime(value) {
  return typeof value === 'string' && AT_RE.test(value) && Number.isFinite(Date.parse(value))
}

function nonEmptyString(value) {
  return typeof value === 'string' && value !== ''
}

/**
 * Returns the complete cliworker.usage/v1 row for `input`, filling only the documented defaults.
 * Missing `at` is read from ctx.clock.nowIso(); it is never refreshed later in the commit path.
 */
export function normalizeUsageRow(input, ctx) {
  if (!isObject(input)) throw invalid('usage row must be a JSON object')
  const row = { ...input }
  row.schema = input.schema === undefined ? USAGE_SCHEMA : input.schema
  row.idempotency_key = input.idempotency_key === undefined ? undefined : input.idempotency_key
  row.lease_id = input.lease_id === undefined ? '' : input.lease_id
  row.pools = input.pools === undefined ? [] : input.pools
  row.kind = input.kind === undefined ? 'manual' : input.kind
  row.input_tokens = input.input_tokens === undefined ? 0 : input.input_tokens
  row.output_tokens = input.output_tokens === undefined ? 0 : input.output_tokens
  row.cache_read_tokens = input.cache_read_tokens === undefined ? 0 : input.cache_read_tokens
  row.cache_write_tokens = input.cache_write_tokens === undefined ? 0 : input.cache_write_tokens
  row.cost_usd = input.cost_usd === undefined ? 0 : input.cost_usd
  row.pool_fraction_before = input.pool_fraction_before === undefined ? null : input.pool_fraction_before
  row.pool_fraction_after = input.pool_fraction_after === undefined ? null : input.pool_fraction_after
  row.at = input.at === undefined ? ctx.clock.nowIso() : input.at
  return validateUsageRow(row)
}

/** Throws E_REQUEST_INVALID unless `row` is a complete, well-typed usage row. */
export function validateUsageRow(row) {
  if (!isObject(row)) throw invalid('usage row must be a JSON object')
  if (row.schema !== USAGE_SCHEMA) throw invalid('usage row has an unsupported schema')
  if (row.id !== undefined && !nonEmptyString(row.id)) throw invalid('usage row id must be a non-empty string')
  if (row.idempotency_key !== undefined && !nonEmptyString(row.idempotency_key)) {
    throw invalid('usage row idempotency_key must be a non-empty string')
  }
  if (!nonEmptyString(row.lease_id) && row.lease_id !== '') throw invalid('usage row lease_id must be a string')
  if (!nonEmptyString(row.model)) throw invalid('usage row model must be a non-empty string')
  if (!Array.isArray(row.pools) || !row.pools.every((item) => typeof item === 'string')) {
    throw invalid('usage row pools must be an array of strings')
  }
  if (!KINDS.has(row.kind)) throw invalid('usage row kind must be task, probe or manual')
  for (const key of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']) {
    if (!isToken(row[key])) throw invalid(`usage row ${key} must be a non-negative integer`)
  }
  if (typeof row.cost_usd !== 'number' || !Number.isFinite(row.cost_usd) || row.cost_usd < 0) {
    throw invalid('usage row cost_usd must be a non-negative finite number')
  }
  if (!isFraction(row.pool_fraction_before) || !isFraction(row.pool_fraction_after)) {
    throw invalid('usage row pool fractions must be null or numbers between 0 and 1')
  }
  if (!isIsoTime(row.at)) throw invalid('usage row at must be an ISO-8601 UTC instant')
  return row
}

function isNewFormatRow(row) {
  return isObject(row) && row.schema === USAGE_SCHEMA
}

/** First row per non-empty idempotency key; keyless rows stay independent legacy records. */
export function dedupeUsageRows(rows) {
  const seen = new Set()
  const kept = []
  let legacy = false
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = isObject(row) && nonEmptyString(row.idempotency_key) ? row.idempotency_key : null
    if (key === null) {
      legacy = true
      kept.push(row)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(row)
  }
  return { rows: kept, legacy }
}

/**
 * Strict read: a missing ledger is empty, but unreadable bytes, broken JSONL or an invalid new
 * format row fail instead of being treated as an empty ledger. The file is never modified.
 */
export function readUsageLedger({ ctx, config }) {
  const file = usageFile(config, ctx)
  let stored
  try {
    stored = readJsonl(ctx, file)
  } catch {
    throw stateError('usage ledger cannot be read or is not valid JSONL')
  }
  for (let index = 0; index < stored.length; index += 1) {
    const row = stored[index]
    if (isNewFormatRow(row)) {
      try {
        validateUsageRow(row)
      } catch {
        throw stateError(`usage ledger line ${index + 1} is not a valid usage row`)
      }
      if (!nonEmptyString(row.idempotency_key)) {
        throw stateError(`usage ledger line ${index + 1} is missing its idempotency_key`)
      }
    } else if (!isObject(row)) {
      throw stateError(`usage ledger line ${index + 1} is not a JSON object`)
    }
  }
  return dedupeUsageRows(stored)
}

function hashText(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function nextId(rowCount, used) {
  let candidate = rowCount + 1
  while (used.has(`u_${candidate}`)) candidate += 1
  return `u_${candidate}`
}

/**
 * Commits one row under the state lock. An existing idempotency key returns the stored row and id
 * unchanged, even when the retry payload differs. A failed append rejects instead of reporting a
 * successful commit.
 */
export async function writeUsageRow({ ctx, config, input }) {
  const row = normalizeUsageRow(input, ctx)
  if (!nonEmptyString(row.idempotency_key)) {
    row.idempotency_key = `auto:${hashText(JSON.stringify(row))}`
  }
  return withLock(
    ctx,
    lockFilePath(config._home),
    async () => {
      const ledger = readUsageLedger({ ctx, config })
      const existing = ledger.rows.find(
        (item) => isObject(item) && item.idempotency_key === row.idempotency_key
      )
      if (existing) return { row: existing, created: false, legacy: ledger.legacy }

      const usedIds = new Set(ledger.rows.map((item) => item && item.id).filter(nonEmptyString))
      const id = nonEmptyString(row.id) && !usedIds.has(row.id) ? row.id : nextId(ledger.rows.length, usedIds)
      const stored = { ...row, id }
      appendJsonl(ctx, usageFile(config, ctx), stored)
      return { row: stored, created: true, legacy: ledger.legacy }
    },
    { policy: config.policy }
  )
}
