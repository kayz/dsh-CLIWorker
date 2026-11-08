// Minimal environment step: verifies the fixture config resolves to the flow's own paths and that
// the fake provider is callable with the advertised version. T-024 replaces this with `doctor`.
import assert from 'node:assert/strict'
import path from 'node:path'

export const name = 'doctor'
export const introduced_by = 'T-012'
export const ac = ['AC-031']

function samePath(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

export async function run(flow) {
  const paths = flow.run(['paths', '--config', flow.config_path])
  assert.equal(paths.code, 0, 'paths exited non-zero')
  assert.equal(paths.json && paths.json.ok, true, 'paths did not report ok')
  assert.ok(samePath(paths.json.config, flow.config_path), 'paths.config does not match the flow config')
  assert.ok(samePath(paths.json.state_dir, flow.state_dir), 'paths.state_dir does not match the flow state dir')
  assert.deepEqual(paths.json.warnings, [], 'paths reported warnings')

  const providers = flow.run(['providers', '--config', flow.config_path])
  assert.equal(providers.code, 0, 'providers exited non-zero')
  assert.equal(providers.json && providers.json.schema, 'cliworker.providers/v1', 'providers schema mismatch')
  const fixture = (providers.json.providers || []).find((provider) => provider.id === 'fixture')
  assert.ok(fixture, 'providers did not list the fixture provider')
  assert.equal(fixture.state, 'callable', 'fixture provider is not callable')
  assert.equal(fixture.version, '1.2.3', 'fixture provider version mismatch')
}
