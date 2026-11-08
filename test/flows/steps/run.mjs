// Flow step for T-023: build an isolated v2 fixture, obtain a real lease through
// `models select`, then drive the recorded wrapper call and check the streamed result.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { validate } from '../../../lib/contract/validate.mjs'

export const id = 'run'
export const name = 'run'
export const introduced_by = 'T-023'
export const ac = ['AC-057']

const KEY = 'claude:flow-run'
const NOW = new Date().toISOString()
const EVENT_SCHEMA = JSON.parse(fs.readFileSync(new URL('../../../contracts/schemas/event.v1.schema.json', import.meta.url), 'utf8'))
const USAGE_SCHEMA = JSON.parse(fs.readFileSync(new URL('../../../contracts/schemas/usage.v1.schema.json', import.meta.url), 'utf8'))

const FAKE_CLI = `import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = Buffer.concat(chunks).toString('utf8')
const recordDir = process.env.CW_RUN_RECORD
if (recordDir) {
  const secret = process.env.CW_RUN_TOKEN || ''
  fs.writeFileSync(path.join(recordDir, 'run-invocation.json'), JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    input,
    secret_len: secret.length,
    secret_sha: crypto.createHash('sha256').update(secret).digest('hex'),
  }))
}
process.stdout.write(JSON.stringify({ type: 'text', text: 'flow run ok' }) + '\\n')
process.stdout.write(JSON.stringify({ type: 'usage', usage: { input_tokens: 4000, output_tokens: 2000 } }) + '\\n')
process.stdout.write(JSON.stringify({ type: 'result', text: 'flow run ok', usage: { input_tokens: 4000, output_tokens: 2000 } }) + '\\n')
`

function modelRecord() {
  return {
    schema: 'cliworker.model/v1',
    key: KEY,
    id: 'flow-run',
    cli: process.execPath,
    provider: 'claude',
    vendor: 'anthropic',
    aliases: [],
    allowed: false,
    level: 'Top',
    level_source: { kind: 'config', ref: 'flow#catalog.levels', at: NOW },
    availability: { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null },
    identity: 'verified',
    capabilities: { context_tokens: 200000, readonly: true, stdin: true },
    prices: { input_per_mtok: 3, output_per_mtok: 15, source: 'manual' },
    source: { kind: 'manual', ref: 'flow#catalog.manual', at: NOW },
    deprecated: false,
  }
}

function probeRecord() {
  const model = modelRecord()
  return {
    ...model,
    availability: {
      state: 'callable',
      reason: null,
      at: NOW,
      ttl_s: 86400,
      evidence: {
        probe_id: 'probe-flow-run', cmd_redacted: 'node', exit: 0, duration_ms: 1,
        nonce_ok: true, reported_model: KEY, tokens: null,
      },
    },
  }
}

function writeFixture(flow) {
  const fake = path.join(flow.root, 'flow-run-fake-cli.mjs')
  fs.writeFileSync(fake, FAKE_CLI, 'utf8')
  const configFile = path.join(flow.root, 'flow-run.config.json')
  const config = {
    schema: 'cliworker.config/v2',
    state_dir: flow.state_dir,
    secrets: { claude: { ref: 'env:CW_FLOW_SENTINEL' } },
    discovery: {
      extra_dirs: [], wsl: false, probe_unknown: false, unknown_patterns: [],
      cli_overrides: {
        claude: { cli: process.execPath, args_prefix: [fake], adapter: 'claude', readonly: true, env_names: ['CW_RUN_TOKEN'] },
      },
    },
    catalog: { allow: [KEY], levels: { [KEY]: 'Top' }, aliases: {}, deprecated: {}, manual: [modelRecord()] },
    pools: [{
      id: 'claude:plan-flow-run',
      cli: 'claude',
      kind: 'plan_window',
      funding: 'plan',
      window: {
        length_s: 18000,
        anchor: 'rolling',
        start_at: new Date(Date.parse(NOW) - 3600_000).toISOString(),
        reset_at: new Date(Date.parse(NOW) + 3600_000).toISOString(),
        reset_source: 'config',
      },
      capacity_mtok: { [KEY]: { value: 10, source: 'config' } },
      used_fraction: { value: 0.5, source: 'config', at: NOW },
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
  return { configFile, recordDir: path.join(flow.root, 'flow-run-record') }
}

function writeProbe(flow) {
  const file = path.join(flow.state_dir, 'probes.json')
  let records = []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(parsed)) records = parsed
  } catch {
    records = []
  }
  records = records.filter((item) => !item || item.key !== KEY)
  records.push(probeRecord())
  fs.mkdirSync(flow.state_dir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(records, null, 2), 'utf8')
}

export async function run(flow) {
  const { configFile, recordDir } = writeFixture(flow)
  fs.mkdirSync(recordDir, { recursive: true })
  writeProbe(flow)

  const request = {
    schema: 'cliworker.request/v1',
    request_id: 'flow-run-v1',
    level: 'Top',
    count: 1,
    usage: 'Normal',
    importance: 'high',
    require_readonly: true,
    cwd: flow.root,
    timeout_ms: 60000,
  }
  const selection = flow.run(['models', 'select', '--config', configFile, '--request', JSON.stringify(request)])
  assert.equal(selection.code, 0, selection.stderr || selection.stdout)
  assert.equal(selection.json.ok, true)
  const handle = selection.json.models[0]
  const call = selection.json.calls[0]
  assert.equal(handle.lease_id, call.args[call.args.indexOf('--lease') + 1])

  const input = '第一行\n第二行  '
  const runResult = flow.spawn(call.command, call.args, {
    input,
    env: { CW_RUN_RECORD: recordDir },
  })
  assert.equal(runResult.code, 0, runResult.stderr || runResult.stdout)
  assert.equal(runResult.stderr, '')

  const events = runResult.stdout.split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
  assert.ok(events.length >= 4)
  for (const [index, event] of events.entries()) {
    assert.deepEqual(validate(EVENT_SCHEMA, event), { ok: true, errors: [] })
    assert.equal(event.seq, index + 1)
    assert.equal(event.lease_id, handle.lease_id)
    assert.match(event.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  }
  assert.equal(events[0].type, 'start')
  const last = events[events.length - 1]
  assert.equal(last.type, 'result')
  assert.equal(last.ok, true)
  assert.equal(last.exit_code, 0)
  assert.equal(last.text, 'flow run ok')
  assert.deepEqual(last.usage, { input_tokens: 4000, output_tokens: 2000 })

  const invocation = JSON.parse(fs.readFileSync(path.join(recordDir, 'run-invocation.json'), 'utf8'))
  assert.equal(invocation.input, input)
  assert.equal(invocation.cwd, flow.root)
  assert.equal(invocation.secret_len, flow.sentinel.length)
  assert.equal(runResult.stdout.includes(flow.sentinel), false)
  assert.equal(runResult.stderr.includes(flow.sentinel), false)

  const rows = fs.readFileSync(path.join(flow.state_dir, 'usage.jsonl'), 'utf8')
    .split(/\r?\n/).filter(Boolean).map(JSON.parse)
  const pre = rows.find((row) => row.idempotency_key === `${handle.lease_id}:pre`)
  const post = rows.find((row) => row.idempotency_key === `${handle.lease_id}:post`)
  assert.ok(pre && post)
  assert.deepEqual(validate(USAGE_SCHEMA, pre), { ok: true, errors: [] })
  assert.deepEqual(validate(USAGE_SCHEMA, post), { ok: true, errors: [] })
  assert.equal(pre.input_tokens, 0)
  assert.equal(post.input_tokens, 4000)
  assert.equal(post.output_tokens, 2000)
  assert.equal(post.model, KEY)
  assert.equal(post.pools[0], 'claude:plan-flow-run')
  assert.equal(fs.readFileSync(path.join(flow.state_dir, 'usage.jsonl'), 'utf8').includes(flow.sentinel), false)

  flow.shared.run = { lease_id: handle.lease_id, events, rows: [pre, post] }
  return undefined
}
