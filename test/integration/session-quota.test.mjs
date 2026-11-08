import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildForecast } from '../../lib/forecast.mjs'
import {
  composeInput,
  nextAction,
  resumeSession,
  startSession,
  writeRolePolicy,
} from '../../lib/session.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

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
  return createFakeContext({ now, exec: handler ?? (() => OK) })
}

function forecastWith(pct) {
  return buildForecast({ model: 'prov-x:m-secret', quota: { remaining_pct: pct }, now: T0 })
}

test('[AC-076] a healthy forecast lets the session resume', () => {
  const forecast = forecastWith(80)
  assert.equal(forecast.risk, 'ok')
  const started = startSession(ctxAt(T0), { target: TARGET, input: { prompt: 'p' } })
  const ctx = ctxAt(T0 + 60000)
  const result = resumeSession(ctx, { target: TARGET, token: started.session_token, input: { diff: 'd' }, forecast })
  assert.equal(result.ok, true)
  assert.equal(ctx.exec.count, 1)
})

test('[AC-076] exhausted or critical quota blocks resume and keeps the provider idle', () => {
  const started = startSession(ctxAt(T0), { target: TARGET, input: { prompt: 'p' } })
  for (const [pct, risk] of [[0, 'exhausted'], [3, 'critical']]) {
    const forecast = forecastWith(pct)
    assert.equal(forecast.risk, risk)
    const ctx = ctxAt(T0 + 60000)
    const result = resumeSession(ctx, {
      target: TARGET,
      token: started.session_token,
      input: { diff: 'd' },
      forecast,
    })
    assert.equal(result.ok, false)
    assert.equal(result.action, 'resume')
    assert.equal(result.error.code, 'E_SESSION_QUOTA_EXHAUSTED')
    assert.equal(result.error.retryable, false)
    assert.equal(result.error.retry_after, null)
    assert.equal('identity' in result, false)
    assert.equal(ctx.exec.count, 0)
    assert.ok(!JSON.stringify(result).includes('m-secret'))
  }
})

test('[AC-076] after quota exhaustion the caller starts another model with summary and diff', () => {
  const started = startSession(ctxAt(T0), { target: TARGET, input: { prompt: 'p' } })

  const other = {
    ...TARGET,
    model_key: 'prov-z:m2',
    provider: 'prov-z',
    model_id: 'm2',
    session: {
      ...DESCRIPTOR,
      start: { command: 'fakecli2', args: ['-p'], input: 'stdin', cwd: '<workspace>' },
    },
  }

  const seen = []
  const ctx = ctxAt(T0, (command, args, options) => {
    seen.push({ command, args, options })
    return {
      ok: true,
      code: 0,
      stdout: JSON.stringify({ session_id: 'sid-2', model: 'm2' }),
      stderr: '',
      error: null,
    }
  })
  const fresh = startSession(ctx, { target: other, input: { summary: 'SUM', diff: 'DIFF' } })
  assert.equal(fresh.ok, true)
  assert.equal(ctx.exec.count, 1)
  assert.equal(seen[0].command, 'fakecli2')
  assert.equal(seen[0].options.input, composeInput({ summary: 'SUM', diff: 'DIFF' }))
  assert.notEqual(fresh.session_token, started.session_token)

  const stale = resumeSession(ctxAt(T0), { target: other, token: started.session_token, input: { diff: 'd' } })
  assert.equal(stale.error.code, 'E_SESSION_PROVIDER_CHANGED')
})

test('[AC-076] design and dev resume across rounds while review starts every round', () => {
  assert.equal(nextAction('design', { hasActiveRecord: true }), 'resume')
  assert.equal(nextAction('dev', { hasActiveRecord: true }), 'resume')
  assert.equal(nextAction('review', { hasActiveRecord: true }), 'start')

  let designToken = startSession(ctxAt(T0), { target: TARGET, input: { prompt: 'p' } }).session_token
  for (let round = 1; round <= 2; round += 1) {
    const ctx = ctxAt(T0 + round * 60000)
    const result = resumeSession(ctx, { target: TARGET, token: designToken, input: { summary: `r${round}` } })
    assert.equal(result.ok, true)
    designToken = result.session_token
  }

  let devToken = startSession(ctxAt(T0), { target: TARGET, input: { prompt: 'p' } }).session_token
  const devRound = resumeSession(ctxAt(T0 + 60000), { target: TARGET, token: devToken, input: { diff: 'fix' } })
  assert.equal(devRound.ok, true)
  devToken = devRound.session_token
  assert.equal(typeof devToken, 'string')

  const first = startSession(ctxAt(T0), { target: TARGET, input: { prompt: 'review 1' } })
  const second = startSession(ctxAt(T0 + 1000), { target: TARGET, input: { prompt: 'review 2' } })
  assert.notEqual(first.session_token, second.session_token)
})

test('[AC-076] writeRolePolicy persists five roles and leaves a foreign schema alone', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 's032-'))
  try {
    const ctx = ctxAt(T0)
    ctx.fs = fs
    const roles = ['design', 'design_prereview', 'dev', 'review', 'test_architect']
    const modes = {
      design: ['reuse', null],
      design_prereview: ['reuse', 'design'],
      dev: ['reuse', null],
      review: ['new_each_round', null],
      test_architect: ['configurable', null],
    }

    for (const role of roles) {
      const written = writeRolePolicy(ctx, { taskDir: directory, task: '032', role })
      assert.deepEqual(written, { ok: true, written: true, path: path.join(directory, 'sessions', `${role}.json`) })
      const text = fs.readFileSync(written.path, 'utf8')
      const value = JSON.parse(text)
      assert.deepEqual(Object.keys(value), ['schema', 'task', 'role', 'mode', 'shares_with', 'ttl_s', 'invalidate_on'])
      assert.equal(value.schema, 'cliworker.session-policy/v1')
      assert.equal(value.task, '032')
      assert.equal(value.role, role)
      assert.equal(value.mode, modes[role][0])
      assert.equal(value.shares_with, modes[role][1])
      assert.equal(value.ttl_s, 43200)
      assert.deepEqual(value.invalidate_on, [
        'E_SESSION_MODEL_CHANGED',
        'E_SESSION_PROVIDER_CHANGED',
        'E_SESSION_CONTRACT_CHANGED',
        'E_SESSION_EXPIRED',
        'E_SESSION_RESUME_FAILED',
        'E_SESSION_NOT_SUPPORTED',
      ])
      assert.ok(!/session_id|session_token|\bst_|prov-x|fakecli/.test(text))
    }

    const devFile = path.join(directory, 'sessions', 'dev.json')
    fs.writeFileSync(devFile, JSON.stringify({ schema: 'agentline.session/v1', session_id: 'sess_abc' }))
    const foreign = writeRolePolicy(ctx, { taskDir: directory, task: '032', role: 'dev' })
    assert.deepEqual(foreign, { ok: true, written: false, reason: 'foreign_schema', path: devFile })
    assert.equal(JSON.parse(fs.readFileSync(devFile, 'utf8')).session_id, 'sess_abc')

    assert.equal(writeRolePolicy(ctx, { taskDir: directory, task: '032', role: '../evil' }).ok, false)
    assert.equal(writeRolePolicy(ctx, { taskDir: directory, task: '../x', role: 'dev' }).ok, false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('[AC-076] writeRolePolicy leaves no partial file when the rename fails', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 's032-'))
  try {
    const ctx = ctxAt(T0)
    ctx.fs = Object.assign({}, fs, {
      renameSync: () => {
        throw new Error('EPERM')
      },
    })
    const result = writeRolePolicy(ctx, { taskDir: directory, task: '032', role: 'design' })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'E_INTERNAL')
    assert.equal(result.error.message, 'failed to write session policy')
    assert.deepEqual(fs.readdirSync(path.join(directory, 'sessions')), [])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('[AC-076] the session path never fetches a catalog or runs a non-session command', () => {
  const ctx = ctxAt(T0)
  const started = startSession(ctx, { target: TARGET, input: { prompt: 'p' } })
  const resumed = resumeSession(ctx, { target: TARGET, token: started.session_token, input: { diff: 'd' } })
  assert.equal(resumed.ok, true)
  assert.equal(ctx.fetch.calls.length, 0)
  assert.equal(ctx.exec.count, 2)
  for (const call of ctx.exec.calls) assert.equal(call.command, 'fakecli')
})
