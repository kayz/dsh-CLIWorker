// Library-internal provider descriptors for the two transports CLIWorker can address. This
// module is pure: building or querying a descriptor reads no environment variable, performs no
// network request and starts no process. Model ids are always injected by the caller; nothing
// here carries a permanent model table.

import { buildDirectCall } from '../adapters/call.mjs'
import { codedError } from '../output.mjs'

export const DEFAULT_CHAT_PATH = '/chat/completions'

const UNSAFE_NAMES = new Set(['__proto__', 'constructor', 'prototype'])
const SAFE_NAME_RE = /^[A-Za-z0-9._-]+$/
const UNSAFE_PATH_RE = /[\s?#]/

function invalid(message) {
  return codedError('E_REQUEST_INVALID', message)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSafeName(value) {
  return typeof value === 'string' && value !== '' && SAFE_NAME_RE.test(value) && !UNSAFE_NAMES.has(value)
}

/**
 * Joins a base URL and a chat path into the one endpoint an HTTP provider uses. Credentials,
 * query strings and fragments are rejected so a descriptor can never hide a secret or widen the
 * address space of a request.
 */
export function buildChatEndpoint(baseUrl, chatPath = DEFAULT_CHAT_PATH) {
  if (typeof baseUrl !== 'string' || baseUrl === '') throw invalid('base_url must be a non-empty string')
  if (typeof chatPath !== 'string' || chatPath === '' || !chatPath.startsWith('/')) {
    throw invalid('chat_path must start with /')
  }
  if (UNSAFE_PATH_RE.test(chatPath) || chatPath.includes('//')) throw invalid('chat_path is invalid')

  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw invalid('base_url is not a valid URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw invalid('base_url must use http or https')
  if (parsed.username !== '' || parsed.password !== '') throw invalid('base_url must not contain credentials')
  if (parsed.search !== '' || parsed.hash !== '') throw invalid('base_url must not contain a query or fragment')

  const base = baseUrl.replace(/\/+$/, '')
  const path = chatPath.replace(/^\/+/, '')
  return `${base}/${path}`
}

/**
 * Identity evidence from one OpenAI-compatible response. A non-empty string equal to the
 * requested model is `verified`; every other case is `observed`. Missing or invalid evidence is
 * never backfilled with the requested model, while a mismatch keeps the actual model string.
 */
export function identityFromResponse({ request_model, response_model } = {}) {
  if (typeof response_model === 'string' && response_model !== '') {
    if (response_model === request_model) {
      return {
        identity: 'verified',
        identity_source: 'response.model',
        reason: null,
        reported_model: response_model,
      }
    }
    return {
      identity: 'observed',
      identity_source: 'response.model',
      reason: 'response model does not match the requested model',
      reported_model: response_model,
    }
  }
  return {
    identity: 'observed',
    identity_source: 'response.model',
    reason: 'response did not report a usable model',
    reported_model: null,
  }
}

function tokenValue(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * Exact token mapping from an OpenAI-compatible usage object. Both prompt_tokens and
 * completion_tokens must be non-negative safe integers; otherwise the whole usage stays unknown
 * rather than becoming a fabricated zero. Cache details are ignored, so prompt_tokens is never
 * billed twice.
 */
export function usageFromResponse(response) {
  const usage = isObject(response) && isObject(response.usage) ? response.usage : null
  const input = usage === null ? null : tokenValue(usage.prompt_tokens)
  const output = usage === null ? null : tokenValue(usage.completion_tokens)
  if (input === null || output === null) {
    return { input_tokens: null, output_tokens: null, known: false }
  }
  return { input_tokens: input, output_tokens: output, known: true }
}

/**
 * An HTTP descriptor: endpoint, supported model ids and the same identity/usage hooks the client
 * executes. `supported_models` is a caller-supplied support list, not a model whitelist.
 */
export function createHttpDescriptor({
  provider,
  base_url,
  chat_path = DEFAULT_CHAT_PATH,
  supported_models,
  default_timeout_ms,
} = {}) {
  if (!isSafeName(provider)) throw invalid('provider must be a safe identifier')
  const endpoint = buildChatEndpoint(base_url, chat_path)
  if (!Array.isArray(supported_models) || supported_models.length === 0) {
    throw invalid('supported_models must be a non-empty array')
  }
  const seen = new Set()
  for (const id of supported_models) {
    if (typeof id !== 'string' || id === '') throw invalid('supported_models entries must be non-empty strings')
    if (seen.has(id)) throw invalid('supported_models entries must be unique')
    seen.add(id)
  }
  if (default_timeout_ms !== undefined && (!Number.isInteger(default_timeout_ms) || default_timeout_ms <= 0)) {
    throw invalid('default_timeout_ms must be a positive integer')
  }

  return Object.freeze({
    transport: 'http',
    provider,
    base_url,
    chat_path,
    endpoint,
    supported_models: Object.freeze([...supported_models]),
    default_timeout_ms: default_timeout_ms === undefined ? null : default_timeout_ms,
    identity_hook: identityFromResponse,
    usage_hook: usageFromResponse,
  })
}

/**
 * The first HTTP channel: DeepSeek's official OpenAI-compatible endpoint. The model ids are
 * always supplied by the caller, so this factory never becomes a permanent whitelist.
 */
export function createDeepSeekDescriptor({ supported_models, default_timeout_ms } = {}) {
  return createHttpDescriptor({
    provider: 'deepseek',
    base_url: 'https://api.deepseek.com',
    chat_path: '/chat/completions',
    supported_models,
    default_timeout_ms,
  })
}

/**
 * A CLI descriptor keeps the existing direct-call construction untouched. It adds only the
 * transport label and the declared provider identity used for source accounting.
 */
export function createCliDescriptor({ provider } = {}) {
  if (!isSafeName(provider)) throw invalid('provider must be a safe identifier')
  return Object.freeze({
    transport: 'cli',
    provider,
    buildCall(options) {
      return buildDirectCall(options)
    },
  })
}

/**
 * Validates the endpoint, the selected model against the injected support list and the request
 * shape. Every failure is E_REQUEST_INVALID and happens before any credential read or fetch.
 */
export function validateHttpRequest(descriptor, { model, messages, timeout_ms } = {}) {
  if (
    !isObject(descriptor)
    || descriptor.transport !== 'http'
    || typeof descriptor.endpoint !== 'string'
    || descriptor.endpoint === ''
    || !Array.isArray(descriptor.supported_models)
  ) {
    throw invalid('descriptor is not an http provider')
  }
  const id = isObject(model) && typeof model.id === 'string' && model.id !== '' ? model.id : null
  if (id === null) throw invalid('model id is required')
  if (!descriptor.supported_models.includes(id)) {
    throw invalid(`model ${id} is not supported by provider ${descriptor.provider}`)
  }
  if (!Array.isArray(messages) || messages.length === 0) throw invalid('messages must be a non-empty array')
  for (const message of messages) {
    if (!isObject(message)) throw invalid('each message must be an object')
  }
  if (timeout_ms !== undefined && (!Number.isInteger(timeout_ms) || timeout_ms <= 0)) {
    throw invalid('timeout_ms must be a positive integer')
  }
  return { endpoint: descriptor.endpoint, model: id, messages }
}
