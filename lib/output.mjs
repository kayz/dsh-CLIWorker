// CLI output helpers: coded errors, the error envelope and the exit code mapping. The code table
// lives in the frozen registry, so this module only reads it. Zero dependencies.

import { getCode } from './contract/registry.mjs'

const FALLBACK = 'E_INTERNAL'

function entryFor(code) {
  return getCode(code) || getCode(FALLBACK)
}

/** An Error carrying a registry code and, optionally, retry metadata. */
export function codedError(code, message, extra) {
  const error = new Error(message)
  error.code = code
  const more = extra || {}
  if (more.retryable !== undefined) error.retryable = more.retryable
  if (more.retry_after !== undefined) error.retry_after = more.retry_after
  return error
}

/** The registry exit code of `code`, or 1 for a code the registry does not know. */
export function exitCodeFor(code) {
  const entry = getCode(code)
  return entry ? entry.exit : 1
}

/** The `{ok:false, error}` envelope for a code, with the registry defaults filled in. */
export function errorBody(code, message, extra) {
  const entry = entryFor(code)
  const more = extra || {}
  return {
    ok: false,
    error: {
      code: entry.code,
      message: String(message),
      retryable: more.retryable === undefined ? entry.retryable : !!more.retryable,
      retry_after: more.retry_after === undefined ? null : more.retry_after,
    },
  }
}

/** The envelope for a thrown value: known codes are kept, anything else becomes E_INTERNAL. */
export function errorBodyFrom(e) {
  const object = e !== null && typeof e === 'object'
  const message = object && typeof e.message === 'string' ? e.message : String(e)
  const extra = {}
  if (object && e.retryable !== undefined) extra.retryable = e.retryable
  if (object && e.retry_after !== undefined) extra.retry_after = e.retry_after
  if (object && typeof e.code === 'string' && getCode(e.code)) return errorBody(e.code, message, extra)
  return errorBody(FALLBACK, message)
}

/** Write one JSON value followed by a newline, the shape every command already used. */
export function writeJson(ctx, value) {
  ctx.stdout.write(JSON.stringify(value, null, 2) + '\n')
}
