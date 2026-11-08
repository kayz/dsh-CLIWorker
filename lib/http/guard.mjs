import { decideGate, getCode } from '../contract/registry.mjs'
import { errorBody } from '../output.mjs'
import { isLoopbackRequest } from './security.mjs'

/** Check only headers and connection metadata; never consume the body here. */
export function gateRequest(route, req, sessions, readonly) {
  const session = req.headers?.['x-cliworker-session']
  const sessionValid = sessions.valid(session)
  return decideGate({
    route: route.level,
    session_valid: sessionValid,
    loopback_ok: route.level === 'bootstrap' && isLoopbackRequest(req),
    readonly: readonly === true,
    csrf_valid: sessionValid && readonly !== true && sessions.validCsrf(session, req.headers?.['x-cliworker-csrf']),
  })
}

export function sendJson(res, body, status = 200) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export function sendError(res, code) {
  const entry = getCode(code) || getCode('E_INTERNAL')
  sendJson(res, errorBody(entry.code, entry.code), entry.http_status)
}

/** Bound input in bytes and drain oversized streams without destroying the response. */
export function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > 2_000_000) {
        if (!tooLarge) { tooLarge = true; chunks.length = 0; reject(new Error('invalid request')) }
        return
      }
      if (!tooLarge) chunks.push(bytes)
    })
    req.on('end', () => {
      if (tooLarge) { reject(new Error('invalid request')); return }
      try { resolve(size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch { reject(new Error('invalid request')) }
    })
    req.on('error', reject)
  })
}
