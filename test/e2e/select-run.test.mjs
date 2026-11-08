import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHostStub } from '../helpers/host-stub.mjs'
import { createPlugin } from '../../lib/index.js'
import { createContext } from '../../lib/context.mjs'
import { validate } from '../../lib/contract/validate.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BIN = path.join(ROOT, 'bin/cliworker.mjs')
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/schemas/event.v1.schema.json'), 'utf8'))
export const AT = '2026-11-10T00:00:00.000Z'
export const TTL = 7200
export const TIMEOUT = 60000
export const INPUT = '第一行\n第二行  '
const TEXT = '固定输出\nsecond line  '
const USAGE = { input_tokens: 4000, output_tokens: 2000 }
const fakeSource = `import fs from 'node:fs'
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
fs.appendFileSync(process.env.CW_RECORD, JSON.stringify({pid: process.pid, argv: process.argv.slice(2), cwd: process.cwd(), input: Buffer.concat(chunks).toString('utf8')}) + '\\n')
for (const event of [{type:'text',text:${JSON.stringify(TEXT)}},{type:'usage',usage:${JSON.stringify(USAGE)}},{type:'result',text:${JSON.stringify(TEXT)},usage:${JSON.stringify(USAGE)}}]) process.stdout.write(JSON.stringify(event) + '\\n')
`

export function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw select run '))
  try {
    const stateDir = path.join(dir, 'state'), home = path.join(dir, 'home'), cwd = path.join(dir, 'working directory')
    for (const p of [stateDir, home, cwd]) fs.mkdirSync(p, { recursive: true })
    const clock = path.join(dir, 'clock'), fake = path.join(dir, 'fake-cli.mjs'), configFile = path.join(dir, 'config file.json'), record = path.join(dir, 'records.jsonl')
    fs.writeFileSync(clock, AT, 'utf8')
    fs.writeFileSync(fake, fakeSource, 'utf8')
    const keys = [1, 2, 3].map(i => `claude:run-${i}`)
    const models = keys.map((key, i) => ({ schema: 'cliworker.model/v1', key, id: `run-${i + 1}`, cli: process.execPath, provider: 'claude', vendor: 'anthropic', aliases: [], allowed: false, level: 'Top', level_source: { kind: 'config', ref: 'test#catalog.levels', at: AT }, availability: { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null }, identity: 'verified', capabilities: { context_tokens: 200000, readonly: true, stdin: true }, prices: { input_per_mtok: 3, output_per_mtok: 15, source: 'manual' }, source: { kind: 'manual', ref: 'test#catalog.manual', at: AT }, deprecated: false }))
    const probes = models.map(model => ({ ...model, availability: { state: 'callable', reason: null, at: AT, ttl_s: 86400, evidence: { probe_id: `probe-${model.id}`, cmd_redacted: 'node', exit: 0, duration_ms: 1, nonce_ok: true, reported_model: model.key, tokens: null } } }))
    const config = { schema: 'cliworker.config/v2', state_dir: stateDir, secrets: { claude: { ref: 'env:CW_TEST_SECRET' } }, discovery: { extra_dirs: [], wsl: false, probe_unknown: false, unknown_patterns: [], cli_overrides: { claude: { cli: process.execPath, args_prefix: [fake], adapter: 'claude', readonly: true, env_names: ['CW_RUN_TOKEN'] } } }, catalog: { allow: keys, levels: Object.fromEntries(keys.map(k => [k, 'Top'])), aliases: {}, deprecated: {}, manual: models }, pools: [{ id: 'claude:plan-run', cli: 'claude', kind: 'plan_window', funding: 'plan', window: { length_s: 86400, anchor: 'rolling', start_at: new Date(Date.parse(AT) - 3600000).toISOString(), reset_at: new Date(Date.parse(AT) + 36000000).toISOString(), reset_source: 'config' }, capacity_mtok: Object.fromEntries(keys.map(k => [k, { value: 100, source: 'config' }])), used_fraction: { value: 0.1, source: 'config', at: AT }, credits_per_mtok: null }], policy: { probe_ttl_s: 86400, lease_ttl_s: TTL, reading_ttl_s: 600, lock_stale_ms: 30000, lock_wait_ms: 5000, lock_poll_ms: 25, session_ttl_s: 43200, reserve_fraction_for_high: 0.15, unknown_policy: 'after_known', usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 }, cache_read_weight: 0, probe_schedule: null } }
    fs.writeFileSync(configFile, JSON.stringify(config), 'utf8')
    fs.writeFileSync(path.join(stateDir, 'probes.json'), JSON.stringify(probes), 'utf8')
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT' && !k.startsWith('CLIWORKER_')))
    Object.assign(env, { CLIWORKER_HOME: home, CLIWORKER_TEST_CLOCK_FILE: clock, CW_TEST_SECRET: 'test-secret', CW_RECORD: record })
    return { dir, stateDir, cwd, clock, fake, configFile, record, env }
  } catch (error) { fs.rmSync(dir, { recursive: true, force: true }); throw error }
}
export function cleanup(box) { fs.rmSync(box.dir, { recursive: true, force: true }); assert.equal(fs.existsSync(box.dir), false) }
export function rows(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse) : [] }
export function ledger(box) { return rows(path.join(box.stateDir, 'usage.jsonl')) }
export function run(box, call, input = INPUT) {
  assert.equal(call.input, 'stdin')
  return spawnSync(call.command, call.args, { cwd: call.cwd, input, env: box.env, encoding: 'utf8', timeout: 60000, windowsHide: true, shell: false })
}
export async function select(box, entry, count, id) {
  const request = { schema: 'cliworker.request/v1', request_id: id, level: 'Top', count, usage: 'Normal', importance: 'high', require_readonly: true, cwd: box.cwd, timeout_ms: TIMEOUT }
  let body
  if (entry === 'http') {
    const host = createHostStub()
    createPlugin(host.ctx, { configPath: box.configFile }, { ctx: createContext({ env: box.env }) })
    const result = await host.request('/cliworker/select', { method: 'POST', body: request })
    assert.equal(result.statusCode, 200, result.body)
    body = JSON.parse(result.body)
  } else {
    const result = spawnSync(process.execPath, [BIN, 'models', 'select', '--config', box.configFile, '--request', JSON.stringify(request)], { env: box.env, input: '', encoding: 'utf8', timeout: 60000, windowsHide: true, shell: false })
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr || result.stdout)
    body = JSON.parse(result.stdout)
  }
  assert.equal(body.ok, true); assert.equal(body.models.length, count); assert.equal(body.calls.length, count)
  for (let i = 0; i < count; i++) {
    assert.deepEqual(body.calls[i], body.models[i].call)
    assert.equal(arg(body.calls[i], '--lease'), body.models[i].lease_id)
  }
  return body
}
export function arg(call, name) { const indices = call.args.flatMap((x, i) => x === name ? [i] : []); assert.equal(indices.length, 1); assert.ok(call.args[indices[0] + 1]); return call.args[indices[0] + 1] }
export function events(result, lease, at) {
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.stderr, '')
  const parsed = result.stdout.split(/\r?\n/).filter(line => line.trim()).map(JSON.parse)
  assert.ok(parsed.length)
  parsed.forEach((event, i) => { assert.deepEqual(validate(SCHEMA, event), { ok: true, errors: [] }); assert.equal(event.seq, i + 1); assert.equal(event.lease_id, lease); assert.equal(event.at, at) })
  return parsed
}
export function success(result, lease, at) {
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const parsed = events(result, lease, at)
  assert.equal(parsed[0].type, 'start'); assert.equal(parsed.filter(e => e.type === 'result').length, 1); assert.equal(parsed.filter(e => e.type === 'error').length, 0)
  const last = parsed.at(-1); assert.equal(last.type, 'result'); assert.equal(last.ok, true); assert.equal(last.exit_code, 0); assert.equal(last.text, TEXT); assert.deepEqual(last.usage, USAGE)
}
export function failure(result, lease, at, code, retryable) {
  assert.equal(result.status, 6, result.stderr || result.stdout)
  const parsed = events(result, lease, at), last = parsed.at(-1)
  assert.equal(last.type, 'error'); assert.equal(last.code, code); assert.equal(last.retryable, retryable); assert.equal(last.exit_code, 6); assert.equal(parsed.filter(e => e.type === 'result' && e.ok).length, 0)
}
export function invocation(box, row, model, input = INPUT) {
  assert.notEqual(row.pid, process.pid); assert.equal(row.cwd, box.cwd); assert.equal(row.input, input)
  const lease = JSON.parse(fs.readFileSync(path.join(box.stateDir, 'leases.json'), 'utf8')).leases.find(item => item.lease_id === model.lease_id)
  assert.ok(lease); assert.match(lease.model_key, /^claude:run-[123]$/)
  assert.deepEqual(row.argv, ['-p', '--model', lease.model_key.split(':')[1], '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan'])
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test('[AC-064] HTTP and CLI calls execute and reject replay', async () => {
    const box = fixture()
    try {
      const http = await select(box, 'http', 1, 'http-one')
      const cli = await select(box, 'cli', 1, 'cli-one')
      for (const name of ['--config', '--state-dir']) {
        const expected = name === '--config' ? box.configFile : box.stateDir
        assert.equal(arg(http.calls[0], name), expected); assert.equal(arg(cli.calls[0], name), expected)
      }
      for (const [i, selected] of [http, cli].entries()) {
        const call = selected.calls[0], model = selected.models[0]
        assert.equal(call.cwd, box.cwd)
        success(run(box, call), model.lease_id, AT)
        const records = rows(box.record); assert.equal(records.length, i + 1); invocation(box, records[i], model)
        const before = fs.readFileSync(path.join(box.stateDir, 'usage.jsonl'), 'utf8')
        failure(run(box, call), model.lease_id, AT, 'E_LEASE_CONSUMED', false)
        assert.equal(rows(box.record).length, i + 1); assert.equal(fs.readFileSync(path.join(box.stateDir, 'usage.jsonl'), 'utf8'), before)
        assert.equal(ledger(box).filter(r => r.idempotency_key === `${model.lease_id}:post`).length, 1)
      }
    } finally { cleanup(box) }
  })
}
