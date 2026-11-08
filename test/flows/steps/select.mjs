// v1 selection step: builds its own isolated v2 directory, quota pool, probe cache and policy,
// then drives the real CLI with a cliworker.request/v1 body and checks the AgentLine handle.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

export const id = 'select'
export const name = 'select'
export const introduced_by = 'T-022'
export const ac = ['AC-056']

const KEY = 'flow:select-one'

function record({ at }) {
  return {
    schema: 'cliworker.model/v1',
    key: KEY,
    id: 'select-one',
    cli: process.execPath,
    provider: 'claude',
    vendor: 'anthropic',
    aliases: [],
    allowed: false,
    level: 'Top',
    level_source: { kind: 'config', ref: 'flow#catalog.levels', at },
    availability: { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null },
    identity: 'verified',
    capabilities: { context_tokens: 200000, readonly: true, stdin: true },
    prices: { input_per_mtok: 3, output_per_mtok: 15, source: 'manual' },
    source: { kind: 'manual', ref: 'flow#catalog.manual', at },
    deprecated: false,
  }
}

function probeRecord(model, at) {
  return {
    ...model,
    availability: {
      state: 'callable',
      reason: null,
      at,
      ttl_s: 86400,
      evidence: {
        probe_id: 'probe-flow-select',
        cmd_redacted: 'node',
        exit: 0,
        duration_ms: 1,
        nonce_ok: true,
        reported_model: KEY,
        tokens: null,
      },
    },
  }
}

function writeFixture(flow) {
  const at = new Date().toISOString()
  const model = record({ at })
  const configFile = path.join(flow.root, 'select.config.json')
  const config = {
    schema: 'cliworker.config/v2',
    state_dir: flow.state_dir,
    secrets: {},
    discovery: {
      extra_dirs: [],
      wsl: false,
      probe_unknown: false,
      unknown_patterns: [],
      cli_overrides: {
        claude: { cli: process.execPath, args_prefix: [], adapter: 'claude', readonly: true, env_names: [] },
      },
    },
    catalog: { allow: [KEY], levels: { [KEY]: 'Top' }, aliases: {}, deprecated: {}, manual: [model] },
    pools: [
      {
        id: 'claude:plan-flow',
        cli: 'claude',
        kind: 'plan_window',
        funding: 'plan',
        window: {
          length_s: 18000,
          anchor: 'rolling',
          start_at: new Date(Date.parse(at) - 3600_000).toISOString(),
          reset_at: new Date(Date.parse(at) + 3600_000).toISOString(),
          reset_source: 'config',
        },
        capacity_mtok: { [KEY]: { value: 10, source: 'config' } },
        used_fraction: { value: 0.5, source: 'config', at },
        credits_per_mtok: null,
      },
    ],
    policy: {
      probe_ttl_s: 21600,
      lease_ttl_s: 7200,
      reading_ttl_s: 600,
      lock_stale_ms: 30000,
      lock_wait_ms: 5000,
      lock_poll_ms: 25,
      session_ttl_s: 43200,
      reserve_fraction_for_high: 0.15,
      unknown_policy: 'after_known',
      usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 },
      cache_read_weight: 0,
      probe_schedule: null,
    },
  }
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8')
  return { configFile, probe: probeRecord(model, at) }
}

export async function run(flow) {
  const cacheFile = path.join(flow.state_dir, 'probes.json')
  const saved = fs.existsSync(cacheFile) ? fs.readFileSync(cacheFile) : null
  const { configFile, probe } = writeFixture(flow)
  fs.mkdirSync(flow.state_dir, { recursive: true })
  fs.writeFileSync(cacheFile, JSON.stringify([probe], null, 2), 'utf8')
  try {
    const request = {
      schema: 'cliworker.request/v1',
      request_id: 'flow-select-v1',
      level: 'Top',
      count: 1,
      usage: 'Normal',
      importance: 'high',
      cwd: flow.root,
    }
    const result = flow.run(['models', 'select', '--config', configFile, '--request', JSON.stringify(request)])
    assert.equal(result.code, 0, result.stderr || result.stdout)
    const body = result.json
    assert.equal(body.schema, 'cliworker.selection/v1')
    assert.equal(body.ok, true)
    assert.equal(body.count_returned, 1)
    assert.equal(body.models.length, 1)
    assert.equal(body.calls.length, 1)
    assert.deepEqual(body.calls[0], body.models[0].call)
    assert.equal(Object.hasOwn(body.models[0], 'key'), false, 'AgentLine handle must not carry a model key')
    assert.match(body.models[0].handle_id, /^h_[A-Za-z0-9]+$/)
    assert.match(body.models[0].lease_id, /^l_[A-Za-z0-9]+$/)
    assert.equal(body.models[0].call.args.length, 8)
    assert.equal(body.models[0].call.output, 'cliworker.event/v1')
    assert.equal(typeof body.models[0].expires_at, 'string')
    flow.shared.select = {
      handle_id: body.models[0].handle_id,
      lease_id: body.models[0].lease_id,
      call: body.models[0].call,
      expires_at: body.models[0].expires_at,
    }
  } finally {
    if (saved === null) fs.rmSync(cacheFile, { force: true })
    else fs.writeFileSync(cacheFile, saved)
    fs.rmSync(configFile, { force: true })
  }
}
