import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { REGISTRY, checkFrozen, compareRegistry } from '../../lib/contract/registry.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SCRIPT = path.join(ROOT, 'scripts', 'snapshot-update.mjs')
const REGISTRY_PATH = path.join(ROOT, 'lib', 'contract', 'registry.mjs')
const SNAPSHOT_PATH = path.join(ROOT, 'contracts', 'registry.snapshot.json')

const NEW_CODE = {
  code: 'E_NEW_SURFACE',
  exit: 2,
  http_status: 400,
  retryable: false,
  trigger_id: 'new_surface',
  trigger: 'A newly added surface',
}

function clone() {
  return structuredClone(REGISTRY)
}

function withRegistry(mutate) {
  const candidate = clone()
  mutate(candidate)
  return candidate
}

function sandbox(mutationSource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-freeze-'))
  fs.mkdirSync(path.join(dir, 'lib', 'contract'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'contracts'), { recursive: true })
  const wrapper = [
    `import { REGISTRY as base } from '${pathToFileURL(REGISTRY_PATH).href}'`,
    'const REGISTRY = structuredClone(base)',
    mutationSource,
    'export { REGISTRY }',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(dir, 'lib', 'contract', 'registry.mjs'), wrapper, 'utf8')
  fs.copyFileSync(SNAPSHOT_PATH, path.join(dir, 'contracts', 'registry.snapshot.json'))
  return dir
}

function runSnapshotUpdate(dir) {
  return spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' })
}

function firstLine(result) {
  return String(result.stdout ?? '').split(/\r?\n/)[0]
}

function readSnapshot(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'contracts', 'registry.snapshot.json'), 'utf8'))
}

test('[AC-010] compareRegistry reports removed for a deleted code', () => {
  const current = withRegistry((registry) => {
    registry.codes = registry.codes.filter((entry) => entry.code !== 'E_CSRF')
  })
  assert.deepStrictEqual(compareRegistry(REGISTRY, current), {
    removed: ['codes:E_CSRF'],
    added: [],
    changed: [],
  })
})

test('[AC-010] compareRegistry reports removed and added for a renamed code', () => {
  const current = withRegistry((registry) => {
    registry.codes = registry.codes.map((entry) =>
      entry.code === 'E_CSRF' ? { ...entry, code: 'E_CSRF2' } : entry
    )
  })
  assert.deepStrictEqual(compareRegistry(REGISTRY, current), {
    removed: ['codes:E_CSRF'],
    added: ['codes:E_CSRF2'],
    changed: [],
  })
})

test('[AC-010] compareRegistry reports changed for a modified field', () => {
  const current = withRegistry((registry) => {
    registry.codes = registry.codes.map((entry) =>
      entry.code === 'E_CSRF' ? { ...entry, exit: 9 } : entry
    )
  })
  assert.deepStrictEqual(compareRegistry(REGISTRY, current), {
    removed: [],
    added: [],
    changed: ['codes:E_CSRF'],
  })
})

test('[AC-010] compareRegistry reports nothing for identical registries', () => {
  assert.deepStrictEqual(compareRegistry(REGISTRY, clone()), { removed: [], added: [], changed: [] })
  assert.equal(checkFrozen(REGISTRY, clone()).ok, true)
})

test('[AC-010] checkFrozen fails for a deleted code, a renamed code and an added code with a stale snapshot', () => {
  const deleted = withRegistry((registry) => {
    registry.codes = registry.codes.filter((entry) => entry.code !== 'E_CSRF')
  })
  const deletedResult = checkFrozen(REGISTRY, deleted)
  assert.equal(deletedResult.ok, false)
  assert.ok(deletedResult.errors.some((error) => error.id === 'freeze.removed'))

  const renamed = withRegistry((registry) => {
    registry.codes = registry.codes.map((entry) =>
      entry.code === 'E_CSRF' ? { ...entry, code: 'E_CSRF2' } : entry
    )
  })
  const renamedResult = checkFrozen(REGISTRY, renamed)
  assert.equal(renamedResult.ok, false)
  const ids = new Set(renamedResult.errors.map((error) => error.id))
  assert.ok(ids.has('freeze.removed'))
  assert.ok(ids.has('freeze.added'))

  const added = withRegistry((registry) => {
    registry.codes = [...registry.codes, NEW_CODE]
  })
  const addedResult = checkFrozen(REGISTRY, added)
  assert.equal(addedResult.ok, false)
  assert.ok(addedResult.errors.every((error) => error.id === 'freeze.added'))
})

test('[AC-010] snapshot-update is a no-op on an unchanged registry', () => {
  const dir = sandbox('')
  try {
    const before = fs.readFileSync(path.join(dir, 'contracts', 'registry.snapshot.json'), 'utf8')
    const result = runSnapshotUpdate(dir)
    assert.equal(result.status, 0)
    assert.equal(firstLine(result), 'snapshot-update: unchanged (snapshot_version 1)')
    const after = fs.readFileSync(path.join(dir, 'contracts', 'registry.snapshot.json'), 'utf8')
    assert.equal(after, before)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-010] snapshot-update writes the snapshot only when snapshot_version is previous plus one', () => {
  const dir = sandbox(`REGISTRY.codes.push(${JSON.stringify(NEW_CODE)})\nREGISTRY.snapshot_version = 2`)
  try {
    const result = runSnapshotUpdate(dir)
    assert.equal(result.status, 0)
    assert.equal(firstLine(result), 'snapshot-update: wrote snapshot_version 2')
    const written = readSnapshot(dir)
    assert.equal(written.snapshot_version, 2)
    assert.ok(written.codes.some((entry) => entry.code === NEW_CODE.code))
    const expected = withRegistry((registry) => {
      registry.codes.push(NEW_CODE)
      registry.snapshot_version = 2
    })
    assert.equal(checkFrozen(written, expected).ok, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-010] snapshot-update refuses an addition without a version bump', () => {
  const dir = sandbox(`REGISTRY.codes.push(${JSON.stringify(NEW_CODE)})`)
  try {
    const before = fs.readFileSync(path.join(dir, 'contracts', 'registry.snapshot.json'), 'utf8')
    const result = runSnapshotUpdate(dir)
    assert.equal(result.status, 1)
    assert.equal(firstLine(result), 'FAIL snapshot.version_not_bumped have=1 need=2')
    assert.equal(fs.readFileSync(path.join(dir, 'contracts', 'registry.snapshot.json'), 'utf8'), before)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-010] snapshot-update refuses removed, renamed or changed entries', () => {
  const cases = [
    [
      `REGISTRY.codes = REGISTRY.codes.filter((entry) => entry.code !== 'E_CSRF')\nREGISTRY.snapshot_version = 2`,
      'FAIL snapshot.breaking removed=1 changed=0',
    ],
    [
      `REGISTRY.codes = REGISTRY.codes.map((entry) => entry.code === 'E_CSRF' ? { ...entry, code: 'E_CSRF2' } : entry)\nREGISTRY.snapshot_version = 2`,
      'FAIL snapshot.breaking removed=1 changed=0',
    ],
    [
      `REGISTRY.codes = REGISTRY.codes.map((entry) => entry.code === 'E_CSRF' ? { ...entry, exit: 9 } : entry)\nREGISTRY.snapshot_version = 2`,
      'FAIL snapshot.breaking removed=0 changed=1',
    ],
  ]
  for (const [mutation, expectedLine] of cases) {
    const dir = sandbox(mutation)
    try {
      const before = fs.readFileSync(path.join(dir, 'contracts', 'registry.snapshot.json'), 'utf8')
      const result = runSnapshotUpdate(dir)
      assert.equal(result.status, 1)
      assert.equal(firstLine(result), expectedLine)
      assert.equal(fs.readFileSync(path.join(dir, 'contracts', 'registry.snapshot.json'), 'utf8'), before)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('[AC-010] snapshot holds reject reasons, risk thresholds, availability, warning codes, draft mapping and semantic_change', () => {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'))
  assert.equal(snapshot.reject_reasons.v1.length, 15)
  assert.deepStrictEqual(snapshot.reject_reasons.admin_only, ['not_allowed'])
  assert.equal(snapshot.reject_reasons.draft.length, 7)
  assert.equal(snapshot.draft_reason_mapping.length, 10)
  assert.equal(snapshot.warning_codes.length, 8)
  assert.equal(snapshot.forecast_reasons.length, 7)
  assert.deepStrictEqual(snapshot.risk, ['ok', 'low_reserve', 'critical', 'exhausted', 'unknown'])
  assert.deepStrictEqual(snapshot.risk_basis, ['tasks', 'usd', 'fraction', 'none'])
  assert.deepStrictEqual(snapshot.tasks_left_basis, ['tasks', 'usd', 'none'])
  assert.deepStrictEqual(snapshot.availability, [
    'unverified',
    'callable',
    'blocked',
    'unavailable',
    'deprecated',
  ])
  assert.deepStrictEqual(snapshot.identity, ['verified', 'unverified', 'mismatch'])
  assert.deepStrictEqual(snapshot.semantic_change, [
    'forecast.tasks_left',
    'forecast.risk',
    'handle.cli_removed',
    'draft_reason_mapping',
    'config_v1_to_v2',
  ])
  assert.deepStrictEqual(
    snapshot.thresholds.tasks.map((row) => [row.risk, row.op, row.value]),
    [
      ['exhausted', '<=', 0],
      ['critical', '<=', 2],
      ['low_reserve', '<=', 5],
      ['ok', 'else', null],
    ]
  )
  assert.deepStrictEqual(
    snapshot.thresholds.fraction.map((row) => [row.risk, row.op, row.value]),
    [
      ['exhausted', '<=', 0],
      ['critical', '<', 0.05],
      ['low_reserve', '<', 0.15],
      ['ok', 'else', null],
    ]
  )
  assert.deepStrictEqual(snapshot.thresholds.priority, ['tasks', 'usd', 'fraction', 'unknown'])
})
