// [AC-080] Production discovery and the frozen inventory contract.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { run } from '../../lib/commands/discover.mjs'
import { scanLocal } from '../../lib/discovery/scan.mjs'
import { validate } from '../../lib/contract/validate.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const names = ['codex', 'claude', 'dsh', 'cursor', 'codebuddy', 'antigravity', 'trae', 'zcode', 'qoder', 'kimi', 'opencode']
const schema = JSON.parse(fs.readFileSync(new URL('../../contracts/schemas/inventory.v1.schema.json', import.meta.url), 'utf8'))
const digest = s => createHash('sha256').update(s).digest('hex')
const fields = ['id', 'recognized', 'platform', 'path', 'realpath', 'version', 'fingerprint', 'auth', 'evidence', 'first_seen', 'last_seen', 'status'].sort()
const config = { _home: path.resolve('memory-state'), discovery: { wsl: false, extra_dirs: [], cli_overrides: {}, unknown_patterns: [], probe_unknown: false }, policy: { probe_ttl_s: 3600 } }
const bin = path.resolve('memory-bin')
const file = name => path.join(bin, name + (process.platform === 'win32' ? '.cmd' : ''))
const present = body => body.entries.filter(e => e.recognized && e.status === 'present').map(e => e.id).sort()
function context(selected, result = { ok: true, code: 0, stdout: 'fixture 1.2.3\n' }) {
  const ctx = createFakeContext({ files: Object.fromEntries([...selected, 'ordinary'].map(n => [file(n), 'fixture'])), env: { PATH: bin }, platform: process.platform, exec: (_cmd, args) => { assert.deepEqual(args, ['--version']); return result } })
  ctx.fs.lstatSync = () => ({ isSymbolicLink: () => false })
  return ctx
}
async function discover(ctx, options = config, args = []) { return run({ argv: ['discover', ...args], ctx, config: options }) }
function check(body, selected, stdout = 'fixture 1.2.3\n', code = 0) {
  assert.deepEqual(validate(schema, body), { ok: true, errors: [] })
  assert.deepEqual(present(body), [...selected].sort())
  for (const e of body.entries) {
    assert.deepEqual(Object.keys(e).sort(), fields)
    assert.equal(e.path, file(e.id)); assert.equal(e.realpath, e.path)
    assert.deepEqual(e.fingerprint, { size: 7, mtime: null, realpath: e.realpath })
    assert.equal(e.platform, process.platform); assert.equal(e.status, 'present')
    assert.equal(e.recognized, true); assert.deepEqual(e.auth, { state: 'unknown', source: 'none' })
    assert.equal(e.first_seen, body.generated_at); assert.equal(e.last_seen, body.generated_at)
    assert.equal(e.version, code === 0 && stdout.includes('1.2.3') ? '1.2.3' : null)
    assert.deepEqual(e.evidence, [{ kind: 'probe', cmd_redacted: `${e.id} --version`, exit: code, at: body.generated_at, digest: digest(stdout) }])
  }
}

test('[AC-080] all names, subsets and probe outcomes use the frozen contract', async () => {
  for (const selected of [names, ['codex', 'dsh', 'qoder'], []]) {
    const ctx = context(selected); const body = await discover(ctx)
    check(body, selected); assert.equal(ctx.exec.count, selected.length)
    assert.deepEqual(JSON.parse(ctx.fs.readFileSync(path.join(config._home, 'inventory.json'), 'utf8')), body)
    assert.equal(ctx.fetch.calls.length, 0)
  }
  for (const [code, stdout] of [[0, ''], [7, 'fixture 1.2.3\n'], [null, 'failure']]) {
    const ctx = context(['codex'], { ok: code === 0, code, stdout })
    check(await discover(ctx), ['codex'], stdout, code)
  }
  const ctx = context(['codex']); ctx.exec = () => { throw new Error('boom') }
  await assert.rejects(discover(ctx), e => e.code === 'E_INTERNAL')
})

test('[AC-080] unknown candidates, stale recognition, TTL and disappearance', async () => {
  const ctx = context(['claude', 'other-cli'])
  const opts = { ...config, discovery: { ...config.discovery, unknown_patterns: ['*-cli*'], cli_overrides: { extra: file('ordinary') } } }
  let body = await discover(ctx, opts)
  assert.deepEqual(present(body), ['claude']); assert.equal(ctx.exec.count, 1)
  assert.deepEqual(body.entries.filter(e => !e.recognized).map(e => e.id).sort(), ['ordinary', 'other-cli'])
  assert.ok(body.entries.filter(e => !e.recognized).every(e => e.evidence.length === 0))
  body = await discover(ctx, opts, ['--probe-unknown'])
  assert.equal(ctx.exec.count, 3); assert.ok(body.entries.filter(e => !e.recognized).every(e => e.version === '1.2.3'))
  const inventoryFile = path.join(config._home, 'inventory.json')
  const previous = JSON.parse(ctx.fs.readFileSync(inventoryFile, 'utf8'))
  const old = previous.entries.find(e => e.id === 'claude'); old.id = 'obsolete'; old.recognized = false
  const unknown = previous.entries.find(e => e.id === 'other-cli'); unknown.recognized = true
  ctx.fs.writeFileSync(inventoryFile, JSON.stringify(previous))
  body = await discover(ctx, opts)
  assert.deepEqual(present(body), ['claude']); assert.equal(ctx.exec.count, 4)
  assert.equal(body.entries.find(e => e.id === 'claude').first_seen, old.first_seen)
  assert.equal(body.entries.find(e => e.id === 'other-cli').version, null)
  await ctx.clock.advance(1800000); await discover(ctx, opts); assert.equal(ctx.exec.count, 4)
  await ctx.clock.advance(1800001); await discover(ctx, opts); assert.equal(ctx.exec.count, 5)
  await discover(ctx, opts, ['--full']); assert.equal(ctx.exec.count, 6)
  ctx.fs.writeFileSync(file('claude'), 'changed fixture'); await discover(ctx, opts); assert.equal(ctx.exec.count, 7)
  ctx.fs.rmSync(file('other-cli')); body = await discover(ctx, opts)
  assert.equal(body.entries.find(e => e.id === 'other-cli').status, 'gone')
  const readdir = ctx.fs.readdirSync; ctx.fs.readdirSync = p => { if (p === bin) throw new Error('denied'); return readdir(p) }
  body = await discover(ctx, opts); assert.equal(body.entries.find(e => e.id === 'claude').status, 'present')
})

test('[AC-080] ordering, aliases and platform name matching', () => {
  const options = { platform: 'win32', env: { PATH: 'C:\\bin;C:\\bin' }, discovery: { extra_dirs: [], cli_overrides: {}, unknown_patterns: [] } }
  const io = { readdirSync: () => ['CLAUDE.EXE', 'codex.CMD', 'other'], realpathSync: p => p.toLowerCase().includes('claude') ? 'C:\\real\\claude' : p, statSync: () => ({ isFile: () => true, size: 1 }) }
  const first = scanLocal(io, options)
  const reverse = scanLocal({ ...io, readdirSync: () => ['other', 'codex.CMD', 'CLAUDE.EXE'] }, options)
  assert.deepEqual(first, reverse); assert.deepEqual(first.candidates.map(c => c.rule.name).sort(), ['claude', 'codex'])
  const posix = scanLocal({ ...io, readdirSync: () => ['CLAUDE', 'claude'] }, { ...options, platform: 'linux', env: { PATH: '/bin' } })
  assert.equal(posix.candidates.length, 1)
  const alias = scanLocal({ ...io, readdirSync: () => ['claude.exe', 'CLAUDE.cmd'] }, options)
  assert.equal(alias.candidates.length, 1)
})

test('[AC-080] real bin emits and stores one inventory for isolated executables', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-discovery-'))
  try {
    const dir = path.join(root, 'bin'); const state = path.join(root, 'state'); fs.mkdirSync(dir)
    const runtime = fs.readFileSync(new URL('../fixtures/discovery/runtime.cjs', import.meta.url), 'utf8')
    for (const name of names) {
      if (process.platform === 'win32') {
        fs.writeFileSync(path.join(dir, `${name}.cjs`), runtime)
        fs.writeFileSync(path.join(dir, `${name}.cmd`), `@echo off\r\nnode "%~dp0${name}.cjs" %*\r\n`)
      } else fs.writeFileSync(path.join(dir, name), `#!${process.execPath}\n${runtime}`, { mode: 0o755 })
    }
    fs.writeFileSync(path.join(dir, 'ordinary'), 'unknown')
    const configFile = path.join(root, 'config.json')
    fs.writeFileSync(configFile, JSON.stringify({ schema: 'cliworker.config/v2', state_dir: state, secrets: {}, discovery: { wsl: false, extra_dirs: [], cli_overrides: {}, unknown_patterns: [], probe_unknown: false }, catalog: { allow: [], levels: {}, aliases: {}, deprecated: {}, manual: [] }, pools: [], policy: { probe_ttl_s: 3600 } }))
    const record = path.join(root, 'calls')
    const env = { ...process.env, PATH: [dir, dir].join(path.delimiter), DISCOVERY_RECORD: record }
    delete env.Path
    const result = spawnSync(process.execPath, ['bin/cliworker.mjs', 'discover', '--config', configFile], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 60000 })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const body = JSON.parse(result.stdout); assert.deepEqual(validate(schema, body), { ok: true, errors: [] })
    assert.deepEqual(present(body), [...names].sort()); assert.equal(body.entries.length, names.length)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, 'inventory.json'), 'utf8')), body)
    assert.equal(fs.readFileSync(record, 'utf8').trim().split('\n').length, names.length)
    for (const e of body.entries) {
      assert.deepEqual(Object.keys(e).sort(), fields); assert.equal(e.version, '1.2.3')
      assert.deepEqual(e.auth, { state: 'unknown', source: 'none' }); assert.equal(e.status, 'present')
      assert.equal(e.path, filePath(dir, e.id)); assert.equal(e.realpath, fs.realpathSync(e.path))
      assert.equal(e.fingerprint.realpath, e.realpath); assert.equal(e.fingerprint.size, fs.statSync(e.realpath).size)
      assert.deepEqual(e.evidence, [{ kind: 'probe', cmd_redacted: `${e.id} --version`, exit: 0, at: body.generated_at, digest: digest('fixture 1.2.3\n') }])
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
function filePath(dir, name) { return path.join(dir, name + (process.platform === 'win32' ? '.cmd' : '')) }
