import assert from 'node:assert/strict'
import fs from 'node:fs'
import { validate } from '../../../lib/contract/validate.mjs'

export const name = 'enumerate'
export const introduced_by = 'T-036'
export const ac = ['AC-079']

export async function run(flow) {
  const result = flow.run(['models', 'enumerate', '--config', flow.config_path])
  assert.equal(result.code, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.schema, 'cliworker.models/v1')
  assert.ok(Array.isArray(output.models))
  assert.equal(output.models.length, 1)
  assert.equal(output.models[0].id, 'q')
  const schema = JSON.parse(fs.readFileSync(new URL('../../../contracts/schemas/model.v1.schema.json', import.meta.url), 'utf8'))
  const checked = validate(schema, output.models[0])
  assert.equal(checked.ok, true, JSON.stringify(checked.errors))
}
