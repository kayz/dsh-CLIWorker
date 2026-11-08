// Session protocol: start/resume contracts, opaque tokens, invalidation and role policy.
// Stateless by design: CLIWorker holds no conversation, no session_id and no module state. Every
// time value comes from ctx.clock, every command from ctx.exec, every byte written through ctx.fs.
import { createHash } from 'node:crypto'
import path from 'node:path'

import {
  SESSION_ID_RE,
  buildSessionCall,
  classifyIdentity,
  extractSessionId,
  runSessionCall,
  validateSessionDescriptor,
} from './providers/call.mjs'
import { SESSION_RESULT_SCHEMA, sessionView } from './contract/views.mjs'
import { errorBody } from './output.mjs'

export const DEFAULT_SESSION_TTL_S = 43200

export const SESSION_ERRORS = Object.freeze({
  E_SESSION_MODEL_CHANGED: Object.freeze({
    code: 'E_SESSION_MODEL_CHANGED',
    retryable: false,
    message: 'session was created for a different model',
  }),
  E_SESSION_PROVIDER_CHANGED: Object.freeze({
    code: 'E_SESSION_PROVIDER_CHANGED',
    retryable: false,
    message: 'session was created for a different provider',
  }),
  E_SESSION_CONTRACT_CHANGED: Object.freeze({
    code: 'E_SESSION_CONTRACT_CHANGED',
    retryable: false,
    message: 'session was created for a different CLI contract',
  }),
  E_SESSION_EXPIRED: Object.freeze({
    code: 'E_SESSION_EXPIRED',
    retryable: false,
    message: 'session has expired',
  }),
  E_SESSION_RESUME_FAILED: Object.freeze({
    code: 'E_SESSION_RESUME_FAILED',
    retryable: false,
    message: 'session resume failed',
  }),
  E_SESSION_NOT_SUPPORTED: Object.freeze({
    code: 'E_SESSION_NOT_SUPPORTED',
    retryable: false,
    message: 'session is not supported by this provider',
  }),
  E_SESSION_QUOTA_EXHAUSTED: Object.freeze({
    code: 'E_SESSION_QUOTA_EXHAUSTED',
    retryable: false,
    message: 'session quota is exhausted; start a new session with another model',
  }),
  E_SESSION_START_FAILED: Object.freeze({
    code: 'E_SESSION_START_FAILED',
    retryable: false,
    message: 'session start failed',
  }),
  E_SESSION_ID_MISSING: Object.freeze({
    code: 'E_SESSION_ID_MISSING',
    retryable: false,
    message: 'session id is missing from the provider output',
  }),
})

export const INVALIDATION_CODES = Object.freeze([
  'E_SESSION_MODEL_CHANGED',
  'E_SESSION_PROVIDER_CHANGED',
  'E_SESSION_CONTRACT_CHANGED',
  'E_SESSION_EXPIRED',
  'E_SESSION_RESUME_FAILED',
  'E_SESSION_NOT_SUPPORTED',
])

export const ROLE_POLICIES = Object.freeze({
  design: Object.freeze({ mode: 'reuse', shares_with: null }),
  design_prereview: Object.freeze({ mode: 'reuse', shares_with: 'design' }),
  dev: Object.freeze({ mode: 'reuse', shares_with: null }),
  review: Object.freeze({ mode: 'new_each_round', shares_with: null }),
  test_architect: Object.freeze({ mode: 'configurable', shares_with: null }),
})

const POLICY_SCHEMA = 'cliworker.session-policy/v1'
const TASK_RE = /^[A-Za-z0-9._-]+$/
const INPUT_ORDER = ['prompt', 'summary', 'diff', 'findings', 'constraints']
const START_KEYS = ['prompt', 'summary', 'diff', 'findings', 'constraints']
const RESUME_KEYS = ['summary', 'diff', 'findings', 'constraints']
const DEFAULT_TIMEOUT_MS = 1800000

function digest(label, value) {
  return createHash('sha256').update(`${label}\n${value}`, 'utf8').digest('hex').slice(0, 12)
}

function contractDigest(target) {
  const cli = target.cli_version ?? 'unknown'
  const contract = target.contract_version ?? SESSION_RESULT_SCHEMA
  return digest('contract', `${cli}\n${contract}`)
}

function errorOf(code) {
  const entry = SESSION_ERRORS[code]
  return {
    code: entry.code,
    message: entry.message,
    retryable: entry.retryable,
    retry_after: null,
  }
}

function failure(action, code) {
  return sessionView({ action, error: errorOf(code) })
}

function requestFailure(action, message) {
  return sessionView({ action, error: errorBody('E_REQUEST_INVALID', message).error })
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== ''
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validTarget(target) {
  if (!isObject(target)) return false
  for (const key of ['model_key', 'provider', 'model_id', 'cwd']) {
    if (!isNonEmptyString(target[key])) return false
  }
  return isObject(target.session)
}

function normalizeValue(value) {
  if (typeof value === 'string') return value === '' ? null : value
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    if (!value.every((item) => typeof item === 'string')) return null
    return value.join('\n')
  }
  return null
}

/** The single delta document handed to the provider: fixed order, one blank line between sections. */
export function composeInput(input) {
  const source = isObject(input) ? input : {}
  const parts = []
  for (const name of INPUT_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) continue
    const text = normalizeValue(source[name])
    if (text === null) continue
    parts.push(`## ${name}\n${text}\n`)
  }
  return parts.join('\n')
}

function checkInput(input, action) {
  if (!isObject(input)) return { ok: false, message: 'input is empty' }
  const allowed = action === 'start' ? START_KEYS : RESUME_KEYS
  const keys = Object.keys(input)
  if (keys.some((key) => !allowed.includes(key))) {
    return {
      ok: false,
      message: action === 'start'
        ? 'input has an unsupported key'
        : 'resume accepts only summary, diff, findings, constraints',
    }
  }
  let used = 0
  for (const key of keys) {
    if (normalizeValue(input[key]) === null) return { ok: false, message: 'input value is invalid' }
    used += 1
  }
  if (used === 0) return { ok: false, message: 'input is empty' }
  return { ok: true, text: composeInput(input) }
}

function readFileFor(ctx, target) {
  return (file) => ctx.fs.readFileSync(path.resolve(target.cwd, file), 'utf8')
}

function parseToken(token) {
  if (typeof token !== 'string' || !token.startsWith('st_')) return null
  const body = token.slice(3)
  if (body === '' || !/^[A-Za-z0-9_-]+$/.test(body)) return null

  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!isObject(payload)) return null
  const keys = Object.keys(payload).sort()
  const expected = ['c', 'm', 'p', 's', 't', 'v']
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) return null
  if (payload.v !== 1) return null
  if (typeof payload.s !== 'string' || !SESSION_ID_RE.test(payload.s)) return null
  for (const key of ['m', 'p', 'c']) {
    if (typeof payload[key] !== 'string' || !/^[0-9a-f]{12}$/.test(payload[key])) return null
  }
  if (!Number.isInteger(payload.t) || !Number.isFinite(payload.t)) return null
  return payload
}

/** Issue the opaque token. It carries only digests plus the provider's own session id. */
export function issueToken(ctx, target, session_id) {
  if (typeof session_id !== 'string' || !SESSION_ID_RE.test(session_id)) {
    throw new TypeError('session_id is invalid')
  }
  const payload = {
    v: 1,
    s: session_id,
    m: digest('model', target.model_key),
    p: digest('provider', target.provider),
    c: contractDigest(target),
    t: ctx.clock.now(),
  }
  return `st_${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`
}

/** Decode a token, or null when any part of it is missing, badly typed or malformed. */
export function decodeToken(token) {
  return parseToken(token)
}

/**
 * Start a session. Provider is called at most once; a failure is reported and never retried.
 */
export function startSession(ctx, { target, input, timeout_ms } = {}) {
  const action = 'start'
  if (!validTarget(target)) return requestFailure(action, 'target is invalid')
  const checked = checkInput(input, action)
  if (!checked.ok) return requestFailure(action, checked.message)

  const descriptor = target.session
  const verdict = validateSessionDescriptor(descriptor)
  if (!verdict.ok) return failure(action, 'E_SESSION_NOT_SUPPORTED')

  const spec = buildSessionCall(descriptor, { mode: 'start', cwd: target.cwd })
  const result = runSessionCall(
    ctx,
    spec,
    checked.text,
    timeout_ms === undefined ? DEFAULT_TIMEOUT_MS : timeout_ms
  )
  const observed_at = ctx.clock.nowIso()
  const identity = classifyIdentity({
    descriptor,
    result,
    requested_model: target.model_id,
    readFile: readFileFor(ctx, target),
    cwd: target.cwd,
    observed_at,
  })

  if (!result || result.ok !== true) {
    return sessionView({ action, error: errorOf('E_SESSION_START_FAILED'), identity })
  }

  const session_id = extractSessionId(
    descriptor,
    { stdout: result.stdout, stderr: result.stderr },
    readFileFor(ctx, target)
  )
  if (session_id === null) {
    return sessionView({ action, error: errorOf('E_SESSION_ID_MISSING'), identity })
  }

  return sessionView({
    action,
    session_token: verdict.resumable ? issueToken(ctx, target, session_id) : null,
    identity,
    reply: typeof result.stdout === 'string' ? result.stdout : '',
  })
}

/**
 * Resume a session. The pre-checks run in a fixed order and short-circuit before the provider is
 * called; only the final resume failure costs an exec.
 */
export function resumeSession(ctx, { target, token, input, forecast, ttl_s, timeout_ms } = {}) {
  const action = 'resume'
  const payload = parseToken(token)
  if (payload === null) return requestFailure(action, 'session_token is malformed')
  if (!validTarget(target)) return requestFailure(action, 'target is invalid')
  const checked = checkInput(input, action)
  if (!checked.ok) return requestFailure(action, checked.message)

  const descriptor = target.session
  const verdict = validateSessionDescriptor(descriptor)
  if (!verdict.resumable) return failure(action, 'E_SESSION_NOT_SUPPORTED')

  if (payload.p !== digest('provider', target.provider)) {
    return failure(action, 'E_SESSION_PROVIDER_CHANGED')
  }
  if (payload.m !== digest('model', target.model_key)) {
    return failure(action, 'E_SESSION_MODEL_CHANGED')
  }
  if (payload.c !== contractDigest(target)) {
    return failure(action, 'E_SESSION_CONTRACT_CHANGED')
  }

  const now = ctx.clock.now()
  const ttlSeconds = ttl_s === undefined ? DEFAULT_SESSION_TTL_S : ttl_s
  if (now - payload.t > ttlSeconds * 1000) return failure(action, 'E_SESSION_EXPIRED')

  if (forecast && (forecast.risk === 'critical' || forecast.risk === 'exhausted')) {
    return failure(action, 'E_SESSION_QUOTA_EXHAUSTED')
  }

  const spec = buildSessionCall(descriptor, { mode: 'resume', session_id: payload.s, cwd: target.cwd })
  const result = runSessionCall(
    ctx,
    spec,
    checked.text,
    timeout_ms === undefined ? DEFAULT_TIMEOUT_MS : timeout_ms
  )
  const observed_at = ctx.clock.nowIso()
  const identity = classifyIdentity({
    descriptor,
    result,
    requested_model: target.model_id,
    readFile: readFileFor(ctx, target),
    cwd: target.cwd,
    observed_at,
  })

  if (!result || result.ok !== true) {
    return sessionView({ action, error: errorOf('E_SESSION_RESUME_FAILED'), identity })
  }

  return sessionView({
    action,
    session_token: issueToken(ctx, target, payload.s),
    identity,
    reply: typeof result.stdout === 'string' ? result.stdout : '',
  })
}

/** A copy of the role policy entry; an unknown role is a programming error. */
export function rolePolicy(role) {
  if (!Object.prototype.hasOwnProperty.call(ROLE_POLICIES, role)) throw new TypeError('unknown session role')
  const policy = ROLE_POLICIES[role]
  return { mode: policy.mode, shares_with: policy.shares_with }
}

/** Whether the next round for this role starts a new session or resumes the active one. */
export function nextAction(role, { hasActiveRecord, reuse } = {}) {
  const policy = rolePolicy(role)
  if (policy.mode === 'new_each_round') return 'start'
  if (policy.mode === 'configurable') return reuse === true && hasActiveRecord === true ? 'resume' : 'start'
  return hasActiveRecord === true ? 'resume' : 'start'
}

/**
 * Persist the role policy to `<taskDir>/sessions/<role>.json`. A file that belongs to another
 * schema is left untouched; a write failure leaves no partial file behind.
 */
export function writeRolePolicy(ctx, { taskDir, task, role, ttl_s } = {}) {
  if (
    !isNonEmptyString(taskDir) ||
    typeof task !== 'string' ||
    !TASK_RE.test(task) ||
    !Object.prototype.hasOwnProperty.call(ROLE_POLICIES, role)
  ) {
    return errorBody('E_REQUEST_INVALID', 'invalid session policy request')
  }

  const directory = path.join(taskDir, 'sessions')
  const target = path.join(directory, `${role}.json`)
  ctx.fs.mkdirSync(directory, { recursive: true })

  if (ctx.fs.existsSync(target)) {
    let current = null
    try {
      current = JSON.parse(ctx.fs.readFileSync(target, 'utf8'))
    } catch {
      current = null
    }
    if (!isObject(current) || current.schema !== POLICY_SCHEMA) {
      return { ok: true, written: false, reason: 'foreign_schema', path: target }
    }
  }

  const policy = ROLE_POLICIES[role]
  const value = {
    schema: POLICY_SCHEMA,
    task,
    role,
    mode: policy.mode,
    shares_with: policy.shares_with,
    ttl_s: ttl_s === undefined ? DEFAULT_SESSION_TTL_S : ttl_s,
    invalidate_on: [...INVALIDATION_CODES],
  }

  const temporary = `${target}.tmp`
  try {
    ctx.fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
    ctx.fs.renameSync(temporary, target)
  } catch {
    try {
      ctx.fs.rmSync(temporary, { force: true })
    } catch {
      // The temporary file is already gone or cannot be removed; the target was never touched.
    }
    return errorBody('E_INTERNAL', 'failed to write session policy')
  }

  return { ok: true, written: true, path: target }
}
