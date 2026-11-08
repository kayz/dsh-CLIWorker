// AC-036: platform identification and local CLI discovery.
// These tests exercise the discovery building blocks that exist on this branch
// (lib/discovery/platform.mjs and lib/discovery/scan.mjs). There is no
// lib/commands/discover.mjs yet, so no CLI subprocess or end-to-end command is
// asserted here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectHost, detectPlatform } from '../../lib/discovery/platform.mjs'
import { scanLocal } from '../../lib/discovery/scan.mjs'

function fakeIo(entries, { reverse = false, realpaths = {} } = {}) {
  const calls = []
  return {
    calls,
    readdirSync(dir) {
      calls.push(['readdir', dir])
      const names = entries[dir]
      if (!names) {
        const error = new Error(`ENOENT: ${dir}`)
        error.code = 'ENOENT'
        throw error
      }
      return reverse ? [...names].reverse() : [...names]
    },
    realpathSync(file) {
      calls.push(['realpath', file])
      return realpaths[file] ?? file
    },
    statSync(file) {
      calls.push(['stat', file])
      return { size: 7, mtime: new Date('2026-01-01T00:00:00Z'), isFile: () => !file.endsWith('folder') }
    },
  }
}

test('[AC-036] a fake win32 PATH discovers rule and pattern candidates and skips non-files', () => {
  const io = fakeIo({
    'C:\\bin': ['claude.exe', 'other-cli', 'notes.txt', 'folder'],
    'C:\\tools': ['claude', 'helper-cli', 'folder'],
  })
  const result = scanLocal(io, {
    platform: 'win32',
    env: { PATH: 'C:\\bin;C:\\tools' },
    discovery: {
      extra_dirs: [],
      unknown_patterns: ['*-cli'],
      cli_overrides: { claude: 'D:\\vendor\\claude.exe' },
    },
  })
  assert.deepEqual(result.failed, [])
  assert.deepEqual(
    result.candidates.map(item => item.realpath.toLowerCase()),
    [
      'c:\\bin\\claude.exe',
      'c:\\bin\\other-cli',
      'c:\\tools\\claude',
      'c:\\tools\\helper-cli',
      'd:\\vendor\\claude.exe',
    ],
  )
  assert.deepEqual(
    result.candidates.map(item => (item.rule ? item.rule.name : null)),
    ['claude', null, 'claude', null, 'claude'],
  )
  // The override still resolves to a rule even though it is outside PATH.
  assert.equal(result.candidates[4].rule.name, 'claude')
  assert.ok(!result.candidates.some(item => item.realpath.endsWith('notes.txt')))
  assert.ok(!result.candidates.some(item => item.realpath.endsWith('folder')))
})

test('[AC-036] the candidate list is sorted by normalized real path regardless of directory order', () => {
  const paths = ['/zzz', '/aaa']
  const entries = { '/zzz': ['b-cli', 'claude'], '/aaa': ['a-cli', 'claude'] }
  const result = scanLocal(fakeIo(entries), {
    platform: 'linux',
    env: { PATH: paths.join(':') },
    discovery: { extra_dirs: [], unknown_patterns: ['*-cli'], cli_overrides: {} },
  })
  assert.deepEqual(
    result.candidates.map(item => item.realpath),
    ['/aaa/a-cli', '/aaa/claude', '/zzz/b-cli', '/zzz/claude'],
  )

  const reversed = scanLocal(fakeIo(entries, { reverse: true }), {
    platform: 'linux',
    env: { PATH: [...paths].reverse().join(':') },
    discovery: { extra_dirs: [], unknown_patterns: ['*-cli'], cli_overrides: {} },
  })
  assert.deepEqual(reversed.candidates, result.candidates)
})

test('[AC-036] host detection only consults WSL evidence on linux and reports the injected platform otherwise', () => {
  const neverRead = {
    readFileSync() {
      throw new Error('platform evidence must not be read for non-linux hosts')
    },
  }
  assert.deepEqual(detectHost({ platform: 'win32', env: { WSL_DISTRO_NAME: 'Ubuntu' } }, neverRead), {
    platform: 'win32',
    wsl: false,
  })
  assert.equal(detectPlatform({ platform: 'darwin', env: {} }, neverRead), 'darwin')
  assert.deepEqual(detectHost({ platform: 'linux', env: { WSL_DISTRO_NAME: ' 测试 发行版 ' } }, neverRead), {
    platform: 'wsl:测试 发行版',
    wsl: true,
  })

  const microsoft = { readFileSync(file) { assert.equal(file, '/proc/version'); return 'Microsoft WSL2' } }
  assert.deepEqual(detectHost({ platform: 'linux', env: {} }, microsoft), { platform: 'linux', wsl: true })

  const unavailable = { readFileSync() { throw new Error('ENOENT') } }
  assert.deepEqual(detectHost({ platform: 'linux', env: {} }, unavailable), { platform: 'linux', wsl: false })
})

test('[AC-036] an unrecognized injected platform is passed through without throwing', () => {
  const neverRead = { readFileSync() { throw new Error('must not read') } }
  // Current behavior: the platform value is echoed back verbatim and marked non-WSL.
  // There is no explicit "unknown platform" verdict in the implementation.
  assert.deepEqual(detectHost({ platform: 'plan9', env: { WSL_DISTRO_NAME: 'x' } }, neverRead), {
    platform: 'plan9',
    wsl: false,
  })
  assert.equal(detectPlatform({ platform: 'plan9', env: {} }, neverRead), 'plan9')

  const result = scanLocal(fakeIo({}), {
    platform: 'plan9',
    env: {},
    discovery: { extra_dirs: [], unknown_patterns: [], cli_overrides: {} },
  })
  assert.deepEqual(result, { candidates: [], failed: [] })
})
