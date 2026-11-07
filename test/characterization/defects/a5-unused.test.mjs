import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const V01 = process.env.CLIWORKER_V01_ROOT
  ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))

test('[repro] [AC-005] a dead helper and an unused fs import survive in 0.1', () => {
  const selectSource = fs.readFileSync(path.join(V01, 'lib', 'select.mjs'), 'utf8')
  assert.equal(selectSource.split('isObject').length - 1, 1)

  const cliSource = fs.readFileSync(path.join(V01, 'lib', 'cli.mjs'), 'utf8')
  assert.match(cliSource, /import fs from/)
  assert.equal(cliSource.includes('fs.'), false)
})
