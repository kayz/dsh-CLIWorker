import { isDeepStrictEqual } from 'node:util'

// Probe age is deliberately derived from evidence rather than the refreshed last_seen.
export function canReuse(previous, fingerprint, now, ttlSeconds, full = false) {
  if (full || !previous || !isDeepStrictEqual(previous.fingerprint, fingerprint)) return false
  const evidence = previous.evidence?.filter(item => item.kind === 'probe').at(-1)
  if (!evidence) return false
  const at = Date.parse(evidence.at)
  const age = now - at
  return Number.isFinite(at) && age >= 0 && age < ttlSeconds * 1000
}

export function markGone(entry) {
  return { ...entry, status: 'gone' }
}
