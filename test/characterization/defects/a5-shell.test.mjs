import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const V01 = process.env.CLIWORKER_V01_ROOT
  ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))

test('[repro] [AC-005] availability always runs through a shell on win32', () => {
  const source = fs.readFileSync(path.join(V01, 'lib', 'availability.mjs'), 'utf8')
  assert.match(source, /shell:\s*process\.platform\s*===\s*'win32'/)
})
