import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import {
  IDENTITY_SOURCES,
  classifyIdentity,
  classifySessionIdentity,
} from '../../lib/identity.mjs'

const T0 = '2026-11-08T00:00:00.000Z'
const TOKEN = ['sk', 'live', 'QWERTY', '9876'].join('-')
const OTHER_TOKEN = ['sk', 'live', 'ZEBRA', '0123'].join('-')

function okResult(extra = {}) {
  return { ok: true, code: 0, stdout: '', stderr: '', error: null, ...extra }
}

function identityDescriptor(source, modelPath, extra = {}) {
  return { identity: { source, model_path: modelPath, ...extra } }
}

function grade(overrides = {}) {
  const {
    source = 'stdout.event.model',
    modelPath = 'event.model',
    result = okResult(),
    requested = 'm-a',
    readFile = undefined,
    cwd = 'C:/work',
    observed_at = T0,
    descriptor = undefined,
  } = overrides
  return classifyIdentity({
    descriptor: descriptor === undefined ? identityDescriptor(source, modelPath) : descriptor,
    result,
    requested_model: requested,
    readFile,
    cwd,
    observed_at,
  })
}

test('[AC-075] all three stdout sources grade verified and keep the declared path', () => {
  const cases = [
    ['stdout.modelUsage', 'modelUsage.model', { modelUsage: { model: 'm-a' } }],
    ['stdout.event.model', 'event.model', { event: { model: 'm-a' } }],
    ['stats.models', 'stats.models.primary', { stats: { models: { primary: 'm-a' } } }],
  ]
  for (const [source, modelPath, payload] of cases) {
    const identity = grade({ source, modelPath, result: okResult({ stdout: JSON.stringify(payload) }) })
    assert.equal(identity.level, 'verified', source)
    assert.equal(identity.identity_source, source)
    assert.deepEqual(identity.evidence, { path: modelPath, at: T0, detail: 'm-a' })
    assert.equal(identity.requested_model, 'm-a')
    assert.equal(identity.reported_model, 'm-a')
  }
})

test('[AC-075] rollout evidence is always observed and only reads the named file', () => {
  const file = 'sessions/rollout-a.jsonl'
  const resolved = path.resolve('C:/work', file)
  const reads = []
  const readFile = (target) => {
    reads.push(target)
    return `not json\n${JSON.stringify({ model: 'm-a' })}\n`
  }
  const matched = grade({
    descriptor: identityDescriptor('rollout-file', 'model', { file }),
    result: okResult({ stdout: JSON.stringify({ event: { model: 'm-b' } }) }),
    requested: 'm-a',
    readFile,
  })
  assert.equal(matched.level, 'observed')
  assert.equal(matched.identity_source, 'rollout-file')
  assert.equal(matched.reported_model, 'm-a')
  assert.equal(matched.evidence.path, resolved)
  assert.deepEqual(reads, [resolved])

  const mismatched = grade({
    descriptor: identityDescriptor('rollout-file', 'model', { file }),
    requested: 'm-b',
    readFile,
  })
  assert.deepEqual(
    [mismatched.level, mismatched.identity_source, mismatched.reported_model],
    ['observed', 'rollout-file', 'm-a']
  )
})

test('[AC-075] cli_flag, none and unknown sources never fabricate a reported model', () => {
  const stdout = JSON.stringify({ event: { model: 'm-a' } })
  const cliFlag = grade({ source: 'cli_flag', result: okResult({ stdout }), requested: 'm-a' })
  assert.deepEqual(
    [cliFlag.level, cliFlag.identity_source, cliFlag.reported_model, cliFlag.evidence.path, cliFlag.evidence.detail],
    ['unverified', 'cli_flag', null, null, null]
  )

  const declaredNone = grade({ source: 'none', result: okResult({ stdout }) })
  assert.deepEqual(
    [declaredNone.level, declaredNone.identity_source, declaredNone.reported_model],
    ['unverified', 'none', null]
  )

  const missing = grade({ descriptor: null, result: okResult({ stdout }) })
  assert.deepEqual([missing.level, missing.identity_source, missing.reported_model], ['unverified', 'none', null])

  const unknown = grade({ source: 'stdout.magic', modelPath: 'event.model', result: okResult({ stdout }) })
  assert.deepEqual([unknown.level, unknown.identity_source, unknown.reported_model], ['unverified', 'none', null])
})

test('[AC-075] missing, malformed and unreadable evidence stay unverified', () => {
  const cases = [
    ['empty stdout', grade({ result: okResult({ stdout: '' }) })],
    ['bad json', grade({ result: okResult({ stdout: 'not json at all' }) })],
    ['no model field', grade({ result: okResult({ stdout: JSON.stringify({ event: {} }) }) })],
    ['empty model', grade({ result: okResult({ stdout: JSON.stringify({ event: { model: '' } }) }) })],
  ]
  for (const [label, identity] of cases) {
    assert.deepEqual([identity.level, identity.identity_source, identity.reported_model], ['unverified', 'none', null], label)
    assert.equal(identity.evidence.path, null, label)
    assert.equal(identity.evidence.detail, null, label)
  }

  const throwing = grade({
    descriptor: identityDescriptor('rollout-file', 'model', { file: 'rollout.jsonl' }),
    readFile: () => {
      throw new Error('denied')
    },
  })
  assert.deepEqual([throwing.level, throwing.identity_source, throwing.reported_model], ['unverified', 'none', null])

  const empty = grade({
    descriptor: identityDescriptor('rollout-file', 'model', { file: 'rollout.jsonl' }),
    readFile: () => '\n\nnot json\n',
  })
  assert.deepEqual([empty.level, empty.identity_source, empty.reported_model], ['unverified', 'none', null])

  const noFile = grade({ descriptor: identityDescriptor('rollout-file', 'model'), readFile: () => '{}\n' })
  assert.deepEqual([noFile.level, noFile.identity_source], ['unverified', 'none'])
})

test('[AC-075] dot paths read only own safe properties', () => {
  const stdout =
    '{"safe":{"nested":{"model":"m-a"}},"number":42,"constructor":{"model":"bad-1"},' +
    '"prototype":{"model":"bad-2"},"__proto__":{"model":"bad-3"}}'

  const safe = grade({ modelPath: 'safe.nested.model', result: okResult({ stdout }) })
  assert.deepEqual([safe.level, safe.reported_model], ['verified', 'm-a'])

  const numeric = grade({ modelPath: 'number', result: okResult({ stdout }) })
  assert.deepEqual([numeric.level, numeric.reported_model, numeric.evidence.detail], ['verified', '42', '42'])

  for (const modelPath of ['constructor.model', 'prototype.model', '__proto__.model', 'safe.missing']) {
    const identity = grade({ modelPath, result: okResult({ stdout }) })
    assert.deepEqual([identity.level, identity.identity_source], ['unverified', 'none'], modelPath)
  }
})

test('[AC-075] a model mismatch keeps the source level and is never a failure', () => {
  const verifiedMismatch = grade({
    result: okResult({ stdout: JSON.stringify({ event: { model: 'm-b' } }) }),
    requested: 'm-a',
  })
  assert.deepEqual([verifiedMismatch.level, verifiedMismatch.reported_model], ['verified', 'm-b'])

  const observedMismatch = grade({
    descriptor: identityDescriptor('rollout-file', 'model', { file: 'rollout.jsonl' }),
    result: okResult({ stdout: JSON.stringify({ event: { model: 'm-a' } }) }),
    requested: 'm-b',
    readFile: () => `${JSON.stringify({ model: 'm-c' })}\n`,
  })
  assert.deepEqual([observedMismatch.level, observedMismatch.identity_source], ['observed', 'rollout-file'])
})

test('[AC-075] a failed call wins over any stdout model evidence', () => {
  const stdout = JSON.stringify({ event: { model: 'm-a' } })

  const explicitFailure = grade({ result: { ok: false, code: 1, stdout, stderr: '', error: null } })
  assert.deepEqual(
    [explicitFailure.level, explicitFailure.identity_source, explicitFailure.reported_model],
    ['failed', 'none', null]
  )
  assert.equal(explicitFailure.requested_model, 'm-a')

  const nonzero = grade({ result: okResult({ code: 2, stdout }) })
  assert.deepEqual([nonzero.level, nonzero.identity_source, nonzero.reported_model], ['failed', 'none', null])

  const thrown = grade({ result: null })
  assert.deepEqual([thrown.level, thrown.identity_source, thrown.reported_model], ['failed', 'none', null])

  const missingCode = grade({ result: { ok: true, stdout } })
  assert.equal(missingCode.level, 'verified')
  assert.equal(missingCode.reported_model, 'm-a')
})

test('[AC-075] inputs are never modified and each output is independent', () => {
  const descriptor = identityDescriptor('stdout.event.model', 'event.model')
  const result = okResult({ stdout: JSON.stringify({ event: { model: 'm-a' } }) })
  const before = { descriptor: structuredClone(descriptor), result: structuredClone(result) }

  const first = grade({ descriptor, result })
  const second = grade({ descriptor, result })

  assert.deepEqual({ descriptor, result }, before)
  assert.deepEqual(first, second)
  assert.notEqual(first.evidence, second.evidence)
  first.evidence.path = 'mutated'
  first.requested_model = 'mutated'
  assert.equal(second.evidence.path, 'event.model')
  assert.equal(second.requested_model, 'm-a')
  assert.equal(descriptor.identity.model_path, 'event.model')
})

test('[AC-075] the session projection keeps four fields and compares raw models', () => {
  const descriptor = identityDescriptor('stdout.event.model', 'event.model')
  const options = { descriptor, result: okResult({ stdout: JSON.stringify({ event: { model: 'm-a' } }) }), requested_model: 'm-a', observed_at: T0 }
  const matched = classifySessionIdentity(options)
  assert.deepEqual(Object.keys(matched), ['level', 'identity_source', 'consistent', 'observed_at'])
  assert.deepEqual(matched, { level: 'verified', identity_source: 'stdout.event.model', consistent: true, observed_at: T0 })

  const mismatch = classifySessionIdentity({
    ...options,
    result: okResult({ stdout: JSON.stringify({ event: { model: 'm-b' } }) }),
  })
  assert.equal(mismatch.consistent, false)

  const sameSecret = classifySessionIdentity({
    ...options,
    requested_model: TOKEN,
    result: okResult({ stdout: JSON.stringify({ event: { model: TOKEN } }) }),
  })
  assert.equal(sameSecret.consistent, true)

  const twoSecrets = classifySessionIdentity({
    ...options,
    requested_model: TOKEN,
    result: okResult({ stdout: JSON.stringify({ event: { model: OTHER_TOKEN } }) }),
  })
  assert.equal(twoSecrets.consistent, false)

  const full = classifyIdentity({
    ...options,
    requested_model: TOKEN,
    result: okResult({ stdout: JSON.stringify({ event: { model: OTHER_TOKEN } }) }),
  })
  assert.equal(full.reported_model, '[REDACTED]')
  assert.equal(full.evidence.detail, '[REDACTED]')

  const failed = classifySessionIdentity({ ...options, result: { ok: false, code: 1 } })
  assert.deepEqual([failed.level, failed.consistent], ['failed', null])

  const absent = classifySessionIdentity({ ...options, descriptor: null })
  assert.deepEqual([absent.level, absent.identity_source, absent.consistent], ['unverified', 'none', null])
})

test('[AC-075] evidence redacts tokens and Windows, POSIX and macOS user directories', () => {
  const windowsFile = 'C:\\Users\\alice\\sessions\\rollout.jsonl'
  const windows = grade({
    descriptor: identityDescriptor('rollout-file', 'model', { file: windowsFile }),
    requested: TOKEN,
    readFile: () => `${JSON.stringify({ model: TOKEN })}\n`,
  })
  const windowsText = JSON.stringify(windows)
  assert.ok(!windowsText.includes('alice'))
  assert.ok(!windowsText.includes(TOKEN))
  assert.ok(windowsText.includes('[REDACTED]'))
  assert.equal(windows.reported_model, '[REDACTED]')
  assert.equal(windows.requested_model, '[REDACTED]')
  assert.equal(windows.evidence.detail, '[REDACTED]')

  const home = grade({
    descriptor: identityDescriptor('rollout-file', 'model', { file: '/home/bob/sessions/rollout.jsonl' }),
    cwd: '',
    readFile: () => `${JSON.stringify({ model: 'm-a' })}\n`,
  })
  assert.ok(!JSON.stringify(home).includes('bob'))
  assert.ok(home.evidence.path.includes('[REDACTED]'))

  const mac = grade({
    descriptor: identityDescriptor('rollout-file', 'model', { file: '/Users/carol/sessions/rollout.jsonl' }),
    cwd: '',
    readFile: () => `${JSON.stringify({ model: 'm-a' })}\n`,
  })
  assert.ok(!JSON.stringify(mac).includes('carol'))
  assert.ok(mac.evidence.path.includes('[REDACTED]'))
})

test('[AC-075] the source enum stays the fixed six-value list', () => {
  assert.ok(Object.isFrozen(IDENTITY_SOURCES))
  assert.deepEqual([...IDENTITY_SOURCES], [
    'stdout.modelUsage',
    'stdout.event.model',
    'stats.models',
    'rollout-file',
    'cli_flag',
    'none',
  ])
})
