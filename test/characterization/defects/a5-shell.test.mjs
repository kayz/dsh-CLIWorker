import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createExec } from '../../../lib/exec.mjs'
import { checkProvider } from '../../../lib/availability.mjs'

const V01 = process.env.CLIWORKER_V01_ROOT
  ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))

test('[repro] [AC-005] availability always runs through a shell on win32', () => {
  const source = fs.readFileSync(path.join(V01, 'lib', 'availability.mjs'), 'utf8')
  assert.match(source, /shell:\s*process\.platform\s*===\s*'win32'/)
})

test('[fixed] [AC-026] live availability never enables a shell and exec never derives it from the platform', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const calls = []
  const store = { existsSync: () => false, readFileSync: () => { throw new Error('ENOENT') } }
  const exec = createExec({
    platform: 'win32',
    fs: store,
    env: {},
    spawnSync: (file, args, options) => {
      calls.push({ file, args, options })
      return { status: 0, stdout: 'cli 1.2.3', stderr: '', error: null }
    },
  })
  const ctx = { exec: exec.runSync, fs: store, env: {}, platform: 'win32' }
  const status = checkProvider({ cli: 'p1cli' }, { ctx })

  assert.equal(status.state, 'callable')
  assert.equal(status.version, '1.2.3')
  assert.ok(calls.length >= 1, 'availability probed the CLI')
  for (const call of calls) assert.equal(call.options.shell, false, `${call.file} ran with a shell`)

  const source = fs.readFileSync(path.join(root, 'lib', 'exec.mjs'), 'utf8')
  assert.equal(/shell:\s*process\.platform/.test(source), false, 'exec.mjs must not enable a shell by platform')
  assert.equal(/shell:\s*true/.test(source), false, 'exec.mjs must not enable a shell at all')
})
