// State storage: atomic JSON writes and JSONL appends, all through ctx.fs so the seams stay in
// lib/context.mjs. Readers always see a complete old version or a complete new one.

import path from 'node:path'

export const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160]

const RETRYABLE_RENAME_CODES = ['EPERM', 'EACCES', 'EBUSY']

export function ensureDir(ctx, dir) {
  ctx.fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Reads and parses a JSON file. A missing file yields `fallback` (null by default); every other
 * read error and every parse error is rethrown unchanged.
 */
export function readJson(ctx, file, fallback) {
  const miss = fallback === undefined ? null : fallback
  let text
  try {
    text = ctx.fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return miss
    throw error
  }
  return JSON.parse(String(text))
}

function serialize(value, indent, label) {
  if (value === undefined) throw new TypeError(`${label} requires a JSON-serialisable value`)
  let text
  try {
    text = JSON.stringify(value, null, indent)
  } catch (error) {
    throw new TypeError(`${label} cannot serialise the value: ${error && error.message ? error.message : String(error)}`)
  }
  if (typeof text !== 'string') throw new TypeError(`${label} requires a JSON-serialisable value`)
  return text
}

/** A base36 fraction of ctx.random(), used to keep temp and tombstone names apart. */
function randomSuffix(ctx) {
  const value = Number(ctx.random())
  const text = Number.isFinite(value) ? value.toString(36) : '0'
  const dot = text.indexOf('.')
  const fraction = dot < 0 ? text : text.slice(dot + 1)
  return fraction === '' ? '0' : fraction
}

async function renameIntoPlace(ctx, from, to) {
  const delays = ctx.platform === 'win32' ? RENAME_RETRY_DELAYS_MS : []
  for (let attempt = 0; ; attempt += 1) {
    try {
      ctx.fs.renameSync(from, to)
      return
    } catch (error) {
      const code = error && error.code
      if (attempt >= delays.length || !RETRYABLE_RENAME_CODES.includes(code)) throw error
      await ctx.clock.sleep(delays[attempt])
    }
  }
}

/**
 * Writes `value` as pretty JSON through a same-directory temp file plus a rename. On any failure
 * the temp file is removed and the destination keeps its previous bytes.
 */
export async function atomicWriteJson(ctx, file, value) {
  const text = serialize(value, 2, 'atomicWriteJson') + '\n'
  ensureDir(ctx, path.dirname(file))
  const tmp = `${file}.${randomSuffix(ctx)}.tmp`
  try {
    ctx.fs.writeFileSync(tmp, text, 'utf8')
    await renameIntoPlace(ctx, tmp, file)
  } catch (error) {
    try {
      ctx.fs.rmSync(tmp, { force: true })
    } catch {
      // best effort: the original failure is what matters
    }
    throw error
  }
}

/** Appends one JSON row with a single append call, so concurrent writers cannot interleave. */
export function appendJsonl(ctx, file, row) {
  const text = serialize(row, undefined, 'appendJsonl') + '\n'
  ensureDir(ctx, path.dirname(file))
  ctx.fs.appendFileSync(file, text, 'utf8')
  return undefined
}

/** Parses a JSONL file. A missing file is empty; a bad line throws unless `skipInvalid`. */
export function readJsonl(ctx, file, { skipInvalid = false } = {}) {
  let text
  try {
    text = ctx.fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }

  const rows = []
  const lines = String(text).split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue
    try {
      rows.push(JSON.parse(lines[i]))
    } catch (error) {
      if (skipInvalid) continue
      throw new SyntaxError(`invalid JSON on line ${i + 1} of ${file}: ${error && error.message ? error.message : String(error)}`)
    }
  }
  return rows
}
