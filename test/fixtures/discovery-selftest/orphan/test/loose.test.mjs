import test from 'node:test'
import assert from 'node:assert/strict'

test('loose test outside the discovered directories', () => {
  assert.equal(5, 5)
})
