import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import {
  IDENTITY_SOURCES,
  callWithIdentity,
  classifyIdentity,
  runSessionCall,
} from '../../lib/providers/call.mjs'
import { classifySessionIdentity } from '../../lib/identity.mjs'
import { callView, identityView } from '../../lib/contract/views.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const T0 = Date.parse('2026-11-08T00:00:00Z')
const ISO = '2026-11-08T00:00:00.000Z'
const SPEC = { command: 'fakecli', args: ['-p'], cwd: 'C:/work', input: 'stdin' }
const TOKEN = ['sk', 'live', 'QWERTY', '0123456789'].join('-')

const CALL_KEYS = [
  'requested_model',
  'reported_model',
  'identity',
  'identity_source',
  'evidence',
  'exit_code',
  'latency_ms',
  'tokens_in',
  'tokens_out',
  'outcome',
]

function descriptor(source, modelPath, extra = {}) {
  return { supported: true, identity: { source, model_path: modelPath, ...extra } }
}

function okExec(extra = {}) {
  return { ok: true, code: 0, stdout: '', stderr: '', error: null, ...extra }
}

/** A fake context whose exec handler also sees the context, so it can move the fake clock. */
function ctxWith(handler, now = T0) {
  const ctx = createFakeContext({ now, exec: () => okExec() })
  const seen = []
  ctx.exec = (command, args, options) => {
    seen.push({ command, args, options })
    return handler(command, args, options, ctx)
  }
  ctx.seen = seen
  return ctx
}

function run(handler, options, now = T0) {
  const ctx = ctxWith(handler, now)
  const result = callWithIdentity(ctx, SPEC, 'call text', 1000, options)
  return { ctx, result }
}

test('[AC-075] callWithIdentity returns one full identity and one complete evidence record', () => {
  const options = { descriptor: descriptor('stdout.event.model', 'event.model'), requested_model: 'm-a' }
  const { ctx, result } = run(
    () => okExec({ stdout: JSON.stringify({ event: { model: 'm-a' } }), tokens_in: 10, tokens_out: 0 }),
    options
  )

  assert.deepEqual(Object.keys(result), ['identity', 'calls'])
  assert.deepEqual(Object.keys(result.identity), [
    'level',
    'identity_source',
    'evidence',
    'requested_model',
    'reported_model',
  ])
  assert.deepEqual(Object.keys(result.identity.evidence), ['path', 'at', 'detail'])
  assert.equal(result.calls.length, 1)
  assert.deepEqual(Object.keys(result.calls[0]), CALL_KEYS)
  assert.deepEqual(Object.keys(result.calls[0].identity), ['level'])

  assert.deepEqual(result.identity, {
    level: 'verified',
    identity_source: 'stdout.event.model',
    evidence: { path: 'event.model', at: ISO, detail: 'm-a' },
    requested_model: 'm-a',
    reported_model: 'm-a',
  })
  const call = result.calls[0]
  assert.deepEqual(call, {
    requested_model: 'm-a',
    reported_model: 'm-a',
    identity: { level: 'verified' },
    identity_source: 'stdout.event.model',
    evidence: { path: 'event.model', at: ISO, detail: 'm-a' },
    exit_code: 0,
    latency_ms: 0,
    tokens_in: 10,
    tokens_out: 0,
    outcome: 'ok',
  })
  assert.notEqual(call.evidence, result.identity.evidence)
  assert.deepEqual(call.evidence, result.identity.evidence)
  assert.equal(ctx.seen.length, 1)
  assert.deepEqual(ctx.seen[0].args, ['-p'])
  assert.equal(ctx.seen[0].options.input, 'call text')
  assert.equal(ctx.seen[0].options.timeout, 1000)
})

test('[AC-075] every success source runs exactly once and keeps outcome ok', () => {
  const stdout = JSON.stringify({ event: { model: 'm-a' } })
  const cases = [
    ['stdout.modelUsage', 'modelUsage.model', okExec({ stdout: JSON.stringify({ modelUsage: { model: 'm-a' } }) })],
    ['stdout.event.model', 'event.model', okExec({ stdout })],
    ['stats.models', 'stats.models.primary', okExec({ stdout: JSON.stringify({ stats: { models: { primary: 'm-a' } } }) })],
  ]
  for (const [source, modelPath, exec] of cases) {
    const { ctx, result } = run(() => exec, { descriptor: descriptor(source, modelPath), requested_model: 'm-a' })
    assert.equal(ctx.seen.length, 1, source)
    assert.equal(result.calls.length, 1, source)
    assert.deepEqual(
      [result.identity.level, result.identity.identity_source, result.calls[0].outcome, result.calls[0].identity.level],
      ['verified', source, 'ok', 'verified'],
      source
    )
  }

  const { ctx, result } = run(
    () => okExec(),
    {
      descriptor: descriptor('rollout-file', 'model', { file: 'rollout.jsonl' }),
      requested_model: 'm-a',
      readFile: () => `${JSON.stringify({ model: 'm-a' })}\n`,
    }
  )
  assert.equal(ctx.seen.length, 1)
  assert.deepEqual(
    [result.identity.level, result.identity.identity_source, result.calls[0].outcome],
    ['observed', 'rollout-file', 'ok']
  )
  assert.equal(result.identity.evidence.path, path.resolve('C:/work', 'rollout.jsonl'))
})

test('[AC-075] cli_flag and missing evidence stay unverified without blocking the call', () => {
  const stdout = JSON.stringify({ event: { model: 'm-a' } })

  const cliFlag = run(() => okExec({ stdout }), {
    descriptor: descriptor('cli_flag', 'event.model'),
    requested_model: 'm-a',
  })
  assert.equal(cliFlag.ctx.seen.length, 1)
  assert.deepEqual(
    [
      cliFlag.result.identity.level,
      cliFlag.result.identity.identity_source,
      cliFlag.result.identity.reported_model,
      cliFlag.result.identity.evidence.path,
      cliFlag.result.identity.evidence.detail,
      cliFlag.result.calls[0].outcome,
    ],
    ['unverified', 'cli_flag', null, null, null, 'ok']
  )

  const declaredNone = run(() => okExec({ stdout }), {
    descriptor: descriptor('none', 'event.model'),
    requested_model: 'm-a',
  })
  assert.deepEqual(
    [declaredNone.result.identity.level, declaredNone.result.identity.identity_source, declaredNone.result.identity.reported_model],
    ['unverified', 'none', null]
  )

  const noDescriptor = run(() => okExec({ stdout }), { requested_model: 'm-a' })
  assert.deepEqual(
    [noDescriptor.result.identity.level, noDescriptor.result.identity.reported_model, noDescriptor.result.calls[0].outcome],
    ['unverified', null, 'ok']
  )

  const noIdentity = run(() => okExec({ stdout }), { descriptor: { supported: true }, requested_model: 'm-a' })
  assert.deepEqual([noIdentity.result.identity.level, noIdentity.result.identity.identity_source], ['unverified', 'none'])
})

test('[AC-075] failures produce exactly one failed record and never leak the failure text', () => {
  const modelStdout = JSON.stringify({ event: { model: 'm-a' } })
  const cases = [
    ['timeout', () => ({ ok: false, code: null, stdout: '', stderr: 'timed out', error: null }), null],
    ['auth', () => ({ ok: false, code: null, stdout: '', stderr: '401 unauthorized', error: null }), null],
    ['rate limit', () => ({ ok: false, code: null, stdout: '', stderr: '429', error: null }), null],
    ['nonzero exit', () => okExec({ code: 3, stdout: modelStdout }), 3],
    ['not ok with code', () => ({ ok: false, code: 7, stdout: modelStdout, stderr: '', error: null }), 7],
    [
      'thrown',
      () => {
        throw new Error(TOKEN)
      },
      null,
    ],
  ]

  for (const [label, handler, exitCode] of cases) {
    const { ctx, result } = run(handler, {
      descriptor: descriptor('stdout.event.model', 'event.model'),
      requested_model: 'm-a',
    })
    assert.equal(ctx.seen.length, 1, label)
    assert.equal(result.calls.length, 1, label)
    const call = result.calls[0]
    assert.deepEqual(
      [result.identity.level, result.identity.identity_source, call.outcome, call.identity.level],
      ['failed', 'none', 'failed', 'failed'],
      label
    )
    assert.equal(result.identity.reported_model, null, label)
    assert.equal(call.reported_model, null, label)
    assert.equal(call.evidence.path, null, label)
    assert.equal(call.evidence.detail, null, label)
    assert.equal(call.exit_code, exitCode, label)
    assert.equal(result.identity.requested_model, 'm-a', label)
    const text = JSON.stringify(result)
    assert.ok(!text.includes(TOKEN), label)
    assert.ok(!text.includes('timed out'), label)
    assert.ok(!text.includes('unauthorized'), label)
  }
})

test('[AC-075] latency uses only the injected clock and never goes negative', () => {
  const advanced = run((command, args, options, ctx) => {
    ctx.clock.setNow(T0 + 250)
    return okExec()
  }, { descriptor: descriptor('stdout.event.model', 'event.model'), requested_model: 'm-a' })
  assert.equal(advanced.result.calls[0].latency_ms, 250)
  assert.equal(advanced.result.calls[0].evidence.at, '2026-11-08T00:00:00.250Z')

  const rewound = run((command, args, options, ctx) => {
    ctx.clock.setNow(T0 - 100)
    return okExec()
  }, { descriptor: descriptor('stdout.event.model', 'event.model'), requested_model: 'm-a' })
  assert.equal(rewound.result.calls[0].latency_ms, 0)
  assert.equal(rewound.result.calls[0].evidence.at, '2026-11-07T23:59:59.900Z')

  const ctx = createFakeContext({ now: T0, exec: () => okExec() })
  const ticks = [0, Number.POSITIVE_INFINITY]
  ctx.clock = {
    now() {
      return ticks.length > 1 ? ticks.shift() : ticks[0]
    },
    nowIso() {
      return ISO
    },
  }
  const nonFinite = callWithIdentity(ctx, SPEC, 'text', 1000, {
    descriptor: descriptor('stdout.event.model', 'event.model'),
    requested_model: 'm-a',
  })
  assert.equal(nonFinite.calls[0].latency_ms, 0)
})

test('[AC-075] token counters keep a real zero and reject missing or invalid values', () => {
  const cases = [
    [{ tokens_in: 0, tokens_out: 5 }, 0, 5],
    [{ tokens_in: '7', tokens_out: -1 }, null, null],
    [{ tokens_in: 1.5, tokens_out: undefined }, null, null],
    [{}, null, null],
  ]
  for (const [extra, expectedIn, expectedOut] of cases) {
    const { result } = run(() => okExec(extra), {
      descriptor: descriptor('stdout.event.model', 'event.model'),
      requested_model: 'm-a',
    })
    assert.equal(result.calls[0].tokens_in, expectedIn, JSON.stringify(extra))
    assert.equal(result.calls[0].tokens_out, expectedOut, JSON.stringify(extra))
  }
})

test('[AC-075] the projections drop unknown fields and deep-copy evidence', () => {
  const dirtyIdentity = {
    level: 'verified',
    identity_source: 'stdout.event.model',
    evidence: { path: 'event.model', at: ISO, detail: 'm-a', raw: 'leak' },
    requested_model: 'm-a',
    reported_model: 'm-a',
    selected_model: 'm-a',
    source: 'stdout',
    strength: 'strong',
  }
  const identity = identityView(dirtyIdentity)
  assert.deepEqual(Object.keys(identity), [
    'level',
    'identity_source',
    'evidence',
    'requested_model',
    'reported_model',
  ])
  assert.deepEqual(Object.keys(identity.evidence), ['path', 'at', 'detail'])
  assert.equal('selected_model' in identity, false)
  assert.notEqual(identity.evidence, dirtyIdentity.evidence)
  identity.evidence.path = 'changed'
  assert.equal(dirtyIdentity.evidence.path, 'event.model')

  const dirtyCall = {
    requested_model: 'm-a',
    reported_model: null,
    identity: { level: 'unverified', extra: 'drop' },
    identity_source: 'cli_flag',
    evidence: { path: null, at: ISO, detail: null, raw: 'leak' },
    exit_code: null,
    latency_ms: 0,
    tokens_in: 0,
    tokens_out: null,
    outcome: 'ok',
    retryable: true,
    exclude: ['other'],
  }
  const call = callView(dirtyCall)
  assert.deepEqual(Object.keys(call), CALL_KEYS)
  assert.deepEqual(Object.keys(call.identity), ['level'])
  assert.equal('retryable' in call, false)
  assert.equal('exclude' in call, false)
  assert.notEqual(call.evidence, dirtyCall.evidence)
  call.evidence.at = 'changed'
  assert.equal(dirtyCall.evidence.at, ISO)
  assert.deepEqual(dirtyCall.identity, { level: 'unverified', extra: 'drop' })
})

test('[AC-075] the real entry point redacts tokens and user directories from evidence', () => {
  const file = 'C:\\Users\\alice\\sessions\\rollout.jsonl'
  const { result } = run(
    () => okExec(),
    {
      descriptor: descriptor('rollout-file', 'model', { file }),
      requested_model: TOKEN,
      readFile: () => `${JSON.stringify({ model: TOKEN })}\n`,
    }
  )
  const text = JSON.stringify(result)
  assert.ok(!text.includes('alice'))
  assert.ok(!text.includes(TOKEN))
  assert.ok(text.includes('[REDACTED]'))
  assert.equal(result.identity.requested_model, '[REDACTED]')
  assert.equal(result.identity.reported_model, '[REDACTED]')
  assert.equal(result.identity.evidence.path, 'C:\\Users\\[REDACTED]\\sessions\\rollout.jsonl')
  assert.equal(result.calls[0].evidence.path, result.identity.evidence.path)
  assert.equal(result.calls[0].outcome, 'ok')
})

test('[AC-075] identity and calls agree and consecutive calls share no state', () => {
  const models = ['m-a', 'm-b']
  let index = 0
  const ctx = ctxWith(() => okExec({ stdout: JSON.stringify({ event: { model: models[index] } }) }))
  const options = { descriptor: descriptor('stdout.event.model', 'event.model'), requested_model: 'm-a' }

  const first = callWithIdentity(ctx, SPEC, 'first', 1000, options)
  index = 1
  const second = callWithIdentity(ctx, SPEC, 'second', 1000, { ...options, requested_model: 'm-b' })

  assert.equal(ctx.seen.length, 2)
  assert.notEqual(ctx.seen[0].options.input, ctx.seen[1].options.input)
  assert.equal(first.identity.reported_model, 'm-a')
  assert.equal(second.identity.reported_model, 'm-b')
  assert.notEqual(first.calls[0], second.calls[0])
  assert.notEqual(first.calls[0].evidence, second.calls[0].evidence)

  for (const result of [first, second]) {
    const call = result.calls[0]
    assert.equal(call.requested_model, result.identity.requested_model)
    assert.equal(call.reported_model, result.identity.reported_model)
    assert.equal(call.identity.level, result.identity.level)
    assert.equal(call.identity_source, result.identity.identity_source)
    assert.deepEqual(call.evidence, result.identity.evidence)
    assert.deepEqual(identityView(result.identity), result.identity)
    assert.deepEqual(callView(call), call)
  }
})

test('[AC-075] existing provider exports stay compatible', () => {
  assert.ok(Object.isFrozen(IDENTITY_SOURCES))
  assert.deepEqual([...IDENTITY_SOURCES], [
    'stdout.modelUsage',
    'stdout.event.model',
    'stats.models',
    'rollout-file',
    'cli_flag',
    'none',
  ])

  const execResult = okExec({ stdout: JSON.stringify({ event: { model: 'm-a' } }) })
  const ctx = ctxWith(() => execResult)
  assert.equal(runSessionCall(ctx, SPEC, 'payload', 25), execResult)
  assert.equal(ctx.seen.length, 1)
  assert.equal(ctx.seen[0].options.input, 'payload')
  assert.equal(ctx.seen[0].options.timeout, 25)

  const options = {
    descriptor: descriptor('stdout.event.model', 'event.model'),
    result: execResult,
    requested_model: 'm-a',
    observed_at: ISO,
  }
  const reduced = classifyIdentity(options)
  assert.deepEqual(Object.keys(reduced), ['level', 'identity_source', 'consistent', 'observed_at'])
  assert.deepEqual(reduced, classifySessionIdentity(options))
})
