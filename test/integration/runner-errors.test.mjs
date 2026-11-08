// AC-058 — executor failure paths. Every case runs the real CLI in a fresh temporary state
// directory, uses only a generated local fake provider, and asserts the exact registry code,
// exit code, provider call count and ledger rows.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { main } from '../../lib/cli.mjs'
import { createContext } from '../../lib/context.mjs'
import { createFakeClock } from '../helpers/clock.mjs'
import { fakeStream } from '../helpers/ctx.mjs'
import { validate } from '../../lib/contract/validate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const BIN = path.join(ROOT, 'bin', 'cliworker.mjs')
const EVENT_SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts', 'schemas', 'event.v1.schema.json'), 'utf8'))
const USAGE_SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts', 'schemas', 'usage.v1.schema.json'), 'utf8'))

const AT = '2026-11-10T00:00:00.000Z'
const SECRET = 'cw-run-errors-secret-51c7'
const MODEL = 'claude:run-one'
const POOL = 'claude:plan-run'
const LEASE_RE = /^l_[A-Za-z0-9]+$/

const FAKE_CLI = `import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = Buffer.concat(chunks).toString('utf8')
const mode = process.env.CW_RUN_MODE || 'ok'
const dir = process.env.CW_RUN_RECORD
const secret = process.env.CW_RUN_TOKEN || ''
if (dir) {
  fs.appendFileSync(path.join(dir, 'invocations.jsonl'), JSON.stringify({
    argv: process.argv.slice(2), cwd: process.cwd(), input, mode,
    secret_len: secret.length,
    secret_sha: crypto.createHash('sha256').update(secret).digest('hex'),
  }) + '\\n')
}
const okText = 'run ok'
if (mode === 'ok' || mode === 'slow') {
  if (mode === 'slow') await new Promise((done) => setTimeout(done, 1200))
  process.stdout.write(JSON.stringify({ type: 'text', text: okText }) + '\\n')
  process.stdout.write(JSON.stringify({ type: 'usage', usage: { input_tokens: 1000, output_tokens: 500 } }) + '\\n')
  process.stdout.write(JSON.stringify({ type: 'result', text: okText, usage: { input_tokens: 1000, output_tokens: 500 } }) + '\\n')
} else if (mode === 'auth' || mode === 'quota') {
  process.stdout.write(JSON.stringify({ type: 'error', code: mode === 'auth' ? 'E_PROVIDER_AUTH' : 'E_PROVIDER_QUOTA' }) + '\\n')
  process.exitCode = 1
} else if (mode === 'fail') {
  process.stderr.write('provider exploded\\n')
  process.exitCode = 2
} else if (mode === 'garbage') {
  process.stdout.write('not json at all\\n')
} else if (mode === 'timeout') {
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  fs.writeFileSync(path.join(dir, 'pids.json'), JSON.stringify({ child: process.pid, grandchild: child.pid }))
  setInterval(() => {}, 1000)
}
`

function modelRecord() {
  return {
    schema: 'cliworker.model/v1',
    key: MODEL,
    id: 'run-one',
    cli: process.execPath,
    provider: 'claude',
    vendor: 'anthropic',
    aliases: [],
    allowed: false,
    level: 'Top',
    level_source: { kind: 'config', ref: 'test#catalog.levels', at: AT },
    availability: { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null },
    identity: 'verified',
    capabilities: { context_tokens: 200000, readonly: true, stdin: true },
    prices: { input_per_mtok: 3, output_per_mtok: 15, source: 'manual' },
    source: { kind: 'manual', ref: 'test#catalog.manual', at: AT },
    deprecated: false,
  }
}

function probeRecord() {
  return {
    ...modelRecord(),
    availability: {
      state: 'callable', reason: null, at: AT, ttl_s: 86400,
      evidence: {
        probe_id: 'probe-errors', cmd_redacted: 'node', exit: 0, duration_ms: 1,
        nonce_ok: true, reported_model: MODEL, tokens: null,
      },
    },
  }
}

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-run-errors-'))
  const stateDir = path.join(dir, 'state')
  const home = path.join(dir, 'home')
  const cwdDir = path.join(dir, 'cwd')
  const recordDir = path.join(dir, 'record')
  for (const entry of [stateDir, home, cwdDir, recordDir]) fs.mkdirSync(entry, { recursive: true })

  const clockFile = path.join(dir, 'clock.txt')
  fs.writeFileSync(clockFile, AT, 'utf8')

  const fake = path.join(dir, 'fake-cli.mjs')
  fs.writeFileSync(fake, FAKE_CLI, 'utf8')

  const config = {
    schema: 'cliworker.config/v2',
    state_dir: stateDir,
    secrets: { claude: { ref: 'env:CW_RUN_SECRET' } },
    discovery: {
      extra_dirs: [], wsl: false, probe_unknown: false, unknown_patterns: [],
      cli_overrides: {
        claude: { cli: process.execPath, args_prefix: [fake], adapter: 'claude', readonly: true, env_names: ['CW_RUN_TOKEN'] },
      },
    },
    catalog: { allow: [MODEL], levels: { [MODEL]: 'Top' }, aliases: {}, deprecated: {}, manual: [modelRecord()] },
    pools: [{
      id: POOL,
      cli: 'claude',
      kind: 'plan_window',
      funding: 'plan',
      window: {
        length_s: 18000,
        anchor: 'rolling',
        start_at: new Date(Date.parse(AT) - 3600_000).toISOString(),
        reset_at: new Date(Date.parse(AT) + 3600_000).toISOString(),
        reset_source: 'config',
      },
      capacity_mtok: { [MODEL]: { value: 10, source: 'config' } },
      used_fraction: { value: 0.5, source: 'config', at: AT },
      credits_per_mtok: null,
    }],
    policy: {
      probe_ttl_s: 21600, lease_ttl_s: 7200, reading_ttl_s: 600,
      lock_stale_ms: 30000, lock_wait_ms: 5000, lock_poll_ms: 25,
      session_ttl_s: 43200, reserve_fraction_for_high: 0.15,
      unknown_policy: 'after_known', usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 },
      cache_read_weight: 0, probe_schedule: null,
    },
  }
  const configFile = path.join(dir, 'config.json')
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8')
  fs.writeFileSync(path.join(stateDir, 'probes.json'), JSON.stringify([probeRecord()], null, 2), 'utf8')

  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'NODE_TEST_CONTEXT' || key.startsWith('CLIWORKER_')) continue
    env[key] = value
  }
  env.CLIWORKER_HOME = home
  env.CLIWORKER_TEST_CLOCK_FILE = clockFile
  env.CW_RUN_SECRET = SECRET
  env.CW_RUN_RECORD = recordDir

  return {
    dir, stateDir, home, cwdDir, recordDir, clockFile, fake, configFile, config, env,
    writeConfig(file, next) { fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8') },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }) },
  }
}

function select(box, requestId, { compat = false, timeoutMs = 60000 } = {}) {
  const request = {
    schema: 'cliworker.request/v1',
    request_id: requestId,
    level: 'Top',
    count: 1,
    usage: 'Normal',
    importance: 'high',
    require_readonly: true,
    cwd: box.cwdDir,
    timeout_ms: timeoutMs,
    ...(compat ? { compat: 'draft' } : {}),
  }
  return spawnSync(process.execPath, [BIN, 'models', 'select', '--config', box.configFile, '--request', JSON.stringify(request)], {
    encoding: 'utf8', env: box.env, input: '', timeout: 60000, windowsHide: true,
  })
}

function replaceArg(args, flag, value) {
  const copy = args.slice()
  const index = copy.indexOf(flag)
  if (index < 0) copy.push(flag, value)
  else copy[index + 1] = value
  return copy
}

function runWrapper(box, call, { input = '', mode = 'ok', config, env } = {}) {
  const args = config === undefined ? call.args.slice() : replaceArg(call.args, '--config', config)
  const childEnv = { ...box.env, CW_RUN_MODE: mode, ...(env || {}) }
  return spawnSync(call.command, args, {
    encoding: 'utf8',
    env: childEnv,
    input,
    timeout: 60000,
    windowsHide: true,
  })
}

function events(stdout) {
  return String(stdout).split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
}

function errorEvent(stdout) {
  const list = events(stdout)
  for (const [index, event] of list.entries()) {
    assert.deepEqual(validate(EVENT_SCHEMA, event), { ok: true, errors: [] }, `event ${index}`)
    assert.equal(event.seq, index + 1)
  }
  assert.equal(list[0].type, 'start')
  const terminal = list[list.length - 1]
  assert.equal(terminal.type, 'error')
  assert.equal(list.filter((event) => event.type === 'error').length, 1)
  assert.equal(list.filter((event) => event.type === 'result').length, 0)
  return terminal
}

function ledgerRows(box) {
  const file = path.join(box.stateDir, 'usage.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse)
}

function invocations(box) {
  const file = path.join(box.recordDir, 'invocations.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse)
}

function walkFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, found)
    else if (entry.isFile()) found.push(full)
  }
  return found
}

function leaseFile(box) {
  return path.join(box.stateDir, 'leases.json')
}

function leases(box) {
  return JSON.parse(fs.readFileSync(leaseFile(box), 'utf8'))
}

function selected(box, requestId, options) {
  const result = select(box, requestId, options)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const body = JSON.parse(result.stdout)
  assert.equal(body.ok, true, JSON.stringify(body.error))
  return { body, call: body.models[0].call, leaseId: body.models[0].lease_id }
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]))
  }
  return value
}

/** Independent SHA-256 of [normalised state_dir, sorted config], per the design rule. */
function expectedDigest(config, stateDir) {
  let home = path.resolve(stateDir)
  if (process.platform === 'win32') home = home.toLowerCase()
  return crypto.createHash('sha256').update(JSON.stringify([home, sortedJson(config)]), 'utf8').digest('hex')
}

test('[AC-058] an unknown lease is E_LEASE_UNKNOWN, exit 6, with no provider call and no ledger row', () => {
  const box = sandbox()
  try {
    const result = spawnSync(process.execPath, [
      BIN, 'run', '--lease', 'l_unknown123', '--state-dir', box.stateDir, '--config', box.configFile,
    ], { encoding: 'utf8', env: box.env, input: '', timeout: 60000, windowsHide: true })

    assert.equal(result.status, 6, result.stderr || result.stdout)
    assert.equal(result.stderr, '')
    const terminal = errorEvent(result.stdout)
    assert.equal(terminal.code, 'E_LEASE_UNKNOWN')
    assert.equal(terminal.exit_code, 6)
    assert.equal(terminal.retryable, false)
    assert.equal(terminal.message.length > 0, true)
    assert.equal(invocations(box).length, 0)
    assert.equal(ledgerRows(box).length, 0)
    const stateFile = leaseFile(box)
    assert.equal(fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8').includes('l_unknown123') : false, false)
  } finally {
    box.cleanup()
  }
})

test('[AC-058] selection records the independently computed config digest without exposing it', () => {
  const box = sandbox()
  try {
    const { body, leaseId } = selected(box, 'digest-1')
    assert.equal(Object.hasOwn(body.models[0], 'config_digest'), false)
    const lease = leases(box).leases.find((item) => item.lease_id === leaseId)
    assert.match(lease.config_digest, /^[0-9a-f]{64}$/)
    assert.equal(lease.config_digest, expectedDigest(box.config, box.stateDir))
  } finally {
    box.cleanup()
  }
})

test('[AC-058] a valid lease id with an unreadable config emits an error event, not an envelope', () => {
  const box = sandbox()
  try {
    const result = spawnSync(process.execPath, [
      BIN, 'run', '--lease', 'l_configfail', '--state-dir', box.stateDir, '--config', path.join(box.dir, 'missing.json'),
    ], { encoding: 'utf8', env: box.env, input: '', timeout: 60000, windowsHide: true })

    assert.equal(result.status, 3, result.stderr || result.stdout)
    assert.equal(result.stderr, '')
    const terminal = errorEvent(result.stdout)
    assert.equal(terminal.code, 'E_CONFIG')
    assert.equal(terminal.exit_code, 3)
    assert.equal(ledgerRows(box).length, 0)
    assert.equal(invocations(box).length, 0)
  } finally {
    box.cleanup()
  }
})

test('[AC-058] a missing secret backend stops before the provider and books nothing', () => {
  const box = sandbox()
  try {
    const { call } = selected(box, 'secret-1')
    const env = { ...box.env, CW_RUN_MODE: 'ok' }
    delete env.CW_RUN_SECRET
    const result = spawnSync(call.command, call.args, {
      encoding: 'utf8', env, input: 'needs a token', timeout: 60000, windowsHide: true,
    })
    assert.equal(result.status, 3, result.stderr || result.stdout)
    const terminal = errorEvent(result.stdout)
    assert.equal(terminal.code, 'E_SECRET_BACKEND')
    assert.equal(terminal.exit_code, 3)
    assert.equal(invocations(box).length, 0)
    assert.equal(ledgerRows(box).length, 0)
    for (const file of walkFiles(box.stateDir)) assert.equal(fs.readFileSync(file, 'utf8').includes(SECRET), false)
  } finally {
    box.cleanup()
  }
})

test('[AC-058] rotating the secret value does not change the config digest', () => {
  const box = sandbox()
  try {
    const rotated = 'rotated-run-secret-9e2b'
    const { call, leaseId } = selected(box, 'rotate-1')
    const lease = leases(box).leases.find((item) => item.lease_id === leaseId)
    assert.equal(lease.config_digest, expectedDigest(box.config, box.stateDir))

    const result = runWrapper(box, call, { input: 'rotated', env: { CW_RUN_SECRET: rotated } })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const invocation = invocations(box)[0]
    assert.equal(invocation.secret_len, rotated.length)
    assert.equal(invocation.secret_sha, crypto.createHash('sha256').update(rotated).digest('hex'))
    assert.equal(ledgerRows(box).length, 2)
  } finally {
    box.cleanup()
  }
})

test('[AC-058] a failed ledger commit never emits a success result', async () => {
  const box = sandbox()
  const clock = createFakeClock({ start: Date.parse(AT) })
  try {
    const { leaseId } = selected(box, 'ledger-fail-1')
    const io = Object.create(fs)
    io.readFileSync = (file, encoding) => (file === 0 ? 'ledger failure input' : fs.readFileSync(file, encoding))
    io.appendFileSync = (file, data, encoding) => {
      if (String(file).endsWith('usage.jsonl')) {
        const error = new Error('disk full')
        error.code = 'ENOSPC'
        throw error
      }
      return fs.appendFileSync(file, data, encoding)
    }
    const ctx = createContext({
      fs: io,
      env: { ...box.env, CW_RUN_MODE: 'ok' },
      clock,
      stdout: fakeStream(),
      stderr: fakeStream(),
      platform: process.platform,
    })

    const result = await main(['run', '--lease', leaseId, '--state-dir', box.stateDir, '--config', box.configFile], ctx)
    assert.notEqual(result.exitCode, 0)
    const list = events(ctx.stdout.text())
    assert.equal(list[0].type, 'start')
    assert.equal(list[list.length - 1].type, 'error')
    assert.equal(list.some((event) => event.type === 'result'), false)
    assert.equal(ledgerRows(box).length, 0)
  } finally {
    box.cleanup()
  }
})

test('[AC-058] a consumed lease is E_LEASE_CONSUMED, exit 6, and never starts the provider twice', () => {
  const box = sandbox()
  try {
    const { call, leaseId } = selected(box, 'consumed-1')
    const first = runWrapper(box, call, { input: 'once' })
    assert.equal(first.status, 0, first.stderr || first.stdout)
    const beforeRows = ledgerRows(box)
    const beforeBytes = fs.readFileSync(path.join(box.stateDir, 'usage.jsonl'), 'utf8')
    assert.equal(beforeRows.length, 2)

    const second = runWrapper(box, call, { input: 'twice' })
    assert.equal(second.status, 6, second.stderr || second.stdout)
    const terminal = errorEvent(second.stdout)
    assert.equal(terminal.code, 'E_LEASE_CONSUMED')
    assert.equal(terminal.exit_code, 6)
    assert.equal(terminal.retryable, false)
    assert.equal(invocations(box).length, 1)
    assert.equal(fs.readFileSync(path.join(box.stateDir, 'usage.jsonl'), 'utf8'), beforeBytes)
    assert.equal(ledgerRows(box).filter((row) => row.idempotency_key === `${leaseId}:post`).length, 1)
  } finally {
    box.cleanup()
  }
})

test('[AC-058] an expired lease is E_LEASE_EXPIRED while the exact expires_at instant is still valid', () => {
  const box = sandbox()
  try {
    const { call, leaseId } = selected(box, 'expired-1')
    const lease = leases(box).leases.find((item) => item.lease_id === leaseId)
    const expires = Date.parse(lease.expires_at)
    fs.writeFileSync(box.clockFile, new Date(expires + 1).toISOString(), 'utf8')

    const expired = runWrapper(box, call, { input: 'late' })
    assert.equal(expired.status, 6, expired.stderr || expired.stdout)
    const terminal = errorEvent(expired.stdout)
    assert.equal(terminal.code, 'E_LEASE_EXPIRED')
    assert.equal(terminal.exit_code, 6)
    assert.equal(terminal.retryable, true)
    assert.equal(invocations(box).length, 0)
    assert.equal(ledgerRows(box).length, 0)

    fs.writeFileSync(box.clockFile, new Date(expires).toISOString(), 'utf8')
    const boundary = runWrapper(box, call, { input: 'on time' })
    assert.equal(boundary.status, 0, boundary.stderr || boundary.stdout)
    assert.equal(ledgerRows(box).length, 2)
  } finally {
    box.cleanup()
  }
})

test('[AC-058] a config change after selection is E_LEASE_CONFIG_MISMATCH with no side effects', () => {
  const box = sandbox()
  try {
    const { call } = selected(box, 'mismatch-1')
    const changed = structuredClone(box.config)
    changed.policy.lock_wait_ms = 4321
    box.writeConfig(box.configFile, changed)

    const result = runWrapper(box, call, { input: 'nope' })
    assert.equal(result.status, 6, result.stderr || result.stdout)
    const terminal = errorEvent(result.stdout)
    assert.equal(terminal.code, 'E_LEASE_CONFIG_MISMATCH')
    assert.equal(terminal.exit_code, 6)
    assert.equal(terminal.retryable, false)
    assert.equal(invocations(box).length, 0)
    assert.equal(ledgerRows(box).length, 0)
    assert.equal(leases(box).leases.length, 1)
    assert.equal(leases(box).requests.length, 1)
  } finally {
    box.cleanup()
  }
})

test('[AC-058] an equivalent renamed config still runs, a different state_dir does not', () => {
  const box = sandbox()
  try {
    const first = selected(box, 'rename-1')
    const renamed = path.join(box.dir, 'renamed.config.json')
    const reversed = Object.fromEntries(Object.entries(box.config).reverse())
    fs.writeFileSync(renamed, JSON.stringify(reversed, null, 4), 'utf8')

    const ok = runWrapper(box, first.call, { input: 'renamed', config: renamed })
    assert.equal(ok.status, 0, ok.stderr || ok.stdout)
    assert.equal(ledgerRows(box).length, 2)
    assert.equal(invocations(box).length, 1)

    const second = selected(box, 'other-state-1')
    const otherState = path.join(box.dir, 'other-state')
    fs.mkdirSync(otherState, { recursive: true })
    const other = structuredClone(box.config)
    other.state_dir = otherState
    const otherFile = path.join(box.dir, 'other.config.json')
    box.writeConfig(otherFile, other)

    const mismatch = runWrapper(box, second.call, { input: 'wrong state', config: otherFile })
    assert.equal(mismatch.status, 6, mismatch.stderr || mismatch.stdout)
    assert.equal(errorEvent(mismatch.stdout).code, 'E_LEASE_CONFIG_MISMATCH')
    assert.equal(invocations(box).length, 1)
    assert.equal(ledgerRows(box).length, 2)
    assert.ok(leases(box).leases.some((item) => item.lease_id === second.leaseId))
  } finally {
    box.cleanup()
  }
})

test('[AC-058] a lease without config_digest is rejected; other leases and requests survive', () => {
  const box = sandbox()
  try {
    const first = selected(box, 'legacy-a')
    const second = selected(box, 'legacy-b')

    const state = leases(box)
    const legacy = state.leases.find((item) => item.lease_id === first.leaseId)
    delete legacy.config_digest
    fs.writeFileSync(leaseFile(box), JSON.stringify(state, null, 2), 'utf8')

    const rejected = runWrapper(box, first.call, { input: 'legacy' })
    assert.equal(rejected.status, 6, rejected.stderr || rejected.stdout)
    assert.equal(errorEvent(rejected.stdout).code, 'E_LEASE_CONFIG_MISMATCH')
    assert.equal(invocations(box).length, 0)
    assert.equal(ledgerRows(box).length, 0)

    const after = leases(box)
    assert.equal(after.leases.length, 2)
    assert.equal(after.requests.length, 2)
    const stillLegacy = after.leases.find((item) => item.lease_id === first.leaseId)
    assert.equal(Object.hasOwn(stillLegacy, 'config_digest'), false)
    const untouched = after.leases.find((item) => item.lease_id === second.leaseId)
    assert.match(untouched.config_digest, /^[0-9a-f]{64}$/)

    const ok = runWrapper(box, second.call, { input: 'still works' })
    assert.equal(ok.status, 0, ok.stderr || ok.stdout)
    assert.equal(ledgerRows(box).length, 2)
    assert.equal(invocations(box).length, 1)
  } finally {
    box.cleanup()
  }
})

for (const mode of ['auth', 'quota']) {
  test(`[AC-058] ${mode} failure maps ${mode === 'auth' ? 'E_PROVIDER_AUTH' : 'E_PROVIDER_QUOTA'}, exits 7 and blocks the model`, () => {
    const box = sandbox()
    try {
      const { call } = selected(box, `${mode}-1`)
      const expected = mode === 'auth' ? 'E_PROVIDER_AUTH' : 'E_PROVIDER_QUOTA'
      const result = runWrapper(box, call, { input: 'failed', mode })
      assert.equal(result.status, 7, result.stderr || result.stdout)
      const terminal = errorEvent(result.stdout)
      assert.equal(terminal.code, expected)
      assert.equal(terminal.exit_code, 7)
      assert.equal(terminal.retryable, false)
      assert.equal(invocations(box).length, 1)
      assert.equal(ledgerRows(box).length, 0)
      for (const file of [result.stdout, result.stderr]) assert.equal(file.includes(SECRET), false)

      const probes = JSON.parse(fs.readFileSync(path.join(box.stateDir, 'probes.json'), 'utf8'))
      const record = probes.find((item) => item.key === MODEL)
      assert.equal(record.availability.state, 'blocked')
      assert.equal(record.availability.reason, mode)
      for (const key of ['probe_id', 'cmd_redacted', 'exit', 'duration_ms', 'nonce_ok', 'reported_model', 'tokens']) {
        assert.equal(Object.hasOwn(record.availability.evidence, key), true, key)
      }

      const draft = select(box, `${mode}-follow-up`, { compat: true })
      assert.equal(draft.status, 0, draft.stderr || draft.stdout)
      const body = JSON.parse(draft.stdout)
      assert.equal(body.ok, false)
      assert.ok(body.rejected.some((item) => item.key === MODEL && item.reason === 'availability_blocked'))
    } finally {
      box.cleanup()
    }
  })
}

test('[AC-058] generic and unusable provider output map E_PROVIDER_FAILED without booking usage', () => {
  for (const mode of ['fail', 'garbage']) {
    const box = sandbox()
    try {
      const { call } = selected(box, `${mode}-1`)
      const result = runWrapper(box, call, { input: 'failed', mode })
      assert.equal(result.status, 7, `${mode}: ${result.stderr || result.stdout}`)
      const terminal = errorEvent(result.stdout)
      assert.equal(terminal.code, 'E_PROVIDER_FAILED')
      assert.equal(terminal.exit_code, 7)
      assert.equal(terminal.retryable, false)
      assert.equal(invocations(box).length, 1)
      assert.equal(ledgerRows(box).length, 0)
      const probes = JSON.parse(fs.readFileSync(path.join(box.stateDir, 'probes.json'), 'utf8'))
      assert.equal(probes.find((item) => item.key === MODEL).availability.state, 'callable')
    } finally {
      box.cleanup()
    }
  }
})

test('[AC-058] concurrent runs of one lease start the provider once and append one pre/post pair', async () => {
  const box = sandbox()
  try {
    const { call, leaseId } = selected(box, 'concurrent-1')
    const env = { ...box.env, CW_RUN_MODE: 'slow' }
    const run = () => new Promise((resolve) => {
      const child = spawn(call.command, call.args, { env, windowsHide: true })
      const out = []
      const err = []
      child.stdout.on('data', (chunk) => out.push(String(chunk)))
      child.stderr.on('data', (chunk) => err.push(String(chunk)))
      child.on('close', (code) => resolve({ code, stdout: out.join(''), stderr: err.join('') }))
      child.stdin.end('concurrent')
    })

    const [first, second] = await Promise.all([run(), run()])
    const codes = [first.code, second.code].sort((left, right) => left - right)
    assert.deepEqual(codes, [0, 6], `${first.stdout} ${second.stdout}`)
    const failed = [first, second].find((item) => item.code === 6)
    assert.equal(errorEvent(failed.stdout).code, 'E_LEASE_CONSUMED')
    assert.equal(invocations(box).length, 1)
    const rows = ledgerRows(box)
    assert.equal(rows.length, 2)
    assert.equal(rows.filter((row) => row.idempotency_key === `${leaseId}:post`).length, 1)
  } finally {
    box.cleanup()
  }
})

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

async function waitFor(probe, limitMs) {
  const deadline = Date.now() + limitMs
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() >= deadline) return null
    await new Promise((done) => setTimeout(done, 25))
  }
}

test('[AC-058] timeout kills the provider process tree, exits 4 and adds no ledger row', async () => {
  const box = sandbox()
  const clock = createFakeClock({ start: Date.parse(AT) })
  let pids = null
  try {
    const { leaseId } = selected(box, 'timeout-1', { timeoutMs: 5000 })
    const lease = leases(box).leases.find((item) => item.lease_id === leaseId)
    assert.equal(lease.call.timeout_ms, 5000)

    const io = Object.create(fs)
    io.readFileSync = (file, encoding) => (file === 0 ? 'timeout input' : fs.readFileSync(file, encoding))
    const ctx = createContext({
      fs: io,
      env: { ...box.env, CW_RUN_MODE: 'timeout' },
      clock,
      stdout: fakeStream(),
      stderr: fakeStream(),
      platform: process.platform,
    })

    const pending = main(['run', '--lease', leaseId, '--state-dir', box.stateDir, '--config', box.configFile], ctx)
    pids = await waitFor(() => {
      const file = path.join(box.recordDir, 'pids.json')
      if (!fs.existsSync(file)) return null
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch {
        return null
      }
    }, 10000)
    assert.ok(pids && Number.isInteger(pids.child) && Number.isInteger(pids.grandchild), 'the pid barrier appeared')

    await clock.advance(5000)
    const result = await pending
    assert.equal(result.exitCode, 4)
    assert.deepEqual(Object.keys(result), ['exitCode'])
    const list = events(ctx.stdout.text())
    const terminal = list[list.length - 1]
    assert.equal(terminal.type, 'error')
    assert.equal(terminal.code, 'E_TIMEOUT')
    assert.equal(terminal.exit_code, 4)
    assert.equal(terminal.retryable, true)
    assert.equal(clock.pending(), 0)
    assert.equal(ledgerRows(box).length, 0)

    const childGone = await waitFor(() => !isAlive(pids.child), 5000)
    const grandchildGone = await waitFor(() => !isAlive(pids.grandchild), 5000)
    assert.equal(childGone, true, `child ${pids.child} is still alive`)
    assert.equal(grandchildGone, true, `grandchild ${pids.grandchild} is still alive`)
  } finally {
    for (const pid of pids ? [pids.child, pids.grandchild] : []) {
      if (Number.isInteger(pid) && isAlive(pid)) {
        try { process.kill(pid, 'SIGKILL') } catch { /* best effort */ }
      }
    }
    box.cleanup()
  }
})
