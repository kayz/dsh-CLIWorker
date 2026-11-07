import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { enumerateTestFiles, findOrphans, verifyFullRun } from '../../scripts/run-tests.mjs'
import { platformTest } from '../helpers/platform-gate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SCRIPTS = path.join(ROOT, 'scripts')
const RUN_TESTS = path.join(SCRIPTS, 'run-tests.mjs')
const CHECK_FAST = path.join(SCRIPTS, 'check-fast.mjs')
const CHECK_FAST_PS1 = path.join(SCRIPTS, 'check-fast.ps1')
const CHECK_DISCOVERY = path.join(SCRIPTS, 'check-test-discovery.mjs')
const CHECK_CI = path.join(SCRIPTS, 'check-ci.mjs')
const OK_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'discovery-selftest', 'ok')
const SELF = 'test/unit/runner-selftest.test.mjs'

function tmp(prefix = 'cliworker-selftest-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function run(args, options = {}) {
  return spawnSync(process.execPath, args, { encoding: 'utf8', ...options })
}

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

function freshCiRoot() {
  const dir = tmp('cliworker-ci-')
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true })
  fs.copyFileSync(path.join(SCRIPTS, 'ci-matrix.json'), path.join(dir, 'scripts', 'ci-matrix.json'))
  fs.copyFileSync(
    path.join(ROOT, '.github', 'workflows', 'ci.yml'),
    path.join(dir, '.github', 'workflows', 'ci.yml')
  )
  return dir
}

function writeMatrix(dir, matrix) {
  fs.writeFileSync(path.join(dir, 'scripts', 'ci-matrix.json'), `${JSON.stringify(matrix, null, 2)}\n`)
}

function readMatrix(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'scripts', 'ci-matrix.json'), 'utf8'))
}

function writeStep(dir, name, body) {
  fs.writeFileSync(path.join(dir, name), `import fs from 'node:fs'\n${body}\n`)
}

const APPEND = (value) => `fs.appendFileSync(process.env.CW_LOG, '${value}\\n')`

test('[AC-001] enumeration covers the seven roots and excludes fixtures, helpers and perf', () => {
  const files = enumerateTestFiles(ROOT)
  assert.ok(files.includes(SELF), `expected ${SELF} in ${files.join(',')}`)
  assert.ok(files.includes('test/unit/select.test.mjs'))
  assert.ok(files.includes('test/characterization/defects/a3-runner.test.mjs'))
  for (const file of files) {
    assert.ok(!/^test\/(fixtures|helpers|perf)\//.test(file), `excluded path leaked: ${file}`)
  }
  assert.deepEqual(findOrphans(ROOT), [])
})

test('[AC-001] verifyFullRun reports every kind of drift and rejects a filtered manifest', () => {
  const enumerated = ['test/unit/a.test.mjs']
  assert.deepEqual(verifyFullRun({ enumerated, manifest: { mode: 'full', files: [...enumerated] } }).errors, [])

  const missing = verifyFullRun({
    enumerated: ['test/unit/a.test.mjs', 'test/unit/b.test.mjs'],
    manifest: { mode: 'full', files: ['test/unit/a.test.mjs'] },
  })
  assert.ok(missing.errors.some((error) => error.id === 'discovery.missing' && error.path === 'test/unit/b.test.mjs'))

  const unexpected = verifyFullRun({
    enumerated,
    manifest: { mode: 'full', files: ['test/unit/a.test.mjs', 'test/fixtures/x.test.mjs'] },
  })
  assert.ok(unexpected.errors.some((error) => error.id === 'discovery.unexpected'))

  const filtered = verifyFullRun({ enumerated, manifest: { mode: 'filtered', files: [...enumerated] } })
  assert.deepEqual(filtered.errors.map((error) => error.id), ['discovery.mode_not_full'])

  const empty = verifyFullRun({ enumerated: [], manifest: { mode: 'full', files: [] } })
  assert.ok(empty.errors.some((error) => error.id === 'discovery.no_files'))
})

test('[AC-001] a full run on the ok fixture produces an exactly matching manifest', () => {
  const out = tmp('cliworker-full-')
  try {
    const result = run([RUN_TESTS, '--root', OK_FIXTURE, '--out-dir', out])
    assert.equal(result.status, 0, output(result))
    assert.match(result.stdout, /run-tests: full/)
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'files-executed.json'), 'utf8'))
    assert.equal(manifest.mode, 'full')
    assert.equal(manifest.filter, '')
    assert.deepEqual(manifest.files, [
      'test/flows/c.test.mjs',
      'test/integration/b.test.mjs',
      'test/unit/a.test.mjs',
    ])
    assert.ok(fs.existsSync(path.join(out, 'skips.jsonl')))
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})

test('[AC-001] a filtered run writes a filtered manifest and skips the comparison', () => {
  const out = tmp('cliworker-filtered-')
  try {
    const result = run([RUN_TESTS, '--root', OK_FIXTURE, '--ac', 'AC-001', '--out-dir', out])
    assert.equal(result.status, 0, output(result))
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'files-executed.json'), 'utf8'))
    assert.equal(manifest.mode, 'filtered')
    assert.equal(manifest.filter, 'AC-001')
    assert.deepEqual(manifest.files, ['test/unit/a.test.mjs'])
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})

test('[AC-001] the discovery self-test passes end to end', () => {
  const result = run([CHECK_DISCOVERY])
  assert.equal(result.status, 0, output(result))
  assert.match(result.stdout, /check-test-discovery: ok/)
})

test('[AC-001] platformTest writes a cliworker.skip/v1 record when the requirement is unmet', () => {
  const dir = tmp('cliworker-skip-')
  try {
    const probe = path.join(dir, 'probe.test.mjs')
    const gateUrl = pathToFileURL(path.join(ROOT, 'test', 'helpers', 'platform-gate.mjs')).href
    fs.writeFileSync(
      probe,
      [
        `import { platformTest } from ${JSON.stringify(gateUrl)}`,
        "platformTest('[probe] records a skip', { ac: 'AC-001', requires: 'not-a-platform', file: import.meta.url, reason: 'probe skip' }, () => {",
        "  throw new Error('the body must not run')",
        '})',
        '',
      ].join('\n')
    )

    const result = run([probe], { env: { ...process.env, CLIWORKER_RESULTS_DIR: dir } })
    assert.equal(result.status, 0, output(result))

    const lines = fs.readFileSync(path.join(dir, 'skips.jsonl'), 'utf8').trim().split('\n')
    assert.equal(lines.length, 1)
    const record = JSON.parse(lines[0])
    assert.equal(record.schema, 'cliworker.skip/v1')
    assert.equal(record.test, '[probe] records a skip')
    assert.match(record.file, /probe\.test\.mjs$/)
    assert.equal(record.ac, 'AC-001')
    assert.equal(record.requires, 'not-a-platform')
    assert.equal(record.platform, process.platform)
    assert.equal(record.node, process.version)
    assert.equal(record.reason, 'probe skip')
    assert.ok(!Number.isNaN(Date.parse(record.at)))
    assert.deepEqual(Object.keys(record).sort(), [
      'ac',
      'at',
      'file',
      'node',
      'platform',
      'reason',
      'requires',
      'schema',
      'test',
    ])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-002] check-ci accepts the committed workflow', () => {
  const result = run([CHECK_CI])
  assert.equal(result.status, 0, output(result))
  assert.match(result.stdout, /check-ci: ok/)
})

test('[AC-002] check-ci rejects a stale, malformed or unblocked matrix', () => {
  const stale = freshCiRoot()
  try {
    fs.appendFileSync(path.join(stale, '.github', 'workflows', 'ci.yml'), '# x\n')
    const result = run([CHECK_CI, '--root', stale])
    assert.equal(result.status, 1)
    assert.match(output(result), /ci\.stale/)
  } finally {
    fs.rmSync(stale, { recursive: true, force: true })
  }

  const oneChar = freshCiRoot()
  try {
    const file = path.join(oneChar, '.github', 'workflows', 'ci.yml')
    const text = fs.readFileSync(file, 'utf8')
    fs.writeFileSync(file, text.replace('name: ci', 'name: CJ'))
    const result = run([CHECK_CI, '--root', oneChar])
    assert.equal(result.status, 1)
    assert.match(output(result), /ci\.stale/)
  } finally {
    fs.rmSync(oneChar, { recursive: true, force: true })
  }

  const missing = freshCiRoot()
  try {
    fs.rmSync(path.join(missing, '.github', 'workflows', 'ci.yml'))
    const result = run([CHECK_CI, '--root', missing])
    assert.equal(result.status, 1)
    assert.match(output(result), /ci\.missing/)
  } finally {
    fs.rmSync(missing, { recursive: true, force: true })
  }

  const blocking = freshCiRoot()
  try {
    const matrix = readMatrix(blocking)
    matrix.perf.blocking = true
    writeMatrix(blocking, matrix)
    const result = run([CHECK_CI, '--root', blocking])
    assert.equal(result.status, 1)
    assert.match(output(result), /ci\.matrix_invalid/)
  } finally {
    fs.rmSync(blocking, { recursive: true, force: true })
  }

  const oneNode = freshCiRoot()
  try {
    const matrix = readMatrix(oneNode)
    matrix.node = [20]
    writeMatrix(oneNode, matrix)
    const result = run([CHECK_CI, '--root', oneNode])
    assert.equal(result.status, 1)
    assert.match(output(result), /ci\.matrix_invalid/)
  } finally {
    fs.rmSync(oneNode, { recursive: true, force: true })
  }

  const noWindows = freshCiRoot()
  try {
    const matrix = readMatrix(noWindows)
    matrix.os = matrix.os.filter((item) => item.name !== 'windows')
    writeMatrix(noWindows, matrix)
    const result = run([CHECK_CI, '--root', noWindows])
    assert.equal(result.status, 1)
    assert.match(output(result), /ci\.matrix_invalid/)
  } finally {
    fs.rmSync(noWindows, { recursive: true, force: true })
  }
})

test('[AC-003] check-fast stops at the first failure and propagates its exit code', () => {
  const dir = tmp('cliworker-fast-fail-')
  const log = path.join(dir, 'log.txt')
  try {
    writeStep(dir, 'check-a.mjs', APPEND('a'))
    writeStep(dir, 'check-b.mjs', `${APPEND('b')}\nprocess.exit(7)`)
    writeStep(dir, 'check-c.mjs', APPEND('c'))
    writeStep(dir, 'final.mjs', APPEND('final'))

    const result = run([CHECK_FAST], {
      env: {
        ...process.env,
        CW_LOG: log,
        CLIWORKER_TEST_CHECK_DIR: dir,
        CLIWORKER_TEST_FINAL_SCRIPT: path.join(dir, 'final.mjs'),
      },
    })
    assert.equal(result.status, 7, output(result))
    assert.match(output(result), /check-b\.mjs/)
    assert.equal(fs.readFileSync(log, 'utf8').trim(), 'a\nb')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-003] check-fast runs the steps in code point order and skips its own file', () => {
  const dir = tmp('cliworker-fast-ok-')
  const log = path.join(dir, 'log.txt')
  try {
    writeStep(dir, 'check-a.mjs', APPEND('a'))
    writeStep(dir, 'check-b.mjs', APPEND('b'))
    writeStep(dir, 'check-c.mjs', APPEND('c'))
    writeStep(dir, 'check-fast.mjs', APPEND('SELF'))
    writeStep(dir, 'final.mjs', APPEND('final'))

    const result = run([CHECK_FAST], {
      env: {
        ...process.env,
        CW_LOG: log,
        CLIWORKER_TEST_CHECK_DIR: dir,
        CLIWORKER_TEST_FINAL_SCRIPT: path.join(dir, 'final.mjs'),
      },
    })
    assert.equal(result.status, 0, output(result))
    assert.equal(fs.readFileSync(log, 'utf8').trim(), 'a\nb\nc\nfinal')
    assert.match(result.stdout, /==> npm test/)
    assert.ok(!result.stdout.includes('==> check-fast.mjs'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

platformTest(
  '[AC-003] the pwsh wrapper forwards the same exit code with a single node call',
  { ac: 'AC-003', requires: 'pwsh', file: import.meta.url },
  () => {
    const dir = tmp('cliworker-fast-pwsh-')
    const log = path.join(dir, 'log.txt')
    try {
      writeStep(dir, 'check-a.mjs', APPEND('a'))
      writeStep(dir, 'check-b.mjs', `${APPEND('b')}\nprocess.exit(7)`)
      writeStep(dir, 'final.mjs', APPEND('final'))

      const result = spawnSync('pwsh', ['-NoProfile', '-File', CHECK_FAST_PS1], {
        encoding: 'utf8',
        env: {
          ...process.env,
          CW_LOG: log,
          CLIWORKER_TEST_CHECK_DIR: dir,
          CLIWORKER_TEST_FINAL_SCRIPT: path.join(dir, 'final.mjs'),
        },
      })
      assert.equal(result.status, 7, output(result))
      assert.match(output(result), /check-b\.mjs/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }

    const lines = fs
      .readFileSync(CHECK_FAST_PS1, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
    assert.ok(lines.length <= 3, `check-fast.ps1 must stay a thin wrapper, got ${lines.length} lines`)
    assert.match(fs.readFileSync(CHECK_FAST_PS1, 'utf8'), /\$LASTEXITCODE/)
    assert.match(fs.readFileSync(CHECK_FAST_PS1, 'utf8'), /check-fast\.mjs/)
  }
)
