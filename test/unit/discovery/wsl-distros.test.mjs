// AC-037: WSL cross-distribution parsing, including lossless UTF-16LE decoding.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDistros } from '../../../lib/discovery/wsl.mjs'

test('[AC-037] UTF-16LE wsl -l -q bytes preserve non-ASCII distro names losslessly', () => {
  const raw = '\uFEFF* Ubuntu-22.04\r\nUbuntu\r\n中文 发行版\r\n\r\nDebian\0\0\r\n'
  const bytes = Buffer.from(raw, 'utf16le')
  const expected = ['Ubuntu-22.04', 'Ubuntu', '中文 发行版', 'Debian']
  assert.deepEqual(parseDistros(bytes), expected)
  assert.deepEqual(parseDistros(bytes.subarray(2)), expected)
  // Confirm the decode is UTF-16LE rather than a UTF-8 mojibake fallback.
  assert.deepEqual(parseDistros(Buffer.from('中文 发行版\r\n', 'utf16le')), ['中文 发行版'])
})

test('[AC-037] UTF-8 text input still parses with BOM, CRLF and a default-distro marker', () => {
  assert.deepEqual(parseDistros('\uFEFF* Ubuntu\r\nDebian\n中文 发行版\r\n'), ['Ubuntu', 'Debian', '中文 发行版'])
  assert.deepEqual(parseDistros('Ubuntu'), ['Ubuntu'])
})

test('[AC-037] blank lines, stray NULs and duplicate distro names are dropped in first-seen order', () => {
  assert.deepEqual(parseDistros('  * Ubuntu  \r\nUbuntu\r\n\tDebian\t\r\n\r\n'), ['Ubuntu', 'Debian'])
  assert.deepEqual(parseDistros('Ubuntu\0\r\nDebian\0'), ['Ubuntu', 'Debian'])
  assert.deepEqual(parseDistros(''), [])
  assert.deepEqual(parseDistros(Buffer.alloc(0)), [])
  assert.deepEqual(parseDistros(null), [])
})
