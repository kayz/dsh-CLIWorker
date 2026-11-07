import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const CHECK_SEAMS = path.join(ROOT, 'scripts', 'check-seams.mjs')
const FIXTURES = path.join('test', 'fixtures', 'seams')

const CASES = [
  ['child-process', 'seams.child_process'],
  ['fs', 'seams.fs'],
  ['date-now', 'seams.date_now'],
  ['new-date', 'seams.new_date'],
  ['set-timeout', 'seams.set_timeout'],
  ['set-interval', 'seams.set_interval'],
  ['set-immediate', 'seams.set_immediate'],
  ['node-timers', 'seams.node_timers'],
  ['wall-clock', 'seams.wall_clock'],
  ['process-exit', 'seams.process_exit'],
]

function scan(root) {
  const result = spawnSync(process.execPath, [CHECK_SEAMS, '--root', root, '--json'], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, report: JSON.parse(result.stdout) }
}

test('[AC-007] the real lib tree passes the seam check', () => {
  const result = spawnSync(process.execPath, [CHECK_SEAMS], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout)
  assert.equal(result.stdout.includes('FAIL'), false)
  const last = result.stdout.trim().split('\n').pop()
  assert.match(last, /^check-seams: ok \(files=(1[5-9]|[2-9]\d+)\)$/)
})

test('[AC-007] every violation fixture is reported under its own rule', () => {
  for (const [dir, rule] of CASES) {
    const result = scan(path.join(FIXTURES, dir))
    assert.equal(result.status, 1, `${dir} exited ${result.status}`)
    assert.equal(result.report.ok, false)
    assert.ok(result.report.violations.length > 0, `${dir} reported nothing`)
    assert.ok(result.report.files >= 1)
    for (const violation of result.report.violations) {
      assert.equal(violation.rule, rule, `${dir} reported ${violation.rule}`)
      assert.equal(violation.file, 'lib/bad.mjs')
      assert.ok(Number.isInteger(violation.line) && violation.line >= 1)
    }
  }
})

test('[AC-007] the clean and allowed fixtures pass', () => {
  for (const dir of ['clean', 'allowed']) {
    const result = scan(path.join(FIXTURES, dir))
    assert.equal(result.status, 0, `${dir}: ${result.stdout}`)
    assert.deepEqual(result.report.violations, [])
    assert.ok(result.report.files >= 1)
  }
})

test('[AC-007] the allowlist matches repository-relative paths exactly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-seams-'))
  try {
    fs.mkdirSync(path.join(dir, 'lib', 'commands'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'lib', 'commands', 'exec.mjs'), "import cp from 'node:child_process'\n")
    const result = scan(dir)
    assert.equal(result.status, 1)
    assert.equal(result.report.violations.length, 1)
    assert.equal(result.report.violations[0].rule, 'seams.child_process')
    assert.equal(result.report.violations[0].file, 'lib/commands/exec.mjs')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-007] the CLI prints FAIL lines, a summary and rejects unknown arguments', () => {
  const failing = spawnSync(process.execPath, [CHECK_SEAMS, '--root', path.join(FIXTURES, 'date-now')], {
    encoding: 'utf8',
  })
  assert.equal(failing.status, 1)
  const lines = failing.stdout.trim().split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[0], /^FAIL seams\.date_now lib\/bad\.mjs:\d+$/)
  assert.equal(lines[1], 'check-seams: FAILED (1 violations)')

  const bogus = spawnSync(process.execPath, [CHECK_SEAMS, '--bogus'], { encoding: 'utf8' })
  assert.equal(bogus.status, 2)
  assert.equal(bogus.stdout, '')
  assert.ok(bogus.stderr.includes('usage:'))
})
