import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { enumerateTestFiles, findOrphans } from '../../../scripts/run-tests.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')
const DISCOVERY_ROOTS = /^test\/(unit|integration|contract|e2e|smoke|characterization|flows)\//

// 0.1 shipped without package.json scripts and kept its only test file flat in test/.
// The 0.1 copy itself is owned by another task, so the shape is inlined here on purpose.
const V01 = {
  scripts: null,
  testFiles: ['test/select.test.mjs'],
}

test('[repro] 0.1 has no test script and a test file outside the discovery roots', () => {
  assert.equal(V01.scripts, null)
  assert.deepEqual(V01.testFiles, ['test/select.test.mjs'])
  assert.ok(V01.testFiles.every((file) => !DISCOVERY_ROOTS.test(file)))
})

test('[fixed] package.json exposes test, check, perf and snapshot:update', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.ok(pkg.scripts, 'package.json must have scripts')
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ['check', 'perf', 'snapshot:update', 'test'])
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.mjs')
  assert.equal(pkg.scripts.check, 'node scripts/check-fast.mjs')
  assert.equal(pkg.scripts.perf, 'node scripts/run-tests.mjs --perf')
  assert.equal(pkg.scripts['snapshot:update'], 'node scripts/run-tests.mjs --update-snapshots')
})

test('[fixed] the migrated select test is discovered and no test file is orphaned', () => {
  const files = enumerateTestFiles(ROOT)
  assert.ok(files.includes('test/unit/select.test.mjs'), `discovered: ${files.join(',')}`)
  assert.deepEqual(findOrphans(ROOT), [])
  assert.equal(fs.existsSync(path.join(ROOT, 'test', 'select.test.mjs')), false)
})
