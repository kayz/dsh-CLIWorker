// Minimal selection step: asks for one Quick model and expects the fixture model back. T-013
// replaces this with the v1 selection flow.
import assert from 'node:assert/strict'

export const name = 'select'
export const introduced_by = 'T-012'
export const ac = ['AC-031']

export async function run(flow) {
  const result = flow.run([
    'models',
    'select',
    '--config',
    flow.config_path,
    '--level',
    'Quick',
    '--request-id',
    'flow-select-1',
  ])
  assert.equal(result.code, 0, 'models select exited non-zero')
  assert.equal(result.json && result.json.ok, true, 'models select did not report ok')
  assert.equal(result.json.models.length, 1, 'models select did not return exactly one model')
  assert.equal(result.json.models[0].key, 'q', 'models select returned the wrong model')
}
