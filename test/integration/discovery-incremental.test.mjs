// AC-040: incremental inventory decisions.
// The branch exposes only the cache predicate (canReuse) and the gone marker
// (markGone); there is no composed "delta" or inventory writer yet. The tests
// below apply those primitives to the documented second-pass scenarios.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canReuse, markGone } from '../../lib/discovery/inventory.mjs'

const NOW = Date.parse('2026-01-01T01:00:00Z')
const TTL = 3600

function entry(overrides = {}) {
  return {
    id: 'claude',
    first_seen: '2026-01-01T00:00:00Z',
    last_seen: '2026-01-01T00:00:00Z',
    status: 'present',
    fingerprint: { size: 10, mtime: '2026-01-01T00:00:00Z', realpath: '/bin/claude' },
    evidence: [{ kind: 'probe', at: '2026-01-01T00:30:00Z' }],
    ...overrides,
  }
}

test('[AC-040] unchanged entries inside the TTL are reused, so the second pass has an empty delta', () => {
  // First pass: no previous entry, so every candidate has to be probed.
  const first = entry()
  assert.equal(canReuse(undefined, first.fingerprint, NOW, TTL), false)

  // Second pass: same fingerprint inside the TTL, so nothing changes.
  const delta = [first].filter(item => !canReuse(item, item.fingerprint, NOW, TTL))
  assert.deepEqual(delta, [])
})

test('[AC-040] a changed size, mtime or realpath puts the entry back into the second-pass delta', () => {
  const previous = entry()
  const current = [
    { id: 'claude', fingerprint: { ...previous.fingerprint, size: 11 } },
    { id: 'claude', fingerprint: { ...previous.fingerprint, mtime: '2026-01-02T00:00:00Z' } },
    { id: 'claude', fingerprint: { ...previous.fingerprint, realpath: '/usr/bin/claude' } },
  ]
  const changed = current.filter(item => !canReuse(previous, item.fingerprint, NOW, TTL))
  assert.equal(changed.length, 3)
})

test('[AC-040] full mode bypasses the cache and expired TTL entries are re-probed', () => {
  const previous = entry()
  assert.equal(canReuse(previous, previous.fingerprint, NOW, TTL), true)
  assert.equal(canReuse(previous, previous.fingerprint, NOW, TTL, true), false)

  // 00:30 evidence with a 10 minute TTL is already stale at 01:00.
  assert.equal(canReuse(previous, previous.fingerprint, NOW, 600), false)
  // Evidence without a probe record cannot back a cache hit.
  assert.equal(canReuse(entry({ evidence: [] }), previous.fingerprint, NOW, TTL), false)
  assert.equal(canReuse(entry({ evidence: [{ kind: 'scan', at: '2026-01-01T00:30:00Z' }] }), previous.fingerprint, NOW, TTL), false)
  // Future evidence is rejected rather than treated as fresh.
  assert.equal(canReuse(entry({ evidence: [{ kind: 'probe', at: '2026-01-01T02:00:00Z' }] }), previous.fingerprint, NOW, TTL), false)
})

test('[AC-040] a disappeared entry is retained with its identity and history and marked gone', () => {
  const previous = entry()
  const gone = markGone(previous)
  assert.equal(gone.status, 'gone')
  assert.equal(gone.id, previous.id)
  assert.equal(gone.first_seen, previous.first_seen)
  assert.equal(gone.last_seen, previous.last_seen)
  assert.deepEqual(gone.fingerprint, previous.fingerprint)
  assert.deepEqual(gone.evidence, previous.evidence)
  // The original object is not mutated.
  assert.equal(previous.status, 'present')
})
