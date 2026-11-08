import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { REGISTRY, getCode } from '../../lib/contract/registry.mjs'
import { scanView } from '../../lib/contract/scan.mjs'
import {
  SESSION_ACTIONS,
  SESSION_IDENTITY_LEVELS,
  SESSION_RESULT_SCHEMA,
  VIEW_NAMES,
  resolveView,
  sessionView,
} from '../../lib/contract/views.mjs'
import {
  DEFAULT_SESSION_TTL_S,
  INVALIDATION_CODES,
  ROLE_POLICIES,
  SESSION_ERRORS,
  composeInput,
  nextAction,
  resumeSession,
  rolePolicy,
  startSession,
} from '../../lib/session.mjs'
import {
  IDENTITY_SOURCES,
  buildSessionCall,
  extractSessionId,
  validateSessionDescriptor,
} from '../../lib/providers/call.mjs'
import { createFakeContext, fakeFs } from '../helpers/ctx.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const T0 = Date.parse('2026-11-08T00:00:00Z')

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

function ctxAt(now, handler) {
  const ctx = createFakeContext({ now, exec: handler ?? (() => OK) })
  const seen = []
  const exec = ctx.exec
  ctx.exec = (command, args, options) => {
    seen.push({ command, args, options })
    return exec(command, args, options)
  }
  ctx.seen = seen
  return ctx
}

function targetWith(patch) {
  return { ...TARGET, ...(patch || {}) }
}

function tokenOf(ctx) {
  const result = startSession(ctx, { target: TARGET, input: { prompt: 'p' } })
  assert.equal(result.ok, true)
  return result.session_token
}

test('[AC-076] SESSION_ERRORS lists nine fixed non-retryable codes', () => {
  const codes = Object.keys(SESSION_ERRORS)
  assert.equal(codes.length, 9)
  for (const [code, entry] of Object.entries(SESSION_ERRORS)) {
    assert.equal(entry.code, code)
    assert.equal(entry.retryable, false)
    assert.equal(typeof entry.message, 'string')
    assert.ok(entry.message.length > 0)
  }
  assert.ok(Object.isFrozen(SESSION_ERRORS))
})

test('[AC-076] INVALIDATION_CODES keep the AC-076 order', () => {
  assert.deepEqual([...INVALIDATION_CODES], [
    'E_SESSION_MODEL_CHANGED',
    'E_SESSION_PROVIDER_CHANGED',
    'E_SESSION_CONTRACT_CHANGED',
    'E_SESSION_EXPIRED',
    'E_SESSION_RESUME_FAILED',
    'E_SESSION_NOT_SUPPORTED',
  ])
  assert.ok(Object.isFrozen(INVALIDATION_CODES))
  assert.equal(DEFAULT_SESSION_TTL_S, 43200)
})

test('[AC-076] the registry is untouched and knows no session code', () => {
  for (const code of Object.keys(SESSION_ERRORS)) assert.equal(getCode(code), null, code)
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/registry.snapshot.json'), 'utf8'))
  assert.equal(snapshot.snapshot_version, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(REGISTRY)), snapshot)
})

test('[AC-076] sessionView keeps the success keys in order and drops extras', () => {
  const view = sessionView({
    action: 'start',
    session_token: 'st_x',
    identity: null,
    reply: 'r',
    extra: 'drop',
    provider: 'p',
  })
  assert.deepEqual(Object.keys(view), ['schema', 'ok', 'action', 'session_token', 'identity', 'reply'])
  assert.deepEqual(view, {
    schema: SESSION_RESULT_SCHEMA,
    ok: true,
    action: 'start',
    session_token: 'st_x',
    identity: null,
    reply: 'r',
  })
  assert.deepEqual(sessionView({ action: 'resume' }), {
    schema: SESSION_RESULT_SCHEMA,
    ok: true,
    action: 'resume',
    session_token: null,
    identity: null,
    reply: '',
  })
})

test('[AC-076] sessionView keeps only the four error keys and drops the result payload', () => {
  const view = sessionView({
    action: 'resume',
    error: { code: 'E_SESSION_EXPIRED', message: 'm', retryable: false, junk: 1 },
    session_token: 'st_leak',
    reply: 'leak',
  })
  assert.deepEqual(Object.keys(view), ['schema', 'ok', 'action', 'error'])
  assert.equal(view.ok, false)
  assert.deepEqual(view.error, {
    code: 'E_SESSION_EXPIRED',
    message: 'm',
    retryable: false,
    retry_after: null,
  })

  const identity = { level: 'failed', identity_source: 'none', consistent: null, observed_at: 't' }
  const withIdentity = sessionView({
    action: 'start',
    error: { code: 'E_SESSION_START_FAILED', message: 'm', retryable: false, retry_after: null },
    identity,
  })
  assert.deepEqual(Object.keys(withIdentity), ['schema', 'ok', 'action', 'error', 'identity'])
  assert.deepEqual(withIdentity.identity, identity)
})

test('[AC-076] sessionView rejects an unknown action', () => {
  assert.throws(() => sessionView({ action: 'run' }), TypeError)
})

test('[AC-076] startSession returns one exec, an opaque token and a scannable result', () => {
  const ctx = ctxAt(T0)
  const result = startSession(ctx, { target: TARGET, input: { prompt: 'hello' } })
  assert.deepEqual(Object.keys(result), ['schema', 'ok', 'action', 'session_token', 'identity', 'reply'])
  assert.equal(result.schema, 'cliworker.session-result/v1')
  assert.equal(result.action, 'start')
  assert.match(result.session_token, /^st_[A-Za-z0-9_-]+$/)
  assert.equal(result.reply, OK.stdout)
  assert.equal(ctx.seen.length, 1)
  assert.equal(ctx.seen[0].command, 'fakecli')
  assert.deepEqual(ctx.seen[0].args, ['-p', '--model', 'm-secret'])
  assert.equal(ctx.seen[0].options.input, '## prompt\nhello\n')
  assert.equal(ctx.seen[0].options.cwd, 'C:/work')
  assert.deepEqual(result.identity, {
    level: 'verified',
    identity_source: 'stdout.event.model',
    consistent: true,
    observed_at: '2026-11-08T00:00:00.000Z',
  })

  const payload = JSON.parse(Buffer.from(result.session_token.slice(3), 'base64url').toString('utf8'))
  assert.deepEqual(Object.keys(payload), ['v', 's', 'm', 'p', 'c', 't'])
  assert.equal(payload.s, 'sid-1')
  assert.equal(payload.t, T0)
  for (const key of ['m', 'p', 'c']) assert.match(payload[key], /^[0-9a-f]{12}$/)

  const text = JSON.stringify({ ...result, reply: '' })
  for (const word of ['prov-x', 'm-secret', 'fakecli', 'C:/work']) assert.ok(!text.includes(word), word)

  const forbidden = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/agentline-forbidden.json'), 'utf8'))
  const scan = scanView({ ...result, reply: '' }, {
    forbidden,
    catalog: { models: [{ key: 'prov-x:m-secret', id: 'm-secret', cli: 'fakecli' }] },
    wrapper: {},
  })
  assert.deepEqual(scan.hits, [])

  const again = startSession(ctxAt(T0), { target: TARGET, input: { prompt: 'hello' } })
  assert.equal(again.session_token, result.session_token)
})

test('[AC-076] resumeSession reissues the token and sends only the delta', () => {
  const token = tokenOf(ctxAt(T0))
  const ctx = ctxAt(T0 + 60000)
  const result = resumeSession(ctx, { target: TARGET, token, input: { summary: 'S1', diff: 'D1' } })
  assert.equal(result.ok, true)
  assert.deepEqual(Object.keys(result), ['schema', 'ok', 'action', 'session_token', 'identity', 'reply'])
  assert.equal(ctx.seen.length, 1)
  assert.deepEqual(ctx.seen[0].args, ['--resume', 'sid-1'])
  assert.equal(ctx.seen[0].options.input, '## summary\nS1\n\n## diff\nD1\n')
  assert.notEqual(result.session_token, token)
  const payload = JSON.parse(Buffer.from(result.session_token.slice(3), 'base64url').toString('utf8'))
  assert.equal(payload.s, 'sid-1')
  assert.equal(payload.t, T0 + 60000)
})

test('[AC-076] start and resume never touch the file system', () => {
  const ctx = createFakeContext({ now: T0, exec: () => OK })
  const started = startSession(ctx, { target: TARGET, input: { prompt: 'p' } })
  resumeSession(ctx, { target: TARGET, token: started.session_token, input: { diff: 'd' } })
  assert.deepEqual(ctx.fs.accessed, [])
})

test('[AC-076] validateSessionDescriptor accepts one-shot and resumable descriptors', () => {
  assert.deepEqual(validateSessionDescriptor(DESCRIPTOR), { ok: true, resumable: true, problems: [] })

  const oneShot = validateSessionDescriptor({ ...DESCRIPTOR, supports_resume: false, reason: 'one-shot' })
  assert.deepEqual([oneShot.ok, oneShot.resumable, oneShot.problems.length], [true, false, 0])

  const noReason = validateSessionDescriptor({ ...DESCRIPTOR, supports_resume: false })
  assert.equal(noReason.ok, false)
  assert.ok(noReason.problems.length > 0)
  assert.equal(validateSessionDescriptor({ ...DESCRIPTOR, supported: false }).ok, false)
  assert.equal(validateSessionDescriptor({ ...DESCRIPTOR, id_from: 'nope' }).ok, false)
  assert.equal(validateSessionDescriptor(null).ok, false)

  const problems = validateSessionDescriptor({ ...DESCRIPTOR, id_from: 'nope' }).problems
  const text = JSON.stringify(problems)
  assert.ok(!text.includes('fakecli'))
  assert.ok(!text.includes('m-secret'))
  assert.deepEqual([...IDENTITY_SOURCES], [
    'stdout.modelUsage',
    'stdout.event.model',
    'stats.models',
    'rollout-file',
    'cli_flag',
    'none',
  ])
})

test('[AC-076] buildSessionCall keeps argv an array and substitutes the session id', () => {
  assert.deepEqual(buildSessionCall(DESCRIPTOR, { mode: 'resume', session_id: 'sid-1', cwd: 'C:/w' }), {
    command: 'fakecli',
    args: ['--resume', 'sid-1'],
    cwd: 'C:/w',
    input: 'stdin',
  })

  const inline = {
    ...DESCRIPTOR,
    resume: { ...DESCRIPTOR.resume, args: ['--resume={session_id}', '--x'] },
  }
  assert.deepEqual(
    buildSessionCall(inline, { mode: 'resume', session_id: 'sid-1', cwd: 'C:/w' }).args,
    ['--resume=sid-1', '--x']
  )
  assert.deepEqual(buildSessionCall(DESCRIPTOR, { mode: 'start', cwd: 'C:/w' }).args, ['-p', '--model', 'm-secret'])

  for (const bad of ['a b', 'a;b', 'a|b', 'a&b', 'a\nb', '', '../x']) {
    assert.throws(() => buildSessionCall(DESCRIPTOR, { mode: 'resume', session_id: bad, cwd: 'C:/w' }), TypeError, bad)
  }
  assert.throws(() => buildSessionCall(DESCRIPTOR, { mode: 'other', session_id: 'sid-1', cwd: 'C:/w' }), TypeError)
})

test('[AC-076] extractSessionId reads stdout_json, both regex streams and sidecar_file', () => {
  const store = fakeFs({
    'C:/w/sid.txt': 'file-77\n',
    'C:/w/sid.json': JSON.stringify({ session_id: 'js-3' }),
  })
  const readFile = (file) => store.readFileSync(file, 'utf8')

  assert.equal(
    extractSessionId(DESCRIPTOR, { stdout: `noise line\n${JSON.stringify({ session_id: 'jl-1' })}\n`, stderr: '' }, readFile),
    'jl-1'
  )
  assert.equal(
    extractSessionId(
      { ...DESCRIPTOR, id_from: 'stdout_regex', id_pattern: 'session: ([a-z0-9-]+)' },
      { stdout: 'ok session: abc-9 done', stderr: '' },
      readFile
    ),
    'abc-9'
  )
  assert.equal(
    extractSessionId(
      { ...DESCRIPTOR, id_from: 'stderr_regex', id_pattern: 'sid=([A-Za-z0-9_]+)' },
      { stdout: '', stderr: ' sid=err_5 ' },
      readFile
    ),
    'err_5'
  )
  assert.equal(
    extractSessionId(
      { ...DESCRIPTOR, id_from: 'sidecar_file', id_file: 'C:/w/sid.txt', id_path: undefined },
      { stdout: '{}', stderr: '' },
      readFile
    ),
    'file-77'
  )
  assert.equal(
    extractSessionId(
      { ...DESCRIPTOR, id_from: 'sidecar_file', id_file: 'C:/w/sid.json', id_path: 'session_id' },
      { stdout: '{}', stderr: '' },
      readFile
    ),
    'js-3'
  )
  assert.equal(
    extractSessionId(DESCRIPTOR, { stdout: JSON.stringify({ session_id: 'a b' }), stderr: '' }, readFile),
    null
  )
  assert.equal(
    extractSessionId({ ...DESCRIPTOR, id_path: '__proto__.x' }, { stdout: '{}', stderr: '' }, readFile),
    null
  )
})

test('[AC-076] ROLE_POLICIES and nextAction follow the session table', () => {
  assert.deepEqual(Object.keys(ROLE_POLICIES), ['design', 'design_prereview', 'dev', 'review', 'test_architect'])
  assert.deepEqual(rolePolicy('design'), { mode: 'reuse', shares_with: null })
  assert.deepEqual(rolePolicy('design_prereview'), { mode: 'reuse', shares_with: 'design' })
  assert.deepEqual(rolePolicy('dev'), { mode: 'reuse', shares_with: null })
  assert.deepEqual(rolePolicy('review'), { mode: 'new_each_round', shares_with: null })
  assert.deepEqual(rolePolicy('test_architect'), { mode: 'configurable', shares_with: null })
  assert.throws(() => rolePolicy('nobody'), TypeError)

  assert.equal(nextAction('design', { hasActiveRecord: true }), 'resume')
  assert.equal(nextAction('design', { hasActiveRecord: false }), 'start')
  assert.equal(nextAction('review', { hasActiveRecord: true }), 'start')
  assert.equal(nextAction('test_architect', { hasActiveRecord: true }), 'start')
  assert.equal(nextAction('test_architect', { hasActiveRecord: true, reuse: true }), 'resume')
})

test('[AC-076] composeInput writes the fixed order with one blank line between sections', () => {
  assert.equal(
    composeInput({ constraints: 'c', findings: ['a', 'b'], diff: 'd', summary: 's' }),
    '## summary\ns\n\n## diff\nd\n\n## findings\na\nb\n\n## constraints\nc\n'
  )
  assert.equal(composeInput({ prompt: 'P', diff: 'D' }), '## prompt\nP\n\n## diff\nD\n')
})

test('[AC-076] views.mjs stays pure and keeps its existing exports', () => {
  assert.deepEqual(VIEW_NAMES, ['agentline', 'full', 'draft'])
  assert.equal(resolveView({ transport: 'cli', request: { schema: 'cliworker.request/v1' } }).view, 'agentline')
  assert.equal(
    resolveView({ transport: 'cli', request: { view: 'full', schema: 'cliworker.request/v1' } }).error,
    'E_VIEW_FORBIDDEN'
  )
  assert.deepEqual([...SESSION_ACTIONS], ['start', 'resume'])
  assert.deepEqual([...SESSION_IDENTITY_LEVELS], ['verified', 'observed', 'unverified', 'failed'])

  const source = fs.readFileSync(path.join(ROOT, 'lib/contract/views.mjs'), 'utf8')
  assert.ok(!/^\s*import\s/m.test(source))
  assert.ok(!/node:|Date\.now|new Date|setTimeout|setInterval|setImmediate|process\.env/.test(source))
})
