import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { scanView } from '../../lib/contract/scan.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const FORBIDDEN_PATH = path.join(ROOT, 'contracts', 'agentline-forbidden.json')
const EXAMPLE_DIR = path.join(ROOT, 'contracts', 'examples')

const forbidden = JSON.parse(fs.readFileSync(FORBIDDEN_PATH, 'utf8'))
const catalog = {
  models: [
    { key: 'claude:claude-sonnet-5-5', id: 'claude-sonnet-5-5', cli: 'claude' },
    { key: 'codex:gpt-6-codex', id: 'gpt-6-codex', cli: 'codex' },
    { key: 'agent:agent-large', id: 'agent-large', cli: 'agent' },
  ],
}
const wrapper = {
  command: 'node',
  bin: 'bin/cliworker.mjs',
  state_dir: '/state',
  config: '/config.json',
}

function scan(view, options = {}) {
  return scanView(view, { forbidden, catalog, wrapper, ...options })
}

function kinds(result) {
  return result.hits.map((hit) => `${hit.kind}@${hit.path}`)
}

test('[AC-011] every forbidden key is detected at depth 1', () => {
  for (const key of forbidden.keys) {
    const result = scan({ [key]: 1 })
    assert.equal(result.ok, false, `key ${key} was not detected`)
    assert.ok(
      result.hits.some((hit) => hit.kind === 'forbidden_key' && hit.path === `/${key}`),
      `key ${key} produced ${JSON.stringify(kinds(result))}`
    )
  }
})

test('[AC-011] every forbidden key is detected at depth 3', () => {
  for (const key of forbidden.keys) {
    const result = scan({ a: { b: { [key]: 1 } } })
    assert.equal(result.ok, false, `key ${key} was not detected at depth 3`)
    assert.ok(
      result.hits.some((hit) => hit.kind === 'forbidden_key' && hit.path === `/a/b/${key}`),
      `key ${key} produced ${JSON.stringify(kinds(result))}`
    )
  }
})

test('[AC-011] forbidden keys are detected inside arrays, warnings, error and rejected', () => {
  const result = scan({
    warnings: [{ model_key: 1 }],
    error: { provider: 'x' },
    rejected: [{ key: 'r' }],
    nested: [[{ vendor: 1 }]],
  })
  const paths = result.hits.filter((hit) => hit.kind === 'forbidden_key').map((hit) => hit.path)
  assert.ok(paths.includes('/warnings/0/model_key'), JSON.stringify(paths))
  assert.ok(paths.includes('/error/provider'), JSON.stringify(paths))
  assert.ok(paths.includes('/rejected/0/key'), JSON.stringify(paths))
  assert.ok(paths.includes('/nested/0/0/vendor'), JSON.stringify(paths))
})

test('[AC-011] forbidden key matching is case-insensitive and exact', () => {
  for (const key of ['Model_Key', 'MODEL_KEY', 'mOdEl_KeY']) {
    const result = scan({ [key]: 1 })
    assert.ok(result.hits.some((hit) => hit.kind === 'forbidden_key'), key)
  }
  for (const key of ['model_keys', 'xmodel_key', 'model-key', 'model key']) {
    const result = scan({ [key]: 1 })
    assert.equal(result.ok, true, `key ${key} must not match`)
  }
})

test('[AC-011] every forbidden value is detected at depth 1 and depth 3', () => {
  const values = ['claude-sonnet-5-5', 'claude:claude-sonnet-5-5', 'claude', 'gpt-6-codex', 'codex', 'agent-large', 'agent']
  for (const value of values) {
    const shallow = scan({ text: value })
    assert.ok(
      shallow.hits.some((hit) => hit.kind === 'forbidden_value' && hit.path === '/text'),
      `value ${value} was not detected at depth 1`
    )
    const deep = scan({ a: { b: { text: value } } })
    assert.ok(
      deep.hits.some((hit) => hit.kind === 'forbidden_value' && hit.path === '/a/b/text'),
      `value ${value} was not detected at depth 3`
    )
  }
  const keyed = scan({ 'claude-cli': 1 })
  assert.ok(keyed.hits.some((hit) => hit.kind === 'forbidden_value'))
})

test('[AC-011] forbidden values match whole words after tokenizing', () => {
  assert.equal(scan({ text: 'claude-sonnet-5-5-extra' }).ok, false)
  assert.equal(scan({ text: 'use claude here' }).ok, false)
  assert.equal(scan({ text: 'claudette' }).ok, true)
  assert.equal(scan({ text: 'codexes' }).ok, true)
  assert.equal(scan({ text: 'zeta claude' }).ok, false)
})

test('[AC-011] cliworker, config and dsh-CLIWorker are not reported', () => {
  for (const text of ['cliworker', 'config', 'dsh-CLIWorker', 'CLIWorker', 'dsh-cliworker --config']) {
    const result = scan({ note: text })
    assert.equal(result.ok, true, `${text} produced ${JSON.stringify(kinds(result))}`)
  }
})

test('[AC-011] the call subtree skips value scanning but must equal the wrapper template', () => {
  const makeCall = (over) => ({
    command: 'node',
    args: [
      'bin/cliworker.mjs',
      'run',
      '--lease',
      'l_abc',
      '--state-dir',
      '/state',
      '--config',
      '/config.json',
    ],
    cwd: 'C:/work/claude-sonnet-5-5',
    input: 'stdin',
    output: 'cliworker.event/v1',
    timeout_ms: 1000,
    ...over,
  })

  assert.equal(scan({ models: [{ lease_id: 'l_abc', call: makeCall({}) }] }).ok, true)

  const command = scan({ models: [{ lease_id: 'l_abc', call: makeCall({ command: 'claude' }) }] })
  assert.deepStrictEqual(kinds(command), ['call_mismatch@/models/0/call/command'])
  assert.equal(command.hits[0].match, 'command')

  const lease = scan({ models: [{ lease_id: 'l_abc', call: makeCall({ args: makeCall({}).args.map((value, index) => (index === 3 ? 'l_zzz' : value)) }) }] })
  assert.deepStrictEqual(kinds(lease), ['call_mismatch@/models/0/call/args/3'])
  assert.equal(lease.hits[0].match, 'args[3]')

  const missing = makeCall({})
  delete missing.timeout_ms
  const missingResult = scan({ models: [{ lease_id: 'l_abc', call: missing }] })
  assert.deepStrictEqual(kinds(missingResult), ['call_mismatch@/models/0/call'])
  assert.equal(missingResult.hits[0].match, 'keys')

  const extra = scan({ models: [{ lease_id: 'l_abc', call: makeCall({ model: 'x' }) }] })
  assert.deepStrictEqual(kinds(extra), ['call_mismatch@/models/0/call'])
  assert.equal(extra.hits[0].match, 'keys')

  const topLevel = scan({ calls: [makeCall({ command: 'codex' })] })
  assert.deepStrictEqual(kinds(topLevel), ['call_mismatch@/calls/0/command'])
})

test('[AC-011] clean examples produce zero hits', () => {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(EXAMPLE_DIR, name, 'valid', '01.json'), 'utf8'))
  const docs = [
    read('selection-ok.v1'),
    read('handle.v1'),
    read('selection-failed.v1'),
    read('error-envelope'),
  ]
  for (const doc of docs) {
    const call = doc.call ?? doc.models?.[0]?.call ?? doc.calls?.[0] ?? null
    const localWrapper = call
      ? { command: call.command, bin: call.args[0], state_dir: call.args[5], config: call.args[7] }
      : wrapper
    const result = scanView(doc, { forbidden, catalog, wrapper: localWrapper })
    assert.equal(result.ok, true, `${JSON.stringify(kinds(result))}`)
  }
})

test('[AC-011] deeply nested input does not overflow the stack', () => {
  const root = {}
  let node = root
  for (let i = 0; i < 1000; i += 1) {
    node.a = {}
    node = node.a
  }
  node.model_key = 1
  const result = scan(root)
  assert.equal(result.ok, false)
  const hit = result.hits.find((item) => item.kind === 'forbidden_key')
  assert.ok(hit)
  assert.ok(hit.path.endsWith('/model_key'))
  assert.equal(hit.path.split('/').length, 1002)
})
