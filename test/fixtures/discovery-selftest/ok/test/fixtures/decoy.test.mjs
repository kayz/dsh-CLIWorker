import test from 'node:test'
import assert from 'node:assert/strict'

test('decoy under test/fixtures must never execute', () => {
  assert.fail('decoy executed')
})
