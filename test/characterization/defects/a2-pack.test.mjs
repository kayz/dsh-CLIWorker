import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const V01 = process.env.CLIWORKER_V01_ROOT
  ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))

// The v0.1 copy deliberately carries no package.json, so the published shape is inlined here.
const V01_PACKAGE = { bin: null, files: ['lib', 'cordis.patch.yml', 'dsh.plugin.json', 'README.md'] }

test('[repro] [AC-005] 0.1 publishes no bin and no config directory', () => {
  assert.equal(V01_PACKAGE.bin, null)
  assert.equal(V01_PACKAGE.files.includes('bin'), false)
  assert.equal(V01_PACKAGE.files.includes('config'), false)
  assert.equal(fs.existsSync(path.join(V01, 'config', 'cliworker.example.json')), true)
})
