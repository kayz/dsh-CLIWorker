import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFlow, discoverSteps } from '../helpers/flow.mjs'
import { makeSentinel } from '../helpers/leak-scan.mjs'
import { platformTest, recordSkip, satisfies } from '../helpers/platform-gate.mjs'
import { createContext } from '../../lib/context.mjs'
import { resolveSecret, secretAction } from '../../lib/secrets/index.mjs'
import * as auth from '../flows/steps/auth.mjs'

function withFixture(body) {
  const flow = createFlow({ sentinels: [
    { label: 'AUTH', value: makeSentinel('AUTH') },
    { label: 'REPLACEMENT', value: makeSentinel('REPLACEMENT') },
  ] })
  const fixture = auth.createAuthFixture(flow)
  try { body(flow, fixture) } finally { fixture.cleanup(); flow.cleanup() }
}

function verifySource(source) {
  withFixture((flow, fixture) => {
    fixture.config()
    const value = flow.sentinels[0].value
    const result = fixture.cli('set', source === 'from-env' ? { source: true, value } : { input: value + '\n' })
    assert.equal(result.code, 0, 'set failed')
    assert.deepEqual(result.json, { ok: true, state: 'set' })
    auth.scanAuth(flow)
    assert.equal(Object.values(flow.env).includes(value), false, 'status inherited the input credential')
    const status = fixture.cli('status')
    assert.equal(status.code, 0)
    assert.deepEqual(status.json, { ok: true, state: 'set' })
    fixture.checkConsumed(fixture.consume(), value)
    auth.scanAuth(flow)
    assert.deepEqual(fixture.cli('clear').json, { ok: true, state: 'unset' })
    assert.deepEqual(fixture.cli('status').json, { ok: true, state: 'unset' })
    auth.scanAuth(flow)
  })
}

test('[AC-032] from-env persists across processes and injects declared env only', () => verifySource('from-env'))
test('[AC-032] stdin persists across processes and injects declared env only', () => verifySource('stdin'))

test('[AC-032] default ref overwrite and state_dir isolation', () => {
  withFixture((flow, fixture) => {
    fixture.config()
    const beforeConfig = fs.readFileSync(flow.config_path)
    assert.deepEqual(fixture.cli('status').json, { ok: true, state: 'unset' })
    for (const { value } of flow.sentinels) {
      assert.equal(fixture.cli('set', { source: true, value }).code, 0)
      auth.scanAuth(flow)
      fixture.checkConsumed(fixture.consume(), value)
      auth.scanAuth(flow)
    }
    assert.deepEqual(fs.readFileSync(flow.config_path), beforeConfig, 'auth rewrote config or saved the source env name')
    const isolatedState = path.join(flow.root, 'other-state')
    const otherConfig = fixture.config(undefined, isolatedState, path.join(fixture.dir, 'other-config.json'))
    assert.deepEqual(fixture.cli('status', { config: otherConfig }).json, { ok: true, state: 'unset' })
    const missing = fixture.consume(otherConfig)
    assert.equal(missing.code, 3)
    assert.equal(missing.json.error.code, 'E_SECRET_BACKEND')
    assert.equal(fs.existsSync(fixture.record), false, 'provider started without a credential')
    assert.equal(fs.existsSync(isolatedState), false)
    fixture.checkConsumed(fixture.consume(), flow.sentinels[1].value)
    assert.equal(fixture.cli('clear').code, 0)
    auth.scanAuth(flow)
  })
})

test('[AC-032] explicit keychain ref is shared by auth and consumption', () => {
  withFixture((flow, fixture) => {
    const reference = 'keychain:../explicit "entry"\\name'
    fixture.config(reference)
    const original = fs.readFileSync(flow.config_path)
    const value = flow.sentinels[0].value
    assert.equal(fixture.cli('set', { source: true, value }).code, 0)
    auth.scanAuth(flow)
    assert.deepEqual(fixture.cli('status').json, { ok: true, state: 'set' })
    fixture.checkConsumed(fixture.consume(), value)
    auth.scanAuth(flow)
    const defaultConfig = fixture.config(undefined, flow.state_dir, path.join(fixture.dir, 'default-config.json'))
    assert.deepEqual(fixture.cli('status', { config: defaultConfig }).json, { ok: true, state: 'unset' })
    assert.deepEqual(fs.readFileSync(flow.config_path), original)
    if (process.platform === 'win32') {
      assert.deepEqual(fs.readdirSync(path.join(flow.state_dir, 'secrets')), [crypto.createHash('sha256').update(reference.slice(9)).digest('hex') + '.dpapi'])
    }
    assert.equal(fixture.cli('clear').code, 0)
    assert.deepEqual(fixture.cli('clear').json, { ok: true, state: 'unset' })
    auth.scanAuth(flow)
  })
})

test('[AC-032] clear prevents consumption and backend failure preserves files', () => {
  withFixture((flow, fixture) => {
    fixture.config()
    const value = flow.sentinels[0].value
    assert.equal(fixture.cli('set', { input: value }).code, 0)
    auth.scanAuth(flow)
    fixture.checkConsumed(fixture.consume(), value)
    auth.scanAuth(flow)
    assert.deepEqual(fixture.cli('clear').json, { ok: true, state: 'unset' })
    const missing = fixture.consume()
    assert.equal(missing.code, 3)
    assert.equal(missing.json.error.code, 'E_SECRET_BACKEND')
    assert.equal(fs.existsSync(fixture.record), false, 'provider started after clear')
    auth.scanAuth(flow)
    assert.equal(fixture.cli('set', { source: true, value }).code, 0)
    fs.mkdirSync(path.join(flow.state_dir, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(flow.state_dir, 'nested', 'existing.bin'), Buffer.from([0, 255, 1, 13, 10]))
    const existing = auth.snapshotAuth(flow.state_dir)
    const store = auth.snapshotAuth(path.join(fixture.dir, 'store'))
    for (const failure of ['ENOENT', 'permission']) {
      flow.env.CW_TEST_SECRET_FAIL = failure
      const failed = fixture.cli('set', { source: true, value: flow.sentinels[1].value })
      assert.equal(failed.code, 3)
      assert.equal(failed.json.error.code, 'E_SECRET_BACKEND')
      assert.equal(failed.json.error.retryable, false)
      assert.deepEqual(auth.snapshotAuth(flow.state_dir), existing)
      assert.deepEqual(auth.snapshotAuth(path.join(fixture.dir, 'store')), store)
      const status = fixture.cli('status')
      assert.equal(status.code, 3)
      assert.equal(status.json.error.code, 'E_SECRET_BACKEND')
      const consumed = fixture.consume()
      assert.equal(consumed.code, 3)
      assert.equal(fs.existsSync(fixture.record), false)
      assert.deepEqual(auth.snapshotAuth(flow.state_dir), existing)
      const absent = path.join(flow.root, 'never-created')
      const absentConfig = fixture.config(undefined, absent, path.join(fixture.dir, 'absent-config.json'))
      assert.equal(fixture.cli('set', { source: true, value, config: absentConfig }).code, 3)
      assert.equal(fs.existsSync(absent), false, 'failed backend created the state directory')
      auth.scanAuth(flow)
    }
    delete flow.env.CW_TEST_SECRET_FAIL
    fixture.checkConsumed(fixture.consume(), value)
    assert.equal(fixture.cli('clear').code, 0)
    auth.scanAuth(flow)
  })
})

test('[AC-032] auth flow uses real CLI and scans all surfaces', async () => {
  const flow = createFlow()
  const originalConfig = fs.readFileSync(flow.config_path)
  const originalEnv = { ...flow.env }
  try {
    const step = (await discoverSteps()).find(step => step.name === 'auth')
    assert.ok(step, 'auth flow was not discovered')
    assert.equal(step.mod.introduced_by, 'T-013')
    assert.deepEqual(step.mod.ac, ['AC-032'])
    await step.mod.run(flow)
    assert.deepEqual(fs.readFileSync(flow.config_path), originalConfig)
    assert.deepEqual(flow.env, originalEnv)
    assert.equal(fs.existsSync(path.join(flow.root, 'auth-fixture')), false)
    assert.equal(flow.captured.argv.filter(argv => argv.includes('set')).length, 2)
    assert.equal(flow.captured.argv.filter(argv => argv.includes('status')).length, 4)
    assert.equal(flow.captured.argv.filter(argv => argv.some(arg => arg.endsWith('consume.mjs'))).length, 2)
    auth.scanAuth(flow)
    const shard = JSON.parse(fs.readFileSync(new URL('../traceability/T-013.json', import.meta.url), 'utf8'))
    assert.deepEqual(Object.keys(shard).sort(), ['entries', 'milestone', 'task'])
    assert.equal(shard.task, 'T-013')
    assert.equal(shard.milestone, 'M2')
    assert.deepEqual(shard.entries.map(entry => entry.ac), ['AC-032', 'AC-033'])
    for (const entry of shard.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ['ac', 'files', 'status'])
      assert.equal(entry.status, 'covered')
      for (const file of entry.files) assert.ok(fs.existsSync(new URL('../../' + file, import.meta.url)))
    }
  } finally { flow.cleanup() }
  assert.equal(fs.existsSync(flow.root), false)
})

// The formal runner selects this whole file for AC-032; native tests are opt-in only.
if (process.env.CLIWORKER_TEST_NATIVE_SECRETS === '1') {
  platformTest('native keychain isolated roundtrip', { requires: process.platform, file: import.meta.url }, t => {
    const tool = { win32: 'pwsh', darwin: 'security', linux: 'secret-tool' }[process.platform]
    const skip = reason => {
      recordSkip({ test: 'native keychain isolated roundtrip', file: import.meta.url, ac: null, requires: tool ?? process.platform, reason })
      t.skip(reason)
    }
    if (!tool || !satisfies(tool)) return skip('native keychain tool is unavailable')
    if (process.platform === 'linux' && !process.env.DBUS_SESSION_BUS_ADDRESS) return skip('native keychain session is unavailable')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-native-secret-'))
    const ctx = createContext()
    const config = { state_dir: dir, secrets: { kimi: { ref: 'keychain:isolated-native-test' } } }
    const value = crypto.randomBytes(32).toString('hex')
    let attempted = false
    try {
      if (process.platform !== 'win32') {
        try { assert.equal(resolveSecret(ctx, config, 'kimi'), null) } catch { return skip('native keychain session cannot be accessed') }
      }
      attempted = true
      secretAction(ctx, config, 'kimi', 'set', value)
      assert.equal(resolveSecret(createContext(), config, 'kimi') === value, true, 'native credential mismatch')
      secretAction(ctx, config, 'kimi', 'clear')
      assert.equal(resolveSecret(ctx, config, 'kimi'), null)
    } finally {
      try { if (attempted) secretAction(ctx, config, 'kimi', 'clear') } finally { fs.rmSync(dir, { recursive: true, force: true }) }
    }
  })
}
