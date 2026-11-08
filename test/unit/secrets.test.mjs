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

test('legacy configuration retains explicit secret references', () => {
  const file = path.join(os.tmpdir(), 'cw-secret-ref-config.json')
  const raw = { providers: {}, models: {}, secrets: { kimi: { ref: 'session:configured' } } }
  const ctx = createFakeContext({ files: { [file]: JSON.stringify(raw) }, env: {}, platform: process.platform })
  const config = loadConfig({ file, ctx })
  secretAction(ctx, config, 'kimi', 'set', 'test-value')
  assert.equal(resolveSecret(ctx, config, 'kimi'), 'test-value')
  assert.equal(config.secrets.kimi.ref, 'session:configured')
})

test('Windows failed ciphertext write removes directories created by the attempt', () => {
  const removed = []
  const ctx = {
    platform: 'win32', env: {},
    exec: () => ({ ok: true, code: 0, stdout: 'ciphertext', stderr: '', error: null }),
    fs: {
      mkdirSync: () => 'C:\\isolated\\state',
      writeFileSync: () => { throw new Error('write failed') },
      unlinkSync: () => {},
      rmdirSync: dir => removed.push(dir),
    },
  }
  assert.throws(() => secretAction(ctx, { state_dir: 'C:\\isolated\\state' }, 'kimi', 'set', 'value'), { code: 'E_SECRET_BACKEND' })
  assert.deepEqual(removed, ['c:\\isolated\\state\\secrets', 'c:\\isolated\\state'])
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

test('[AC-033] platform backends use stdin and do not expose secrets in arguments', () => {
  const secret = 'secret-value-"-\\'
  for (const platform of ['win32', 'darwin', 'linux']) {
    const calls = []
    const files = new Map()
    const ctx = {
      platform, env: {},
      fs: {
        mkdirSync: () => undefined,
        writeFileSync: (file, data) => files.set(file, data),
        renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from) },
        readFileSync: file => files.get(file),
        unlinkSync: file => { files.delete(file) },
      },
      exec: (command, args, options) => {
        calls.push({ command, args, options })
        return { ok: true, code: 0, stdout: platform === 'win32' ? 'ciphertext' : '', stderr: '', error: null }
      },
    }
    const config = { state_dir: platform === 'win32' ? 'C:\\state' : '/state' }
    secretAction(ctx, config, 'kimi', 'set', secret)
    secretAction(ctx, config, 'kimi', 'get')
    secretAction(ctx, config, 'kimi', 'clear')
    assert.equal(calls[0].command, { win32: 'pwsh', darwin: 'security', linux: 'secret-tool' }[platform])
    for (const call of calls) {
      assert.equal(call.options.shell, false)
      assert.equal(JSON.stringify(call.args).includes(secret), false)
    }
    assert.ok(calls[0].options.input.includes(platform === 'darwin' ? 'secret-value-' : secret))
  }
})

test('[AC-033] backend execution failures remain backend errors on every platform', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const result of [
      { ok: false, code: null, error: 'ENOENT', stdout: '', stderr: '' },
      { ok: false, code: 2, error: null, stdout: '', stderr: 'permission denied' },
    ]) {
      let writes = 0
      const ctx = { platform, env: {}, fs: { mkdirSync: () => { writes += 1 } }, exec: () => result }
      assert.throws(() => secretAction(ctx, { state_dir: platform === 'win32' ? 'C:\\state' : '/state' }, 'kimi', 'set', 'value'), { code: 'E_SECRET_BACKEND' })
      assert.equal(writes, 0)
    }
  }
})
