import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { setup } from '../fixtures/probe/helpers.mjs'
import { run as modelsProbe } from '../../lib/commands/models/probe.mjs'
import { checkProvider, readProbeModels } from '../../lib/availability.mjs'
import { validate } from '../../lib/contract/validate.mjs'
import { observeVersion, parseVersion } from '../../lib/discovery/probe.mjs'
import { run as discover } from '../../lib/commands/discover.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

test('[AC-085] real bin discovers then probes the same executable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-probe-'))
  try {
    const dir = path.join(root, 'bin'), state = path.join(root, 'state'), record = path.join(root, 'calls')
    fs.mkdirSync(dir)
    const runtime = fs.readFileSync(new URL('../fixtures/discovery/probe-runtime.cjs', import.meta.url), 'utf8')
    const expected = { claude: '1.2.3-alpha.1+build.7', codex: '2.0.0', dsh: '3.0.0', cursor: '4.0.0', codebuddy: '5.0.0', antigravity: '6.0.0', trae: '7.0.0', zcode: '8.0.0', qoder: '9.0.0', kimi: '10.0.0', opencode: '11.0.0' }
    const executable = path.join(dir, process.platform === 'win32' ? 'claude.cmd' : 'claude')
    for (const [name, version] of Object.entries(expected)) {
      const content = `process.env.FIXTURE_VERSION = ${JSON.stringify(version)}\n${runtime}`
      if (process.platform === 'win32') {
        fs.writeFileSync(path.join(dir, `${name}.cjs`), content)
        fs.writeFileSync(path.join(dir, `${name}.cmd`), `@echo off\r\nnode "%~dp0${name}.cjs" %*\r\n`)
      } else fs.writeFileSync(path.join(dir, name), `#!${process.execPath}\n${content}`, { mode: 0o755 })
    }
    const at = '2026-11-07T00:00:00.000Z'
    const model = { schema: 'cliworker.model/v1', key: 'claude:one', id: 'one', cli: executable, provider: 'claude', vendor: 'fixture', aliases: [], allowed: false, level: 'Quick', level_source: { kind: 'config', ref: 'fixture', at }, availability: { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null }, identity: 'unverified', capabilities: { context_tokens: 0, readonly: true, stdin: true }, prices: { input_per_mtok: 0, output_per_mtok: 0, source: 'fixture' }, source: { kind: 'manual', ref: 'fixture', at }, deprecated: false }
    const configFile = path.join(root, 'config.json')
    fs.writeFileSync(configFile, JSON.stringify({ schema: 'cliworker.config/v2', state_dir: state, secrets: {}, discovery: { wsl: false, extra_dirs: [], cli_overrides: {}, unknown_patterns: [], probe_unknown: false }, catalog: { allow: ['claude:one'], levels: {}, aliases: {}, deprecated: {}, manual: [model] }, pools: [], policy: { probe_ttl_s: 3600 } }))
    const env = { ...process.env, PATH: dir, DISCOVERY_RECORD: record }; delete env.Path
    const run = args => {
      const result = spawnSync(process.execPath, ['bin/cliworker.mjs', ...args, '--config', configFile], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 60000 })
      assert.equal(result.status, 0, result.stderr || result.stdout)
      return JSON.parse(result.stdout)
    }
    const inventory = run(['discover'])
    const schema = JSON.parse(fs.readFileSync('contracts/schemas/inventory.v1.schema.json', 'utf8'))
    assert.deepEqual(validate(schema, inventory), { ok: true, errors: [] })
    assert.equal(inventory.entries.length, 11)
    for (const entry of inventory.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ['id', 'recognized', 'platform', 'path', 'realpath', 'version', 'fingerprint', 'auth', 'evidence', 'first_seen', 'last_seen', 'status'].sort())
      assert.deepEqual(entry.auth, { state: 'unknown', source: 'none' })
      assert.equal(entry.status, 'present')
      assert.equal(entry.version, expected[entry.id])
      assert.deepEqual(entry.evidence, [{ kind: 'probe', cmd_redacted: `${entry.id} --version`, exit: 0, at: inventory.generated_at, digest: createHash('sha256').update(`fixture v${expected[entry.id]}\n`).digest('hex') }])
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, 'inventory.json'), 'utf8')), inventory)
    assert.equal(fs.existsSync(path.join(state, 'probes.json')), false)
    assert.equal(fs.existsSync(path.join(state, 'usage.jsonl')), false)
    const models = run(['models', 'probe'])
    assert.equal(models.models[0].availability.state, 'callable', JSON.stringify(models.models[0].availability))
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, 'probes.json'), 'utf8')), models.models)
    const calls = fs.readFileSync(record, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
    assert.equal(calls.length, 13)
    assert.ok(calls.slice(0, 12).every(args => JSON.stringify(args) === JSON.stringify(['--version'])))
    assert.ok(calls[12].includes('--model'))
    const usage = fs.readFileSync(path.join(state, 'usage.jsonl'), 'utf8')
    for (const [mode, reason, exit] of [['nonzero', 'non-zero exit', 7], ['unparsable', 'unparsable output', 0], ['missing', 'command missing', null]]) {
      env.DISCOVERY_VERSION_MODE = mode
      if (mode === 'missing') fs.unlinkSync(executable)
      const before = fs.readFileSync(record, 'utf8').trim().split(/\r?\n/).length
      const failed = run(['models', 'probe']).models[0]
      assert.equal(failed.availability.state, 'unverified')
      assert.equal(failed.availability.reason, reason)
      assert.equal(failed.availability.evidence.exit, exit)
      assert.equal(failed.identity, 'unverified')
      assert.equal(failed.availability.evidence.tokens, null)
      assert.equal(fs.readFileSync(path.join(state, 'usage.jsonl'), 'utf8'), usage)
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, 'probes.json'), 'utf8')), [failed])
      const after = fs.readFileSync(record, 'utf8').trim().split(/\r?\n/).length
      assert.equal(after - before, mode === 'missing' ? 0 : 1)
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-085] every known executable supplies its own version observation', async () => {
  const expected = { codex: '1.0.0', claude: '2.0.0-alpha.1+build.7', dsh: '3.0.0', cursor: '4.0.0', codebuddy: '5.0.0', antigravity: '6.0.0', trae: '7.0.0', zcode: '8.0.0', qoder: '9.0.0', kimi: '10.0.0', opencode: '11.0.0' }
  const dir = path.resolve('memory-bin')
  const file = name => path.join(dir, name + (process.platform === 'win32' ? '.cmd' : ''))
  const ctx = createFakeContext({ files: Object.fromEntries(Object.keys(expected).map(name => [file(name), 'fixture'])), env: { PATH: dir }, platform: process.platform, exec: (command, args) => {
    assert.deepEqual(args, ['--version'])
    const name = path.basename(command).replace(/\.cmd$/i, '')
    return { ok: true, code: 0, stdout: `fixture v${expected[name]}\n`, stderr: '' }
  } })
  ctx.fs.lstatSync = () => ({ isSymbolicLink: () => false })
  const config = { _home: path.resolve('memory-state'), discovery: { wsl: false, extra_dirs: [], cli_overrides: {}, unknown_patterns: [], probe_unknown: false }, policy: {} }
  const result = await discover({ argv: ['discover'], ctx, config })
  assert.equal(result.entries.length, 11)
  for (const entry of result.entries) {
    assert.equal(entry.version, expected[entry.id])
    assert.equal(entry.status, 'present')
    assert.equal(entry.evidence[0].digest, createHash('sha256').update(`fixture v${expected[entry.id]}\n`).digest('hex'))
  }
})

test('[AC-085] semantic versions and actual stdout evidence', () => {
  for (const [input, expected] of [['fixture v1.2.3-alpha.1+build.7', '1.2.3-alpha.1+build.7'], ['1.2', null], ['01.2.3', null], ['1.2.3-01', null], ['1.2.3+build.7', '1.2.3+build.7'], ['x1.2.3', null], ['1.2.3.4', null], ['bad 2.3.4 then 3.4.5', '2.3.4']]) assert.equal(parseVersion(input), expected)
  const f = setup()
  try {
    f.ctx.exec = () => ({ ok: false, code: 7, stdout: '1.2.3', stderr: 'secret' })
    const result = observeVersion(f.ctx, 'claude', ['--version'], 'claude')
    assert.equal(result.reason, 'non-zero exit')
    assert.equal(result.version, null)
    assert.equal(result.evidence[0].exit, 7)
    assert.equal(result.evidence[0].digest, createHash('sha256').update('1.2.3').digest('hex'))
    assert.ok(!JSON.stringify(result).includes('secret'))
    for (const [error, reason] of [[{ error_code: 'E_TIMEOUT' }, 'timeout'], [{ error: 'spawn EACCES' }, 'unavailable'], [{ error: 'spawn ENOENT' }, 'command missing']]) {
      f.ctx.exec = () => ({ code: null, stdout: '', stderr: 'secret', ...error })
      const failed = observeVersion(f.ctx, 'claude', ['--version'], 'claude')
      assert.equal(failed.reason, reason)
      assert.equal(failed.version, null)
    }
  } finally { f.cleanup() }
})

test('[AC-085] declared prefixes are retained and interpreters are not mistaken for CLIs', async () => {
  const f = setup()
  try {
    const calls = []
    f.config.discovery.cli_overrides.claude = { cli: 'claude', args_prefix: ['prefix'] }
    f.ctx.exec = (command, args, options) => {
      calls.push([command, [...args]])
      if (args.at(-1) === '--version') return { ok: true, code: 0, stdout: '1.2.3', stderr: '' }
      const nonce = options.input.trim().split(/\s+/).at(-1)
      return { ok: true, code: 0, stdout: JSON.stringify({ type: 'result', model: 'claude:one', text: nonce, usage: { input_tokens: 1, output_tokens: 1 } }), stderr: '' }
    }
    const run = () => modelsProbe({ argv: ['models', 'probe'], ctx: f.ctx, config: f.config })
    assert.equal((await run()).models[0].availability.state, 'callable')
    assert.deepEqual(calls[0], ['claude', ['prefix', '--version']])
    assert.equal(calls[1][1][0], 'prefix')
    calls.length = 0
    f.config.discovery.cli_overrides.claude = { cli: process.execPath, args_prefix: ['wrapper'] }
    assert.equal((await run()).models[0].availability.state, 'callable')
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], process.execPath)
    assert.equal(calls[0][1][0], 'wrapper')
    assert.ok(!calls[0][1].includes('--version'))
  } finally { f.cleanup() }
})

test('[AC-085] models command persists version failures and requires real identity and nonce', async () => {
  const f = setup()
  try {
    f.config.discovery.cli_overrides.claude = { cli: 'claude' }
    let mode = 'valid', calls = 0
    f.ctx.exec = (_command, args, options) => {
      if (args[0] === '--version') {
        if (mode === 'command missing') return { code: null, error: 'spawn ENOENT', stdout: '', stderr: '' }
        if (mode === 'non-zero exit') return { code: 7, stdout: '1.2.3', stderr: '' }
        if (mode === 'unparsable output') return { code: 0, stdout: '', stderr: '1.2.3' }
        return { ok: true, code: 0, stdout: 'v1.2.3', stderr: '' }
      }
      calls++
      const nonce = options.input.trim().split(/\s+/).at(-1)
      return { ok: true, code: 0, stdout: JSON.stringify({ type: 'result', ...(mode === 'identity' ? {} : { model: 'claude:one' }), text: mode === 'nonce' ? 'wrong' : nonce, usage: { input_tokens: 1, output_tokens: 1 } }), stderr: '' }
    }
    const run = async () => (await modelsProbe({ argv: ['models', 'probe'], ctx: f.ctx, config: f.config })).models[0]
    assert.equal(checkProvider({ cli: 'claude' }, { ctx: f.ctx }).state, 'unverified')
    assert.equal((await run()).availability.state, 'callable')
    const usage = fs.readFileSync(path.join(f.dir, 'usage.jsonl'), 'utf8')
    for (mode of ['command missing', 'non-zero exit', 'unparsable output']) {
      const before = calls
      const model = await run()
      assert.equal(model.availability.state, 'unverified')
      assert.equal(model.availability.reason, mode)
      assert.equal(model.identity, 'unverified')
      assert.equal(model.availability.evidence.nonce_ok, false)
      assert.equal(model.availability.evidence.reported_model, null)
      assert.equal(model.availability.evidence.tokens, null)
      assert.equal(model.availability.evidence.exit, mode === 'command missing' ? null : mode === 'non-zero exit' ? 7 : 0)
      assert.equal(calls, before)
      assert.equal(fs.readFileSync(path.join(f.dir, 'usage.jsonl'), 'utf8'), usage)
      assert.deepEqual(readProbeModels(f.config, { ctx: f.ctx }), [model])
    }
    for (mode of ['identity', 'nonce']) assert.notEqual((await run()).availability.state, 'callable')
    mode = 'valid'
    assert.equal((await run()).availability.state, 'callable')
    assert.ok(fs.existsSync(path.join(f.dir, 'probes.json')))
  } finally { f.cleanup() }
})

test('[AC-085] successful versions cannot promote failed real calls', async () => {
  const f = setup()
  try {
    f.config.discovery.cli_overrides.claude = { cli: 'claude' }
    let mode = '', versionCalls = 0, inferenceCalls = 0
    f.ctx.exec = (_command, args, options) => {
      if (args[0] === '--version') { versionCalls++; return { ok: true, code: 0, stdout: '1.2.3', stderr: '' } }
      inferenceCalls++
      if (mode === 'timeout') return { ok: false, code: null, error_code: 'E_TIMEOUT', stdout: '', stderr: '' }
      if (mode === 'auth') return { ok: false, code: 1, stdout: JSON.stringify({ type: 'error', code: 'E_PROVIDER_AUTH' }), stderr: '' }
      const nonce = options.input.trim().split(/\s+/).at(-1)
      return { ok: mode !== 'nonzero', code: mode === 'nonzero' ? 9 : 0, stdout: JSON.stringify({ type: 'result', ...(mode === 'identity' ? {} : { model: 'claude:one' }), text: mode === 'nonce' ? 'bad' : nonce, usage: { input_tokens: 1, output_tokens: 1 } }), stderr: '' }
    }
    for (mode of ['identity', 'nonce', 'auth', 'timeout', 'nonzero', 'valid']) {
      const before = inferenceCalls
      const [model] = (await modelsProbe({ argv: ['models', 'probe'], ctx: f.ctx, config: f.config })).models
      assert.equal(model.availability.state, mode === 'valid' ? 'callable' : mode === 'auth' ? 'blocked' : mode === 'timeout' ? 'unavailable' : 'unverified')
      assert.equal(inferenceCalls - before, mode === 'timeout' ? 2 : 1)
      assert.deepEqual(readProbeModels(f.config, { ctx: f.ctx }), [model])
    }
    assert.equal(versionCalls, 6)
  } finally { f.cleanup() }
})

test('[AC-085] versions are shared only by the same actual target and prefix', async () => {
  const f = setup()
  try {
    delete f.config.discovery.cli_overrides.claude
    const [one, other] = f.config.catalog.manual
    one.cli = path.join(f.dir, 'a', process.platform === 'win32' ? 'claude.cmd' : 'claude')
    other.cli = path.join(f.dir, 'b', process.platform === 'win32' ? 'claude.cmd' : 'claude')
    for (const target of [one.cli, other.cli]) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, 'fixture') }
    f.config.catalog.allow = [one.key, other.key]
    const calls = []
    f.ctx.exec = (command, args, options) => {
      calls.push([command, [...args]])
      if (args[0] === '--version') return command === one.cli ? { ok: true, code: 0, stdout: '1.2.3', stderr: '' } : { ok: false, code: 7, stdout: '1.2.3', stderr: '' }
      const nonce = options.input.trim().split(/\s+/).at(-1)
      const id = args[args.indexOf('--model') + 1]
      return { ok: true, code: 0, stdout: JSON.stringify({ type: 'result', model: `claude:${id}`, text: nonce, usage: { input_tokens: 1, output_tokens: 1 } }), stderr: '' }
    }
    const run = async () => (await modelsProbe({ argv: ['models', 'probe'], ctx: f.ctx, config: f.config })).models
    let result = await run()
    assert.deepEqual(result.map(m => m.availability.state), ['callable', 'unverified'])
    assert.equal(result[1].availability.reason, 'non-zero exit')
    assert.equal(calls.length, 3)
    calls.length = 0
    other.cli = one.cli
    result = await run()
    assert.deepEqual(result.map(m => m.availability.state), ['callable', 'callable'])
    assert.equal(calls.filter(([, args]) => args[0] === '--version').length, 1)
    assert.equal(calls.filter(([, args]) => args.includes('--model')).length, 2)
    assert.ok(result.every(m => m.identity === 'verified' && m.availability.evidence.nonce_ok))
    calls.length = 0
    f.config.catalog.deprecated[other.key] = true
    f.config.catalog.allow = [other.key]
    await run()
    assert.equal(calls.length, 0)
  } finally { f.cleanup() }
})

test('[AC-085] discovery refresh clears stale versions and retains inventory history', async () => {
  const dir = path.resolve('memory-bin'), state = path.resolve('memory-state')
  const executable = path.join(dir, process.platform === 'win32' ? 'claude.cmd' : 'claude')
  let mode = 'valid'
  const ctx = createFakeContext({ files: { [executable]: 'fixture', [path.join(dir, 'unknown-cli')]: 'unknown' }, env: { PATH: [dir, dir].join(path.delimiter) }, platform: process.platform, exec: () => mode === 'valid' ? { ok: true, code: 0, stdout: 'v1.2.3', stderr: '' } : mode === 'missing' ? { ok: false, code: null, error: 'spawn ENOENT', stdout: '', stderr: '' } : { ok: false, code: 4, stdout: '1.2.3', stderr: '' } })
  ctx.fs.lstatSync = () => ({ isSymbolicLink: () => false })
  const config = { _home: state, discovery: { wsl: false, extra_dirs: [], cli_overrides: {}, unknown_patterns: ['unknown-*'], probe_unknown: false }, policy: { probe_ttl_s: 10 } }
  const run = async (...args) => discover({ argv: ['discover', ...args], ctx, config })
  let result = await run()
  const entry = result.entries.find(e => e.id === 'claude'), unknown = result.entries.find(e => e.id === 'unknown-cli')
  assert.equal(entry.version, '1.2.3'); assert.equal(unknown.version, null); assert.deepEqual(unknown.evidence, [])
  assert.equal(ctx.exec.count, 1)
  mode = 'failure'
  result = await run(); assert.equal(result.entries.find(e => e.id === 'claude').version, '1.2.3'); assert.equal(ctx.exec.count, 1)
  result = await run('--full')
  assert.equal(result.entries.find(e => e.id === 'claude').version, null)
  assert.equal(result.entries.find(e => e.id === 'claude').evidence[0].exit, 4)
  assert.equal(result.entries.find(e => e.id === 'claude').first_seen, entry.first_seen)
  mode = 'valid'; await ctx.clock.advance(10001); result = await run()
  assert.equal(result.entries.find(e => e.id === 'claude').version, '1.2.3')
  mode = 'missing'; ctx.fs.writeFileSync(executable, 'changed fixture'); result = await run()
  const missing = result.entries.find(e => e.id === 'claude')
  assert.equal(missing.version, null); assert.equal(missing.evidence[0].exit, null); assert.equal(missing.status, 'present')
  ctx.fs.rmSync(executable); result = await run()
  assert.equal(result.entries.find(e => e.id === 'claude').status, 'gone')
  assert.equal(ctx.fetch.calls.length, 0)
})

test('[AC-085] a candidate disappearing after the scan records missing evidence', async () => {
  const dir = path.resolve('memory-vanishing-bin')
  const executable = path.join(dir, process.platform === 'win32' ? 'claude.cmd' : 'claude')
  const ctx = createFakeContext({ files: { [executable]: 'fixture' }, env: { PATH: dir }, platform: process.platform, exec: () => { throw new Error('must not execute missing target') } })
  ctx.fs.lstatSync = () => ({ isSymbolicLink: () => false })
  const stat = ctx.fs.statSync
  ctx.fs.statSync = target => {
    const info = stat(target)
    if (target === executable) ctx.fs.rmSync(target)
    return info
  }
  const config = { _home: path.resolve('memory-vanishing-state'), discovery: { wsl: false, extra_dirs: [], cli_overrides: {}, unknown_patterns: [], probe_unknown: false }, policy: {} }
  const inventory = await discover({ argv: ['discover'], ctx, config })
  assert.equal(inventory.entries.length, 1)
  const entry = inventory.entries[0]
  assert.equal(entry.status, 'present'); assert.equal(entry.recognized, true); assert.equal(entry.version, null)
  assert.equal(entry.evidence[0].exit, null)
  assert.equal(entry.evidence[0].digest, createHash('sha256').update('').digest('hex'))
  assert.equal(ctx.exec.count, 0)
})
