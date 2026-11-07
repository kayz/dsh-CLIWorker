import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { extractTitles, mergeShards, validateIndex } from '../../scripts/check-traceability.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'check-traceability.mjs')
const INDEX_FILE = path.join(ROOT, 'contracts', 'spec', 'ac-index.json')
const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'traceability')
const FIXTURE_INDEX = path.join(FIXTURES, 'ac-index.json')

function readIndex() {
  return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
}

function entryOf(index, ac) {
  return index.acs.find((item) => item.ac === ac)
}

function ids(errors) {
  return errors.map((error) => error.id)
}

function runJson(root, extra = []) {
  const result = spawnSync(
    process.execPath,
    [CHECK, '--root', root, '--index', FIXTURE_INDEX, '--json', ...extra],
    { encoding: 'utf8' }
  )
  assert.ok(result.stdout, `expected JSON on stdout, got ${result.stdout}${result.stderr}`)
  return { status: result.status, payload: JSON.parse(result.stdout) }
}

test('[AC-004] the committed AC index validates cleanly', () => {
  const index = readIndex()
  assert.equal(index.acs.length, 74)
  assert.deepEqual(validateIndex(index), [])
})

test('[AC-004] index.count rejects missing, duplicated and reordered entries', () => {
  const missing = readIndex()
  missing.acs.pop()
  assert.ok(ids(validateIndex(missing)).includes('index.count'))

  const duplicated = readIndex()
  duplicated.acs[73] = { ...duplicated.acs[0] }
  assert.ok(ids(validateIndex(duplicated)).includes('index.count'))

  const reordered = readIndex()
  const first = reordered.acs[0]
  reordered.acs[0] = reordered.acs[1]
  reordered.acs[1] = first
  assert.ok(ids(validateIndex(reordered)).includes('index.count'))
})

test('[AC-004] index.owner and index.milestone reject unknown values', () => {
  const owner = readIndex()
  entryOf(owner, 'AC-001').owner = 'T-1'
  assert.ok(ids(validateIndex(owner)).includes('index.owner'))

  const milestone = readIndex()
  entryOf(milestone, 'AC-001').milestone = 'M6'
  assert.ok(ids(validateIndex(milestone)).includes('index.milestone'))
})

test('[AC-004] index.levels and index.baseline reject empty, unknown and duplicate values', () => {
  const emptyLevels = readIndex()
  entryOf(emptyLevels, 'AC-001').levels = []
  assert.ok(ids(validateIndex(emptyLevels)).includes('index.levels'))

  const duplicateLevels = readIndex()
  entryOf(duplicateLevels, 'AC-001').levels = ['unit', 'unit']
  assert.ok(ids(validateIndex(duplicateLevels)).includes('index.levels'))

  const unknownLevel = readIndex()
  entryOf(unknownLevel, 'AC-001').levels = ['nope']
  assert.ok(ids(validateIndex(unknownLevel)).includes('index.levels'))

  const emptyBaseline = readIndex()
  entryOf(emptyBaseline, 'AC-001').baseline = []
  assert.ok(ids(validateIndex(emptyBaseline)).includes('index.baseline'))

  const duplicateBaseline = readIndex()
  entryOf(duplicateBaseline, 'AC-001').baseline = ['linux', 'linux']
  assert.ok(ids(validateIndex(duplicateBaseline)).includes('index.baseline'))

  const unknownBaseline = readIndex()
  entryOf(unknownBaseline, 'AC-001').baseline = ['beos']
  assert.ok(ids(validateIndex(unknownBaseline)).includes('index.baseline'))
})

test('[AC-004] index.baseline_incompatible rejects code levels on real-smoke and smoke on win32', () => {
  const codeOnRealSmoke = readIndex()
  entryOf(codeOnRealSmoke, 'AC-001').baseline = ['real-smoke']
  assert.ok(ids(validateIndex(codeOnRealSmoke)).includes('index.baseline_incompatible'))

  const smokeOnWin32 = readIndex()
  entryOf(smokeOnWin32, 'AC-038').baseline = ['win32']
  assert.ok(ids(validateIndex(smokeOnWin32)).includes('index.baseline_incompatible'))
})

test('[AC-004] index.schema rejects a wrong schema and entries with missing or extra keys', () => {
  const wrongSchema = readIndex()
  wrongSchema.schema = 'cliworker.ac-index/v2'
  assert.ok(ids(validateIndex(wrongSchema)).includes('index.schema'))

  const missingKey = readIndex()
  delete entryOf(missingKey, 'AC-001').baseline
  assert.ok(ids(validateIndex(missingKey)).includes('index.schema'))

  const extraKey = readIndex()
  entryOf(extraKey, 'AC-001').note = 'extra'
  assert.ok(ids(validateIndex(extraKey)).includes('index.schema'))
})

test('[AC-004] shard fixtures cover pass, duplicate, not-owner, missing-file, missing-title and baseline', () => {
  const cases = [
    ['ok', 0, null],
    ['duplicate', 1, 'shard.duplicate'],
    ['not-owner', 1, 'shard.not_owner'],
    ['missing-file', 1, 'shard.missing_file'],
    ['missing-title', 1, 'shard.missing_title'],
    ['baseline-in-shard', 1, 'shard.baseline_forbidden'],
  ]

  for (const [name, status, expectedId] of cases) {
    const { status: actual, payload } = runJson(path.join(FIXTURES, name))
    assert.equal(actual, status, `${name}: ${JSON.stringify(payload)}`)
    assert.equal(payload.ok, status === 0, name)
    if (expectedId) {
      assert.ok(
        payload.errors.some((error) => error.id === expectedId),
        `${name} should report ${expectedId}, got ${JSON.stringify(payload.errors)}`
      )
    }
  }

  const { payload: duplicate } = runJson(path.join(FIXTURES, 'duplicate'))
  assert.deepEqual([...new Set(duplicate.errors.map((error) => error.id))].sort(), [
    'shard.duplicate',
    'shard.not_owner',
  ])
})

test('[AC-004] mergeShards treats ACs without a shard as planned', () => {
  const index = readIndex()
  const merged = mergeShards({ root: ROOT, index })
  assert.deepEqual(merged.errors, [])
  assert.equal(merged.acs['AC-001'], 'covered')
  assert.equal(merged.acs['AC-004'], 'covered')
  assert.equal(merged.acs['AC-074'], 'covered')
  assert.equal(merged.acs['AC-006'], 'planned')
})

test('[AC-004] extractTitles ignores skipped titles and still reads platformTest titles', () => {
  const source = [
    "test('[AC-004] plain', () => {})",
    "test.skip('[AC-004] skipped', () => {})",
    "test.todo('[AC-004] todo')",
    "describe('[AC-004] group', () => {})",
    "platformTest('[AC-004] gated', { requires: 'linux' }, () => {})",
    "myTest('[AC-004] not a test call')",
  ].join('\n')

  const titles = extractTitles(source)
  assert.deepEqual(titles.map((item) => item.kind), ['plain', 'skip', 'todo', 'plain', 'plain'])
  assert.ok(titles.every((item) => item.title.includes('[AC-004]')))
})

test('[AC-004] the task graph cross-check flags a wrong owner and accepts the real graph', () => {
  const index = readIndex()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-graph-'))
  try {
    const build = (overrideOwner) => {
      const tasks = new Map()
      for (const item of index.acs) {
        const owner = item.ac === 'AC-001' && overrideOwner ? overrideOwner : item.owner
        if (!tasks.has(owner)) tasks.set(owner, { id: owner, milestone: item.milestone, acceptance: [] })
        tasks.get(owner).acceptance.push(item.ac)
      }
      return {
        schema: 'agentline.taskgraph/v1',
        acceptance: index.acs.map((item) => ({ id: item.ac, levels: item.levels })),
        tasks: [...tasks.values()],
      }
    }

    const wrongOwner = path.join(dir, 'wrong-owner.json')
    fs.writeFileSync(wrongOwner, JSON.stringify(build('T-999')))
    const flagged = runJson(ROOT, ['--task-graph', wrongOwner])
    assert.equal(flagged.status, 1)
    assert.ok(flagged.payload.errors.some((error) => error.id === 'graph.mismatch'))

    const consistent = path.join(dir, 'consistent.json')
    fs.writeFileSync(consistent, JSON.stringify(build(null)))
    const clean = runJson(ROOT, ['--task-graph', consistent])
    assert.equal(clean.status, 0, JSON.stringify(clean.payload.errors))
    assert.ok(!clean.payload.errors.some((error) => error.id === 'graph.mismatch'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
