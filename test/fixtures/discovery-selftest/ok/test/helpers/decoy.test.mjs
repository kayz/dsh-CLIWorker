import test from 'node:test'
import assert from 'node:assert/strict'

test('decoy under test/helpers must never execute', () => {
  assert.fail('decoy executed')
})
