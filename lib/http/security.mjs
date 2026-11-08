import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const SOCKETS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function authority(value) {
  if (typeof value !== 'string' || !value || /[\s/@?#\\]/.test(value)) return false
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(value)) return false
  try {
    const url = new URL(`http://${value}`)
    return HOSTS.has(url.hostname.toLowerCase()) && (!url.port || Number(url.port) <= 65535)
  } catch { return false }
}

export function isLoopbackRequest(req) {
  if (!SOCKETS.has(req?.socket?.remoteAddress) || !authority(req?.headers?.host)) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  if (typeof origin !== 'string') return false
  const match = /^https?:\/\/([^/?#]+)$/i.exec(origin)
  if (!match || !authority(match[1])) return false
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash &&
      authority(url.host)
  } catch { return false }
}

export function createSessions(clock, ttlSeconds = 43200) {
  const key = randomBytes(32)
  const sessions = new Map()
  const csrfFor = (session) => createHmac('sha256', key).update(session).digest('base64url')
  function valid(session) {
    if (typeof session !== 'string') return false
    const expiry = sessions.get(session)
    if (expiry === undefined) return false
    if (clock.now() >= expiry) { sessions.delete(session); return false }
    return true
  }
  return {
    issue() {
      const session = randomBytes(32).toString('base64url')
      const expiry = clock.now() + ttlSeconds * 1000
      sessions.set(session, expiry)
      return { schema: 'cliworker.session/v1', session, csrf: csrfFor(session), expires_at: new Date(expiry).toISOString() }
    },
    valid,
    validCsrf(session, csrf) {
      if (!valid(session) || typeof csrf !== 'string') return false
      const actual = Buffer.from(csrf)
      const expected = Buffer.from(csrfFor(session))
      return actual.length === expected.length && timingSafeEqual(actual, expected)
    },
  }
}
