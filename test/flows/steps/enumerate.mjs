import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { validate } from '../../../lib/contract/validate.mjs'

export const name = 'enumerate'
export const introduced_by = 'T-036'
export const ac = ['AC-079']

const AT = '2026-11-07T00:00:00.000Z'
const KEY = 'fixture:q'

// `models enumerate` projects the native v2 directory (`catalog.manual` of model/v1 records).
// The shared flow fixture is a legacy config/v1 whose migrated `catalog.manual` stays in the
// legacy shape, which the model/v1 directory intentionally rejects (lib/commands/models/list.mjs
// keeps the old selector for that compatibility path). This step therefore writes its own v2
// config under flow.root, leaving the shared flow fixture and the model code untouched.
function writeDirectoryConfig(flow) {
  const file = path.join(flow.root, 'enumerate.config.json')
  const record = {
    schema: 'cliworker.model/v1',
    key: KEY,
    id: 'q',
    cli: process.execPath,
    provider: 'fixture',
    vendor: 'fixture',
    aliases: [],
    allowed: false,
    level: 'Quick',
    level_source: { kind: 'config', ref: `${file}#catalog.levels.${KEY}`, at: AT },
    availability: { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null },
    identity: 'verified',
    capabilities: { context_tokens: 0, readonly: true, stdin: false },
    prices: { input_per_mtok: 0, output_per_mtok: 0, source: 'manual' },
    source: { kind: 'manual', ref: `${file}#catalog.manual.${KEY}`, at: AT },
    deprecated: false,
  }
  const config = {
    schema: 'cliworker.config/v2',
    state_dir: 'state',
    secrets: {},
    discovery: {
      extra_dirs: [],
      wsl: false,
      probe_unknown: false,
      unknown_patterns: [],
      cli_overrides: { fixture: { cli: process.execPath, args_prefix: [], readonly: true } },
    },
    catalog: { allow: [KEY], levels: { [KEY]: 'Quick' }, aliases: {}, deprecated: {}, manual: [record] },
    pools: [],
    policy: {
      probe_ttl_s: 21600,
      lease_ttl_s: 7200,
      reading_ttl_s: 600,
      lock_stale_ms: 30000,
      lock_wait_ms: 5000,
      lock_poll_ms: 50,
      session_ttl_s: 43200,
      reserve_fraction_for_high: 0.15,
      unknown_policy: 'after_known',
      usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 },
      cache_read_weight: 0,
      probe_schedule: null,
    },
  }
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
  return file
}

export async function run(flow) {
  const configFile = writeDirectoryConfig(flow)
  const result = flow.run(['models', 'enumerate', '--config', configFile])
  assert.equal(result.code, 0, result.stderr || result.stdout)
  const output = JSON.parse(result.stdout)
  assert.equal(output.schema, 'cliworker.models/v1')
  assert.ok(Array.isArray(output.models), 'models must be an array')
  assert.ok(output.models.length > 0, 'models must not be empty')

  // Every row is a full model/v1 record: keep the schema check, never relax it to a field probe.
  const schema = JSON.parse(fs.readFileSync(new URL('../../../contracts/schemas/model.v1.schema.json', import.meta.url), 'utf8'))
  for (const model of output.models) {
    const checked = validate(schema, model)
    assert.equal(checked.ok, true, `${model && model.key}: ${JSON.stringify(checked.errors)}`)
  }

  const keys = output.models.map((model) => model.key)
  assert.equal(new Set(keys).size, keys.length, 'model keys must be unique')
  assert.ok(keys.includes(KEY), `configured model ${KEY} is missing from ${JSON.stringify(keys)}`)
}
