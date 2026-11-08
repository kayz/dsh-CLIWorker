import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { setup } from '../../fixtures/probe/helpers.mjs'

export const id = 'probe'
export const name = 'probe'
export const introduced_by = 'T-020'
export const ac = ['AC-047', 'AC-048']

export async function run(env) {
  const savedConfig = fs.readFileSync(env.config_path)
  const cache = path.join(env.state_dir, 'probes.json')
  const savedCache = fs.existsSync(cache) ? fs.readFileSync(cache) : null
  const fixture = setup()
  try {
    const config = { ...fixture.config, schema: 'cliworker.config/v2', state_dir: env.state_dir }
    delete config._home
    fs.writeFileSync(env.config_path, JSON.stringify(config), 'utf8')
    const result = env.run(['models', 'probe', '--config', env.config_path])
    assert.equal(result.code, 0, result.stdout)
    assert.equal(result.json.models[0].availability.state, 'callable')
    const records = JSON.parse(fs.readFileSync(cache, 'utf8'))
    assert.equal(records[0].availability.evidence.nonce_ok, true)
    const rows = fs.readFileSync(path.join(env.state_dir, 'usage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.ok(rows.some(row => row.kind === 'probe' && row.model === 'claude:one'))
    assert.equal(env.scan().ok, true)
  } finally {
    fs.writeFileSync(env.config_path, savedConfig)
    if (savedCache === null) fs.rmSync(cache, { force: true })
    else fs.writeFileSync(cache, savedCache)
    fixture.cleanup()
  }
}
