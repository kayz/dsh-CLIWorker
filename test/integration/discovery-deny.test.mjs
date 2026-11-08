// AC-039: the deny list keeps listed paths out of every read and discovery result.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFsx } from '../../lib/fsx.mjs'
import { scanLocal } from '../../lib/discovery/scan.mjs'

function recordingFs() {
  const calls = []
  return {
    calls,
    lstatSync(file) {
      calls.push(['lstat', file])
      return { isSymbolicLink: () => false }
    },
    readdirSync(dir) {
      calls.push(['readdir', dir])
      if (dir === '/bin') return ['claude']
      if (dir === '/secret') {
        const error = new Error('EACCES')
        error.code = 'EACCES'
        throw error
      }
      return []
    },
    statSync(file) {
      calls.push(['stat', file])
      return { size: 3, mtime: new Date('2026-01-01T00:00:00Z'), isFile: () => true }
    },
    readFileSync(file) {
      calls.push(['readFile', file])
      return 'contents'
    },
  }
}

test('[AC-039] a denied path is rejected before the underlying fs is touched and allowed paths still read', () => {
  const fs = recordingFs()
  const io = createFsx(fs, { platform: 'linux', deny: ['/secret'] })

  assert.throws(() => io.readFileSync('/secret/key'), { code: 'EACCES' })
  assert.throws(() => io.readdirSync('/secret'), { code: 'EACCES' })
  assert.throws(() => io.statSync('/secret/key'), { code: 'EACCES' })
  assert.deepEqual(fs.calls, [])

  assert.equal(io.readFileSync('/etc/ok'), 'contents')
  assert.deepEqual(fs.calls.map(([op, file]) => `${op}:${file}`), [
    'lstat:/etc',
    'lstat:/etc/ok',
    'readFile:/etc/ok',
  ])
})

test('[AC-039] a symlink whose target is denied is rejected without reading the target', () => {
  const calls = []
  const fs = {
    lstatSync(file) {
      calls.push(['lstat', file])
      return { isSymbolicLink: () => file === '/safe/link' }
    },
    readlinkSync(file) {
      calls.push(['readlink', file])
      return '/secret/key'
    },
    statSync(file) {
      calls.push(['stat', file])
      return {}
    },
    readFileSync(file) {
      calls.push(['readFile', file])
      return 'should not happen'
    },
  }
  const io = createFsx(fs, { platform: 'linux', deny: ['/secret'] })
  assert.throws(() => io.readFileSync('/safe/link'), { code: 'EACCES' })
  assert.deepEqual(calls, [
    ['lstat', '/safe'],
    ['lstat', '/safe/link'],
    ['readlink', '/safe/link'],
  ])
})

test('[AC-039] deny matches directory boundaries and Windows paths case-insensitively', () => {
  const fs = recordingFs()
  const windows = createFsx(fs, { platform: 'win32', deny: ['C:\\Secret'] })
  assert.equal(windows.allowed('c:/SECRET/child'), false)
  assert.equal(windows.allowed('C:/Secret-other'), true)
  assert.equal(windows.allowed('C:/Secret'), false)

  const posix = createFsx(fs, { platform: 'linux', deny: ['/secret'] })
  assert.equal(posix.allowed('/secret-neighbour/key'), true)
  assert.equal(posix.allowed('/secret/child'), false)
})

test('[AC-039] a denied directory is absent from scan results and reported as a failed directory', () => {
  const fs = recordingFs()
  const io = createFsx(fs, { platform: 'linux', deny: ['/secret'] })
  const result = scanLocal(io, {
    platform: 'linux',
    env: { PATH: '/bin:/secret' },
    discovery: { extra_dirs: [], unknown_patterns: [], cli_overrides: {} },
  })
  assert.deepEqual(result.candidates.map(item => item.realpath), ['/bin/claude'])
  assert.deepEqual(result.failed, ['/secret'])
  assert.ok(!fs.calls.some(([op, file]) => op === 'readdir' && file === '/secret'))
  assert.ok(!fs.calls.some(([op]) => op === 'readFile'))
})
