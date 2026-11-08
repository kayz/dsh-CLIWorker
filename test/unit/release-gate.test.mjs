import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

const cases = [
  ['good', 0], ['node-alternative', 0], ['ci-fail', 1, 'AC-001'],
  ['baseline-skip', 1, 'AC-001'], ['wrong-os', 1, 'AC-027'],
  ['dry-run', 1, 'AC-038'], ['unredacted', 1, 'AC-038'], ['wrong-version', 1, 'AC-038'],
  ['unmapped-smoke', 1, 'AC-038'], ['smoke-fail', 1, 'AC-038'], ['mandatory-skip', 1, 'AC-038'],
  ['waived-missing-smoke', 0, 'AC-038'], ['waived-mandatory-skip', 1, 'AC-038'],
  ['non-real-waiver', 1, 'AC-001'], ['stale-waiver', 1, 'AC-038'], ['planned', 1, 'AC-001'],
  ['missing-smoke', 1, 'AC-038'], ['missing-manifest', 1], ['missing-reporter', 1],
  ['missing-skips', 1], ['filtered', 1], ['missing-executed-file', 1, 'AC-001'],
  ['missing-result', 1, 'AC-001'], ['malformed-report', 1], ['malformed-waivers', 1], ['missing-waivers', 1],
  ['invalid-index', 1], ['duplicate-owner', 1], ['forged-baseline', 1],
  ['unknown-waiver', 1], ['duplicate-waiver', 1], ['blank-approval', 1],
  ['truncated-tap', 1], ['todo', 1, 'AC-001'], ['skip-conflict', 1],
  ['untagged-fail', 1], ['ac069-skip', 1, 'AC-069'], ['nonrequired-skip', 0],
  ['waived-pass', 0], ['empty-artifacts', 1], ['no-shards', 1], ['fake-pass', 1, 'AC-001'],
]
for (const [name, code, ac] of cases) {
  test(`[AC-070] release evidence ${name}`, () => {
    const root = path.resolve('test/fixtures/release-gate', name)
    const result = spawnSync(process.execPath, ['scripts/release-gate.mjs', '--root', root,
      '--ci-artifacts', path.join(root, 'ci'), '--smoke-report', path.join(root, 'smoke.json'),
      '--waivers', path.join(root, 'release/waivers.json')], { encoding: 'utf8', windowsHide: true })
    assert.ifError(result.error)
    assert.equal(result.status, code, result.stdout + result.stderr)
    const lines = result.stdout.trim().split(/\r?\n/)
    assert.equal(lines.at(-1), `release-gate: ${code ? 'BLOCKED' : 'PASS'}`)
    if (code) assert.ok(lines.some(line => line.startsWith(ac ? `BLOCKED ${ac} ` : 'BLOCKED ')))
    else {
      const index = JSON.parse(fs.readFileSync(path.join(root, 'contracts/spec/ac-index.json')))
      assert.ok(!lines.some(line => line.startsWith('BLOCKED ')))
      for (const entry of index.acs) {
        const status = ['waived-missing-smoke', 'waived-pass'].includes(name) && entry.ac === 'AC-038' ? 'WAIVED' : 'PASS'
        assert.equal(lines.filter(line => line.startsWith(`${status} ${entry.ac} `)).length, 1, entry.ac)
      }
    }
  })
}
test('[AC-070] invalid CLI usage returns 2', () => {
  const result = spawnSync(process.execPath, ['scripts/release-gate.mjs', '--unknown'], { encoding: 'utf8' })
  assert.equal(result.status, 2)
})
