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
import { run as authSet } from '../../lib/commands/auth/set.mjs'
import { run as authStatus } from '../../lib/commands/auth/status.mjs'
import { run as authClear } from '../../lib/commands/auth/clear.mjs'
import crypto from 'node:crypto'
import { createFakeClock } from '../helpers/clock.mjs'
import { main } from '../../lib/cli.mjs'

test('[AC-033] auth validates input before accessing the backend and preserves stdin whitespace', () => {
  let calls = 0
  const ctx = { env: { INPUT: ' value ' }, fs: { readFileSync: () => ' value \r\n' }, platform: 'linux', exec: () => { calls++; throw new Error('unexpected backend call') } }
  const config = { secrets: { kimi: { ref: 'session:test' } } }
  const run = (fn, args) => fn({ argv: ['auth', ...args], ctx, config })
  for (const args of [['set'], ['set', 'kimi', 'extra'], ['set', 'kimi', '--unknown'], ['set', 'kimi', '--from-env'], ['set', 'kimi', '--from-env', 'MISSING']]) {
    assert.throws(() => run(authSet, args), { code: 'E_REQUEST_INVALID' })
  }
  assert.equal(calls, 0)
  assert.deepEqual(run(authSet, ['set', 'kimi']), { ok: true, state: 'set' })
  assert.equal(resolveSecret(ctx, config, 'kimi'), ' value ')
  assert.deepEqual(run(authStatus, ['status', 'kimi']), { ok: true, state: 'set' })
  assert.deepEqual(run(authClear, ['clear', 'kimi']), { ok: true, state: 'unset' })
  assert.deepEqual(run(authStatus, ['status', 'kimi']), { ok: true, state: 'unset' })
  assert.deepEqual(run(authSet, ['set', 'kimi', '--from-env', 'INPUT']), { ok: true, state: 'set' })
  assert.equal(resolveSecret(ctx, config, 'kimi'), ' value ')
})

test('[AC-033] env references are read-only and empty env_names do not resolve credentials', () => {
  let calls = 0
  const env = { INPUT: 'value' }
  const ctx = { env, platform: 'linux', exec: () => { calls++; return { ok: true, code: 0, stdout: '', stderr: '', error: null } } }
  const config = { secrets: { kimi: { ref: 'env:INPUT' } } }
  assert.equal(resolveSecret(ctx, config, 'kimi'), 'value')
  for (const action of ['set', 'clear']) assert.throws(() => secretAction(ctx, config, 'kimi', action, 'other'), { code: 'E_SECRET_BACKEND' })
  assert.deepEqual(env, { INPUT: 'value' })
  runWithSecrets(ctx, { secrets: { kimi: { ref: 'bad' } } }, 'kimi', { command: 'provider', args: [], env_names: [] })
  assert.equal(calls, 1)
})

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

// A platform-specific in-memory filesystem keeps all backend cases runnable on any host.
function memorySecrets(platform) {
  const P = platform === 'win32' ? path.win32 : path.posix
  const root = platform === 'win32' ? 'c:\\' : '/'
  const files = new Map()
  const dirs = new Set([root])
  const norm = value => P.resolve(value)
  let failure
  const fail = operation => {
    if (failure === operation) throw Object.assign(new Error('injected filesystem failure'), { code: 'EACCES' })
  }
  const absent = () => Object.assign(new Error('absent'), { code: 'ENOENT' })
  const api = {
    mkdirSync(value) {
      fail('mkdir')
      const target = norm(value)
      const missing = []
      for (let dir = target; !dirs.has(dir); dir = P.dirname(dir)) missing.unshift(dir)
      for (const dir of missing) dirs.add(dir)
      return missing[0]
    },
    writeFileSync(value, data) {
      files.set(norm(value), Buffer.from(data))
      fail('write')
    },
    renameSync(from, to) {
      fail('rename')
      files.set(norm(to), files.get(norm(from)))
      files.delete(norm(from))
    },
    readFileSync(value, encoding) {
      fail('read')
      if (!files.has(norm(value))) throw absent()
      const data = files.get(norm(value))
      return encoding ? data.toString(encoding) : Buffer.from(data)
    },
    unlinkSync(value) {
      fail('unlink')
      if (!files.delete(norm(value))) throw absent()
    },
    rmdirSync(value) {
      const dir = norm(value)
      if ([...files.keys(), ...dirs].some(child => child !== dir && P.dirname(child) === dir)) throw new Error('not empty')
      dirs.delete(dir)
    },
  }
  return {
    fs: api, files, dirs,
    fail(operation) { failure = operation },
    snapshot() {
      return [...[...dirs].sort().map(dir => [dir, null]), ...[...files].sort().map(([file, bytes]) => [file, bytes.toString('hex')])]
    },
  }
}

test('[AC-033] platform set get status and clear use the same service and entry', () => {
  const value = 'credential "quoted" \\ unicode-令牌'
  const sha = text => crypto.createHash('sha256').update(text).digest('hex')
  for (const platform of ['win32', 'darwin', 'linux']) {
    const io = memorySecrets(platform)
    const calls = []
    const state = platform === 'win32' ? 'C:\\STATE\\Nested\\..' : '/state/nested/..'
    const normalized = platform === 'win32' ? 'c:\\state' : '/state'
    const entry = '../entry "quote"\\backslash'
    const service = 'cliworker:' + sha(normalized)
    const config = { state_dir: state, secrets: { kimi: { ref: 'keychain:' + entry } } }
    const ctx = { platform, env: {}, fs: io.fs, exec(command, args, options) {
      calls.push({ command, args, options })
      const set = platform === 'win32' ? args.at(-1).includes('::Protect(') : platform === 'darwin' ? args[0] === '-i' : args[0] === 'store'
      return { ok: true, code: 0, stdout: set ? (platform === 'win32' ? 'encrypted-blob' : '') : value + (platform === 'win32' ? '' : '\n'), stderr: '', error: null }
    } }
    assert.deepEqual(authSet({ argv: ['auth', 'set', 'kimi', '--from-env', 'INPUT'], ctx: { ...ctx, env: { INPUT: value } }, config }), { ok: true, state: 'set' })
    assert.equal(resolveSecret(ctx, config, 'kimi') === value, true, 'get returned the wrong credential')
    assert.deepEqual(authStatus({ argv: ['auth', 'status', 'kimi'], ctx, config }), { ok: true, state: 'set' })
    assert.deepEqual(authClear({ argv: ['auth', 'clear', 'kimi'], ctx, config }), { ok: true, state: 'unset' })
    for (const call of calls) {
      assert.equal(call.options.shell, false)
      assert.equal(JSON.stringify(call.args).includes(value), false)
      assert.equal(call.command, { win32: 'pwsh', darwin: 'security', linux: 'secret-tool' }[platform])
    }
    if (platform === 'win32') {
      assert.equal(calls.length, 3)
      assert.deepEqual(calls[0].args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command'])
      assert.equal(calls[0].options.input === value, true)
      assert.equal(calls[1].options.input, 'encrypted-blob')
      assert.ok(calls[0].args[3].includes('DataProtectionScope]::CurrentUser'))
      assert.ok(calls[1].args[3].includes('::Unprotect('))
      assert.equal(io.files.size, 0)
    } else if (platform === 'darwin') {
      assert.deepEqual(calls[0].args, ['-i'])
      const quote = text => '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
      assert.equal(calls[0].options.input === `add-generic-password -U -s ${quote(service)} -a ${quote(entry)} -w ${quote(value)}\n`, true)
      assert.deepEqual(calls[1].args, ['find-generic-password', '-s', service, '-a', entry, '-w'])
      assert.deepEqual(calls[2].args, calls[1].args)
      assert.deepEqual(calls[3].args, ['delete-generic-password', '-s', service, '-a', entry])
    } else {
      assert.deepEqual(calls[0].args, ['store', '--label=CLIWorker', 'service', service, 'entry', entry])
      assert.equal(calls[0].options.input === value, true)
      assert.deepEqual(calls[1].args, ['lookup', 'service', service, 'entry', entry])
      assert.deepEqual(calls[2].args, calls[1].args)
      assert.deepEqual(calls[3].args, ['clear', 'service', service, 'entry', entry])
    }
    for (const call of calls.slice(1)) if (platform !== 'win32') assert.equal(Object.hasOwn(call.options, 'input'), false)
  }
})

test('[AC-033] backend errors preserve recursive directories and existing file bytes', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const existing of [false, true]) {
      for (const failure of ['ENOENT', 'permission', 'throw']) {
        const io = memorySecrets(platform)
        const state = platform === 'win32' ? 'c:\\isolated\\state' : '/isolated/state'
        const P = platform === 'win32' ? path.win32 : path.posix
        const config = { state_dir: state }
        const ctx = { platform, env: {}, fs: io.fs, exec() {
          if (failure === 'throw') throw new Error('do not expose backend details')
          return { ok: false, code: failure === 'ENOENT' ? null : 2, error: failure === 'ENOENT' ? 'ENOENT' : null, stdout: 'private backend output', stderr: 'private backend details' }
        } }
        if (existing) {
          io.fs.mkdirSync(P.join(state, 'secrets'))
          io.fs.mkdirSync(P.join(state, 'nested'))
          io.fs.writeFileSync(P.join(state, 'nested', 'original.bin'), Buffer.from([0, 255, 13, 10]))
          io.fs.writeFileSync(P.join(state, 'secrets', crypto.createHash('sha256').update('kimi').digest('hex') + '.dpapi'), 'old ciphertext')
        }
        const before = io.snapshot()
        const checkError = error => {
          assert.equal(error.code, 'E_SECRET_BACKEND')
          assert.equal(exitCodeFor(error.code), 3)
          assert.equal(errorBodyFrom(error).error.retryable, false)
          assert.equal(error.message, 'secret backend unavailable')
          return true
        }
        assert.throws(() => secretAction(ctx, config, 'kimi', 'set', 'replacement'), checkError)
        if (platform !== 'win32' || existing) {
          assert.throws(() => resolveSecret(ctx, config, 'kimi'), checkError)
          assert.throws(() => authStatus({ argv: ['auth', 'status', 'kimi'], ctx, config }), checkError)
        }
        if (platform !== 'win32') assert.throws(() => secretAction(ctx, config, 'kimi', 'clear'), checkError)
        assert.deepEqual(io.snapshot(), before)
        assert.equal(io.dirs.has(state), existing)
      }
    }
  }
})

test('[AC-033] Windows persistence failures clean temporary ciphertext and preserve old files', () => {
  for (const existing of [false, true]) {
    for (const failure of ['mkdir', 'write', 'rename']) {
      const io = memorySecrets('win32')
      const config = { state_dir: 'c:\\isolated\\state' }
      const ctx = { platform: 'win32', env: {}, fs: io.fs, exec: () => ({ ok: true, code: 0, stdout: 'ciphertext', stderr: '', error: null }) }
      if (existing) secretAction(ctx, config, 'kimi', 'set', 'old credential')
      const before = io.snapshot()
      io.fail(failure)
      assert.throws(() => secretAction(ctx, config, 'kimi', 'set', 'new credential'), { code: 'E_SECRET_BACKEND' })
      assert.deepEqual(io.snapshot(), before)
    }
  }
})

test('[AC-033] only absent entries become unset and file access or corruption stays an error', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const io = memorySecrets(platform)
    const config = { state_dir: platform === 'win32' ? 'c:\\state' : '/state' }
    let reply = { ok: false, code: platform === 'darwin' ? 44 : 1, stdout: '', stderr: '', error: null }
    const ctx = { platform, env: {}, fs: io.fs, exec: () => reply }
    assert.deepEqual(authStatus({ argv: ['auth', 'status', 'kimi'], ctx, config }), { ok: true, state: 'unset' })
    assert.deepEqual(authClear({ argv: ['auth', 'clear', 'kimi'], ctx, config }), { ok: true, state: 'unset' })
    if (platform === 'win32') {
      io.fs.mkdirSync('c:\\state\\secrets')
      io.fs.writeFileSync('c:\\state\\secrets\\' + crypto.createHash('sha256').update('kimi').digest('hex') + '.dpapi', 'corrupt')
      assert.throws(() => resolveSecret(ctx, config, 'kimi'), { code: 'E_SECRET_BACKEND' })
      io.fail('read')
      assert.throws(() => resolveSecret(ctx, config, 'kimi'), { code: 'E_SECRET_BACKEND' })
      io.fail('unlink')
      assert.throws(() => secretAction(ctx, config, 'kimi', 'clear'), { code: 'E_SECRET_BACKEND' })
    } else {
      reply = { ok: false, code: 1, stdout: '', stderr: 'session or permission failure', error: null }
      assert.throws(() => resolveSecret(ctx, config, 'kimi'), { code: 'E_SECRET_BACKEND' })
      assert.throws(() => secretAction(ctx, config, 'kimi', 'clear'), { code: 'E_SECRET_BACKEND' })
      reply = { ok: false, code: 1, stdout: 'backend diagnostic', stderr: '', error: null }
      assert.throws(() => resolveSecret(ctx, config, 'kimi'), { code: 'E_SECRET_BACKEND' })
      assert.throws(() => secretAction(ctx, config, 'kimi', 'clear'), { code: 'E_SECRET_BACKEND' })
    }
  }
})

test('[AC-033] security interactive control characters fail before executing extra commands', () => {
  let calls = 0
  const ctx = { platform: 'darwin', env: {}, exec: () => { calls++; throw new Error('must not execute') } }
  for (const value of ['first\nsecond', 'first\rsecond', 'first\0second', 'first\tsecond', 'first\x7fsecond']) {
    for (const ref of ['keychain:entry', 'keychain:' + value]) {
      const config = { state_dir: '/state', secrets: { kimi: { ref } } }
      assert.throws(() => secretAction(ctx, config, 'kimi', 'set', value), { code: 'E_REQUEST_INVALID' })
    }
  }
  assert.equal(calls, 0)
})

test('[AC-033] invalid auth input and references never reach a backend', () => {
  let calls = 0
  const ctx = { platform: 'linux', env: { EMPTY: '' }, fs: { readFileSync: () => '' }, exec: () => { calls++ } }
  const config = { state_dir: '/state' }
  for (const args of [[], ['kimi', 'token'], ['kimi', '--unknown'], ['kimi', '--from-env'], ['kimi', '--from-env', 'MISSING'], ['kimi', '--from-env', 'EMPTY'], ['kimi', '--from-env', 'EMPTY', '--from-env', 'OTHER'], ['kimi', '--config']]) {
    assert.throws(() => authSet({ argv: ['auth', 'set', ...args], ctx, config }), error => {
      assert.equal(error.code, 'E_REQUEST_INVALID')
      assert.equal(exitCodeFor(error.code), 2)
      return true
    })
  }
  for (const fn of [authStatus, authClear]) for (const args of [[], ['kimi', 'extra'], ['kimi', '--from-env', 'INPUT'], ['kimi', '--unknown']]) {
    assert.throws(() => fn({ argv: ['auth', 'status', ...args], ctx, config }), { code: 'E_REQUEST_INVALID' })
  }
  for (const ref of [null, 'env:INPUT', {}, { ref: 'keychain:' }, { ref: 'file:entry' }, { ref: 1 }]) {
    assert.throws(() => resolveSecret(ctx, { secrets: { kimi: ref } }, 'kimi'), { code: 'E_CONFIG' })
  }
  assert.equal(calls, 0)
})

test('[AC-033] consumer removes secret-bearing env aliases and redacts results without mutating inputs', () => {
  for (const platform of ['win32', 'linux']) {
    const secret = 'known-credential-value'
    const env = { SENTINEL: secret, CW_FLOW_SENTINEL: secret, OTHER: 'prefix:' + secret, Path: 'retained-path', Api_Key: 'old', API_KEY: 'stale' }
    const config = { secrets: { kimi: { ref: 'session:entry' } } }
    const call = { command: 'provider', args: ['--read'], cwd: 'work', env_names: ['API_KEY'] }
    const before = structuredClone({ env, config, call })
    const ctx = { platform, env, exec(command, args, options) {
      assert.equal(command, 'provider')
      assert.deepEqual(args, ['--read'])
      assert.equal(options.cwd, 'work')
      assert.equal(options.input, 'prompt')
      assert.equal(options.timeout, 123)
      assert.equal(options.shell, false)
      const expected = { Path: 'retained-path', API_KEY: secret }
      if (platform === 'linux') expected.Api_Key = 'old'
      assert.deepEqual(Object.keys(options.env).sort(), Object.keys(expected).sort())
      for (const key of Object.keys(expected)) assert.equal(options.env[key] === expected[key], true, 'incorrect provider environment value')
      return { ok: false, code: 1, stdout: secret, stderr: secret, error: secret, error_code: null }
    } }
    secretAction(ctx, config, 'kimi', 'set', secret)
    assert.deepEqual(runWithSecrets(ctx, config, 'kimi', call, 'prompt', 123), { ok: false, code: 1, stdout: '[REDACTED]', stderr: '[REDACTED]', error: '[REDACTED]', error_code: null })
    assert.deepEqual({ env, config, call }, before)
    assert.equal(resolveSecret({ ...ctx }, config, 'kimi'), null)
  }
})

test('[AC-033] inline bare refs are rejected before config migration can write files', () => {
  for (const schema of [undefined, 'cliworker.config/v1', 'cliworker.config/v2']) {
    const file = path.join(os.tmpdir(), 'cw-secret-inline.json')
    const raw = schema === 'cliworker.config/v2'
      ? { schema, discovery: {}, catalog: { manual: [] }, pools: [], policy: {}, secrets: {}, nested: [{ ACCESS_TOKEN: 'env:SOURCE' }] }
      : { ...(schema ? { schema } : {}), providers: {}, models: {}, nested: [{ ACCESS_TOKEN: 'env:SOURCE' }] }
    const ctx = createFakeContext({ files: { [file]: JSON.stringify(raw) }, platform: process.platform })
    const before = [...ctx.fs.files]
    assert.throws(() => loadConfig({ file, ctx }), { code: 'E_CONFIG_SECRET_INLINE' })
    assert.deepEqual([...ctx.fs.files], before)
    assert.equal(ctx.fs.accessed.some(call => ['writeFileSync', 'mkdirSync', 'renameSync'].includes(call.method)), false)
  }
})

test('[AC-033] CLI routes auth commands through config and the existing envelopes', async () => {
  const file = path.join(os.tmpdir(), 'cw-auth-cli.json')
  const ctx = createFakeContext({ files: { [file]: JSON.stringify({ providers: {}, models: {}, secrets: { kimi: { ref: 'session:entry' } } }) }, env: { INPUT: 'private-input' }, platform: process.platform })
  for (const [action, extra, state] of [['set', ['--from-env', 'INPUT'], 'set'], ['status', [], 'set'], ['clear', [], 'unset'], ['status', [], 'unset']]) {
    const before = ctx.stdout.text().length
    assert.deepEqual(await main(['auth', action, 'kimi', ...extra, '--config', file], ctx), { exitCode: 0 })
    assert.deepEqual(JSON.parse(ctx.stdout.text().slice(before)), { ok: true, state })
  }
  const before = ctx.stdout.text().length
  assert.deepEqual(await main(['auth', 'set', 'kimi', 'positional-token', '--config', file], ctx), { exitCode: 2 })
  const response = JSON.parse(ctx.stdout.text().slice(before))
  assert.equal(response.error.code, 'E_REQUEST_INVALID')
  assert.equal(ctx.exec.count, 0)
})

test('[AC-033] exec input sync retries and no-input preserve spawn options', () => {
  const calls = []
  const exec = createExec({ platform: 'win32', spawnSync(file, args, options) {
    calls.push({ file, args, options })
    if (file.endsWith('.cmd')) return { status: null, error: Object.assign(new Error('try fallback'), { code: 'EINVAL' }) }
    return { status: 0, stdout: '', stderr: '' }
  } })
  assert.equal(exec.runSync('tool.cmd', ['safe'], { input: '' }).ok, true)
  assert.equal(calls.length, 2)
  for (const call of calls) { assert.equal(call.options.input, ''); assert.equal(call.options.shell, false) }
  calls.length = 0
  assert.equal(exec.runSync('tool', []).ok, true)
  assert.equal(Object.hasOwn(calls[0].options, 'input'), false)
})

test('[AC-033] exec async input EOF EPIPE and throws release slots and clear timers', async () => {
  const clock = createFakeClock()
  const calls = []
  let mode = 'success'
  const exec = createExec({ clock, platform: 'linux', maxConcurrent: 1, spawn(file, args, options) {
    calls.push({ file, args, options })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = new EventEmitter()
    child.stdin.end = value => {
      assert.equal(value === '' || value === 'input', true)
      if (mode === 'throw') throw new Error('must not expose input')
      queueMicrotask(() => {
        if (mode === 'EPIPE') child.stdin.emit('error', Object.assign(new Error('must not expose input'), { code: 'EPIPE' }))
        child.emit('close', 0)
        child.emit('close', 0)
      })
    }
    if (options.stdio[0] === 'ignore') queueMicrotask(() => child.emit('close', 0))
    return child
  } })
  for (const value of ['input', '']) {
    const result = await exec.runAsync('tool', ['argument'], { input: value })
    assert.equal(result.ok, true)
    assert.equal(clock.pending(), 0)
  }
  for (const failure of ['EPIPE', 'throw']) {
    mode = failure
    const result = await exec.runAsync('tool', [], { input: 'input' })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'stdin write failed')
    assert.equal(clock.pending(), 0)
  }
  mode = 'success'
  const results = await Promise.all([exec.runAsync('tool', []), exec.runAsync('tool', [], { input: '' })])
  assert.equal(results.every(result => result.ok), true)
  assert.equal(calls.at(-2).options.stdio[0], 'ignore')
  assert.equal(calls.at(-1).options.stdio[0], 'pipe')
  assert.equal(clock.pending(), 0)
})

test('[AC-033] stdin strips exactly one line ending and rejects empty input', () => {
  const config = { secrets: { kimi: { ref: 'session:stdin' } } }
  for (const [input, expected] of [[' token \n', ' token '], [' token \r\n', ' token '], ['token\n\n', 'token\n'], ['token\r', 'token\r']]) {
    const ctx = { env: {}, fs: { readFileSync: fd => { assert.equal(fd, 0); return input } } }
    assert.deepEqual(authSet({ argv: ['auth', 'set', 'kimi'], ctx, config }), { ok: true, state: 'set' })
    assert.equal(resolveSecret(ctx, config, 'kimi') === expected, true, 'stdin whitespace changed')
  }
  for (const input of ['', '\n', '\r\n']) {
    const ctx = { env: {}, fs: { readFileSync: () => input } }
    assert.throws(() => authSet({ argv: ['auth', 'set', 'kimi'], ctx, config }), { code: 'E_REQUEST_INVALID' })
    assert.equal(resolveSecret(ctx, config, 'kimi'), null)
  }
})

test('[AC-033] async input timeout clears the timer and releases the concurrency slot', async () => {
  const clock = createFakeClock()
  let current
  let ends = 0
  const exec = createExec({ clock, platform: 'linux', maxConcurrent: 1,
    kill(pid, signal) {
      assert.equal(pid, -123)
      assert.equal(signal, 'SIGKILL')
      current.exitCode = 1
      current.emit('exit', 1)
    },
    spawn(file, args, options) {
      const child = new EventEmitter()
      current = child
      child.pid = 123
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.stdin = new EventEmitter()
      child.stdin.end = value => { assert.equal(value === 'input', true); ends++ }
      if (options.stdio[0] === 'ignore') queueMicrotask(() => child.emit('close', 0))
      return child
    },
  })
  const pending = exec.runAsync('tool', [], { input: 'input', timeout: 10 })
  await Promise.resolve()
  assert.equal(clock.pending(), 1)
  await clock.advance(10)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'E_TIMEOUT')
  assert.equal(ends, 1)
  assert.equal(clock.pending(), 0)
  assert.equal((await exec.runAsync('tool', [])).ok, true)
  assert.equal(clock.pending(), 0)
})
