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
import { observeVersion, parseVersion } from '../../lib/discovery/probe.mjs'
import { run as discover } from '../../lib/commands/discover.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

test('[AC-085] real bin discovers then probes the same executable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-probe-'))
  try {
    const dir = path.join(root, 'bin'), state = path.join(root, 'state'), record = path.join(root, 'calls')
    fs.mkdirSync(dir)
    const runtime = fs.readFileSync(new URL('../fixtures/discovery/probe-runtime.cjs', import.meta.url), 'utf8')
    const executable = path.join(dir, process.platform === 'win32' ? 'claude.cmd' : 'claude')
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(dir, 'claude.cjs'), runtime)
      fs.writeFileSync(executable, '@echo off\r\nnode "%~dp0claude.cjs" %*\r\n')
    } else fs.writeFileSync(executable, `#!${process.execPath}\n${runtime}`, { mode: 0o755 })
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
    assert.equal(inventory.entries[0].version, '1.2.3-alpha.1+build.7')
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, 'inventory.json'), 'utf8')), inventory)
    assert.equal(fs.existsSync(path.join(state, 'probes.json')), false)
    assert.equal(fs.existsSync(path.join(state, 'usage.jsonl')), false)
    const models = run(['models', 'probe'])
    assert.equal(models.models[0].availability.state, 'callable', JSON.stringify(models.models[0].availability))
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, 'probes.json'), 'utf8')), models.models)
    const calls = fs.readFileSync(record, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
    assert.deepEqual(calls.slice(0, 2), [['--version'], ['--version']])
    assert.equal(calls.length, 3)
    assert.ok(calls[2].includes('--model'))
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
    for (mode of ['command missing', 'non-zero exit', 'unparsable output']) {
      const before = calls
      const model = await run()
      assert.equal(model.availability.state, 'unverified')
      assert.equal(model.availability.reason, mode)
      assert.equal(model.identity, 'unverified')
      assert.equal(model.availability.evidence.nonce_ok, false)
      assert.equal(calls, before)
      assert.deepEqual(readProbeModels(f.config, { ctx: f.ctx }), [model])
    }
    for (mode of ['identity', 'nonce']) assert.notEqual((await run()).availability.state, 'callable')
    mode = 'valid'
    assert.equal((await run()).availability.state, 'callable')
    assert.ok(fs.existsSync(path.join(f.dir, 'probes.json')))
  } finally { f.cleanup() }
})
