import test from 'node:test'
import assert from 'node:assert/strict'

test('[AC-002] a different AC is tagged here', () => {
  assert.equal(1, 1)
})

test.skip('[AC-001] a skipped title does not count', () => {
  assert.fail('never runs')
})
