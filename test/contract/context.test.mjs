import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createContext, TEST_CLOCK_ENV } from '../../lib/context.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts', 'context', 'context.v1.json'), 'utf8'))

const MEMBERS = Object.keys(SPEC.members).sort()

function assertSurface(label, ctx) {
  assert.deepEqual(Object.keys(ctx).sort(), MEMBERS, `${label} member set`)
  for (const [member, type] of Object.entries(SPEC.members)) {
    const value = ctx[member]
    const ok = type === 'stream' ? typeof value.write === 'function' : typeof value === type
    assert.ok(ok, `${label}.${member} must be ${type}`)
  }
  for (const method of SPEC.stream_methods) {
    assert.equal(typeof ctx.stdout[method], 'function', `${label}.stdout.${method}`)
    assert.equal(typeof ctx.stderr[method], 'function', `${label}.stderr.${method}`)
  }
  for (const method of SPEC.fs_methods) assert.equal(typeof ctx.fs[method], 'function', `${label}.fs.${method}`)
  for (const method of SPEC.clock_methods) assert.equal(typeof ctx.clock[method], 'function', `${label}.clock.${method}`)
}

test('[AC-072] the contract file fixes the context surface', () => {
  assert.equal(SPEC.contract, 'cliworker.context')
  assert.equal(SPEC.version, 1)
  assert.equal(SPEC.test_clock_env, TEST_CLOCK_ENV)
  assert.deepEqual(SPEC.stream_methods, ['write'])
  assert.deepEqual(SPEC.fs_methods, ['readFileSync', 'writeFileSync', 'appendFileSync', 'mkdirSync', 'existsSync', 'statSync', 'readdirSync', 'renameSync', 'rmSync'])
  assert.deepEqual(SPEC.clock_methods, ['now', 'nowIso', 'setTimeout', 'clearTimeout', 'sleep'])
  assert.deepEqual(SPEC.fake_clock_extras, ['setNow', 'advance', 'pending'])
  assert.deepEqual(MEMBERS, ['clock', 'env', 'exec', 'fetch', 'fs', 'now', 'platform', 'random', 'stderr', 'stdout'])
})

test('[AC-072] the real context matches the contract', () => {
  const ctx = createContext({ env: {} })
  assertSurface('real', ctx)
  assert.equal(ctx.platform, process.platform)
  assert.equal(ctx.env.CLIWORKER_CONFIG, undefined)
  assert.ok(Math.abs(ctx.now() - ctx.clock.now()) <= 50)
  assert.deepEqual(ctx.exec('nonexistent-cli-for-contract-test', ['--version']).ok, false)
})

test('[AC-072] the real clock exposes only the five clock methods', () => {
  const ctx = createContext({ env: {} })
  for (const extra of SPEC.fake_clock_extras) assert.equal(extra in ctx.clock, false, `real clock exposes ${extra}`)
  assert.equal(typeof ctx.clock.nowIso(), 'string')
  assert.ok(Math.abs(Date.parse(ctx.clock.nowIso()) - ctx.clock.now()) <= 5)
})

test('[AC-072] the fake context matches the contract', () => {
  const ctx = createFakeContext()
  assertSurface('fake', ctx)
  assert.equal(ctx.platform, 'linux')
  assert.deepEqual(ctx.env, {})
  assert.equal(ctx.now(), ctx.clock.now())
})

test('[AC-072] the fake clock adds exactly the documented extras', () => {
  const ctx = createFakeContext()
  for (const extra of SPEC.fake_clock_extras) assert.equal(typeof ctx.clock[extra], 'function', `fake clock lacks ${extra}`)
})

test('[AC-072] the fake context keeps its handles on the members themselves', () => {
  const ctx = createFakeContext({ files: { '/a.txt': 'x' } })
  ctx.exec('tool', ['--flag'], { env: { TOKEN: 'secret-value' }, timeout: 5 })
  assert.equal(ctx.exec.count, 1)
  assert.deepEqual(ctx.exec.calls[0].envNames, ['TOKEN'])
  assert.equal(JSON.stringify(ctx.exec.calls).includes('secret-value'), false)
  assert.equal(ctx.fs.readFileSync('/a.txt', 'utf8'), 'x')
  assert.ok(ctx.fs.accessed.length >= 1)
  for (const value of [ctx.random(), ctx.random()]) assert.ok(value >= 0 && value < 1)
  assert.deepEqual(Object.keys(ctx).sort(), MEMBERS)
})
