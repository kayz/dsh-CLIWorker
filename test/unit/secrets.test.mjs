import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createExec } from '../../lib/exec.mjs'
import { loadConfig } from '../../lib/config.mjs'
import { exitCodeFor, errorBodyFrom } from '../../lib/output.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'
import path from 'node:path'
import os from 'node:os'
import { resolveSecret, runWithSecrets, secretAction } from '../../lib/secrets/index.mjs'

test('[AC-033] recursive inline secret detection preserves config compatibility', () => {
  const file = path.join(os.tmpdir(), 'cw-secret-config.json')
  const value = 'sensitive-test-value'
  for (const key of ['ACCESS_TOKEN', 'my_api_key_value', 'clientSecret', 'PASSWORD']) {
    const raw = { providers: {}, models: {}, nested: [{ [key]: value }] }
    const ctx = createFakeContext({ files: { [file]: JSON.stringify(raw) }, env: {}, platform: process.platform })
    assert.throws(() => loadConfig({ file, ctx }), error => {
      assert.equal(error.code, 'E_CONFIG_SECRET_INLINE')
      assert.equal(exitCodeFor(error.code), 3)
      assert.equal(errorBodyFrom(error).error.retryable, false)
      assert.equal(error.message.includes(value), false)
      return true
    })
  }
  const raw = { providers: {}, models: {}, nested: [{ access_token: { ref: 'env:EXAMPLE' }, password: 42 }] }
  const ctx = createFakeContext({ files: { [file]: JSON.stringify(raw) }, env: {}, platform: process.platform })
  assert.doesNotThrow(() => loadConfig({ file, ctx }))
})

test('session isolation and consumer injection', () => {
  const calls = []
  const env = { SENTINEL: 'sensitive-value', ALIAS: 'sensitive-value', PATH: 'path' }
  const ctx = { env, platform: 'linux', exec: (command, args, options) => {
    calls.push({ command, args, options })
    return { ok: true, code: 0, stdout: 'sensitive-value', stderr: '', error: null }
  } }
  const config = { secrets: { kimi: { ref: 'session:example' } } }
  secretAction(ctx, config, 'kimi', 'set', 'sensitive-value')
  assert.equal(resolveSecret(ctx, config, 'kimi'), 'sensitive-value')
  assert.equal(resolveSecret({ ...ctx }, config, 'kimi'), null)
  const result = runWithSecrets(ctx, config, 'kimi', { command: 'provider', args: [], env_names: ['KIMI_API_KEY'] })
  assert.deepEqual(calls[0].options.env, { PATH: 'path', KIMI_API_KEY: 'sensitive-value' })
  assert.equal(result.stdout, '[REDACTED]')
  assert.equal(env.SENTINEL, 'sensitive-value')
  secretAction(ctx, config, 'kimi', 'clear')
  assert.throws(() => runWithSecrets(ctx, config, 'kimi', { command: 'provider', args: [], env_names: ['KIMI_API_KEY'] }), { code: 'E_SECRET_BACKEND' })
  assert.equal(calls.length, 1)
})

test('exec forwards synchronous input without changing argv', () => {
  let observed
  const exec = createExec({ spawnSync: (file, args, options) => {
    observed = { file, args, options }
    return { status: 0, stdout: '', stderr: '' }
  } })
  assert.equal(exec.runSync('tool', ['argument'], { input: 'input value' }).ok, true)
  assert.deepEqual(observed.args, ['argument'])
  assert.equal(observed.options.input, 'input value')
  assert.equal(observed.options.shell, false)
})

test('exec sends empty asynchronous input and handles stdin errors', async () => {
  let stdin
  let options
  const clock = { setTimeout: () => 1, clearTimeout: () => {} }
  const exec = createExec({ clock, spawn: (file, args, opts) => {
    options = opts
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    stdin = child.stdin = new EventEmitter()
    stdin.end = value => { assert.equal(value, ''); queueMicrotask(() => stdin.emit('error', new Error('EPIPE'))) }
    return child
  } })
  const result = await exec.runAsync('tool', [], { input: '' })
  assert.equal(options.stdio[0], 'pipe')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'stdin write failed')
})
