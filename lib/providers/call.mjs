// Provider session calls: descriptor validation, argv construction, session id extraction and the
// evidence entry point. Zero dependencies and no IO of its own; the caller supplies ctx.exec and a
// read callback. Nothing here knows a provider name or a model id.
import {
  IDENTITY_SOURCES,
  classifyIdentity as classifyFullIdentity,
  classifySessionIdentity,
  firstPathValue,
  jsonValues,
  readText,
  tryParse,
  valueAtPath,
} from '../identity.mjs'

export { IDENTITY_SOURCES }

export const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/

const ID_FROM = ['stdout_json', 'stdout_regex', 'stderr_regex', 'sidecar_file']

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
 * Backwards-compatible name for the Session projection. The full evidence object lives in
 * `classifyIdentity`; this one keeps the four fields `lib/session.mjs` already consumes.
 */
export function classifyIdentity(options = {}) {
  return classifySessionIdentity(options)
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * Execute one provider call and return both the full identity and a single evidence record.
 * Exactly one exec happens; a failure keeps its record. Nothing retries and no module state
 * survives the call.
 */
export function callWithIdentity(ctx, spec, text, timeout_ms, options = {}) {
  const settings = isObject(options) ? options : {}
  const clock = ctx.clock
  const started = clock.now()
  let result = null
  try {
    result = runSessionCall(ctx, spec, text, timeout_ms)
  } catch {
    result = null
  }
  const finished = clock.now()
  const observed_at = clock.nowIso()
  const cwd = isNonEmptyString(settings.cwd)
    ? settings.cwd
    : (spec && isNonEmptyString(spec.cwd) ? spec.cwd : settings.cwd)

  const identity = classifyFullIdentity({
    descriptor: settings.descriptor,
    result,
    requested_model: settings.requested_model,
    readFile: settings.readFile,
    cwd,
    observed_at,
  })

  const elapsed = finished - started
  const call = {
    requested_model: identity.requested_model,
    reported_model: identity.reported_model,
    identity: { level: identity.level },
    identity_source: identity.identity_source,
    evidence: {
      path: identity.evidence.path,
      at: identity.evidence.at,
      detail: identity.evidence.detail,
    },
    exit_code: Number.isInteger(result && result.code) ? result.code : null,
    latency_ms: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0,
    tokens_in: nonNegativeInteger(result && result.tokens_in),
    tokens_out: nonNegativeInteger(result && result.tokens_out),
    outcome: identity.level === 'failed' ? 'failed' : 'ok',
  }

  return { identity, calls: [call] }
}
