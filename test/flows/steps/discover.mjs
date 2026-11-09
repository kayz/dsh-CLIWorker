import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

export const name = 'discover'
export const introduced_by = 'T-039'
export const ac = ['AC-082']

export async function run(flow) {
  const file = path.join(flow.root, 'discover.config.json')
  const config = {
    schema: 'cliworker.config/v2',
    state_dir: flow.state_dir,
    secrets: {},
    discovery: { extra_dirs: [], wsl: false, probe_unknown: false, unknown_patterns: [], cli_overrides: {} },
    catalog: { allow: [], levels: {}, aliases: {}, deprecated: {}, manual: [] },
    pools: [],
    policy: {
      probe_ttl_s: 21600, lease_ttl_s: 7200, reading_ttl_s: 600,
      lock_stale_ms: 30000, lock_wait_ms: 5000, lock_poll_ms: 50,
      session_ttl_s: 43200, reserve_fraction_for_high: 0.15,
      unknown_policy: 'after_known', usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 },
      cache_read_weight: 0, probe_schedule: null,
    },
  }
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
  const result = flow.run(['discover', '--config', file], { env: { PATH: '', Path: '' } })
  assert.equal(result.code, 0, result.stderr || result.stdout)
  const output = JSON.parse(result.stdout)
  const inventory = JSON.parse(fs.readFileSync(path.join(flow.state_dir, 'inventory.json'), 'utf8'))
  for (const value of [output, inventory]) {
    assert.equal(value.schema, 'cliworker.inventory/v1')
    assert.ok(Array.isArray(value.entries))
    assert.equal(typeof value.generated_at, 'string')
    assert.ok(value.generated_at.length > 0 && Number.isFinite(Date.parse(value.generated_at)))
  }
  assert.deepEqual(inventory, output)
}
