import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('[AC-032] real CLI reports an absent default credential as unset', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-secret-status-'))
  try {
    const config = path.join(temp, 'config.json')
    fs.writeFileSync(config, JSON.stringify({ providers: {}, models: {}, state_dir: path.join(temp, 'state') }), 'utf8')
    const preload = path.join(temp, 'preload.mjs')
    fs.writeFileSync(preload, `import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
const original = cp.spawnSync
cp.spawnSync = (command, args, options) => {
  if (command === 'secret-tool') return { status: 1, stdout: '', stderr: '' }
  if (command === 'security') return { status: 44, stdout: '', stderr: '' }
  return original(command, args, options)
}
syncBuiltinESMExports()
`, 'utf8')
    const result = spawnSync(process.execPath, [path.join(root, 'bin/cliworker.mjs'), 'auth', 'status', 'kimi', '--config', config], {
      encoding: 'utf8', windowsHide: true, env: { ...process.env, CLIWORKER_HOME: path.join(temp, 'home'), NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` },
    })
    assert.equal(result.status, 0, `child command failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, state: 'unset' })
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
