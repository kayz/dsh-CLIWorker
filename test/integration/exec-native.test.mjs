import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createExec } from '../../lib/exec.mjs'
import { platformTest } from '../helpers/platform-gate.mjs'

const FIXTURES = fileURLToPath(new URL('../fixtures/exec/', import.meta.url))
const ARGS = ['a&b', 'two words', 'p|q', 'c^d', '50%', 'bang!', 'say "hi"', 'semi;colon', 'back`tick']

function record(calls, via, run) {
  return (file, args, options) => {
    calls.push({ via, file, args, options })
    return run(file, args, options)
  }
}

platformTest(
  '[AC-027] a generated win32 .cmd shim is parsed and node runs with the exact argv',
  { ac: 'AC-027', requires: 'win32', file: import.meta.url },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-exec-native-'))
    try {
      const shim = path.join(dir, 'foo.cmd')
      const marker = path.join(dir, 'cmd-ran.marker')
      // The sample points at foo.js; the generated shim targets the fixture script foo.mjs.
      const template = fs
        .readFileSync(path.join(FIXTURES, 'shims', 'npm-v7.cmd.txt'), 'utf8')
        .replace('foo.js', 'foo.mjs')
      fs.writeFileSync(shim, `${template}@ECHO ran> "%dp0%\cmd-ran.marker"\n`)

      const bin = path.join(dir, 'node_modules', 'foo', 'bin')
      fs.mkdirSync(bin, { recursive: true })
      fs.copyFileSync(path.join(FIXTURES, 'argv-recorder.mjs'), path.join(bin, 'foo.mjs'))

      const calls = []
      const exec = createExec({
        platform: 'win32',
        fs: {
          existsSync: (target) => fs.existsSync(target),
          readFileSync: (target, encoding) => fs.readFileSync(target, encoding),
        },
        env: { ...process.env, Path: dir },
        nodePath: process.execPath,
        spawn: record(calls, 'spawn', spawn),
        spawnSync: record(calls, 'spawnSync', spawnSync),
        clock: {
          setTimeout: (fn, ms) => setTimeout(fn, ms),
          clearTimeout: (handle) => clearTimeout(handle),
        },
      })

      const syncResult = exec.runSync(shim, ARGS, { timeout: 30_000 })
      assert.equal(syncResult.ok, true, syncResult.error)
      assert.deepEqual(JSON.parse(syncResult.stdout), ARGS)

      const asyncResult = await exec.runAsync(shim, ARGS, { timeout: 30_000 })
      assert.equal(asyncResult.ok, true, asyncResult.error)
      assert.deepEqual(JSON.parse(asyncResult.stdout), ARGS)

      assert.equal(fs.existsSync(marker), false, 'cmd.exe must never have run the batch file')

      const spawned = calls.filter((call) => call.via === 'spawn')
      assert.equal(spawned.length, 1)
      assert.equal(spawned[0].file, process.execPath)
      for (const call of calls) {
        assert.notEqual(path.win32.basename(String(call.file)).toLowerCase(), 'cmd.exe', `${call.via} ran cmd.exe`)
        assert.equal(call.options.shell, false, `${call.via} ${call.file} ran with a shell`)
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
)
