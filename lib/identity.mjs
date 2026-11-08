// Identity evidence: the single place that extracts an actual model, maps an evidence source to
// a fixed level and redacts what leaves the process. Pure apart from the injected read callback;
// it never reads the clock, the environment or a real file on its own.
import path from 'node:path'

import { redact, redactString, REDACTED } from './redact.mjs'

export const IDENTITY_SOURCES = Object.freeze([
  'stdout.modelUsage',
  'stdout.event.model',
  'stats.models',
  'rollout-file',
  'cli_flag',
  'none',
])

const LEVEL_BY_SOURCE = Object.freeze({
  'stdout.modelUsage': 'verified',
  'stdout.event.model': 'verified',
  'stats.models': 'verified',
  'rollout-file': 'observed',
  cli_flag: 'unverified',
  none: 'unverified',
})

const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

// A home directory segment: `C:\Users\name`, `/Users/name`, `\home\name`, `/home/name`. The
// separator may be a forward or backward slash in either style.
const USER_DIR_RE = /((?:[A-Za-z]:)?[\\/](?:Users|home)[\\/])[^\\/\s]+/g

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== ''
}

/** Safe dot-path lookup: own properties only, prototype names never traversed. */
export function valueAtPath(value, dotted) {
  if (!isNonEmptyString(dotted)) return null
  let current = value
  for (const segment of dotted.split('.')) {
    if (UNSAFE_SEGMENTS.has(segment)) return null
    if (!isObject(current) && !Array.isArray(current)) return null
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return null
    current = current[segment]
  }
  if (typeof current === 'string') return current === '' ? null : current
  if (typeof current === 'number' && Number.isFinite(current)) return String(current)
  return null
}

export function tryParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** JSON values from stdout: the whole document first, otherwise every non-empty JSONL line. */
export function jsonValues(text) {
  if (typeof text !== 'string' || text.trim() === '') return []
  const values = []
  const whole = tryParse(text)
  if (whole !== null) values.push(whole)
  else {
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === '') continue
      const parsed = tryParse(line)
      if (parsed !== null) values.push(parsed)
    }
  }
  return values
}

export function firstPathValue(values, dotted) {
  for (const value of values) {
    const found = valueAtPath(value, dotted)
    if (found !== null) return found
  }
  return null
}

export function readText(readFile, file) {
  if (typeof readFile !== 'function' || typeof file !== 'string' || file === '') return null
  try {
    const value = readFile(file)
    return typeof value === 'string' ? value : String(value)
  } catch {
    return null
  }
}

function rolloutModel(file, modelPath, readFile) {
  const text = readText(readFile, file)
  if (text === null) return null
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const parsed = tryParse(line)
    if (parsed === null) continue
    const found = valueAtPath(parsed, modelPath)
    if (found !== null) return found
  }
  return null
}

/** Remove a user directory segment so a path cannot identify the account. */
function stripUserDirs(text) {
  return String(text).replace(USER_DIR_RE, (match, prefix) => `${prefix}${REDACTED}`)
}

function scrub(text) {
  return redactString(stripUserDirs(text))
}

function isNonZeroExit(code) {
  return Number.isInteger(code) && code !== 0
}

function unresolved() {
  return { level: 'unverified', identity_source: 'none', reported: null, path: null }
}

/**
 * One raw extraction shared by both projections. `reported` and `path` are unredacted here so the
 * session view can compare real model strings; nothing in this result leaves the module.
 */
function resolveIdentity({ descriptor, result, readFile, cwd } = {}) {
  if (!result || result.ok !== true || isNonZeroExit(result.code)) {
    return { level: 'failed', identity_source: 'none', reported: null, path: null }
  }

  const identity = isObject(descriptor) && isObject(descriptor.identity) ? descriptor.identity : null
  if (identity === null || !isNonEmptyString(identity.source)) return unresolved()
  if (!IDENTITY_SOURCES.includes(identity.source)) return unresolved()
  if (identity.source === 'cli_flag') {
    return { level: 'unverified', identity_source: 'cli_flag', reported: null, path: null }
  }
  if (identity.source === 'none') return unresolved()

  let reported = null
  let evidencePath = null

  if (identity.source === 'rollout-file') {
    const resolved = isNonEmptyString(identity.file)
      ? (isNonEmptyString(cwd) ? path.resolve(cwd, identity.file) : identity.file)
      : null
    if (resolved !== null) {
      reported = rolloutModel(resolved, identity.model_path, readFile)
      if (reported !== null) evidencePath = resolved
    }
  } else if (isNonEmptyString(identity.model_path)) {
    reported = firstPathValue(jsonValues(result.stdout), identity.model_path)
    if (reported !== null) evidencePath = identity.model_path
  }

  if (reported === null) return unresolved()
  return {
    level: LEVEL_BY_SOURCE[identity.source] ?? 'unverified',
    identity_source: identity.source,
    reported,
    path: evidencePath,
  }
}

/**
 * The full evidence object for one call: fixed fields only, every string redacted, no reference
 * kept to the descriptor, stdout or the read result.
 */
export function classifyIdentity({
  descriptor,
  result,
  requested_model,
  readFile,
  cwd,
  observed_at,
} = {}) {
  const raw = resolveIdentity({ descriptor, result, readFile, cwd })
  const evidence = redact({
    path: raw.path === null ? null : stripUserDirs(raw.path),
    at: isNonEmptyString(observed_at) ? stripUserDirs(observed_at) : null,
    detail: raw.reported === null ? null : stripUserDirs(raw.reported),
  })
  return {
    level: raw.level,
    identity_source: raw.identity_source,
    evidence,
    requested_model: isNonEmptyString(requested_model) ? scrub(requested_model) : null,
    reported_model: raw.reported === null ? null : scrub(raw.reported),
  }
}

/**
 * The four-field projection the Session API already exposes. `consistent` compares the raw model
 * strings before redaction, so two different secrets cannot look equal once both are masked.
 */
export function classifySessionIdentity({
  descriptor,
  result,
  requested_model,
  readFile,
  cwd,
  observed_at,
} = {}) {
  const raw = resolveIdentity({ descriptor, result, readFile, cwd })
  return {
    level: raw.level,
    identity_source: raw.identity_source,
    consistent: raw.reported === null ? null : raw.reported === requested_model,
    observed_at,
  }
}
