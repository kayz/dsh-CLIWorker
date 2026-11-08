import test from 'node:test'
import assert from 'node:assert/strict'

import {
  composeInput,
  resumeSession,
  startSession,
} from '../../lib/session.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const T0 = Date.parse('2026-11-08T00:00:00Z')
const DEFAULT_TTL_MS = 43200 * 1000

const DESCRIPTOR = {
  supported: true,
  supports_resume: true,
  start: { command: 'fakecli', args: ['-p', '--model', 'm-secret'], input: 'stdin', cwd: '<workspace>' },
  resume: { command: 'fakecli', args: ['--resume', '{session_id}'], input: 'stdin', cwd: '<workspace>' },
  id_from: 'stdout_json',
  id_path: 'session_id',
  reset_on: ['model_change'],
  identity: { source: 'stdout.event.model', model_path: 'model' },
}

const TARGET = {
  model_key: 'prov-x:m-secret',
  provider: 'prov-x',
  model_id: 'm-secret',
  cli_version: '1.0.0',
  cwd: 'C:/work',
  session: DESCRIPTOR,
}

const OK = {
  ok: true,
  code: 0,
  stdout: JSON.stringify({ session_id: 'sid-1', model: 'm-secret' }),
  stderr: '',
  error: null,
}

const BAD = { ok: false, code: 1, stdout: '', stderr: 'boom /secret/path', error: null }

function ctxAt(now, handler, files) {
  return createFakeContext({ now, exec: handler ?? (() => OK), files })
}

function targetWith(patch) {
  return { ...TARGET, ...(patch || {}) }
}

function tokenFrom(now) {
  const result = startSession(ctxAt(now), { target: TARGET, input: { prompt: 'p' } })
  assert.equal(result.ok, true)
  return result.session_token
}

test('[AC-076] a changed model returns E_SESSION_MODEL_CHANGED before any call', () => {
  const token = tokenFrom(T0)
  const ctx = ctxAt(T0)
  const result = resumeSession(ctx, {
    target: targetWith({ model_key: 'prov-x:other' }),
    token,
    input: { diff: 'd' },
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'E_SESSION_MODEL_CHANGED')
  assert.equal(result.error.retryable, false)
  assert.equal(result.error.retry_after, null)
  assert.deepEqual(Object.keys(result.error), ['code', 'message', 'retryable', 'retry_after'])
  assert.equal('identity' in result, false)
  assert.equal(ctx.exec.count, 0)
})

test('[AC-076] a changed provider returns E_SESSION_PROVIDER_CHANGED even with a new model', () => {
  const token = tokenFrom(T0)

  const providerOnly = ctxAt(T0)
  const first = resumeSession(providerOnly, {
    target: targetWith({ provider: 'prov-y' }),
    token,
    input: { diff: 'd' },
  })
  assert.equal(first.error.code, 'E_SESSION_PROVIDER_CHANGED')
  assert.equal(providerOnly.exec.count, 0)

  const both = ctxAt(T0)
  const second = resumeSession(both, {
    target: targetWith({ provider: 'prov-y', model_key: 'prov-y:m-secret' }),
    token,
    input: { diff: 'd' },
  })
  assert.equal(second.error.code, 'E_SESSION_PROVIDER_CHANGED')
  assert.equal(both.exec.count, 0)
})

test('[AC-076] a changed CLI or contract version returns E_SESSION_CONTRACT_CHANGED', () => {
  const token = tokenFrom(T0)

  const cli = ctxAt(T0)
  assert.equal(
    resumeSession(cli, { target: targetWith({ cli_version: '2.0.0' }), token, input: { diff: 'd' } }).error.code,
    'E_SESSION_CONTRACT_CHANGED'
  )
  assert.equal(cli.exec.count, 0)

  const contract = ctxAt(T0)
  assert.equal(
    resumeSession(contract, {
      target: targetWith({ contract_version: 'other/v2' }),
      token,
      input: { diff: 'd' },
    }).error.code,
    'E_SESSION_CONTRACT_CHANGED'
  )
  assert.equal(contract.exec.count, 0)
})

test('[AC-076] expiry happens one millisecond after the ttl, not at the boundary', () => {
  const token = tokenFrom(T0)

  const boundary = ctxAt(T0 + DEFAULT_TTL_MS)
  const stillValid = resumeSession(boundary, { target: TARGET, token, input: { diff: 'd' } })
  assert.equal(stillValid.ok, true)
  assert.equal(boundary.exec.count, 1)

  const past = ctxAt(T0 + DEFAULT_TTL_MS + 1)
  const expired = resumeSession(past, { target: TARGET, token, input: { diff: 'd' } })
  assert.equal(expired.error.code, 'E_SESSION_EXPIRED')
  assert.equal(past.exec.count, 0)

  const shortBoundary = ctxAt(T0 + 10000)
  assert.equal(
    resumeSession(shortBoundary, { target: TARGET, token, input: { diff: 'd' }, ttl_s: 10 }).ok,
    true
  )
  assert.equal(shortBoundary.exec.count, 1)

  const shortPast = ctxAt(T0 + 10001)
  assert.equal(
    resumeSession(shortPast, { target: TARGET, token, input: { diff: 'd' }, ttl_s: 10 }).error.code,
    'E_SESSION_EXPIRED'
  )
  assert.equal(shortPast.exec.count, 0)
})

test('[AC-076] a failed resume returns E_SESSION_RESUME_FAILED after exactly one call', () => {
  const token = tokenFrom(T0)
  const ctx = ctxAt(T0, () => BAD)
  const result = resumeSession(ctx, { target: TARGET, token, input: { diff: 'd' } })
  assert.equal(result.error.code, 'E_SESSION_RESUME_FAILED')
  assert.equal(result.error.retryable, false)
  assert.equal(result.identity.level, 'failed')
  assert.equal(result.identity.identity_source, 'none')
  assert.equal(ctx.exec.count, 1)
  assert.ok(!JSON.stringify(result).includes('boom'))
  assert.ok(!JSON.stringify(result).includes('/secret/path'))
})

test('[AC-076] a provider without resume returns E_SESSION_NOT_SUPPORTED before any call', () => {
  const token = tokenFrom(T0)
  const ctx = ctxAt(T0)
  const result = resumeSession(ctx, {
    target: targetWith({ session: { ...DESCRIPTOR, supports_resume: false, reason: 'no resume' } }),
    token,
    input: { diff: 'd' },
  })
  assert.equal(result.error.code, 'E_SESSION_NOT_SUPPORTED')
  assert.equal(ctx.exec.count, 0)
  assert.equal('identity' in result, false)
})

test('[AC-076] resume reissues the token with the same session id and a new time', () => {
  const token = tokenFrom(T0)
  const ctx = ctxAt(T0 + 60000)
  const result = resumeSession(ctx, { target: TARGET, token, input: { diff: 'd' } })
  assert.equal(result.ok, true)
  assert.notEqual(result.session_token, token)
  const before = JSON.parse(Buffer.from(token.slice(3), 'base64url').toString('utf8'))
  const after = JSON.parse(Buffer.from(result.session_token.slice(3), 'base64url').toString('utf8'))
  assert.equal(after.s, before.s)
  assert.equal(after.t, T0 + 60000)
})

test('[AC-076] resume rejects brief, design, docs and prompt without calling the provider', () => {
  const token = tokenFrom(T0)
  for (const key of ['brief', 'design', 'docs', 'prompt']) {
    const ctx = ctxAt(T0)
    const result = resumeSession(ctx, { target: TARGET, token, input: { [key]: 'FULL TEXT', diff: 'd' } })
    assert.equal(result.ok, false, key)
    assert.equal(result.error.code, 'E_REQUEST_INVALID', key)
    assert.equal(result.error.message, 'resume accepts only summary, diff, findings, constraints')
    assert.equal(ctx.exec.count, 0, key)
  }

  const empty = ctxAt(T0)
  assert.equal(resumeSession(empty, { target: TARGET, token, input: {} }).error.message, 'input is empty')
  assert.equal(empty.exec.count, 0)

  const badValue = ctxAt(T0)
  assert.equal(resumeSession(badValue, { target: TARGET, token, input: { diff: 5 } }).error.code, 'E_REQUEST_INVALID')
  assert.equal(badValue.exec.count, 0)

  const malformed = ctxAt(T0)
  const broken = resumeSession(malformed, { target: TARGET, token: 'st_!!!', input: { diff: 'd' } })
  assert.equal(broken.error.code, 'E_REQUEST_INVALID')
  assert.equal(broken.error.message, 'session_token is malformed')
  assert.equal(malformed.exec.count, 0)
})

test('[AC-076] composeInput joins arrays by line and keeps the canonical byte layout', () => {
  assert.equal(
    composeInput({ constraints: 'c', findings: ['a', 'b'], diff: 'd', summary: 's' }),
    '## summary\ns\n\n## diff\nd\n\n## findings\na\nb\n\n## constraints\nc\n'
  )
  assert.equal(composeInput({ prompt: 'P', diff: 'D' }), '## prompt\nP\n\n## diff\nD\n')
  assert.equal(composeInput({ findings: ['f1', 'f2'], diff: 'D' }), '## diff\nD\n\n## findings\nf1\nf2\n')
})

test('[AC-076] the four identity levels are reachable and unverified never blocks', () => {
  const rollout = JSON.stringify({ model: 'm-secret' }) + '\n'
  const files = { 'C:/work/rollout.jsonl': rollout }

  const verified = startSession(ctxAt(T0), { target: TARGET, input: { prompt: 'p' } })
  assert.deepEqual(
    [verified.ok, verified.identity.level, verified.identity.identity_source, verified.identity.consistent],
    [true, 'verified', 'stdout.event.model', true]
  )

  const observed = startSession(ctxAt(T0, undefined, files), {
    target: targetWith({
      session: { ...DESCRIPTOR, identity: { source: 'rollout-file', model_path: 'model', file: 'rollout.jsonl' } },
    }),
    input: { prompt: 'p' },
  })
  assert.deepEqual(
    [observed.ok, observed.identity.level, observed.identity.identity_source, observed.identity.consistent],
    [true, 'observed', 'rollout-file', true]
  )

  const none = startSession(ctxAt(T0), {
    target: targetWith({ session: { ...DESCRIPTOR, identity: undefined } }),
    input: { prompt: 'p' },
  })
  assert.deepEqual([none.ok, none.identity.level, none.identity.identity_source, none.identity.consistent], [
    true,
    'unverified',
    'none',
    null,
  ])
  assert.equal(typeof none.session_token, 'string')

  const cliFlag = startSession(ctxAt(T0), {
    target: targetWith({ session: { ...DESCRIPTOR, identity: { source: 'cli_flag', model_path: 'model' } } }),
    input: { prompt: 'p' },
  })
  assert.deepEqual([cliFlag.ok, cliFlag.identity.level, cliFlag.identity.identity_source], [true, 'unverified', 'cli_flag'])

  const mismatch = startSession(ctxAt(T0, () => ({
    ok: true,
    code: 0,
    stdout: JSON.stringify({ session_id: 'sid-1', model: 'other-model' }),
    stderr: '',
    error: null,
  })), { target: TARGET, input: { prompt: 'p' } })
  assert.deepEqual([mismatch.ok, mismatch.identity.level, mismatch.identity.consistent], [true, 'verified', false])

  const failed = startSession(ctxAt(T0, () => BAD), { target: TARGET, input: { prompt: 'p' } })
  assert.deepEqual([failed.ok, failed.identity.level, failed.identity.identity_source], [false, 'failed', 'none'])
  const text = JSON.stringify(failed.identity)
  assert.ok(!text.includes('m-secret'))
  assert.ok(!text.includes('other-model'))
})

test('[AC-076] start against a one-shot provider returns a null token', () => {
  const ctx = ctxAt(T0)
  const result = startSession(ctx, {
    target: targetWith({ session: { ...DESCRIPTOR, supports_resume: false, reason: 'one-shot' } }),
    input: { prompt: 'p' },
  })
  assert.equal(result.ok, true)
  assert.equal(result.session_token, null)
  assert.equal(ctx.exec.count, 1)
})
