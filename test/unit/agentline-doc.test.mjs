import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const keys = JSON.parse(fs.readFileSync(new URL('../../contracts/agentline-forbidden.json', import.meta.url), 'utf8')).keys
const document = fs.readFileSync(new URL('../../docs/agentline-integration.md', import.meta.url), 'utf8')
const scan = text => keys.filter(key => new RegExp(`(?<![A-Za-z0-9_])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'i').test(text))

test('[AC-068] AgentLine contract and word boundaries', () => {
  assert.deepEqual(scan(document), [])
  for (const key of keys) {
    assert.ok(scan(`<!-- ${key.toUpperCase()} -->`).includes(key))
    assert.ok(scan(`"${key}": 1`).includes(key))
    assert.ok(!scan(`prefix_${key}_suffix`).includes(key))
  }
  assert.deepEqual(scan('CLIWorker E_PROVIDER_FAILED E_INSUFFICIENT_QUOTA'), [])
  for (const word of ['level', 'count', 'usage', 'importance', 'calls', '顺序', '再申请', 'error']) assert.ok(document.includes(word))
})
