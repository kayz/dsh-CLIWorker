import assert from 'node:assert/strict'

export const name = 'doctor'
export const introduced_by = 'T-024'
export const ac = ['AC-031', 'AC-061']

export async function run(flow) {
  const result = flow.run(['doctor', '--config', flow.config_path])
  assert.equal(result.code, 0, result.stderr || result.stdout)
  assert.equal(result.json?.status, 'ok')
  assert.equal(result.json.registration, 'ok')
  assert.equal(result.json.test_clock, false)
  assert.deepEqual(result.json.checks.map(check => check.id).sort(),
    ['config', 'state_dir', 'lock', 'secrets', 'inventory', 'probes', 'registration', 'test_clock'].sort())
  assert.ok(result.json.checks.every(check => check.ok))
  assert.equal(result.json.checks.find(check => check.id === 'inventory').detail, 'not generated')
  assert.equal(result.json.checks.find(check => check.id === 'probes').detail, 0)
}
