// Canary tests for the shared byte scanner: every surface must report a planted sentinel exactly
// where it lives, a clean run must stay clean, and no result may echo a sentinel value back.
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { MIN_SENTINEL_LENGTH, leakScan, makeSentinel, normalizeSentinels } from '../helpers/leak-scan.mjs'

function withRoot(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-leak-'))
  try {
    return body(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function writeFile(root, rel, data) {
  const full = path.join(root, ...rel.split('/'))
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, data)
  return full
}

test('[AC-031] stdout sentinel is reported at its byte offset', () => {
  const value = makeSentinel('STDOUT')
  const result = leakScan({ sentinels: [{ label: 'S1', value }], stdout: 'log: ' + value })

  assert.equal(result.ok, false)
  assert.deepEqual(result.errors, [])
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].surface, 'stdout')
  assert.equal(result.hits[0].location, 'stdout@5')
  assert.equal(result.hits[0].sentinel, 'S1')
  assert.equal(result.hits[0].encoding, 'raw')
})

test('[AC-031] stderr array entries are reported with their index', () => {
  const value = makeSentinel('STDERR')
  const result = leakScan({ sentinels: [value], stderr: ['clean line', 'x' + value] })

  assert.equal(result.ok, false)
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].surface, 'stderr')
  assert.equal(result.hits[0].location, 'stderr[1]@1')
  assert.equal(result.hits[0].sentinel, 'S1')
})

test('[AC-031] state_dir deep file sentinel is reported', () => {
  withRoot((root) => {
    const value = makeSentinel('DEEP')
    const prefix = Buffer.from('prefix-')
    const state = path.join(root, 'state')
    writeFile(state, 'a/b/c/deep.bin', Buffer.concat([prefix, Buffer.from(value, 'utf8'), crypto.randomBytes(6)]))

    const result = leakScan({ sentinels: [value], state_dir: state })

    assert.equal(result.ok, false)
    assert.deepEqual(result.errors, [])
    assert.equal(result.hits.length, 1)
    assert.equal(result.hits[0].surface, 'state_dir')
    assert.equal(result.hits[0].location, 'state_dir:a/b/c/deep.bin@7')
    assert.equal(result.scanned.files, 1)
  })
})

test('[AC-031] audit sentinel is reported once at its line', () => {
  withRoot((root) => {
    const value = makeSentinel('AUDIT')
    const state = path.join(root, 'state')
    const body = '{"event":"start"}\n' + 'prefix' + value + '\n'
    writeFile(state, 'audit.jsonl', body)

    const result = leakScan({ sentinels: [value], state_dir: state })

    assert.equal(result.ok, false)
    assert.deepEqual(result.errors, [])
    assert.equal(result.hits.length, 1)
    assert.equal(result.hits[0].surface, 'audit')
    assert.equal(result.hits[0].location, 'audit:audit.jsonl:2@6')
    assert.equal(result.scanned.files, 0)
    assert.equal(result.scanned.audit, Buffer.byteLength(body))
  })
})

test('[AC-031] http body sentinel is reported', () => {
  const value = makeSentinel('HTTPBODY')
  const result = leakScan({
    sentinels: [value],
    http: [{ method: 'POST', url: 'https://example.test/v1/select', status: 200, body: 'x' + value }],
  })

  assert.equal(result.ok, false)
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].surface, 'http')
  assert.equal(result.hits[0].location, 'http[0].body@1')
  assert.equal(result.scanned.http, 1)
})

test('[AC-031] http headers sentinel is reported with a lowercased name', () => {
  const value = makeSentinel('HTTPHDR')
  const result = leakScan({
    sentinels: [value],
    http: [{ method: 'GET', url: 'https://example.test/v1/select', status: 200, headers: { 'X-Token': value } }],
  })

  assert.equal(result.ok, false)
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].surface, 'http')
  assert.equal(result.hits[0].location, 'http[0].headers.x-token@0')
})

test('[AC-031] http url sentinel is reported', () => {
  const value = makeSentinel('HTTPURL')
  const prefix = 'https://example.test/v1/select?token='
  const result = leakScan({
    sentinels: [value],
    http: [{ method: 'GET', url: prefix + value, status: 200, body: 'ok' }],
  })

  assert.equal(result.ok, false)
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].surface, 'http')
  assert.equal(result.hits[0].location, `http[0].url@${Buffer.byteLength(prefix)}`)
})

test('[AC-031] argv sentinel is reported at its argument index', () => {
  const value = makeSentinel('ARGV')
  const result = leakScan({
    sentinels: [value],
    argv: [['node', 'x.mjs', '--token', value]],
  })

  assert.equal(result.ok, false)
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].surface, 'argv')
  assert.equal(result.hits[0].location, 'argv[0][3]@0')
  assert.equal(result.scanned.argv, 4)
})

test('[AC-031] clean surfaces produce no hits', () => {
  withRoot((root) => {
    const state = path.join(root, 'state')
    writeFile(state, 'a/notes.txt', 'nothing to see here\n')
    writeFile(state, 'a/b/config.json', '{"ok":true}\n')
    writeFile(state, 'audit.jsonl', '{"event":"start"}\n{"event":"stop"}\n')

    const result = leakScan({
      sentinels: [makeSentinel('CLEAN')],
      stdout: 'all commands succeeded\n',
      stderr: 'no errors\n',
      argv: [['node', 'cliworker.mjs', 'paths']],
      http: [{ method: 'GET', url: 'https://example.test/v1/select', status: 200, body: { ok: true } }],
      state_dir: state,
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.hits, [])
    assert.deepEqual(result.errors, [])
    assert.ok(result.scanned.files >= 1)
    assert.ok(result.scanned.stdout > 0)
    assert.ok(result.scanned.audit > 0)
  })
})

test('[AC-031] utf16le, base64 and hex encodings are detected', () => {
  withRoot((root) => {
    const value = makeSentinel('ENCODED')
    const state = path.join(root, 'state')
    const utf16 = Buffer.from(value, 'utf16le')
    const base64 = Buffer.from(Buffer.from(value, 'utf8').toString('base64'), 'utf8')
    const hex = Buffer.from(Buffer.from(value, 'utf8').toString('hex'), 'utf8')
    writeFile(state, 'enc-utf16.bin', Buffer.concat([Buffer.from('A'), utf16]))
    writeFile(state, 'enc-base64.txt', Buffer.concat([Buffer.from('B'), base64]))
    writeFile(state, 'enc-hex.txt', Buffer.concat([Buffer.from('C'), hex]))

    const result = leakScan({ sentinels: [value], state_dir: state })
    const found = result.hits.map((hit) => `${hit.location}|${hit.encoding}`)

    assert.equal(result.ok, false)
    assert.deepEqual(found, [
      'state_dir:enc-base64.txt@1|base64',
      'state_dir:enc-hex.txt@1|hex',
      'state_dir:enc-utf16.bin@1|utf16le',
    ])
  })
})

test('[AC-031] two sentinels stay distinguishable by label', () => {
  const first = makeSentinel('ONE')
  const second = makeSentinel('TWO')
  const result = leakScan({
    sentinels: [
      { label: 'ONE', value: first },
      { label: 'TWO', value: second },
    ],
    stdout: 'x' + first,
    stderr: second,
  })

  assert.equal(result.ok, false)
  assert.deepEqual(
    result.hits.map((hit) => `${hit.surface}|${hit.location}|${hit.sentinel}`),
    ['stdout|stdout@1|ONE', 'stderr|stderr@0|TWO']
  )
})

test('[AC-031] scan results not leak sentinel values', () => {
  withRoot((root) => {
    const value = makeSentinel('LEAK')
    const state = path.join(root, 'state')
    writeFile(state, 'a/b/deep.txt', value)
    writeFile(state, 'audit.jsonl', '{"event":"start"}\n' + value + '\n')

    const result = leakScan({
      sentinels: [{ label: 'LEAK', value }],
      stdout: value,
      stderr: value,
      argv: [['node', 'x.mjs', value]],
      http: [{ method: 'GET', url: 'https://example.test/v1/select', status: 200, headers: { 'X-Token': value }, body: value }],
      state_dir: state,
    })

    assert.equal(result.ok, false)
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.ok(result.hits.length >= 6)
    assert.ok(result.hits.every((hit) => hit.sentinel === 'LEAK'))
  })
})

test('[AC-031] a file name containing the sentinel is reported with #name', () => {
  withRoot((root) => {
    const value = makeSentinel('NAME')
    const state = path.join(root, 'state')
    writeFile(state, `${value}.txt`, '')

    const result = leakScan({ sentinels: [value], state_dir: state })

    assert.equal(result.ok, false)
    assert.equal(result.hits.length, 1)
    assert.equal(result.hits[0].surface, 'state_dir')
    assert.equal(result.hits[0].location, `state_dir:${value}.txt#name`)
  })
})

test('[AC-031] input validation rejects unsafe sentinel lists', () => {
  assert.throws(() => makeSentinel('bad label'), TypeError)
  assert.throws(() => normalizeSentinels([]), TypeError)
  assert.throws(() => normalizeSentinels(['short']), TypeError)
  assert.throws(
    () => normalizeSentinels([{ label: 'A', value: 'x'.repeat(MIN_SENTINEL_LENGTH) }, { label: 'A', value: 'y'.repeat(MIN_SENTINEL_LENGTH) }]),
    TypeError
  )
})

test('[AC-031] a missing state_dir scans as empty', () => {
  withRoot((root) => {
    const result = leakScan({ sentinels: [makeSentinel('MISSING')], state_dir: path.join(root, 'absent') })

    assert.equal(result.ok, true)
    assert.deepEqual(result.hits, [])
    assert.deepEqual(result.errors, [])
    assert.equal(result.scanned.files, 0)
    assert.equal(result.scanned.audit, 0)
  })
})
