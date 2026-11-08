import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canReuse, markGone } from '../../../lib/discovery/inventory.mjs'
import { findRule } from '../../../lib/discovery/rules.mjs'

test('cache expiry uses evidence time and all fingerprint fields', () => {
  const fingerprint = { size: 4, mtime: '2026-01-01T00:00:00Z', realpath: '/bin/claude' }
  const previous = { fingerprint, last_seen: '2026-01-01T02:00:00Z', evidence: [{ kind: 'probe', at: '2026-01-01T00:00:00Z' }], status: 'present' }
  const now = Date.parse('2026-01-01T01:00:00Z')
  assert.equal(canReuse(previous, fingerprint, now, 7200), true)
  assert.equal(canReuse(previous, fingerprint, now, 3600), false)
  assert.equal(canReuse(previous, fingerprint, now, 7200, true), false)
  for (const [key, value] of [['size', 5], ['mtime', null], ['realpath', '/other']]) {
    assert.equal(canReuse(previous, { ...fingerprint, [key]: value }, now, 7200), false)
  }
  assert.equal(markGone(previous).last_seen, previous.last_seen)
  assert.equal(markGone(previous).status, 'gone')
})

test('only the contract-supported executable is recognized', () => {
  assert.deepEqual(findRule('CLAUDE.EXE', 'win32')?.versionArgs, ['--version'])
  assert.equal(findRule('claude', 'linux')?.name, 'claude')
  assert.equal(findRule('other-cli', 'linux'), null)
})
