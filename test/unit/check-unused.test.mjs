import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { scanPaths, scanSource } from '../../scripts/check-unused.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FIXTURE = 'test/fixtures/unused'
const SCRIPT = 'scripts/check-unused.mjs'

function key(item) {
  return `${item.file}|${item.kind}|${item.name}`
}

function readExpected() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, FIXTURE, 'expected.json'), 'utf8')).items
}

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' })
}

test('[AC-022] scanPaths reports exactly the eight declarations of the fixture', () => {
  const report = scanPaths([FIXTURE], { root: ROOT })
  const expected = readExpected()

  assert.equal(report.files, 3)
  assert.equal(report.items.length, 8)
  assert.deepEqual(report.items.map(key).sort(), expected.map(key).sort())
  assert.deepEqual(
    report.items,
    [...report.items].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)))
  )
})

test('[AC-022] the clean fixture reports nothing', () => {
  const report = scanPaths([`${FIXTURE}/clean`], { root: ROOT })
  assert.equal(report.files, 1)
  assert.deepEqual(report.items, [])
})

test('[AC-022] lib reports nothing', () => {
  const report = scanPaths(['lib'], { root: ROOT })
  assert.ok(report.files > 0)
  assert.deepEqual(report.items, [])
})

test('[AC-022] the CLI exits 1 on the fixture and 0 on lib', () => {
  const dirty = runCli([FIXTURE])
  assert.equal(dirty.status, 1)
  assert.match(dirty.stdout, /^check-unused: FAIL \(8 unused\)$/m)

  const json = runCli(['--json', FIXTURE])
  assert.equal(json.status, 1)
  const parsed = JSON.parse(json.stdout)
  assert.equal(parsed.files, 3)
  assert.deepEqual(parsed.items.map(key).sort(), readExpected().map(key).sort())

  const lib = runCli([])
  assert.equal(lib.status, 0)
  const lines = lib.stdout.trim().split('\n')
  assert.ok(lines[lines.length - 1].startsWith('check-unused: ok (files='))
})

test('[AC-022] the CLI rejects unknown flags and missing paths with exit 2', () => {
  const unknown = runCli(['--no-such-flag'])
  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /usage: node scripts\/check-unused\.mjs/)
  assert.equal(unknown.stdout.includes('check-unused: ok'), false)

  const missing = runCli(['no/such/dir'])
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /usage: node scripts\/check-unused\.mjs/)
})

test('[AC-022] scanSource ignores comments, strings and template text', () => {
  const source = [
    "import { a, b, c, d } from './dep.mjs'",
    '// a is mentioned in a comment',
    "const text = 'b lives in a string'",
    'const template = `c lives in template text`',
    'const used = `${d}`',
    'export { used }',
  ].join('\n')

  assert.deepEqual(scanSource(source), [
    { line: 1, kind: 'import', name: 'a' },
    { line: 1, kind: 'import', name: 'b' },
    { line: 1, kind: 'import', name: 'c' },
  ])
})

test('[AC-022] scanSource treats obj.name as property access but spreads as references', () => {
  const propertyOnly = ["import fs from 'node:fs'", 'const holder = {}', 'export const value = holder.fs'].join('\n')
  assert.deepEqual(scanSource(propertyOnly), [{ line: 1, kind: 'import', name: 'fs' }])

  const spread = ["import { join } from 'node:path'", 'export const parts = [...join("a")]'].join('\n')
  assert.deepEqual(scanSource(spread), [])
})

test('[AC-022] a regex literal with quotes does not disturb later scanning', () => {
  const source = [
    "import { join } from 'node:path'",
    'const re = /["\']/',
    "export const value = join('a', 'b')",
  ].join('\n')
  assert.deepEqual(scanSource(source), [])
})

test('[AC-022] export lists and self-recursion follow the documented rules', () => {
  const exportList = ["import { a } from './dep.mjs'", 'export { a as b }'].join('\n')
  assert.deepEqual(scanSource(exportList), [])

  const recursive = ['function spin(n) {', '  return n > 0 ? spin(n - 1) : 0', '}'].join('\n')
  assert.deepEqual(scanSource(recursive), [{ line: 1, kind: 'function', name: 'spin' }])

  const exported = ['export function kept() {', '  return 1', '}'].join('\n')
  assert.deepEqual(scanSource(exported), [])
})
