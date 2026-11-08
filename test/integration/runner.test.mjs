// AC-057 — the streamed executor success path. A real selection produces the lease and the
// wrapper call; the wrapper then starts a local fake provider only. Every assertion is made
// against the actual CLI process, its JSONL stdout, its ledger rows and the provider's recorded
// stdin/cwd/argv.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { validate } from '../../lib/contract/validate.mjs'
import { createFlow } from '../helpers/flow.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const BIN = path.join(ROOT, 'bin', 'cliworker.mjs')
const EVENT_SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts', 'schemas', 'event.v1.schema.json'), 'utf8'))
const USAGE_SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts', 'schemas', 'usage.v1.schema.json'), 'utf8'))

const AT = '2026-11-10T00:00:00.000Z'
const SECRET = 'cw-run-sentinel-8f3a9d2c7b'
const TEXT = '你好，世界\nline two  '
const MODEL = 'claude:run-one'
const POOL = 'claude:plan-run'
const INPUT = '第一行\n第二行  '

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
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    input,
    mode,
    secret_len: secret.length,
    secret_sha: crypto.createHash('sha256').update(secret).digest('hex'),
  }) + '\\n')
}
const text = mode === 'echo' ? 'echo:' + secret : ${JSON.stringify(TEXT)}
if (mode === 'ok' || mode === 'echo') {
  process.stdout.write(JSON.stringify({ type: 'text', text }) + '\\n')
  process.stdout.write(JSON.stringify({ type: 'usage', usage: { input_tokens: 1000000, output_tokens: 500000 } }) + '\\n')
  process.stdout.write(JSON.stringify({ type: 'result', text, usage: { input_tokens: 1000000, output_tokens: 500000 } }) + '\\n')
} else if (mode === 'auth' || mode === 'quota') {
  process.stdout.write(JSON.stringify({ type: 'error', code: mode === 'auth' ? 'E_PROVIDER_AUTH' : 'E_PROVIDER_QUOTA' }) + '\\n')
  process.exitCode = 1
} else if (mode === 'fail') {
  process.stderr.write('provider exploded\\n')
  process.exitCode = 2
} else if (mode === 'garbage') {
  process.stdout.write('not json at all\\n')
} else if (mode === 'slow') {
  await new Promise((done) => setTimeout(done, 400))
  process.stdout.write(JSON.stringify({ type: 'text', text: ${JSON.stringify(TEXT)} }) + '\\n')
  process.stdout.write(JSON.stringify({ type: 'usage', usage: { input_tokens: 1000000, output_tokens: 500000 } }) + '\\n')
  process.stdout.write(JSON.stringify({ type: 'result', text: ${JSON.stringify(TEXT)}, usage: { input_tokens: 1000000, output_tokens: 500000 } }) + '\\n')
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
      state: 'callable',
      reason: null,
      at: AT,
      ttl_s: 86400,
      evidence: {
        probe_id: 'probe-run', cmd_redacted: 'node', exit: 0, duration_ms: 1,
        nonce_ok: true, reported_model: MODEL, tokens: null,
      },
    },
  }
}

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-run-success-'))
  const stateDir = path.join(dir, 'state')
  const home = path.join(dir, 'home')
  const cwdDir = path.join(dir, 'cwd')
  const recordDir = path.join(dir, 'record')
  for (const entry of [stateDir, home, cwdDir, recordDir]) fs.mkdirSync(entry, { recursive: true })

  const clockFile = path.join(dir, 'clock.txt')
  fs.writeFileSync(clockFile, AT, 'utf8')

  const fake = path.join(dir, 'fake-cli.mjs')
  fs.writeFileSync(fake, FAKE_CLI, 'utf8')

  const configFile = path.join(dir, 'config.json')
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
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }) },
  }
}

function select(box, requestId) {
  const request = {
    schema: 'cliworker.request/v1',
    request_id: requestId,
    level: 'Top',
    count: 1,
    usage: 'Normal',
    importance: 'high',
    require_readonly: true,
    cwd: box.cwdDir,
    timeout_ms: 60000,
  }
  return spawnSync(process.execPath, [BIN, 'models', 'select', '--config', box.configFile, '--request', JSON.stringify(request)], {
    encoding: 'utf8',
    env: box.env,
    input: '',
    timeout: 60000,
    windowsHide: true,
  })
}

function runWrapper(box, call, { input = '', mode = 'ok', config } = {}) {
  const args = call.args.slice()
  if (config !== undefined) args[args.indexOf('--config') + 1] = config
  return spawnSync(call.command, args, {
    encoding: 'utf8',
    env: { ...box.env, CW_RUN_MODE: mode },
    input,
    timeout: 60000,
    windowsHide: true,
  })
}

function parseEvents(stdout) {
  return String(stdout).split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
}

function assertEvents(events, leaseId) {
  assert.ok(events.length > 0)
  for (const [index, event] of events.entries()) {
    assert.deepEqual(validate(EVENT_SCHEMA, event), { ok: true, errors: [] }, `event ${index}`)
    assert.equal(event.seq, index + 1)
    assert.equal(event.lease_id, leaseId)
    assert.equal(event.at, AT)
  }
  assert.equal(events[0].type, 'start')
  const results = events.filter((event) => event.type === 'result')
  assert.equal(results.length, 1)
  assert.equal(events[events.length - 1].type, 'result')
  return results[0]
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

test('[AC-057] run --lease emits validated JSONL events and books pre/post usage', () => {
  const box = sandbox()
  try {
    const selection = select(box, 'success-1')
    assert.equal(selection.status, 0, selection.stderr || selection.stdout)
    const body = JSON.parse(selection.stdout)
    assert.equal(body.ok, true)
    const call = body.models[0].call
    const leaseId = body.models[0].lease_id

    const result = runWrapper(box, call, { input: INPUT })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(result.stderr, '')

    const events = parseEvents(result.stdout)
    const final = assertEvents(events, leaseId)
    assert.equal(events.length, 4)
    assert.equal(events[1].type, 'text')
    assert.equal(events[1].text, TEXT)
    assert.equal(events[2].type, 'usage')
    assert.deepEqual(events[2].usage, { input_tokens: 1000000, output_tokens: 500000 })
    assert.equal(final.ok, true)
    assert.equal(final.exit_code, 0)
    assert.equal(final.text, TEXT)
    assert.deepEqual(final.usage, { input_tokens: 1000000, output_tokens: 500000 })

    const invocationsSeen = invocations(box)
    assert.equal(invocationsSeen.length, 1)
    const invocation = invocationsSeen[0]
    assert.equal(invocation.input, INPUT)
    assert.equal(invocation.cwd, box.cwdDir)
    assert.deepEqual(invocation.argv, [
      '-p', '--model', 'run-one', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan',
    ])
    assert.equal(invocation.secret_len, SECRET.length)
    assert.equal(invocation.secret_sha, crypto.createHash('sha256').update(SECRET).digest('hex'))

    for (const text of [result.stdout, result.stderr, JSON.stringify(events), JSON.stringify(invocationsSeen)]) {
      assert.equal(text.includes(SECRET), false)
    }
    for (const file of walkFiles(box.stateDir)) {
      assert.equal(fs.readFileSync(file, 'utf8').includes(SECRET), false, file)
    }

    const rows = ledgerRows(box)
    assert.equal(rows.length, 2)
    const pre = rows.find((row) => row.idempotency_key === `${leaseId}:pre`)
    const post = rows.find((row) => row.idempotency_key === `${leaseId}:post`)
    assert.ok(pre && post)
    assert.deepEqual(validate(USAGE_SCHEMA, pre), { ok: true, errors: [] })
    assert.deepEqual(validate(USAGE_SCHEMA, post), { ok: true, errors: [] })
    assert.equal(pre.input_tokens, 0)
    assert.equal(pre.output_tokens, 0)
    assert.equal(pre.cost_usd, 0)
    assert.equal(pre.pool_fraction_before, 0.5)
    assert.equal(pre.pool_fraction_after, 0.5)
    assert.equal(post.input_tokens, 1000000)
    assert.equal(post.output_tokens, 500000)
    assert.equal(post.cost_usd, 10.5)
    assert.equal(post.pool_fraction_before, 0.5)
    assert.equal(post.pool_fraction_after, 0.65)
    assert.equal(post.model, MODEL)
    assert.deepEqual(post.pools, [POOL])
    assert.equal(post.kind, 'task')

    const summary = spawnSync(process.execPath, [BIN, 'usage', 'summary', '--config', box.configFile], {
      encoding: 'utf8', env: box.env, input: '', timeout: 60000, windowsHide: true,
    })
    assert.equal(summary.status, 0, summary.stderr)
    const records = JSON.parse(summary.stdout).records
    assert.equal(records.length, 2)
    assert.equal(records.reduce((total, row) => total + row.input_tokens, 0), 1000000)
    assert.equal(records.reduce((total, row) => total + row.output_tokens, 0), 500000)

    const replay = spawnSync(process.execPath, [BIN, 'usage', 'record', '--config', box.configFile, '--json', JSON.stringify({
      idempotency_key: `${leaseId}:post`,
      lease_id: leaseId,
      model: MODEL,
      pools: [POOL],
      kind: 'task',
      input_tokens: 1,
      output_tokens: 1,
    })], { encoding: 'utf8', env: box.env, input: '', timeout: 60000, windowsHide: true })
    assert.equal(replay.status, 0, replay.stderr)
    assert.equal(JSON.parse(replay.stdout).recorded.id, post.id)
    assert.equal(ledgerRows(box).length, 2)
  } finally {
    box.cleanup()
  }
})

test('[AC-057] run redacts an echoed token from every public surface', () => {
  const box = sandbox()
  try {
    const selection = select(box, 'redact-1')
    assert.equal(selection.status, 0, selection.stderr || selection.stdout)
    const body = JSON.parse(selection.stdout)
    const call = body.models[0].call
    const leaseId = body.models[0].lease_id

    const result = runWrapper(box, call, { input: 'redact me', mode: 'echo' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const events = parseEvents(result.stdout)
    const final = assertEvents(events, leaseId)
    assert.equal(final.text, 'echo:[REDACTED]')
    assert.equal(events[1].text, 'echo:[REDACTED]')
    assert.equal(result.stdout.includes(SECRET), false)
    assert.equal(result.stderr.includes(SECRET), false)
    assert.ok(result.stdout.includes('[REDACTED]'))

    const rows = ledgerRows(box)
    assert.equal(rows.length, 2)
    assert.equal(rows.find((row) => row.idempotency_key === `${leaseId}:post`).input_tokens, 1000000)
    for (const file of walkFiles(box.stateDir)) {
      assert.equal(fs.readFileSync(file, 'utf8').includes(SECRET), false, file)
    }
    for (const file of walkFiles(box.recordDir)) {
      assert.equal(fs.readFileSync(file, 'utf8').includes(SECRET), false, file)
    }
  } finally {
    box.cleanup()
  }
})

test('[AC-057] importing runner, select and cli starts no process and prints nothing', () => {
  for (const file of ['lib/runner.mjs', 'lib/select.mjs', 'lib/cli.mjs']) {
    const url = pathToFileURL(path.join(ROOT, file)).href
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(process.argv[1])', url], {
      encoding: 'utf8',
      timeout: 60000,
    })
    assert.equal(result.status, 0, `${file}: ${result.stderr}`)
    assert.equal(result.stdout, '', `${file} wrote to stdout`)
    assert.equal(result.stderr, '', `${file} wrote to stderr`)
  }
})

test('[AC-057] the run flow step consumes a real selection call end to end', async () => {
  const flow = createFlow()
  try {
    const step = await import('../flows/steps/run.mjs')
    assert.equal(step.name, 'run')
    assert.equal(step.introduced_by, 'T-023')
    await step.run(flow)
    assert.ok(flow.shared.run)
    assert.equal(flow.shared.run.events[0].type, 'start')
    assert.equal(flow.shared.run.rows.length, 2)
    const leak = flow.scan()
    assert.equal(leak.ok, true, leak.hits.map((hit) => hit.location).join(','))
  } finally {
    flow.cleanup()
  }
})
