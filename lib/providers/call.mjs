// Provider session calls: descriptor validation, argv construction, session id extraction and
// identity grading. Zero dependencies and no IO of its own; the caller supplies ctx.exec and a
// read callback. Nothing here knows a provider name or a model id.
import path from 'node:path'

export const IDENTITY_SOURCES = Object.freeze([
  'stdout.modelUsage',
  'stdout.event.model',
  'stats.models',
  'rollout-file',
  'cli_flag',
  'none',
])

export const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/

const ID_FROM = ['stdout_json', 'stdout_regex', 'stderr_regex', 'sidecar_file']
const LEVEL_BY_SOURCE = {
  'stdout.modelUsage': 'verified',
  'stdout.event.model': 'verified',
  'stats.models': 'verified',
  'rollout-file': 'observed',
  'cli_flag': 'unverified',
  none: 'unverified',
}
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== ''
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function hasCaptureGroup(source) {
  let escaped = false
  let inClass = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (inClass) {
      if (char === ']') inClass = false
      continue
    }
    if (char === '[') {
      inClass = true
      continue
    }
    if (char === '(') {
      if (source[i + 1] !== '?') return true
    }
  }
  return false
}

function isUsablePattern(value) {
  if (!isNonEmptyString(value) || !hasCaptureGroup(value)) return false
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}

function addProblem(problems, problem) {
  if (!problems.includes(problem)) problems.push(problem)
}

function checkCallShape(call, problems, prefix, needId) {
  if (!isObject(call)) {
    addProblem(problems, `${prefix}_call`)
    return
  }
  if (!isNonEmptyString(call.command)) addProblem(problems, `${prefix}_command`)
  if (!isStringArray(call.args)) addProblem(problems, `${prefix}_args`)
  if (call.input !== 'stdin') addProblem(problems, `${prefix}_input`)
  if (needId && isStringArray(call.args) && !call.args.some((item) => item.includes('{session_id}'))) {
    addProblem(problems, 'resume_args')
  }
}

/**
 * Validate the `session` descriptor. Problems are fixed identifiers, never descriptor content.
 * `resumable` is only true for a valid descriptor whose provider supports resume.
 */
export function validateSessionDescriptor(descriptor) {
  const problems = []
  if (!isObject(descriptor) || descriptor.supported !== true) {
    return { ok: false, resumable: false, problems: ['unsupported'] }
  }

  checkCallShape(descriptor.start, problems, 'start', false)

  if (!ID_FROM.includes(descriptor.id_from)) addProblem(problems, 'id_from')
  if (descriptor.id_from === 'stdout_json' && !isNonEmptyString(descriptor.id_path)) addProblem(problems, 'id_path')
  if (descriptor.id_from === 'stdout_regex' || descriptor.id_from === 'stderr_regex') {
    if (!isUsablePattern(descriptor.id_pattern)) addProblem(problems, 'id_pattern')
  }
  if (descriptor.id_from === 'sidecar_file' && !isNonEmptyString(descriptor.id_file)) addProblem(problems, 'id_file')

  if (typeof descriptor.supports_resume !== 'boolean') {
    addProblem(problems, 'supports_resume')
  } else if (descriptor.supports_resume === false) {
    if (!isNonEmptyString(descriptor.reason)) addProblem(problems, 'reason')
  } else {
    checkCallShape(descriptor.resume, problems, 'resume', true)
  }

  if (descriptor.identity !== undefined && descriptor.identity !== null) {
    const identity = descriptor.identity
    if (!isObject(identity)) {
      addProblem(problems, 'identity')
    } else {
      if (!IDENTITY_SOURCES.includes(identity.source)) addProblem(problems, 'identity_source')
      if (!isNonEmptyString(identity.model_path)) addProblem(problems, 'identity_model_path')
      if (identity.source === 'rollout-file' && !isNonEmptyString(identity.file)) addProblem(problems, 'identity_file')
    }
  }

  const ok = problems.length === 0
  return { ok, resumable: ok && descriptor.supports_resume === true, problems }
}

/**
 * Build the exec spec for one session call. Arguments stay an array and `{session_id}` is
 * substituted element by element, so nothing is ever handed to a shell.
 */
export function buildSessionCall(descriptor, { mode, session_id, cwd } = {}) {
  if (mode !== 'start' && mode !== 'resume') throw new TypeError('session call mode is invalid')
  if (mode === 'resume' && !SESSION_ID_RE.test(session_id)) throw new TypeError('session_id is invalid')

  const source = isObject(descriptor) ? descriptor[mode] : null
  if (!isObject(source) || typeof source.command !== 'string' || !isStringArray(source.args)) {
    throw new TypeError('session descriptor is not callable')
  }

  const args = mode === 'resume'
    ? source.args.map((item) => item.split('{session_id}').join(session_id))
    : source.args.slice()

  return { command: source.command, args, cwd, input: 'stdin' }
}

/** One provider invocation. Returns the exec result untouched; it never retries. */
export function runSessionCall(ctx, spec, text, timeout_ms) {
  return ctx.exec(spec.command, spec.args, { cwd: spec.cwd, input: text, timeout: timeout_ms })
}

function readText(readFile, file) {
  if (typeof readFile !== 'function' || typeof file !== 'string' || file === '') return null
  try {
    const value = readFile(file)
    return typeof value === 'string' ? value : String(value)
  } catch {
    return null
  }
}

function jsonValues(text) {
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

function tryParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Safe dot-path lookup: own properties only, prototype names never traversed. */
function valueAtPath(value, dotted) {
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

function firstPathValue(values, dotted) {
  for (const value of values) {
    const found = valueAtPath(value, dotted)
    if (found !== null) return found
  }
  return null
}

function regexCapture(pattern, text) {
  if (!isNonEmptyString(pattern) || typeof text !== 'string') return null
  let re
  try {
    re = new RegExp(pattern)
  } catch {
    return null
  }
  const match = re.exec(text)
  if (!match || typeof match[1] !== 'string') return null
  return match[1] === '' ? null : match[1]
}

function rolloutModel(file, modelPath, readFile, cwd) {
  const resolved = isNonEmptyString(file)
    ? (isNonEmptyString(cwd) ? path.resolve(cwd, file) : file)
    : null
  const text = readText(readFile, resolved)
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

/**
 * Extract the provider session id from the four supported sources. A value that does not match
 * the safe id grammar is treated as missing, never repaired.
 */
export function extractSessionId(descriptor, { stdout, stderr } = {}, readFile) {
  if (!isObject(descriptor)) return null
  let candidate = null

  if (descriptor.id_from === 'stdout_json') {
    candidate = firstPathValue(jsonValues(stdout), descriptor.id_path)
  } else if (descriptor.id_from === 'stdout_regex') {
    candidate = regexCapture(descriptor.id_pattern, stdout)
  } else if (descriptor.id_from === 'stderr_regex') {
    candidate = regexCapture(descriptor.id_pattern, stderr)
  } else if (descriptor.id_from === 'sidecar_file') {
    const text = readText(readFile, descriptor.id_file)
    if (text !== null) {
      if (isNonEmptyString(descriptor.id_path)) {
        candidate = valueAtPath(tryParse(text), descriptor.id_path)
      } else {
        const trimmed = text.trim()
        candidate = trimmed === '' ? null : trimmed
      }
    }
  }

  return typeof candidate === 'string' && SESSION_ID_RE.test(candidate) ? candidate : null
}

/**
 * Grade how strongly the provider proved which model answered. A mismatch is reported, not
 * rejected: cross-checking is AgentLine's job.
 */
export function classifyIdentity({ descriptor, result, requested_model, readFile, cwd, observed_at } = {}) {
  if (!result || result.ok !== true) {
    return { level: 'failed', identity_source: 'none', consistent: null, observed_at }
  }

  const identity = isObject(descriptor) && isObject(descriptor.identity) ? descriptor.identity : null
  if (identity === null) {
    return { level: 'unverified', identity_source: 'none', consistent: null, observed_at }
  }

  let reported = null
  if (identity.source === 'rollout-file') {
    reported = rolloutModel(identity.file, identity.model_path, readFile, cwd)
  } else {
    reported = firstPathValue(jsonValues(result.stdout), identity.model_path)
  }

  if (reported === null) {
    return { level: 'unverified', identity_source: 'none', consistent: null, observed_at }
  }

  return {
    level: LEVEL_BY_SOURCE[identity.source] ?? 'unverified',
    identity_source: identity.source,
    consistent: reported === requested_model,
    observed_at,
  }
}
