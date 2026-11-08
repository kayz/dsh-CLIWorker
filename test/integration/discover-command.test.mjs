// AC-036: the discover command is a real CLI entry point, not just a set of building blocks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { main } from '../../lib/cli.mjs'
import * as discoverCommand from '../../lib/commands/discover.mjs'
import { validate } from '../../lib/contract/validate.mjs'
import { createFakeContext, fakeStream } from '../helpers/ctx.mjs'

const INVENTORY_SCHEMA = JSON.parse(
  fs.readFileSync(new URL('../../contracts/schemas/inventory.v1.schema.json', import.meta.url), 'utf8'),
)

const CONFIG_FILE = '/cw/config.json'
const CONFIG = JSON.stringify({
  schema: 'cliworker.config/v2',
  state_dir: '/cw/state',
  secrets: {},
  discovery: {
    extra_dirs: [],
    wsl: false,
    probe_unknown: false,
    unknown_patterns: ['*-cli'],
    cli_overrides: {},
  },
  catalog: { allow: [], levels: {}, aliases: {}, deprecated: {}, manual: [] },
  pools: [],
  policy: { probe_ttl_s: 3600 },
})

function versionExec() {
  return (command, args) => {
    if (args.length === 1 && args[0] === '--version') {
      const version = command === '/bin/claude' ? '1.2.3' : '2.0.0'
      return { ok: true, code: 0, stdout: `${version}\n`, stderr: '', error: null }
    }
    return { ok: false, code: null, stdout: '', stderr: '', error: `unexpected exec: ${command}` }
  }
}

function context({ files = {}, exec = versionExec(), env = {}, now } = {}) {
  const ctx = createFakeContext({
    files: {
      [CONFIG_FILE]: CONFIG,
      '/bin/claude': 'claude-binary',
      '/bin/other-cli': 'other-binary',
      ...files,
    },
    env: { PATH: '/bin', ...env },
    platform: 'linux',
    exec,
    now,
  })
  // createFsx checks each path component for links before the wrapped fs is touched.
  ctx.fs.lstatSync = () => ({ isSymbolicLink: () => false })
  return ctx
}

async function run(ctx, argv) {
  ctx.stdout = fakeStream()
  ctx.stderr = fakeStream()
  const result = await main(argv, ctx)
  const stdout = ctx.stdout.text()
  return {
    exitCode: result.exitCode,
    stdout,
    stderr: ctx.stderr.text(),
    body: stdout === '' ? null : JSON.parse(stdout),
  }
}

test('[AC-036] the bare discover command is reachable and emits an inventory/v1 result', async () => {
  assert.deepEqual(discoverCommand.route, { cmd: 'discover', sub: null })
  assert.equal(typeof discoverCommand.run, 'function')

  const ctx = context({ env: { CLIWORKER_CONFIG: CONFIG_FILE } })
  const result = await run(ctx, ['discover'])

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, '')
  assert.deepEqual(Object.keys(result.body).sort(), ['entries', 'generated_at', 'host', 'schema'])
  assert.equal(result.body.schema, 'cliworker.inventory/v1')
  assert.deepEqual(validate(INVENTORY_SCHEMA, result.body), { ok: true, errors: [] })
  assert.match(result.body.generated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/)
  assert.deepEqual(Object.keys(result.body.host).sort(), ['arch', 'platform', 'wsl_distros'])
  assert.equal(result.body.host.platform, 'linux')
  assert.deepEqual(result.body.host.wsl_distros, [])

  const claude = result.body.entries.find((entry) => entry.id === 'claude')
  assert.ok(claude, 'recognized candidate missing from the inventory')
  assert.equal(claude.recognized, true)
  assert.equal(claude.platform, 'linux')
  assert.equal(claude.path, '/bin/claude')
  assert.equal(claude.realpath, '/bin/claude')
  assert.equal(claude.version, '1.2.3')
  assert.equal(claude.fingerprint.realpath, '/bin/claude')
  assert.deepEqual(claude.auth, { state: 'unknown', source: 'none' })
  assert.equal(claude.status, 'present')
  assert.equal(claude.last_seen, result.body.generated_at)
  assert.equal(claude.evidence.length, 1)
  assert.equal(claude.evidence[0].kind, 'probe')
  assert.equal(claude.evidence[0].cmd_redacted, 'claude --version')
  assert.equal(claude.evidence[0].exit, 0)
  assert.match(claude.evidence[0].digest, /^[0-9a-f]{64}$/)

  const unknown = result.body.entries.find((entry) => entry.id === 'other-cli')
  assert.ok(unknown, 'pattern candidate missing from the inventory')
  assert.equal(unknown.recognized, false)
  assert.equal(unknown.version, null)
  assert.deepEqual(unknown.evidence, [])
  // An unrecognized CLI is never executed unless discovery.probe_unknown is enabled.
  assert.deepEqual(ctx.exec.calls.map((call) => [call.command, call.args]), [['/bin/claude', ['--version']]])
})

test('[AC-036] default discover reuses fresh entries while --full re-probes them', async () => {
  const ctx = context()

  const first = await run(ctx, ['discover', '--config', CONFIG_FILE])
  assert.equal(first.exitCode, 0)
  assert.equal(ctx.exec.count, 1)

  const second = await run(ctx, ['discover', '--config', CONFIG_FILE])
  assert.equal(second.exitCode, 0)
  assert.equal(ctx.exec.count, 1, 'the default path must reuse an unchanged entry inside the TTL')
  assert.deepEqual(second.body.entries, first.body.entries)

  const full = await run(ctx, ['discover', '--full', '--config', CONFIG_FILE])
  assert.equal(full.exitCode, 0)
  assert.equal(ctx.exec.count, 2, '--full must bypass the TTL cache and probe again')
  const firstClaude = first.body.entries.find((entry) => entry.id === 'claude')
  const fullClaude = full.body.entries.find((entry) => entry.id === 'claude')
  assert.equal(fullClaude.first_seen, firstClaude.first_seen)
  assert.equal(fullClaude.status, 'present')
})

test('[AC-036] --probe-unknown is the only path that executes an unrecognized CLI', async () => {
  const ctx = context()

  const off = await run(ctx, ['discover', '--config', CONFIG_FILE])
  assert.equal(off.exitCode, 0)
  assert.equal(ctx.exec.count, 1, 'an unknown CLI must not be executed by default')

  const on = await run(ctx, ['discover', '--probe-unknown', '--config', CONFIG_FILE])
  assert.equal(on.exitCode, 0)
  assert.equal(ctx.exec.count, 2, 'the recognized entry is reused and only the unknown one is probed')
  const unknown = on.body.entries.find((entry) => entry.id === 'other-cli')
  assert.equal(unknown.recognized, false)
  assert.equal(unknown.version, '2.0.0')
  assert.equal(unknown.evidence.length, 1)
  assert.equal(unknown.evidence[0].cmd_redacted, 'other-cli --version')
})

test('[AC-036] discover reports configuration failures through the shared JSON envelope', async () => {
  const ctx = context()
  const result = await run(ctx, ['discover', '--config', '/cw/missing.json'])

  assert.equal(result.exitCode, 3)
  assert.equal(result.stderr, '')
  assert.deepEqual(Object.keys(result.body), ['ok', 'error'])
  assert.equal(result.body.ok, false)
  assert.equal(result.body.error.code, 'E_CONFIG')
  assert.equal(result.body.error.retryable, false)
  assert.equal(ctx.exec.count, 0)
})
