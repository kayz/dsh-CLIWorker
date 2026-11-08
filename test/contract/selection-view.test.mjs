import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { scanView } from '../../lib/contract/scan.mjs'
import { validate } from '../../lib/contract/validate.mjs'
import { createFlow } from '../helpers/flow.mjs'
import * as selectStep from '../flows/steps/select.mjs'
import { createContext } from '../../lib/context.mjs'
import { loadConfig } from '../../lib/config.mjs'
import { runSelection } from '../../lib/select.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bin = path.join(root, 'bin', 'cliworker.mjs')
const forbidden = JSON.parse(fs.readFileSync(path.join(root, 'contracts/agentline-forbidden.json'), 'utf8'))

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-view-'))
  const state = path.join(dir, 'state')
  const file = path.join(dir, 'config.json')
  const at = new Date().toISOString()
  const key = 'fixture:only-model'
  const model = {
    schema: 'cliworker.model/v1', key, id: 'only-model', cli: 'provider-executable',
    provider: 'claude', vendor: 'anthropic', aliases: [], allowed: false, level: 'Top',
    level_source: { kind: 'config', ref: 'fixture', at },
    availability: { state: 'callable', reason: null, at, ttl_s: 86400, evidence: null },
    identity: 'verified', capabilities: { context_tokens: 100000, readonly: true, stdin: true },
    prices: { input_per_mtok: 1, output_per_mtok: 1, source: 'config' },
    source: { kind: 'manual', ref: 'fixture', at }, deprecated: false,
  }
  const config = {
    schema: 'cliworker.config/v2', state_dir: state, secrets: {},
    discovery: { extra_dirs: [], wsl: false, probe_unknown: false, unknown_patterns: [],
      cli_overrides: { claude: { cli: 'provider-executable', args_prefix: [], adapter: 'claude', readonly: true, env_names: [] } } },
    catalog: { allow: [key], levels: { [key]: 'Top' }, aliases: {}, deprecated: {}, manual: [model] },
    pools: [{ id: 'plan', cli: 'claude', kind: 'plan_window', funding: 'plan',
      window: { length_s: 3600, anchor: 'rolling', start_at: at, reset_at: new Date(Date.now() + 3600000).toISOString(), reset_source: 'config' },
      capacity_mtok: { [key]: { value: 10, source: 'config' } },
      used_fraction: { value: 0, source: 'config', at }, credits_per_mtok: null }],
    policy: { lease_ttl_s: 7200, reading_ttl_s: 600, reserve_fraction_for_high: 0.15,
      unknown_policy: 'after_known', usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 }, cache_read_weight: 0 },
  }
  fs.writeFileSync(file, JSON.stringify(config), 'utf8')
  const request = { schema: 'cliworker.request/v1', level: 'Top', usage: 'Normal', importance: 'high', cwd: dir }
  return { dir, state, file, model, config, request,
    run(route, body) {
      const child = spawnSync(process.execPath, [bin, ...route, '--config', file, '--request', JSON.stringify(body)], { encoding: 'utf8', env: { ...process.env, CW_VIEW_SENTINEL: 'dummy-view-secret-742' } })
      return { code: child.status, stdout: child.stdout, stderr: child.stderr, json: JSON.parse(child.stdout) }
    },
    scan(value) {
      return scanView(value, { forbidden, catalog: { models: [model] }, wrapper: { command: process.execPath, bin, state_dir: state, config: file } })
    },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }) },
  }
}

test('[AC-056] real CLI gates full view and scans AgentLine handles', () => {
  const f = fixture()
  try {
    const denied = f.run(['models', 'select'], { ...f.request, view: 'full' })
    assert.equal(denied.code, 2)
    assert.equal(denied.json.error.code, 'E_VIEW_FORBIDDEN')
    assert.equal(fs.existsSync(path.join(f.state, 'leases.json')), false)
    const selected = f.run(['models', 'select'], { ...f.request, count: 2, request_id: 'view' })
    assert.equal(selected.code, 0, selected.stderr || selected.stdout)
    assert.equal(selected.json.truncated, true)
    assert.equal(selected.json.shortfall, 1)
    assert.deepEqual(selected.json.calls[0], selected.json.models[0].call)
    assert.deepEqual(f.scan(selected.json), { ok: true, hits: [] })
    const admin = f.run(['admin', 'select'], { ...f.request, request_id: 'view' })
    assert.equal(admin.code, 0, admin.stderr || admin.stdout)
    for (const name of ['model_key', 'cli', 'vendor', 'funding', 'pools', 'forecast', 'direct_call']) assert.ok(Object.hasOwn(admin.json.models[0].detail, name), name)
    const draft = f.run(['models', 'select'], { ...f.request, request_id: 'view', compat: 'draft' })
    assert.equal(draft.code, 0, draft.stderr || draft.stdout)
    assert.ok(draft.json.warnings.some((item) => item.code === 'W_DRAFT_DEPRECATED'))
    assert.equal(Object.hasOwn(draft.json.models[0], 'cli'), false)
    const legacy = f.run(['models', 'select'], { level: 'Top', request_id: 'view', cwd: f.dir, extra_field: true })
    assert.equal(legacy.code, 0, legacy.stderr || legacy.stdout)
    assert.ok(legacy.json.warnings.some((item) => item.code === 'W_DRAFT_DEPRECATED'))
    assert.ok(legacy.json.warnings.some((item) => item.code === 'W_FIELD_IGNORED'))
    for (const field of ['key', 'provider', 'id', 'level', 'prices', 'quota', 'forecast', 'call']) assert.ok(Object.hasOwn(legacy.json.models[0], field), field)
    for (const result of [denied, selected, admin, draft, legacy]) assert.equal((result.stdout + result.stderr).includes('dummy-view-secret-742'), false)
    assert.equal(fs.readFileSync(path.join(f.state, 'leases.json'), 'utf8').includes('dummy-view-secret-742'), false)
  } finally { f.cleanup() }
})

test('[AC-056] quota and non-quota failures keep distinct errors and safe views', async () => {
  const f = fixture()
  try {
    for (const [code, mutate] of [
      ['E_INSUFFICIENT_QUOTA', (config) => { config.pools[0].used_fraction.value = 1 }],
      ['E_NO_CANDIDATE', (config) => { config.catalog.levels[f.model.key] = 'High' }],
    ]) {
      const config = structuredClone(f.config)
      mutate(config)
      fs.writeFileSync(f.file, JSON.stringify(config), 'utf8')
      const ctx = createContext()
      const loaded = loadConfig({ file: f.file, ctx })
      const request = { ...f.request, request_id: code }
      const selection = await runSelection({ ctx, config: loaded, request })
      assert.equal(selection.agentline.error.code, code)
      assert.deepEqual(f.scan(selection.agentline), { ok: true, hits: [] })
      const cli = f.run(['models', 'select'], request)
      assert.equal(cli.code, 5, cli.stderr || cli.stdout)
      assert.equal(cli.json.error.code, code)
    }
  } finally { f.cleanup() }
})

test('[AC-056] contract example materials validate against their own schemas', () => {
  const examples = path.join(root, 'contracts/examples')
  for (const name of fs.readdirSync(examples)) {
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'contracts/schemas', `${name}.schema.json`), 'utf8'))
    for (const validity of ['valid', 'invalid']) {
      const dir = path.join(examples, name, validity)
      for (const file of fs.readdirSync(dir)) {
        const value = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
        const loadSchema = (ref) => JSON.parse(fs.readFileSync(path.join(root, 'contracts/schemas', ref), 'utf8'))
        assert.equal(validate(schema, value, { loadSchema }).ok, validity === 'valid', `${name}/${validity}/${file}`)
      }
    }
  }
})

test('[AC-056] select flow step yields a v1 handle for subsequent steps', async () => {
  const flow = createFlow()
  try {
    assert.equal(selectStep.id, 'select')
    assert.equal(selectStep.introduced_by, 'T-022')
    await selectStep.run(flow)
    assert.equal(flow.shared.select.call.output, 'cliworker.event/v1')
    assert.ok(flow.shared.select.lease_id)
  } finally { flow.cleanup() }
})
