import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanLocal } from '../../../lib/discovery/scan.mjs'

test('scan enumerates declared directories only and deduplicates real paths', () => {
  const reads = []
  const io = {
    readdirSync(dir) { reads.push(dir); if (dir === '/bad') throw Error(); return ['claude', 'other-cli', 'ignore', 'folder'] },
    realpathSync(file) { return file.replace('/extra/', '/bin/') },
    statSync(file) { return { size: 5, mtime: new Date('2026-01-01T00:00:00Z'), isFile: () => !file.endsWith('/folder') } },
  }
  const result = scanLocal(io, { platform: 'linux', env: { PATH: '/bin:/bin' }, discovery: { extra_dirs: ['/extra', '/bad'], unknown_patterns: ['*-cli'], cli_overrides: {} } })
  assert.deepEqual(reads, ['/bin', '/extra', '/bad'])
  assert.deepEqual(result.failed, ['/bad'])
  assert.deepEqual(result.candidates.map(item => item.realpath), ['/bin/claude', '/bin/other-cli'])
  assert.equal(result.candidates[0].rule.name, 'claude')
  assert.equal(result.candidates[1].rule, null)
})
