import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP_IDS, validateReport } from './report.mjs'

test('[AC-069] report structure and semantics reject malformed reports', () => {
  const report = {
    schema: 'cliworker.smoke/v1', mode: 'dry-run', version: 'fixture', platform: process.platform,
    node: process.version, redacted: true,
    steps: STEP_IDS.map(id => ({ id, ac: [id === 'wsl-discover' ? 'AC-038' : 'AC-069'], mandatory: true, status: 'pass', reason: null, duration_ms: 0 })),
  }
  assert.equal(validateReport(report, 'fixture').ok, true)
  const variants = [
    r => { delete r.node }, r => { r.extra = true }, r => { r.version = 'wrong' },
    r => { r.steps = [] }, r => { r.steps[1].id = r.steps[0].id },
    r => { [r.steps[0], r.steps[1]] = [r.steps[1], r.steps[0]] },
    r => { r.steps[0].ac = [] }, r => { r.steps[1].ac = ['AC-069'] },
    r => { r.steps[0].status = 'unknown' }, r => { r.steps[0].duration_ms = -1 },
    r => { r.steps[0].duration_ms = Infinity }, r => { r.steps[0].status = 'fail' },
    r => { r.steps[0].mandatory = false },
  ]
  for (const change of variants) {
    const candidate = structuredClone(report)
    change(candidate)
    assert.equal(validateReport(candidate, 'fixture').ok, false)
  }
})
