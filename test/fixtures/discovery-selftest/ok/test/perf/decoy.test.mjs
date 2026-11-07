import test from 'node:test'
import assert from 'node:assert/strict'

test('decoy under test/perf must never execute', () => {
  assert.fail('decoy executed')
})
