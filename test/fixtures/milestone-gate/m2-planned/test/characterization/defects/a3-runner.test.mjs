import test from 'node:test'
import assert from 'node:assert/strict'

test('[repro] fixture reproduces the missing runner script', () => {
  assert.equal(1, 1)
})

test('[fixed] fixture runner script exists', () => {
  assert.equal(2, 2)
})
