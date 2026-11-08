import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createExec } from '../../../lib/exec.mjs'
import { parseDistros } from '../../../lib/discovery/wsl.mjs'

test('WSL list decoding preserves UTF-16LE across split bytes', async () => {
  const bytes = Buffer.from('\uFEFF* Ubuntu\r\n中文 发行版\r\nUbuntu\r\n', 'utf16le')
  const expected = ['Ubuntu', '中文 发行版']
  assert.deepEqual(parseDistros(bytes), expected)
  assert.deepEqual(parseDistros(bytes.subarray(2)), expected)
  const clock = { setTimeout, clearTimeout }
  const exec = createExec({
    platform: 'linux', clock,
    spawnSync: (_file, _args, options) => {
      assert.equal(options.shell, false)
      assert.equal(options.encoding, null)
      return { status: 0, stdout: bytes, stderr: Buffer.alloc(0) }
    },
    spawn: (_file, _args, options) => {
      assert.equal(options.shell, false)
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      queueMicrotask(() => {
        child.stdout.emit('data', bytes.subarray(0, 5))
        child.stdout.emit('data', bytes.subarray(5))
        child.emit('close', 0)
      })
      return child
    },
  })
  assert.deepEqual(parseDistros(exec.runSync('wsl.exe', ['-l', '-q']).stdout), expected)
  assert.deepEqual(parseDistros((await exec.runAsync('wsl', ['-l', '-q'])).stdout), expected)
})

test('other commands retain UTF-8 execution behavior', () => {
  const exec = createExec({ platform: 'linux', spawnSync: (_file, _args, options) => {
    assert.equal(options.encoding, 'utf8')
    assert.equal(options.shell, false)
    return { status: 0, stdout: '中文', stderr: 'warning' }
  } })
  for (const [file, args] of [['other', ['-l', '-q']], ['wsl', ['--version']]]) {
    assert.deepEqual(exec.runSync(file, args), { ok: true, code: 0, stdout: '中文', stderr: 'warning', error: null, error_code: null })
  }
})
