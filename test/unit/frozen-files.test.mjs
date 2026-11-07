import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { checkFrozenFiles } from '../../scripts/check-frozen-files.mjs'
import { checkRepros, reproSha256 } from '../../scripts/check-defects.mjs'

const COPY = 'test/fixtures/characterization/v0.1/'
const STABLE = 'test/characterization/stable.test.mjs'
const SELECT = `${COPY}lib/select.mjs`

function digest(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

function entry(rel, text) {
  return { path: rel, sha256: digest(text) }
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cw-frozen-unit-'))
}

function write(root, rel, text) {
  const file = path.join(root, ...rel.split('/'))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

function copyFiles() {
  return {
    [SELECT]: "export const level = 'Quick'\n",
    [`${COPY}config/cliworker.example.json`]: '{"providers":{}}\n',
    [STABLE]: "test('[AC-005] stable: placeholder', () => {})\n",
  }
}

function manifestRoot(files, registered) {
  const root = tempRoot()
  for (const [rel, text] of Object.entries(files)) write(root, rel, text)
  const manifest = { source_commit: 'f75bb76', files: registered }
  write(root, 'test/characterization/frozen-files.json', JSON.stringify(manifest, null, 2) + '\n')
  return root
}

function registeredFrom(files, extras = []) {
  return [...Object.keys(files).map((rel) => entry(rel, files[rel])), ...extras]
}

function clean(root) {
  fs.rmSync(root, { recursive: true, force: true })
}

const ZERO = '0'.repeat(64)

const MINI_REPRO = [
  "import test from 'node:test'",
  "import assert from 'node:assert/strict'",
  "import path from 'node:path'",
  "import { pathToFileURL } from 'node:url'",
  '',
  "test('[repro] mini defect is present', async () => {",
  "  const mod = await import(pathToFileURL(path.join(process.env.CLIWORKER_V01_ROOT, 'lib', 'select.mjs')).href)",
  "  assert.equal(mod.BROKEN, true)",
  '})',
  '',
].join('\n')

const ALWAYS_REPRO = [
  "import test from 'node:test'",
  "import assert from 'node:assert/strict'",
  '',
  "test('[repro] the repro is a tautology', () => {",
  '  assert.ok(true)',
  '})',
  '',
].join('\n')

function ledgerFor(repro) {
  return {
    id: 'mini',
    owner_task: 'T-001',
    owner_milestone: 'M1',
    ac: 'AC-001',
    repro_sha256: reproSha256(repro),
  }
}

function defectRoot({ repro, copy = "export const BROKEN = true\n", overlay = "export const BROKEN = false\n", canary = true, edits = undefined }) {
  const root = tempRoot()
  write(root, SELECT, copy)
  write(root, 'test/characterization/defects/mini.test.mjs', repro)
  if (canary) {
    const data = { defect: 'mini' }
    if (edits !== undefined) data.repro_edits = edits
    write(root, 'test/characterization/canary/mini/canary.json', JSON.stringify(data, null, 2) + '\n')
    if (overlay !== null) write(root, 'test/characterization/canary/mini/overlay/lib/select.mjs', overlay)
  }
  return root
}

function ids(errors) {
  return errors.map((error) => error.id)
}

test('[AC-005] frozen: untouched fixture root passes', () => {
  const files = copyFiles()
  const root = manifestRoot(files, registeredFrom(files))
  try {
    const { errors, count } = checkFrozenFiles({ root })
    assert.deepEqual(errors, [])
    assert.equal(count, 3)
  } finally {
    clean(root)
  }
})

test('[AC-005] frozen: changing one registered byte fails with frozen.hash_mismatch', () => {
  const files = copyFiles()
  const root = manifestRoot(files, registeredFrom(files))
  try {
    write(root, SELECT, "export const level = 'High'\n")
    const { errors } = checkFrozenFiles({ root })
    assert.deepEqual(ids(errors), ['frozen.hash_mismatch'])
    assert.equal(errors[0].detail, SELECT)
  } finally {
    clean(root)
  }
})

test('[AC-005] frozen: CRLF checkout of a registered file still passes', () => {
  const files = copyFiles()
  const root = manifestRoot(files, registeredFrom(files))
  try {
    write(root, SELECT, files[SELECT].replace(/\n/g, '\r\n'))
    write(root, STABLE, files[STABLE].replace(/\n/g, '\r\n'))
    const { errors } = checkFrozenFiles({ root })
    assert.deepEqual(errors, [])
  } finally {
    clean(root)
  }
})

test('[AC-005] frozen: lib/, bin/ and config/ paths are rejected as frozen.forbidden_path', () => {
  const files = copyFiles()
  const root = manifestRoot(files, registeredFrom(files, [
    { path: 'lib/select.mjs', sha256: ZERO },
    { path: 'bin/cliworker.mjs', sha256: ZERO },
    { path: 'config/cliworker.example.json', sha256: ZERO },
  ]))
  try {
    const { errors } = checkFrozenFiles({ root })
    assert.deepEqual(ids(errors), ['frozen.forbidden_path', 'frozen.forbidden_path', 'frozen.forbidden_path'])
    assert.deepEqual(errors.map((error) => error.detail), [
      'lib/select.mjs',
      'bin/cliworker.mjs',
      'config/cliworker.example.json',
    ])
  } finally {
    clean(root)
  }
})

test('[AC-005] frozen: scripts/ and other unlisted paths fail with frozen.outside_allowed', () => {
  const files = copyFiles()
  const root = manifestRoot(files, registeredFrom(files, [
    { path: 'scripts/run-tests.mjs', sha256: ZERO },
    { path: 'package.json', sha256: ZERO },
  ]))
  try {
    const { errors } = checkFrozenFiles({ root })
    assert.deepEqual(ids(errors), ['frozen.outside_allowed', 'frozen.outside_allowed'])
    assert.deepEqual(errors.map((error) => error.detail), ['scripts/run-tests.mjs', 'package.json'])
  } finally {
    clean(root)
  }
})

test('[AC-005] frozen: contracts/spec and contracts/golden paths are allowed', () => {
  const files = copyFiles()
  files['contracts/spec/surfaces.json'] = '{}\n'
  files['contracts/golden/select.json'] = '{}\n'
  const root = manifestRoot(files, registeredFrom(files))
  try {
    const { errors, count } = checkFrozenFiles({ root })
    assert.deepEqual(errors, [])
    assert.equal(count, 5)
  } finally {
    clean(root)
  }
})

test('[AC-005] frozen: unregistered file in the v0.1 copy fails with frozen.unregistered', () => {
  const files = copyFiles()
  const root = manifestRoot(files, registeredFrom(files))
  try {
    write(root, `${COPY}README.md`, 'x\n')
    const { errors } = checkFrozenFiles({ root })
    assert.deepEqual(ids(errors), ['frozen.unregistered'])
    assert.equal(errors[0].detail, `${COPY}README.md`)
  } finally {
    clean(root)
  }
})

test('[AC-005] frozen: missing registered file fails with frozen.file_missing', () => {
  const files = copyFiles()
  const root = manifestRoot(files, registeredFrom(files, [
    { path: `${COPY}lib/forecast.mjs`, sha256: ZERO },
  ]))
  try {
    const { errors } = checkFrozenFiles({ root })
    assert.deepEqual(ids(errors), ['frozen.file_missing'])
    assert.equal(errors[0].detail, `${COPY}lib/forecast.mjs`)
  } finally {
    clean(root)
  }
})

test('[AC-005] frozen: path traversal and absolute paths are rejected', () => {
  const files = copyFiles()
  const root = manifestRoot(files, registeredFrom(files, [
    { path: '../outside.json', sha256: ZERO },
    { path: 'C:/tmp/outside.json', sha256: ZERO },
    { path: 'lib\\select.mjs', sha256: ZERO },
  ]))
  try {
    const { errors } = checkFrozenFiles({ root })
    assert.deepEqual(ids(errors), ['frozen.outside_allowed', 'frozen.outside_allowed', 'frozen.outside_allowed'])
  } finally {
    clean(root)
  }
})

test('[AC-005] defects: well-formed fixture ledger passes', () => {
  const root = defectRoot({ repro: MINI_REPRO })
  try {
    const { errors } = checkRepros({ root, defects: [ledgerFor(MINI_REPRO)] })
    assert.deepEqual(errors, [])
  } finally {
    clean(root)
  }
})

test('[AC-005] defects: repro edited after registration fails with defects.repro_changed', () => {
  const root = defectRoot({ repro: MINI_REPRO })
  try {
    const edited = MINI_REPRO.replace('assert.equal(mod.BROKEN, true)', 'assert.equal(mod.BROKEN, true, "edited")')
    write(root, 'test/characterization/defects/mini.test.mjs', edited)
    const { errors } = checkRepros({ root, defects: [ledgerFor(MINI_REPRO)] })
    assert.deepEqual(ids(errors), ['defects.repro_changed'])
  } finally {
    clean(root)
  }
})

test('[AC-005] defects: canary that still passes fails with defects.canary_survived', () => {
  const root = defectRoot({ repro: ALWAYS_REPRO })
  try {
    const { errors } = checkRepros({ root, defects: [ledgerFor(ALWAYS_REPRO)] })
    assert.deepEqual(ids(errors), ['defects.canary_survived'])
  } finally {
    clean(root)
  }
})

test('[AC-005] defects: missing canary fails with defects.canary_missing', () => {
  const root = defectRoot({ repro: MINI_REPRO, canary: false })
  try {
    const { errors } = checkRepros({ root, defects: [ledgerFor(MINI_REPRO)] })
    assert.deepEqual(ids(errors), ['defects.canary_missing'])
  } finally {
    clean(root)
  }
})

test('[AC-005] defects: repro failing on the unmodified copy fails with defects.repro_baseline_failed', () => {
  const root = defectRoot({ repro: MINI_REPRO, copy: 'export const BROKEN = false\n' })
  try {
    const { errors } = checkRepros({ root, defects: [ledgerFor(MINI_REPRO)] })
    assert.deepEqual(ids(errors), ['defects.repro_baseline_failed'])
  } finally {
    clean(root)
  }
})

test('[AC-005] defects: a repro that cannot even load is not counted as a canary hit', () => {
  const root = defectRoot({
    repro: MINI_REPRO,
    overlay: null,
    edits: [{ find: 'assert.equal(mod.BROKEN, true)', replace: 'assert.equal(mod.BROKEN,' }],
  })
  try {
    const { errors } = checkRepros({ root, defects: [ledgerFor(MINI_REPRO)] })
    assert.ok(errors.length > 0)
    assert.ok(
      ['defects.canary_survived', 'defects.canary_error'].includes(errors[0].id),
      `unexpected ${errors[0].id}`
    )
  } finally {
    clean(root)
  }
})
