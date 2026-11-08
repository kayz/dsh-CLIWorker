// Discoverable wrapper so `npm run perf` (which only enumerates `*.test.mjs`) runs the select
// measurement. It reports numbers only; there is no wall-clock threshold.
import test from 'node:test'
import assert from 'node:assert/strict'

import { measureSelectPerformance } from './select.perf.mjs'

test('[AC-055] cached selection performance is measured and reported', async () => {
  const report = await measureSelectPerformance()
  assert.equal(report.models, 50)
  assert.ok(report.warmup > 0)
  assert.ok(report.samples > 0)
  assert.ok(Number.isFinite(report.p95) && report.p95 >= 0)
  process.stdout.write(
    `select perf: models=${report.models} warmup=${report.warmup} samples=${report.samples} ` +
    `p95=${report.p95.toFixed(3)} ms\n`
  )
})
