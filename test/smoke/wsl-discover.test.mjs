import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createContext } from '../../lib/context.mjs'
import { run } from '../../lib/commands/discover.mjs'
import { parseDistros } from '../../lib/discovery/wsl.mjs'
import { spawnSync } from 'node:child_process'
import { realWsl } from '../../scripts/smoke-real.mjs'
import { leakScan, makeSentinel } from '../helpers/leak-scan.mjs'

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
    const env = { ...process.env }
    delete env.CLIWORKER_SMOKE
    const child = spawnSync(process.execPath, ['scripts/smoke-real.mjs', '--dry-run'], { env, encoding: 'utf8', timeout: 240000, windowsHide: true })
    assert.ifError(child.error)
    assert.equal(child.status, 0)
    const report = JSON.parse(child.stdout)
    assert.equal(report.mode, 'dry-run')
    assert.deepEqual(report.steps[1].ac, ['AC-038'])
    assert.equal(report.steps[1].status, 'pass')
    assert.equal(report.steps[1].mandatory, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

if (process.env.CLIWORKER_SMOKE === '1') {
  test('[AC-038] real WSL distributions and in-distribution inventories', async () => {
    assert.equal(process.platform, 'win32', 'real WSL acceptance requires Windows')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker real wsl '))
    try {
      const captured = { stdout: [], stderr: [], argv: [], http: [] }
      const sentinel = makeSentinel('WSL')
      const env = { HOME: root, USERPROFILE: root, CLIWORKER_HOME: root, CW_FLOW_SENTINEL: sentinel }
      for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'SYSTEMDRIVE']) if (process.env[key]) env[key] = process.env[key]
      await realWsl(root, env, captured, process.env.PATH || process.env.Path || '')
      assert.equal(leakScan({ sentinels: [{ label: 'WSL', value: sentinel }], ...captured, state_dir: root }).ok, true)
      const result = spawnSync(process.execPath, ['scripts/smoke-real.mjs', '--dry-run'], { encoding: 'utf8', timeout: 240000, windowsHide: true })
      assert.ifError(result.error)
      assert.equal(result.status, 0)
      const report = JSON.parse(result.stdout)
      assert.equal(report.mode, 'dry-run')
      assert.deepEqual(report.steps[1].ac, ['AC-038'])
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
}
