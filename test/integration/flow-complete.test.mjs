import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { STEP_ORDER, discoverSteps, createFlow, runFlow } from '../helpers/flow.mjs'
import { leakScan } from '../helpers/leak-scan.mjs'

// 期望的步骤集合从磁盘派生，避免写死列表随新增步骤漂移（历史上这里硬编码导致多次假红）。
// 只固定"每个步骤必须存在"的不变量，以及 introduced_by 的格式。
import fs from 'node:fs'
const STEPS_DIR = new URL('../flows/steps/', import.meta.url)
const expectedNames = fs.readdirSync(STEPS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs'))
  .map((entry) => entry.name.slice(0, -4))
  .sort()
const namesOf = (list) => list.map((step) => step.name).sort()

test('[AC-071] complete flow uses one sentinel and scans every surface', async () => {
  const steps = await discoverSteps()
  assert.deepEqual(namesOf(steps.map(step => ({ name: step.name }))), expectedNames)
  for (const name of STEP_ORDER) assert.ok(expectedNames.includes(name), `missing required step: ${name}`)
  for (const step of steps) {
    assert.equal(step.name, path.basename(step.file, '.mjs'))
    assert.match(step.mod.introduced_by, /^T-\d{3}$/)
  }
  const flow = createFlow()
  const sentinel = flow.sentinel
  try {
    // The auth step checks the provider's recorded environment hashes and argv itself.
    const report = await runFlow({ flow })
    assert.deepEqual(namesOf(report.results), expectedNames)
    for (const step of report.results) assert.match(step.introduced_by, /^T-\d{3}$/)
    assert.ok(report.results.every(step => step.ok), 'flow step failed')
    assert.equal(flow.sentinel === sentinel && flow.sentinels[0].value === sentinel, true)
    assert.equal(Object.values(flow.env).includes(sentinel), true)
    assert.equal(report.ok, true)
    assert.equal(report.leak.ok, true)
    assert.equal(report.leak.hits.length, 0, 'flow leak hits')
    assert.equal(report.leak.errors.length, 0, 'flow scan errors')
    const scan = leakScan({
      sentinels: flow.sentinels, ...flow.captured,
      state_dir: flow.root, auditFile: path.join(flow.state_dir, 'audit.jsonl'),
    })
    assert.equal(scan.ok, true, 'flow leaked or scan failed')
    assert.equal(scan.hits.length, 0, 'flow leak hits')
    assert.equal(scan.errors.length, 0, 'flow scan errors')
    for (const surface of ['argv', 'stdout', 'http', 'files', 'audit']) {
      assert.ok(scan.scanned[surface] > 0, `not scanned: ${surface}`)
    }
  } finally {
    flow.cleanup()
  }
})
