import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { discoverSteps, createFlow, runFlow } from '../helpers/flow.mjs'
import { leakScan } from '../helpers/leak-scan.mjs'

const expected = [
  ['auth', 'T-013'], ['doctor', 'T-024'], ['discover', 'T-016'],
  ['enumerate', 'T-036'], ['probe', 'T-020'], ['select', 'T-022'],
  ['run', 'T-023'], ['http-select', 'T-024'], ['http-admin', 'T-024'],
]

test('[AC-071] complete flow uses one sentinel and scans every surface', async () => {
  const steps = await discoverSteps()
  assert.deepEqual(steps.map(step => [step.name, step.mod.introduced_by]), expected)
  const flow = createFlow()
  const sentinel = flow.sentinel
  try {
    // The auth step checks the provider's recorded environment hashes and argv itself.
    const report = await runFlow({ flow })
    assert.deepEqual(report.results.map(step => [step.name, step.introduced_by]), expected)
    assert.ok(report.results.every(step => step.ok), 'flow step failed')
    assert.equal(flow.sentinel === sentinel && flow.sentinels[0].value === sentinel, true)
    assert.equal(Object.values(flow.env).includes(sentinel), true)
    assert.equal(report.ok, true)
    assert.equal(report.leak.ok, true)
    assert.deepEqual(report.leak.hits, [])
    assert.deepEqual(report.leak.errors, [])
    const scan = leakScan({
      sentinels: flow.sentinels, ...flow.captured,
      state_dir: flow.root, auditFile: path.join(flow.state_dir, 'audit.jsonl'),
    })
    assert.equal(scan.ok, true, 'flow leaked or scan failed')
    assert.deepEqual(scan.hits, [])
    assert.deepEqual(scan.errors, [])
    for (const surface of ['argv', 'stdout', 'http', 'files', 'audit']) {
      assert.ok(scan.scanned[surface] > 0, `not scanned: ${surface}`)
    }
  } finally {
    flow.cleanup()
  }
})
