import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { extractTitles } from '../../scripts/check-traceability.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const GATE = path.join(ROOT, 'scripts', 'milestone-gate.mjs')
const DEFECTS = path.join(ROOT, 'scripts', 'check-defects.mjs')
const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'milestone-gate')
const M2_PLANNED = path.join(FIXTURES, 'm2-planned')
const M4_NOCACHE = path.join(FIXTURES, 'm4-nocache')

function runGate(milestone, root) {
  return spawnSync(process.execPath, [GATE, '--milestone', milestone, '--root', root], { encoding: 'utf8' })
}

function runDefects(args) {
  return spawnSync(process.execPath, [DEFECTS, ...args], { encoding: 'utf8' })
}

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

test('[AC-074] m2-planned: M1 passes while M2 is blocked by a planned AC and a missing fix', () => {
  const m1 = runGate('M1', M2_PLANNED)
  assert.equal(m1.status, 0, output(m1))
  assert.match(m1.stdout, /milestone-gate M1: PASS/)

  const m2 = runGate('M2', M2_PLANNED)
  assert.equal(m2.status, 1, output(m2))
  assert.match(m2.stdout, /milestone-gate M2: BLOCKED/)
  assert.match(m2.stdout, /gate\.ac_not_covered[^\n]*AC-026/)
  assert.match(m2.stdout, /defects\.missing_fixed[^\n]*a5-shell/)
  assert.ok(!/gate\.ac_not_covered[^\n]*AC-001/.test(m2.stdout))
})

test('[AC-074] m4-nocache: M3 passes while M4 is blocked only by the missing fix', () => {
  const m3 = runGate('M3', M4_NOCACHE)
  assert.equal(m3.status, 0, output(m3))
  assert.match(m3.stdout, /milestone-gate M3: PASS/)

  const m4 = runGate('M4', M4_NOCACHE)
  assert.equal(m4.status, 1, output(m4))
  assert.match(m4.stdout, /milestone-gate M4: BLOCKED/)
  assert.match(m4.stdout, /defects\.missing_fixed[^\n]*a5-nocache/)
  assert.ok(!/gate\.ac_not_covered/.test(m4.stdout))
})

test('[AC-074] check-defects default mode only demands a fix for covered ACs', () => {
  const planned = runDefects(['--root', M2_PLANNED])
  assert.equal(planned.status, 0, output(planned))
  assert.match(planned.stdout, /check-defects: ok/)

  const covered = runDefects(['--root', M4_NOCACHE])
  assert.equal(covered.status, 1, output(covered))
  assert.match(covered.stdout, /defects\.missing_fixed[^\n]*a5-nocache/)
})

test('[AC-074] check-defects --milestone demands a fix for every defect up to that milestone', () => {
  const m1 = runDefects(['--milestone', 'M1', '--root', M2_PLANNED])
  assert.equal(m1.status, 0, output(m1))
  assert.ok(!/defects\.set_mismatch/.test(m1.stdout))
  assert.ok(!/defects\.missing_fixed/.test(m1.stdout))

  const m2 = runDefects(['--milestone', 'M2', '--root', M2_PLANNED])
  assert.equal(m2.status, 1, output(m2))
  assert.ok(!/defects\.set_mismatch/.test(m2.stdout))
  assert.match(m2.stdout, /defects\.missing_fixed/)

  const m5 = runDefects(['--milestone', 'M5', '--root', M2_PLANNED])
  assert.equal(m5.status, 1, output(m5))
  assert.match(m5.stdout, /defects\.set_mismatch/)

  const invalid = runDefects(['--milestone', 'M9', '--root', M2_PLANNED])
  assert.equal(invalid.status, 2, output(invalid))
})

test('[AC-074] the milestone gate refuses to run without a valid milestone', () => {
  const missing = spawnSync(process.execPath, [GATE, '--root', M2_PLANNED], { encoding: 'utf8' })
  assert.equal(missing.status, 2, output(missing))

  const invalid = spawnSync(process.execPath, [GATE, '--milestone', 'M9', '--root', M2_PLANNED], {
    encoding: 'utf8',
  })
  assert.equal(invalid.status, 2, output(invalid))
})

test('[AC-074] extractTitles only counts plain titles for [fixed] and [repro]', () => {
  const source = [
    "test('[repro] broken today', () => {})",
    "test('[fixed] repaired', () => {})",
    "test.skip('[fixed] not a fix', () => {})",
    "test.todo('[fixed] still todo')",
  ].join('\n')

  const titles = extractTitles(source)
  const plain = titles.filter((item) => item.kind === 'plain').map((item) => item.title)
  assert.ok(plain.some((title) => title.startsWith('[fixed]')))
  assert.ok(plain.some((title) => title.startsWith('[repro]')))
  assert.equal(plain.filter((title) => title.startsWith('[fixed]')).length, 1)
})
