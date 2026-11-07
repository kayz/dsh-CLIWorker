import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { REGISTRY } from '../../lib/contract/registry.mjs'
import { validate } from '../../lib/contract/validate.mjs'
import { renderContractDoc } from '../../scripts/gen-contract-doc.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SCRIPTS = path.join(ROOT, 'scripts')
const CONTRACTS = path.join(ROOT, 'contracts')

const GOLDEN_FROZEN = path.join(SCRIPTS, 'check-golden-frozen.mjs')
const WRITE_SCOPE = path.join(SCRIPTS, 'check-write-scope.mjs')
const NO_COLLAB = path.join(SCRIPTS, 'check-no-collab.mjs')
const CONTRACT_DOC = path.join(SCRIPTS, 'check-contract-doc.mjs')

const REQUIRED_GOLDEN_IDS = {
  'quota-shapes.json': [
    'q-pct-5',
    'q-pct-4',
    'q-pct-0',
    'q-pct-15',
    'q-credits-no-rate',
    'q-credits-zero',
    'q-credits-rate',
    'q-tokens',
    'q-usd',
  ],
  'b44.json': [
    'b44-used-0',
    'b44-reading-half',
    'b44-ledger-sonnet-1m',
    'b44-reading-then-1m',
    'b44-fresh-reading-ignores-earlier-rows',
    'b44-stale-reading-uses-ledger',
    'b44-unknown-capacity-row',
    'b44-rounding',
    'b44-two-pools-min',
  ],
  'forecast/thresholds.json': [
    'tasks-minus1',
    'tasks-0',
    'tasks-1',
    'tasks-2',
    'tasks-3',
    'tasks-5',
    'tasks-6',
    'tasks-100',
    'usd-0',
    'usd-2',
    'usd-6',
    'frac-0',
    'frac-0.0001',
    'frac-0.049',
    'frac-0.05',
    'frac-0.149',
    'frac-0.15',
    'frac-1',
    'priority-tasks-over-fraction',
    'priority-usd-over-fraction',
    'unknown-none',
  ],
  'forecast/quantiles.json': [
    'n3-heavy',
    'n3-normal',
    'n3-light',
    'n4-unsorted-heavy',
    'n4-unsorted-normal',
    'n4-unsorted-light',
    'n12-heavy',
    'n12-normal',
    'n12-light',
    'n20-heavy',
    'n20-normal',
    'n20-light',
    'n2-invalid',
    'n1-invalid',
    'n0-invalid',
  ],
  'forecast/confidence.json': [
    'n0',
    'n1',
    'n4',
    'n5',
    'n19',
    'n20-cv0.5',
    'n20-cv1',
    'n20-cv1.01',
    'n50-cv2',
    'n10-cv3',
    'n3-cv5',
  ],
  'forecast/burn-eta.json': [
    'burn-5.5-over-5h',
    'burn-clamp-zero-hours',
    'burn-clamp-tiny-hours',
    'burn-rounding',
    'burn-zero-used',
    'eta-after-reset',
    'eta-before-reset',
    'eta-equal-reset',
    'eta-empty',
    'round3-0.0625',
    'round3-0.1875',
    'round3-negative',
    'round3-down',
    'round3-zero',
  ],
  'capacity.json': [
    'cap-k2-low',
    'cap-k3-medium',
    'cap-k10-high',
    'cap-discard-small-delta',
    'cap-reset-pair-ignored',
  ],
  'policy/p1-order.json': ['p1-order'],
  'policy/p2-quota-low.json': ['p2-quota-low'],
  'policy/p3-unknown.json': ['p3-after-known', 'p3-reject'],
  'policy/p4-identity-group.json': ['p4-distinct-group', 'p4-fill-same-group'],
}

const REQUIRED_KINDS = {
  'quota-shapes.json': 'quota-shapes',
  'b44.json': 'b44',
  'forecast/thresholds.json': 'forecast-thresholds',
  'forecast/quantiles.json': 'forecast-quantiles',
  'forecast/confidence.json': 'forecast-confidence',
  'forecast/burn-eta.json': 'forecast-burn-eta',
  'capacity.json': 'capacity',
  'policy/p1-order.json': 'policy',
  'policy/p2-quota-low.json': 'policy',
  'policy/p3-unknown.json': 'policy',
  'policy/p4-identity-group.json': 'policy',
}

function tmp(prefix = 'cliworker-spec-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function runNode(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dst, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, base, out)
    else out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

function normalizedSha256(file) {
  const text = fs.readFileSync(file).toString('utf8').replace(/\r\n/g, '\n')
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

function git(dir, args) {
  return spawnSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    { cwd: dir, encoding: 'utf8' }
  )
}

function initRepo(dir) {
  const result = git(dir, ['init'])
  assert.equal(result.status, 0, output(result))
}

function commitAll(dir, message) {
  const add = git(dir, ['add', '-A'])
  assert.equal(add.status, 0, output(add))
  const commit = git(dir, ['commit', '-m', message])
  assert.equal(commit.status, 0, output(commit))
}

function sandboxContracts(prefix) {
  const dir = tmp(prefix)
  copyDir(CONTRACTS, path.join(dir, 'contracts'))
  return dir
}

test('[AC-073] snapshot, spec, golden and forbidden files are tracked by git and not ignored', () => {
  const listed = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(listed.status, 0, 'the repository root must be a git work tree')
  const tracked = new Set(
    String(listed.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  )

  const wanted = [
    'contracts/registry.snapshot.json',
    'contracts/agentline-forbidden.json',
    ...walk(path.join(CONTRACTS, 'spec'), ROOT, []),
    ...walk(path.join(CONTRACTS, 'golden'), ROOT, []),
  ]
  for (const rel of wanted) {
    assert.equal(tracked.has(rel), true, `${rel} is not tracked by git (run git add)`)
    const ignored = spawnSync('git', ['check-ignore', '-q', rel], { cwd: ROOT })
    assert.equal(ignored.status, 1, `${rel} must not be ignored`)
  }
})

test('[AC-073] every spec and golden file validates against its schema', () => {
  const loadSchema = (name) => readJson(path.join(CONTRACTS, 'schemas', name))
  const check = (schemaName, docPath) => {
    const schema = loadSchema(`${schemaName}.schema.json`)
    const result = validate(schema, readJson(docPath), { loadSchema })
    assert.equal(result.ok, true, `${path.relative(ROOT, docPath)}: ${JSON.stringify(result.errors)}`)
  }

  check('registry-snapshot', path.join(CONTRACTS, 'registry.snapshot.json'))
  check('agentline-forbidden', path.join(CONTRACTS, 'agentline-forbidden.json'))
  check('surfaces', path.join(CONTRACTS, 'spec', 'surfaces.json'))
  check('migration-map', path.join(CONTRACTS, 'spec', 'migration-map.json'))
  check('ac-index', path.join(CONTRACTS, 'spec', 'ac-index.json'))
  check('golden-manifest', path.join(CONTRACTS, 'golden', 'manifest.json'))
  for (const rel of walk(path.join(CONTRACTS, 'golden'), ROOT, [])) {
    if (rel.endsWith('manifest.json')) continue
    check('golden', path.join(ROOT, rel))
  }

  const registry = readJson(path.join(CONTRACTS, 'registry.snapshot.json'))
  const surfaces = readJson(path.join(CONTRACTS, 'spec', 'surfaces.json'))
  const migration = readJson(path.join(CONTRACTS, 'spec', 'migration-map.json'))

  for (const entry of registry.draft_reason_mapping) {
    assert.ok(registry.reject_reasons.v1.includes(entry.v1), `${entry.v1} is not a v1 reject reason`)
  }
  for (const pattern of registry.reject_reasons.draft) {
    const covered = registry.draft_reason_mapping.some((entry) =>
      pattern === 'level:<Level>'
        ? entry.draft.startsWith('level:')
        : pattern === 'availability:<state>'
          ? entry.draft.startsWith('availability:')
          : entry.draft === pattern
    )
    assert.equal(covered, true, `${pattern} is not covered by the draft mapping`)
  }

  assert.deepStrictEqual(
    [...surfaces.semantic_change.map((item) => item.id)].sort(),
    [...registry.semantic_change].sort()
  )
  assert.deepStrictEqual(
    migration.draft_to_v1.reasons.map((entry) => [entry.draft, entry.v1]),
    registry.draft_reason_mapping.map((entry) => [entry.draft, entry.v1])
  )

  const ids = [
    ...migration.draft_to_v1.reasons,
    ...migration.draft_to_v1.fields,
    ...migration.config_v1_to_v2,
  ].map((entry) => entry.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('[AC-073] golden files hold the required case ids', () => {
  for (const [rel, ids] of Object.entries(REQUIRED_GOLDEN_IDS)) {
    const golden = readJson(path.join(CONTRACTS, 'golden', rel))
    assert.equal(golden.schema, 'cliworker.golden/v1')
    assert.equal(golden.kind, REQUIRED_KINDS[rel], rel)
    const got = golden.cases.map((entry) => entry.id)
    assert.equal(new Set(got).size, got.length, `${rel} has duplicate case ids`)
    for (const id of ids) assert.ok(got.includes(id), `${rel} misses case ${id}`)
  }
})

test('[AC-073] manifest registers every spec and golden file with its normalized sha256', () => {
  const manifest = readJson(path.join(CONTRACTS, 'golden', 'manifest.json'))
  assert.equal(manifest.schema, 'cliworker.golden-manifest/v1')
  const registered = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]))
  const disk = [
    ...walk(path.join(CONTRACTS, 'spec'), ROOT, []),
    ...walk(path.join(CONTRACTS, 'golden'), ROOT, []),
  ].filter((rel) => rel !== 'contracts/golden/manifest.json')

  assert.deepStrictEqual([...registered.keys()].sort(), [...disk].sort())
  for (const rel of disk) {
    assert.equal(registered.get(rel), normalizedSha256(path.join(ROOT, rel)), rel)
  }
})

test('[AC-073] check-golden-frozen fails when a golden file is modified', () => {
  const dir = sandboxContracts('cliworker-golden-mod-')
  try {
    const clean = runNode(GOLDEN_FROZEN, ['--root', dir])
    assert.equal(clean.status, 0, output(clean))

    fs.appendFileSync(path.join(dir, 'contracts', 'golden', 'b44.json'), ' ')
    const result = runNode(GOLDEN_FROZEN, ['--root', dir])
    assert.equal(result.status, 1)
    assert.ok(output(result).includes('FAIL golden.changed contracts/golden/b44.json'), output(result))
    assert.ok(output(result).includes('check-golden-frozen: FAILED (1 errors)'), output(result))

    const crlfDir = sandboxContracts('cliworker-golden-crlf-')
    try {
      const target = path.join(crlfDir, 'contracts', 'golden', 'capacity.json')
      const text = fs.readFileSync(target, 'utf8')
      fs.writeFileSync(target, text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8')
      const crlf = runNode(GOLDEN_FROZEN, ['--root', crlfDir])
      assert.equal(crlf.status, 0, output(crlf))
    } finally {
      fs.rmSync(crlfDir, { recursive: true, force: true })
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-073] check-golden-frozen fails when a golden file is added', () => {
  const dir = sandboxContracts('cliworker-golden-add-')
  try {
    fs.writeFileSync(path.join(dir, 'contracts', 'golden', 'extra.json'), '{}\n', 'utf8')
    const result = runNode(GOLDEN_FROZEN, ['--root', dir])
    assert.equal(result.status, 1)
    assert.ok(output(result).includes('FAIL golden.unregistered contracts/golden/extra.json'), output(result))
    assert.ok(output(result).includes('check-golden-frozen: FAILED (1 errors)'), output(result))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-073] check-golden-frozen fails when a golden file is deleted', () => {
  const dir = sandboxContracts('cliworker-golden-del-')
  try {
    fs.rmSync(path.join(dir, 'contracts', 'golden', 'capacity.json'))
    const result = runNode(GOLDEN_FROZEN, ['--root', dir])
    assert.equal(result.status, 1)
    assert.ok(output(result).includes('FAIL golden.missing contracts/golden/capacity.json'), output(result))
    assert.ok(output(result).includes('check-golden-frozen: FAILED (1 errors)'), output(result))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-073] check-write-scope reports an unregistered spec or golden file', () => {
  const dir = sandboxContracts('cliworker-write-scope-')
  try {
    fs.writeFileSync(path.join(dir, 'contracts', 'spec', 'x.json'), '{}\n', 'utf8')
    const result = runNode(WRITE_SCOPE, ['--root', dir])
    assert.equal(result.status, 1)
    assert.ok(
      output(result).includes('FAIL write_scope.unregistered contracts/spec/x.json'),
      output(result)
    )
    assert.ok(output(result).includes('check-write-scope: FAILED (1 errors)'), output(result))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-073] check-write-scope reports changes outside the write scope', () => {
  const dir = tmp('cliworker-write-scope-git-')
  try {
    fs.mkdirSync(path.join(dir, 'contracts', 'spec'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'contracts', 'golden'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'contracts', 'golden', 'manifest.json'),
      `${JSON.stringify({ schema: 'cliworker.golden-manifest/v1', files: [] }, null, 2)}\n`,
      'utf8'
    )
    fs.mkdirSync(path.join(dir, 'lib', 'contract'), { recursive: true })
    initRepo(dir)
    commitAll(dir, 'baseline')

    fs.writeFileSync(path.join(dir, 'lib', 'contract', 'ok.mjs'), 'export const ok = true\n')
    fs.writeFileSync(path.join(dir, 'lib', 'other.mjs'), 'export const other = true\n')

    const crossSegment = runNode(WRITE_SCOPE, ['--root', dir, '--base', 'HEAD', '--scope', 'lib/contract/**'])
    assert.equal(crossSegment.status, 1, output(crossSegment))
    assert.ok(output(crossSegment).includes('FAIL write_scope.outside lib/other.mjs'), output(crossSegment))
    assert.equal(output(crossSegment).includes('FAIL write_scope.outside lib/contract/ok.mjs'), false)

    const singleSegment = runNode(WRITE_SCOPE, ['--root', dir, '--base', 'HEAD', '--scope', 'lib/*.mjs'])
    assert.equal(singleSegment.status, 1, output(singleSegment))
    assert.ok(
      output(singleSegment).includes('FAIL write_scope.outside lib/contract/ok.mjs'),
      output(singleSegment)
    )
    assert.equal(output(singleSegment).includes('FAIL write_scope.outside lib/other.mjs'), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-073] check-write-scope reads write_scope from markdown front matter', () => {
  const dir = tmp('cliworker-write-scope-md-')
  try {
    fs.mkdirSync(path.join(dir, 'contracts', 'spec'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'contracts', 'golden'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'contracts', 'golden', 'manifest.json'),
      `${JSON.stringify({ schema: 'cliworker.golden-manifest/v1', files: [] }, null, 2)}\n`,
      'utf8'
    )
    fs.mkdirSync(path.join(dir, 'lib', 'contract'), { recursive: true })
    initRepo(dir)
    commitAll(dir, 'baseline')

    fs.writeFileSync(path.join(dir, 'lib', 'contract', 'ok.mjs'), 'export const ok = true\n')
    fs.writeFileSync(path.join(dir, 'lib', 'other.mjs'), 'export const other = true\n')

    const design = path.join(dir, 'design.md')
    fs.writeFileSync(
      design,
      '---\ntask: "x"\nwrite_scope:\n  - lib/contract/**\n---\n\n# design\n',
      'utf8'
    )
    const valid = runNode(WRITE_SCOPE, ['--root', dir, '--base', 'HEAD', '--scope-from', design])
    assert.equal(valid.status, 1, output(valid))
    assert.ok(output(valid).includes('FAIL write_scope.outside lib/other.mjs'), output(valid))
    assert.equal(output(valid).includes('FAIL write_scope.outside lib/contract/ok.mjs'), false)

    const broken = path.join(dir, 'no-front-matter.md')
    fs.writeFileSync(broken, '# no front matter\n', 'utf8')
    const missing = runNode(WRITE_SCOPE, ['--root', dir, '--base', 'HEAD', '--scope-from', broken])
    assert.equal(missing.status, 2, output(missing))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-073] check-no-collab reports zero references in the repository', () => {
  const result = runNode(NO_COLLAB, [])
  assert.equal(result.status, 0, output(result))
  assert.match(String(result.stdout ?? ''), /^check-no-collab: ok \(scanned \d+ files\)$/m)
})

test('[AC-073] check-no-collab reports the violating fixture and passes the clean fixture', () => {
  const fixtures = path.join(ROOT, 'test', 'fixtures', 'no-collab')
  const violating = runNode(NO_COLLAB, ['--root', path.join(fixtures, 'violating')])
  assert.equal(violating.status, 1, output(violating))
  assert.deepStrictEqual(String(violating.stdout ?? '').split(/\r?\n/).filter(Boolean), [
    'FAIL no_collab contracts/d.json:2',
    'FAIL no_collab docs/e.md:3',
    'FAIL no_collab lib/a.mjs:1',
    'FAIL no_collab package.json:2',
    'FAIL no_collab scripts/b.mjs:2',
    'FAIL no_collab test/c.txt:1',
    'check-no-collab: FAILED (6 violations)',
  ])

  const clean = runNode(NO_COLLAB, ['--root', path.join(fixtures, 'clean')])
  assert.equal(clean.status, 0, output(clean))
  assert.equal(String(clean.stdout ?? '').trim(), 'check-no-collab: ok (scanned 2 files)')
})

test('[AC-073] gen-contract-doc output equals the committed docs/contract.md', () => {
  const committed = fs.readFileSync(path.join(ROOT, 'docs', 'contract.md'), 'utf8')
  const rendered = renderContractDoc(ROOT)
  assert.equal(rendered, committed.replace(/\r\n/g, '\n'))
  assert.equal(rendered.includes('\r'), false)
  assert.notEqual(rendered.charCodeAt(0), 0xfeff)
  assert.equal(rendered.endsWith('\n'), true)
  assert.equal(rendered.endsWith('\n\n'), false)
})

test('[AC-073] check-contract-doc fails on a stale document', () => {
  const dir = tmp('cliworker-contract-doc-')
  try {
    copyDir(CONTRACTS, path.join(dir, 'contracts'))
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true })
    fs.copyFileSync(path.join(ROOT, 'docs', 'contract.md'), path.join(dir, 'docs', 'contract.md'))
    const fresh = runNode(CONTRACT_DOC, ['--root', dir])
    assert.equal(fresh.status, 0, output(fresh))

    fs.appendFileSync(path.join(dir, 'docs', 'contract.md'), 'x')
    const stale = runNode(CONTRACT_DOC, ['--root', dir])
    assert.equal(stale.status, 1, output(stale))
    assert.ok(output(stale).includes('FAIL contract_doc.stale docs/contract.md'), output(stale))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-073] snapshot contains every code, trigger, threshold, reason, mapping and semantic_change of interfaces section 5', () => {
  const snapshot = readJson(path.join(CONTRACTS, 'registry.snapshot.json'))

  const codes = [
    'E_INTERNAL',
    'E_REQUEST_INVALID',
    'E_LEVEL_REQUIRED',
    'E_LEVEL_UNKNOWN',
    'E_SCHEMA_UNSUPPORTED',
    'E_UNSAFE_ARG',
    'E_UNKNOWN_COMMAND',
    'E_VIEW_FORBIDDEN',
    'E_CONFIG',
    'E_CONFIG_EXAMPLE',
    'E_CONFIG_EXISTS',
    'E_CONFIG_SECRET_INLINE',
    'E_SECRET_BACKEND',
    'E_STATE_LOCKED',
    'E_TIMEOUT',
    'E_NO_CANDIDATE',
    'E_INSUFFICIENT_QUOTA',
    'E_LEASE_UNKNOWN',
    'E_LEASE_EXPIRED',
    'E_LEASE_CONSUMED',
    'E_LEASE_CONFIG_MISMATCH',
    'E_PROVIDER_AUTH',
    'E_PROVIDER_QUOTA',
    'E_PROVIDER_FAILED',
    'E_ADMIN_REQUIRED',
    'E_LOOPBACK_ONLY',
    'E_READONLY',
    'E_CSRF',
    'E_HEALTH_DEGRADED',
    'E_SMOKE_DISABLED',
  ]
  assert.deepStrictEqual(snapshot.codes.map((entry) => entry.code), codes)

  assert.deepStrictEqual(snapshot.warning_codes, [
    'W_FIELD_IGNORED',
    'W_FIELD_DEPRECATED',
    'W_CONFIG_V1',
    'W_STALE_DATA',
    'W_DRAFT_DEPRECATED',
    'W_MODELS_MANUAL_REQUIRED',
    'W_LEGACY_USAGE',
    'W_TEST_CLOCK',
  ])
  assert.deepStrictEqual(snapshot.reject_reasons.v1, [
    'excluded',
    'level_mismatch',
    'level_unassigned',
    'availability_unverified',
    'availability_blocked',
    'availability_unavailable',
    'availability_stale',
    'deprecated',
    'identity_unverified',
    'identity_mismatch',
    'readonly_unavailable',
    'adapter_unverified',
    'quota_low',
    'quota_unknown_policy',
    'reserve_protected',
  ])
  assert.deepStrictEqual(snapshot.reject_reasons.admin_only, ['not_allowed'])
  assert.deepStrictEqual(snapshot.reject_reasons.draft, [
    'excluded',
    'not_in_workspace_order',
    'level:<Level>',
    'availability:<state>',
    'identity_unverified',
    'readonly_unavailable',
    'E_FORECAST_EXHAUSTION',
  ])
  assert.deepStrictEqual(snapshot.forecast_reasons, [
    'no_samples',
    'capacity_unknown',
    'ledger_capacity_unknown',
    'credits_conversion_missing',
    'usd_samples_missing',
    'reading_stale',
    'window_unknown',
  ])
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
  assert.deepStrictEqual(snapshot.write_route_order, ['session', 'readonly', 'csrf', 'body'])
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
  assert.deepStrictEqual(snapshot.draft_reason_mapping, REGISTRY.draft_reason_mapping)
})

test('[AC-073] new check scripts are discoverable by check-fast', () => {
  const names = fs.readdirSync(SCRIPTS).filter((name) => name.endsWith('.mjs'))
  for (const name of names.filter((item) => item.startsWith('check-'))) {
    assert.match(name, /^check-.*\.mjs$/)
  }
  for (const name of [
    'check-contract-doc.mjs',
    'check-golden-frozen.mjs',
    'check-no-collab.mjs',
    'check-write-scope.mjs',
  ]) {
    assert.ok(names.includes(name), `${name} is missing`)
    assert.equal(fs.statSync(path.join(SCRIPTS, name)).isFile(), true)
  }
})
