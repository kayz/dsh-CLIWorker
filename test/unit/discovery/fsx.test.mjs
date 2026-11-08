import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFsx } from '../../../lib/fsx.mjs'
import { detectHost, detectPlatform } from '../../../lib/discovery/platform.mjs'

test('denied paths and symlink targets are rejected before underlying access', () => {
  const calls = []
  const fs = {
    lstatSync(file) {
      calls.push(file)
      return { isSymbolicLink: () => file === '/safe/link' }
    },
    readlinkSync() { return '/secret/key' },
    statSync(file) { calls.push(file); return {} },
  }
  const io = createFsx(fs, { deny: ['/secret'] })
  assert.throws(() => io.statSync('/secret/../secret/key'), { code: 'EACCES' })
  assert.throws(() => io.statSync('/safe/link'), { code: 'EACCES' })
  assert.deepEqual(calls, ['/safe', '/safe/link'])
  io.statSync('/secret-neighbour/key')
  assert.ok(calls.includes('/secret-neighbour/key'))
  const windows = createFsx(fs, { platform: 'win32', deny: ['C:\\Secret'] })
  assert.equal(windows.allowed('c:/SECRET/child'), false)
  assert.equal(windows.allowed('C:/Secret-other'), true)
})

test('platform detection uses injected evidence', () => {
  let reads = 0
  const fsx = { readFileSync() { reads += 1; return 'Microsoft' } }
  assert.equal(detectPlatform({ platform: 'win32', env: { WSL_DISTRO_NAME: 'x' } }, fsx), 'win32')
  assert.equal(detectPlatform({ platform: 'linux', env: { WSL_DISTRO_NAME: '测试' } }, fsx), 'wsl:测试')
  assert.equal(detectPlatform({ platform: 'linux', env: {} }, fsx), 'linux')
  assert.deepEqual(detectHost({ platform: 'linux', env: {} }, fsx), { platform: 'linux', wsl: true })
  assert.equal(reads, 2)
})
