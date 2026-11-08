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
import { run as runSelectCommand } from '../../lib/commands/models/select.mjs'

function useFakeClock(f) {
  const clock = createFakeClock()
  f.ctx.clock = clock
  f.ctx.now = () => clock.now()
  return clock
}

function selectionConfig(model) {
  return {
    providers: { claude: { cli: 'claude' } },
    models: { [model.key]: { ...model, readonly: true } },
    quotas: {},
  }
}

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
    assert.equal(fs.existsSync(`${f.dir}/usage.jsonl`), false)
  } finally { f.cleanup() }
})

test('[AC-047] an expired probe stays rejected as availability_stale without refreshing its timestamp', async () => {
  const f = setup()
  try {
    const clock = useFakeClock(f)
    const [model] = await probeModels(f.config, { ctx: f.ctx })
    const before = readProbeModels(f.config, { ctx: f.ctx })[0]
    const choose = () => selectModels(selectionConfig(model), { level: 'Quick' }, {
      // The provider status stays healthy, so only the cached TTL can reject the model.
      status: { claude: { state: 'callable' } },
      ctx: f.ctx,
      probeModels: readProbeModels(f.config, { ctx: f.ctx }),
    })
    assert.equal(choose().models[0].key, model.key)
    await clock.advance(10001)
    const expired = choose()
    assert.equal(expired.ok, false)
    assert.deepEqual(expired.models, [])
    assert.deepEqual(expired.calls, [])
    assert.deepEqual(expired.rejected.map((row) => row.reason), ['availability_stale'])
    const after = readProbeModels(f.config, { ctx: f.ctx })[0]
    assert.equal(after.availability.at, before.availability.at)
    assert.equal(after.availability.evidence.probe_id, before.availability.evidence.probe_id)
  } finally { f.cleanup() }
})

test('[AC-047] a stale record rejects only its own model on a shared provider', async () => {
  const f = setup()
  try {
    const clock = useFakeClock(f)
    const [stale] = await probeModels(f.config, { ctx: f.ctx })
    // Build a second record from a real probe and give it a newer completion time, so both models
    // are on the same provider but only one is past its own TTL.
    await clock.advance(6000)
    const fresh = structuredClone(stale)
    fresh.key = 'claude:other'
    fresh.id = 'other'
    fresh.availability.at = clock.nowIso()
    fresh.availability.evidence.probe_id = 'probe-fresh'
    await clock.advance(5000)
    const config = {
      providers: { claude: { cli: 'claude' } },
      models: { [stale.key]: { ...stale, readonly: true }, [fresh.key]: { ...fresh, readonly: true } },
      quotas: {},
    }
    const result = selectModels(config, { level: 'Quick', count: 2 }, {
      status: { claude: { state: 'callable' } },
      ctx: f.ctx,
      probeModels: [stale, fresh],
    })
    assert.deepEqual(result.models.map((item) => item.key), ['claude:other'])
    assert.ok(result.rejected.some((row) => row.key === 'claude:one' && row.reason === 'availability_stale'))
    assert.ok(!result.rejected.some((row) => row.key === 'claude:other'))
  } finally { f.cleanup() }
})

test('[AC-047] models without a probe record keep their legacy selection behavior', () => {
  const ctx = { clock: { now: () => Date.parse('2030-01-01T00:00:00Z') } }
  const legacy = {
    provider: 'claude', id: 'legacy', tier: 'top', identity: 'verified', readonly: true,
    // A hand-written availability with an old timestamp and no evidence must not be TTL-filtered.
    availability: { state: 'callable', reason: null, at: '2000-01-01T00:00:00.000Z', ttl_s: 1, evidence: null },
  }
  const config = { providers: { claude: { cli: 'claude' } }, models: { legacy }, quotas: {} }
  const direct = selectModels(config, { level: 'Top' }, { status: { claude: { state: 'callable' } }, ctx })
  assert.deepEqual(direct.models.map((item) => item.key), ['legacy'])
  assert.deepEqual(direct.rejected, [])

  // A record for some other key must not change the legacy path of this model.
  const otherRecord = {
    key: 'claude:other', provider: 'claude', id: 'other', identity: 'verified',
    availability: {
      state: 'callable', reason: null, at: '2030-01-01T00:00:00.000Z', ttl_s: 60,
      evidence: { probe_id: 'p-other', cmd_redacted: 'claude', exit: 0, duration_ms: 1, nonce_ok: true, reported_model: 'claude:other', tokens: null },
    },
  }
  const indirect = selectModels(config, { level: 'Top' }, {
    status: { claude: { state: 'callable' } }, ctx, probeModels: [otherRecord],
  })
  assert.deepEqual(indirect.models.map((item) => item.key), ['legacy'])
  assert.deepEqual(indirect.rejected, [])
})

test('[AC-047] the production select command loads probes.json and rejects a stale record', async () => {
  const f = setup()
  try {
    const clock = useFakeClock(f)
    const [model] = await probeModels(f.config, { ctx: f.ctx })
    await clock.advance(10001)
    // Provider status is still healthy; only the persisted probe record is stale.
    f.ctx.exec = () => ({ ok: true, code: 0, stdout: 'claude 9.9.9', stderr: '' })
    const config = {
      _home: f.dir,
      providers: { claude: { cli: 'claude' } },
      models: { [model.key]: { ...model, readonly: true } },
      quotas: {},
      policy: {},
    }
    const result = await runSelectCommand({ argv: ['models', 'select', '--level', 'Quick'], ctx: f.ctx, config })
    assert.equal(result.ok, false)
    assert.deepEqual(result.models, [])
    assert.ok(result.rejected.some((row) => row.key === model.key && row.reason === 'availability_stale'))
  } finally { f.cleanup() }
})
