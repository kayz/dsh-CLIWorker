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

test('[fixed] [AC-022] the live selector has no dead helper and no unused binding', async () => {
  const { scanPaths } = await import('../../../scripts/check-unused.mjs')
  const root = fileURLToPath(new URL('../../../', import.meta.url))

  const source = fs.readFileSync(path.join(root, 'lib', 'select.mjs'), 'utf8')
  assert.equal(source.split('isObject').length - 1, 0)

  const report = scanPaths(['lib'], { root })
  assert.deepEqual(report.items, [])
})
