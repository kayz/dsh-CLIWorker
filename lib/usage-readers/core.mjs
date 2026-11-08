// Shared reading plumbing: user-supplied file or session directory only, pure conversions and
// latest-by-observation selection. Nothing here reads account directories or credential files.

import path from 'node:path'
import { codedError } from '../output.mjs'

const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const NUMERIC_RE = /^-?\d+$/

function unreadable() {
  return codedError('E_REQUEST_INVALID', 'usage source is not readable')
}

/** ISO strings keep their original spelling; epoch seconds/milliseconds become UTC ISO. */
export function toIsoTime(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (AT_RE.test(trimmed) && Number.isFinite(Date.parse(trimmed))) return trimmed
    if (NUMERIC_RE.test(trimmed)) return toIsoTime(Number(trimmed))
    const parsed = Date.parse(trimmed)
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = Math.abs(value) >= 1e12 ? value : value * 1000
    return new Date(millis).toISOString()
  }
  return null
}

/**
 * Fraction used from a supplier limit object. A reported used percentage is divided by 100; a
 * remaining percentage is converted first. Token totals are deliberately not accepted.
 */
export function fractionFromLimit(limit) {
  if (limit === null || typeof limit !== 'object') return null
  let fraction = null
  if (typeof limit.used_percent === 'number' && Number.isFinite(limit.used_percent)) {
    fraction = limit.used_percent / 100
  } else if (typeof limit.utilization === 'number' && Number.isFinite(limit.utilization)) {
    fraction = limit.utilization / 100
  } else if (typeof limit.remaining_percent === 'number' && Number.isFinite(limit.remaining_percent)) {
    fraction = 1 - limit.remaining_percent / 100
  }
  if (fraction === null || !(fraction >= 0 && fraction <= 1)) return null
  return fraction
}

/** Parsed JSON objects from JSONL text; blank or malformed lines are ignored as bad events. */
export function parseJsonLines(text) {
  const out = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.trim() === '') continue
    let value
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) out.push(value)
  }
  return out
}

/** The latest valid reading by observation time; file or array order never decides the result. */
export function selectLatest(readings) {
  let best = null
  let bestAt = null
  for (const reading of Array.isArray(readings) ? readings : []) {
    if (reading === null || typeof reading !== 'object') continue
    const at = Date.parse(reading.at)
    if (!Number.isFinite(at)) continue
    if (best === null || bestAt === null || at >= bestAt) {
      best = reading
      bestAt = at
    }
  }
  return best
}

function readText(ctx, file) {
  try {
    return String(ctx.fs.readFileSync(file, 'utf8'))
  } catch {
    throw unreadable()
  }
}

/**
 * Reads the texts of an explicitly provided file, or the direct `*.jsonl` files of an explicitly
 * provided session directory. Names are sorted for determinism; recursion is never attempted.
 */
export function readSessionTexts(ctx, target) {
  if (typeof target !== 'string' || target === '') throw unreadable()
  let stat
  try {
    stat = ctx.fs.statSync(target)
  } catch {
    throw unreadable()
  }
  if (stat && stat.isFile()) return [readText(ctx, target)]
  if (stat && stat.isDirectory()) {
    let names
    try {
      names = ctx.fs.readdirSync(target)
    } catch {
      throw unreadable()
    }
    return names
      .filter((name) => typeof name === 'string' && name.endsWith('.jsonl'))
      .sort()
      .map((name) => readText(ctx, path.join(target, name)))
  }
  throw unreadable()
}
