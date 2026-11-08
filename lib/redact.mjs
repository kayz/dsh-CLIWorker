// Secret redaction: returns a copy of any value whose strings carry no credentials. Pure: no IO,
// no clock, no timers, nothing to inject.

export const REDACTED = '[REDACTED]'

const SK_RE = /(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]{8,}/g
const BEARER_RE = /\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi
const JWT_RE = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g

/** Usable secret values, de-duplicated and ordered longest first. */
function secretList(secrets) {
  const list = []
  for (const value of Array.isArray(secrets) ? secrets : []) {
    if (typeof value !== 'string' || value === '') continue
    if (!list.includes(value)) list.push(value)
  }
  list.sort((a, b) => b.length - a.length)
  return list
}

/** One string with every known secret shape replaced by the marker. */
export function redactString(text, secrets = []) {
  let out = String(text)
  for (const secret of secretList(secrets)) out = out.split(secret).join(REDACTED)
  out = out.replace(SK_RE, REDACTED)
  out = out.replace(BEARER_RE, (match, word) => `${word} ${REDACTED}`)
  out = out.replace(JWT_RE, REDACTED)
  return out
}

function walk(value, secrets, seen) {
  if (typeof value === 'string') return redactString(value, secrets)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (value instanceof Error) {
    const out = {
      name: redactString(String(value.name), secrets),
      message: redactString(String(value.message), secrets),
    }
    if (value.code !== undefined) out.code = walk(value.code, secrets, seen)
    return out
  }

  if (Array.isArray(value)) {
    const out = []
    for (const item of value) out.push(walk(item, secrets, seen))
    return out
  }

  const out = {}
  for (const key of Object.keys(value)) out[redactString(key, secrets)] = walk(value[key], secrets, seen)
  return out
}

/** A deep, redacted copy of `value`. The input is never modified. */
export function redact(value, { secrets = [] } = {}) {
  return walk(value, secretList(secrets), new Set())
}

/** A mutable registry of known secret values. */
export function createSecretRegistry() {
  const values = []
  return {
    add(value) {
      if (typeof value !== 'string' || value === '') return
      if (!values.includes(value)) values.push(value)
    },
    list() {
      return values.slice()
    },
    redact(value) {
      return redact(value, { secrets: values })
    },
  }
}
