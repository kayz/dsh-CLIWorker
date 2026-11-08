import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext } from '../../../lib/context.mjs'
import { createPlugin } from '../../../lib/index.js'
import { scanView } from '../../../lib/contract/scan.mjs'
import { createHostStub } from '../../helpers/host-stub.mjs'

export const name = 'http-select'
export const introduced_by = 'T-024'
export const ac = ['AC-059', 'AC-060']

export async function withFixture(flow, fn) {
  const saved = fs.readFileSync(flow.config_path)
  const cache = path.join(flow.state_dir, 'probes.json')
  const prior = fs.existsSync(cache) ? fs.readFileSync(cache) : null
  const at = new Date().toISOString()
  const key = 'flow:select-one'
  const model = { schema: 'cliworker.model/v1', key, id: 'select-one', cli: process.execPath, provider: 'claude', vendor: 'anthropic', aliases: [], allowed: false, level: 'Top', level_source: { kind: 'config', ref: 'flow', at }, availability: { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null }, identity: 'verified', capabilities: { context_tokens: 200000, readonly: true, stdin: true }, prices: { input_per_mtok: 3, output_per_mtok: 15, source: 'manual' }, source: { kind: 'manual', ref: 'flow', at }, deprecated: false }
  const pool = { id: 'claude:plan-flow', cli: 'claude', kind: 'plan_window', funding: 'plan', window: { length_s: 18000, anchor: 'rolling', start_at: new Date(Date.parse(at) - 3600000).toISOString(), reset_at: new Date(Date.parse(at) + 3600000).toISOString(), reset_source: 'config' }, capacity_mtok: { [key]: { value: 10, source: 'config' } }, used_fraction: { value: 0.5, source: 'config', at }, credits_per_mtok: null }
  const config = { schema: 'cliworker.config/v2', state_dir: flow.state_dir, secrets: {}, discovery: { extra_dirs: [], wsl: false, probe_unknown: false, unknown_patterns: [], cli_overrides: { claude: { cli: process.execPath, args_prefix: [], adapter: 'claude', readonly: true, env_names: [] } } }, catalog: { allow: [key], levels: { [key]: 'Top' }, aliases: {}, deprecated: {}, manual: [model] }, pools: [pool], policy: {} }
  const probe = { ...model, availability: { state: 'callable', reason: null, at, ttl_s: 86400, evidence: { probe_id: 'probe-flow', cmd_redacted: 'node', exit: 0, duration_ms: 1, nonce_ok: true, reported_model: key, tokens: null } } }
  fs.mkdirSync(flow.state_dir, { recursive: true })
  fs.writeFileSync(flow.config_path, JSON.stringify(config), 'utf8')
  fs.writeFileSync(cache, JSON.stringify([probe]), 'utf8')
  try { return await fn({ config, model, pool }) }
  finally {
    fs.writeFileSync(flow.config_path, saved)
    if (prior === null) fs.rmSync(cache, { force: true }); else fs.writeFileSync(cache, prior)
  }
}

export function setup(flow, settings = {}) {
  const host = createHostStub()
  createPlugin(host.ctx, { configPath: flow.config_path, ...settings }, { ctx: createContext({ env: flow.env }) })
  return async (url, options) => {
    const response = await host.request(url, options)
    flow.recordHttp({ url, body: response.body })
    return response
  }
}

export async function run(flow) {
  await withFixture(flow, async ({ model }) => {
    const request = setup(flow)
    const response = await request('/cliworker/select', { method: 'POST', body: { schema: 'cliworker.request/v1', level: 'Top', cwd: flow.root } })
    assert.equal(response.statusCode, 200)
    const view = JSON.parse(response.body)
    assert.equal(view.ok, true)
    const forbidden = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../contracts/agentline-forbidden.json', import.meta.url)), 'utf8'))
    const wrapper = { command: process.execPath, bin: fileURLToPath(new URL('../../../bin/cliworker.mjs', import.meta.url)), state_dir: flow.state_dir, config: flow.config_path }
    assert.deepEqual(scanView(view, { forbidden, catalog: { models: [model] }, wrapper }).hits, [])
    const scan = flow.scan()
    assert.ok(scan.scanned.http > 0)
    assert.deepEqual(scan.hits, [])
  })
}
