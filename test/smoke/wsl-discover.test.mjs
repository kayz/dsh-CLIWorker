import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createContext } from '../../lib/context.mjs'
import { run } from '../../lib/commands/discover.mjs'
import { parseDistros } from '../../lib/discovery/wsl.mjs'

test('[AC-038] WSL fixture passes through discover', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-wsl-fixture-'))
  try {
    const bytes = Buffer.from('\uFEFFUbuntu\0\r\nSpace Distro\r\nUbuntu\r\n', 'utf16le')
    const expected = ['Ubuntu', 'Space Distro']
    assert.deepEqual(parseDistros(bytes), expected)
    assert.deepEqual(parseDistros(bytes.subarray(2)), expected)
    const calls = []
    const ctx = createContext({
      platform: 'win32', env: { PATH: '' },
      exec(command, args) {
        calls.push([command, args])
        return { ok: true, code: 0, stdout: bytes.toString('utf16le') }
      },
    })
    const inventory = await run({ argv: [], ctx, config: { _home: root, discovery: { wsl: true } } })
    assert.deepEqual(inventory.host.wsl_distros, expected)
    assert.deepEqual(calls, [['wsl', ['-l', '-q']]])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
