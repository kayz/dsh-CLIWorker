import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { probeModels } from '../../lib/probe.mjs'
import { readProbeModels } from '../../lib/availability.mjs'
import { setup } from '../fixtures/probe/helpers.mjs'
import { createFlow } from '../helpers/flow.mjs'
import { run as runFlowProbe } from '../flows/steps/probe.mjs'
import { createFakeClock } from '../helpers/clock.mjs'
import { selectModels } from '../../lib/select.mjs'

for (const [mode, state, identity] of [['ok', 'callable', 'verified'], ['auth', 'blocked', 'unverified'], ['quota', 'blocked', 'unverified'], ['deprecated', 'deprecated', 'unverified'], ['mismatch', 'blocked', 'mismatch'], ['bad-nonce', 'unverified', 'verified'], ['missing-model', 'unverified', 'unverified']]) {
  test(`[AC-047] local stub ${mode}`, async () => {
    const f = setup(mode)
    try {
      const [model] = await probeModels(f.config, { ctx: f.ctx })
      assert.equal(model.availability.state, state)
      assert.equal(model.identity, identity)
      assert.equal(model.availability.evidence.nonce_ok, !['bad-nonce', 'auth', 'quota', 'deprecated'].includes(mode))
      assert.equal(fs.readFileSync(f.count, 'utf8'), 'one\n')
      assert.deepEqual(readProbeModels(f.config, { ctx: f.ctx }), [model])
    } finally { f.cleanup() }
  })
}

test('[AC-047] local stub flow reaches the real command', async () => {
  const flow = createFlow()
  try { await runFlowProbe(flow) } finally { flow.cleanup() }
})

test('[AC-047] cached callable expires after the boundary', async () => {
  const f = setup()
  try {
    const clock = createFakeClock()
    f.ctx.clock = clock
    f.ctx.now = () => clock.now()
    const [model] = await probeModels(f.config, { ctx: f.ctx })
    const config = { providers: { claude: { cli: 'claude' } }, models: { [model.key]: { ...model, readonly: true } }, quotas: {} }
    const choose = () => selectModels(config, { level: 'Quick' }, { status: { claude: { state: 'unavailable' } }, ctx: f.ctx, probeModels: [model] })
    assert.equal(choose().models.length, 1)
    await clock.advance(10000)
    assert.equal(choose().models.length, 1)
    await clock.advance(1)
    const expired = choose()
    assert.equal(expired.models.length, 0)
    assert.ok(expired.rejected.some(row => row.key === model.key && row.reason === 'availability_stale'))
  } finally { f.cleanup() }
})

test('[AC-047] exhausted timeout returns unavailable without inventing usage', async () => {
  const f = setup()
  let calls = 0
  f.ctx.exec = () => { calls++; return { ok: false, code: null, stdout: '', stderr: '', error_code: 'E_TIMEOUT' } }
  try {
    const [model] = await probeModels(f.config, { ctx: f.ctx })
    assert.equal(calls, 2)
    assert.equal(model.availability.state, 'unavailable')
    assert.equal(model.availability.evidence.tokens, null)
  } finally { f.cleanup() }
})
