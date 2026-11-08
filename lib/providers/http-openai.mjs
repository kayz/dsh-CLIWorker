// Complete HTTP transport for OpenAI-compatible providers. Credentials travel only in an
// in-memory Authorization header; request construction, decoding, the fixed retry budget and
// usage aggregation all live here. The client never executes a process and never commits the
// ledger itself, so a storage failure cannot trigger a second paid request.

import { DEFAULT_TIMEOUT_MS } from '../exec.mjs'
import { codedError } from '../output.mjs'
import { redact } from '../redact.mjs'
import { resolveSecret } from '../secrets/index.mjs'
import { assertChannelIsolation } from '../usage/ledger.mjs'
import {
  identityFromResponse,
  usageFromResponse,
  validateHttpRequest,
} from './registry.mjs'

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const SECRET_SHAPE_RE = /^(?:sk-|env:|vault:)/i
const CONTROL_RE = /[\s\x00-\x1f\x7f]/
const MAX_ATTEMPTS = 2

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(message) {
  return codedError('E_REQUEST_INVALID', message)
}

function backendError(message) {
  return codedError('E_SECRET_BACKEND', message, { retryable: false })
}

function unknownUsage() {
  return { input_tokens: null, output_tokens: null, known: false }
}

function addUsage(total, usage) {
  if (!isObject(usage) || usage.known !== true) return { total, overflow: false }
  const input = total.input_tokens === null ? usage.input_tokens : total.input_tokens + usage.input_tokens
  const output = total.output_tokens === null ? usage.output_tokens : total.output_tokens + usage.output_tokens
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output)) return { total, overflow: true }
  return { total: { input_tokens: input, output_tokens: output, known: true }, overflow: false }
}

function failure(error, { attempts = 0, usage = unknownUsage(), reported_model = null } = {}) {
  const code = error && typeof error.code === 'string' ? error.code : 'E_PROVIDER_FAILED'
  const message = error && typeof error.message === 'string' ? error.message : 'provider request failed'
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: error && error.retryable !== undefined ? error.retryable === true : false,
      retry_after: error && error.retry_after !== undefined ? error.retry_after : null,
    },
    identity: 'failed',
    identity_source: 'none',
    reason: message,
    reported_model,
    usage,
    attempts,
  }
}

function finish(result, secret) {
  return redact(result, secret === undefined || secret === '' ? { secrets: [] } : { secrets: [secret] })
}

function envNameFor(config) {
  if (!isObject(config)) throw invalid('config is required')
  for (const key of ['apiKey', 'api_key', 'token', 'secret', 'password']) {
    if (typeof config[key] === 'string' && config[key] !== '') {
      throw codedError('E_CONFIG_SECRET_INLINE', 'inline credential is not allowed', { retryable: false })
    }
  }
  const name = config.apiKeyEnv
  if (typeof name !== 'string' || name === '') throw invalid('apiKeyEnv is required')
  if (SECRET_SHAPE_RE.test(name) || CONTROL_RE.test(name)) {
    throw codedError('E_CONFIG_SECRET_INLINE', 'apiKeyEnv must be an environment variable name', { retryable: false })
  }
  if (!ENV_NAME_RE.test(name)) throw invalid('apiKeyEnv must be an environment variable name')
  return name
}

function readSecret(ctx, config, descriptor, envName) {
  const existing = isObject(config.secrets) ? config.secrets[descriptor.provider] : undefined
  if (typeof existing === 'string' && existing !== '') {
    throw codedError('E_CONFIG_SECRET_INLINE', 'inline credential is not allowed', { retryable: false })
  }
  const secrets = isObject(config.secrets) ? { ...config.secrets } : {}
  secrets[descriptor.provider] = { ref: `env:${envName}` }
  const view = { ...config, secrets }
  let secret
  try {
    secret = resolveSecret(ctx, view, descriptor.provider)
  } catch {
    throw backendError('secret backend unavailable')
  }
  if (typeof secret !== 'string' || secret === '') {
    throw backendError(`missing environment variable: ${envName}`)
  }
  return secret
}

async function readResponseText(response) {
  if (response && typeof response.text === 'function') {
    const text = await response.text()
    return typeof text === 'string' ? text : JSON.stringify(text)
  }
  if (response && typeof response.json === 'function') {
    return JSON.stringify(await response.json())
  }
  throw new Error('response has no body reader')
}

function headerValue(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    return value === undefined ? null : value
  }
  if (headers instanceof Map) {
    const value = headers.get(name)
    return value === undefined ? null : value
  }
  if (typeof headers === 'object') {
    const wanted = name.toLowerCase()
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === wanted) return headers[key]
    }
  }
  return null
}

function parseRetryAfter(headers, ctx) {
  const raw = headerValue(headers, 'retry-after')
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const value = raw.trim()
  if (value.startsWith('-')) return null
  if (/^\d+$/.test(value)) {
    const seconds = Number(value)
    if (!Number.isSafeInteger(seconds)) return null
    const at = ctx.clock.now() + seconds * 1000
    const date = new Date(at)
    if (!Number.isFinite(at) || Number.isNaN(date.getTime())) return null
    return date.toISOString()
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString()
}

function quotaEvidence(body) {
  if (!isObject(body) || !isObject(body.error)) return false
  const parts = [body.error.code, body.error.type, body.error.message]
    .filter((value) => typeof value === 'string' && value !== '')
  if (parts.length === 0) return false
  const text = parts.join(' ')
  return /(?:insufficient|exceeded|out[_\s-]of|no)[_\s-]*(?:quota|balance|credit|credits|funds)/i.test(text)
    || /(?:quota|balance|credit|credits)[_\s-]*(?:exhausted|exceeded|insufficient|depleted)/i.test(text)
    || /payment_required|billing/i.test(text)
}

function replyText(body) {
  if (!isObject(body) || !Array.isArray(body.choices) || body.choices.length === 0) return null
  const choice = body.choices[0]
  if (!isObject(choice) || !isObject(choice.message)) return null
  const content = choice.message.content
  return typeof content === 'string' && content !== '' ? content : null
}

function statusOutcome(status, body, headers, ctx) {
  if (status >= 300 && status < 400) return { kind: 'redirect' }
  if (status === 401 || status === 403) return { kind: 'auth' }
  if (status === 429) return { kind: 'quota', retry_after: parseRetryAfter(headers, ctx) }
  if (status === 402) return { kind: 'quota', retry_after: null }
  if (status >= 500 && status <= 599) {
    if (quotaEvidence(body)) return { kind: 'quota', retry_after: null }
    return { kind: 'server' }
  }
  if (status >= 400 && status < 500) {
    if (quotaEvidence(body)) return { kind: 'quota', retry_after: null }
    return { kind: 'request' }
  }
  if (status < 200 || status >= 300) return { kind: 'request' }
  return { kind: 'ok' }
}

async function attemptOnce({ ctx, request, secret, timeoutMs, identityHook, usageHook }) {
  const controller = new AbortController()
  let settled = false
  let timedOut = false
  const timer = ctx.clock.setTimeout(() => {
    if (settled) return
    timedOut = true
    controller.abort()
  }, timeoutMs)

  let response
  let text
  try {
    response = await ctx.fetch(request.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ model: request.model, messages: request.messages, stream: false }),
      redirect: 'manual',
      signal: controller.signal,
    })
    if (timedOut) return { kind: 'timeout' }
    text = await readResponseText(response)
    if (timedOut) return { kind: 'timeout' }
    settled = true
  } catch (error) {
    if (timedOut || (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR'))) {
      return { kind: 'timeout' }
    }
    return { kind: 'network' }
  } finally {
    settled = true
    ctx.clock.clearTimeout(timer)
  }

  const status = response ? response.status : undefined
  let body = null
  let parseError = false
  if (typeof text === 'string' && text.trim() !== '') {
    try {
      body = JSON.parse(text)
    } catch {
      parseError = true
    }
  }
  const usage = parseError ? unknownUsage() : usageHook(body)
  if (!Number.isInteger(status)) return { kind: 'decode', usage }

  const outcome = statusOutcome(status, body, response ? response.headers : null, ctx)
  if (outcome.kind !== 'ok') return { ...outcome, usage }
  if (parseError) return { kind: 'decode', usage }

  const reply = replyText(body)
  if (reply === null) return { kind: 'structure', usage }

  const identity = identityHook({ request_model: request.model, response_model: body.model })
  return { kind: 'success', reply, identity, usage }
}

function messageFor(kind) {
  switch (kind) {
    case 'auth':
      return 'provider authentication failed'
    case 'quota':
      return 'provider quota exhausted'
    case 'request':
      return 'provider rejected the request'
    case 'server':
      return 'provider request failed'
    case 'timeout':
      return 'provider request timed out'
    case 'redirect':
      return 'provider redirect is not allowed'
    case 'network':
      return 'provider request failed'
    case 'decode':
      return 'provider response could not be decoded'
    case 'structure':
      return 'provider response is missing the required reply'
    default:
      return 'provider request failed'
  }
}

function errorFor(kind, outcome, secondAttempt) {
  if (kind === 'auth') return codedError('E_PROVIDER_AUTH', messageFor(kind), { retryable: false })
  if (kind === 'quota') {
    return codedError('E_PROVIDER_QUOTA', messageFor(kind), {
      retryable: false,
      retry_after: outcome.retry_after === undefined ? null : outcome.retry_after,
    })
  }
  if (kind === 'request') return codedError('E_REQUEST_INVALID', messageFor(kind), { retryable: false })
  if (kind === 'server') {
    return codedError('E_PROVIDER_FAILED', messageFor(kind), { retryable: secondAttempt ? true : false })
  }
  if (kind === 'timeout') return codedError('E_TIMEOUT', messageFor(kind), { retryable: true })
  return codedError('E_PROVIDER_FAILED', messageFor(kind), { retryable: false })
}

/**
 * Runs one logical HTTP provider call: local validation, credential reference resolution, a
 * non-streaming JSON POST through ctx.fetch, identity/usage extraction and at most one immediate
 * retry for a 5xx response or a timeout. The returned object is already redacted.
 */
export async function callHttpProvider({
  descriptor,
  config,
  model,
  ctx,
  messages,
  timeout_ms,
} = {}) {
  let secret
  let request
  let timeoutMs

  try {
    if (!ctx || typeof ctx.fetch !== 'function' || !ctx.clock) throw invalid('ctx with fetch and clock is required')
    request = validateHttpRequest(descriptor, { model, messages, timeout_ms })
    const envName = envNameFor(config)
    assertChannelIsolation(config, { descriptor, model })
    timeoutMs = timeout_ms === undefined
      ? (typeof descriptor.default_timeout_ms === 'number' ? descriptor.default_timeout_ms : DEFAULT_TIMEOUT_MS)
      : timeout_ms
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw invalid('timeout_ms must be a positive integer')
    secret = readSecret(ctx, config, descriptor, envName)
  } catch (error) {
    return finish(failure(error, { attempts: 0 }), secret)
  }

  const identityHook = typeof descriptor.identity_hook === 'function' ? descriptor.identity_hook : identityFromResponse
  const usageHook = typeof descriptor.usage_hook === 'function' ? descriptor.usage_hook : usageFromResponse
  let attempts = 0
  let usage = unknownUsage()

  for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
    attempts += 1
    let outcome
    try {
      outcome = await attemptOnce({ ctx, request, secret, timeoutMs, identityHook, usageHook })
    } catch {
      return finish(failure(codedError('E_PROVIDER_FAILED', messageFor('network'), { retryable: false }), {
        attempts,
        usage,
      }), secret)
    }

    const added = addUsage(usage, outcome.usage)
    if (added.overflow) {
      return finish(failure(codedError('E_PROVIDER_FAILED', 'usage total exceeds the safe integer range', {
        retryable: false,
      }), { attempts, usage: unknownUsage() }), secret)
    }
    usage = added.total

    if (outcome.kind === 'success') {
      return finish({
        ok: true,
        reply: outcome.reply,
        model: request.model,
        reported_model: outcome.identity.reported_model,
        identity: outcome.identity.identity,
        identity_source: outcome.identity.identity_source,
        reason: outcome.identity.reason,
        usage,
        attempts,
      }, secret)
    }

    const retryable = outcome.kind === 'server' || outcome.kind === 'timeout'
    if (retryable && index === 0) continue
    const error = errorFor(outcome.kind, outcome, index > 0)
    return finish(failure(error, { attempts, usage }), secret)
  }

  return finish(failure(codedError('E_PROVIDER_FAILED', 'provider request failed', { retryable: false }), {
    attempts,
    usage,
  }), secret)
}
