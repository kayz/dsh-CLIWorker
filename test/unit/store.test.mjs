import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createFakeClock } from '../helpers/clock.mjs'
import { createMemFs } from '../fixtures/store/memfs.mjs'
import {
  RENAME_RETRY_DELAYS_MS,
  appendJsonl,
  atomicWriteJson,
  ensureDir,
  readJson,
  readJsonl,
} from '../../lib/store.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const STATE = '/state'

const INSTANCES = []

function seededRandom(seed = 7) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

function makeCtx({ platform = 'linux' } = {}) {
  const clock = createFakeClock()
  const memfs = createMemFs({ clock })
  INSTANCES.push(memfs)
  return { fs: memfs, clock, platform, random: seededRandom() }
}

/** Replaces clock.sleep with a recorder that moves virtual time, so retries need no driver. */
function recordSleep(ctx) {
  const sleeps = []
  const start = ctx.clock.now()
  ctx.clock.sleep = async (ms) => {
    sleeps.push(ms)
    ctx.clock.setNow(ctx.clock.now() + ms)
  }
  return { sleeps, elapsed: () => ctx.clock.now() - start }
}

test('[AC-029] atomic-write-ok: writes pretty JSON with a trailing newline and no leftovers', async () => {
  const ctx = makeCtx()
  const file = path.join(STATE, 'app.json')
  const value = { provider: 'alpha', nested: { count: 2 }, list: [1, true, null] }

  await atomicWriteJson(ctx, file, value)

  const text = ctx.fs.text(file)
  assert.equal(text, JSON.stringify(value, null, 2) + '\n')
  assert.notEqual(text.charCodeAt(0), 0xfeff)
  assert.deepEqual(ctx.fs.names(STATE), ['app.json'])
  assert.deepEqual(readJson(ctx, file), value)
})

test('[AC-029] atomic-write-rename-fail: rename failure keeps the old bytes and drops the temp file', async () => {
  const ctx = makeCtx()
  const file = path.join(STATE, 'app.json')
  ctx.fs.setFile(file, 'original bytes')
  ctx.fs.failNext('renameSync', 'EIO')

  await assert.rejects(() => atomicWriteJson(ctx, file, { n: 1 }), (error) => {
    assert.equal(error.code, 'EIO')
    return true
  })

  assert.equal(ctx.fs.text(file), 'original bytes')
  assert.deepEqual(ctx.fs.names(STATE), ['app.json'])
})

test('[AC-029] atomic-write-write-fail: temp write failure leaves the target untouched', async () => {
  const ctx = makeCtx()
  const file = path.join(STATE, 'app.json')
  ctx.fs.setFile(file, 'keep me')
  ctx.fs.failNext('writeFileSync', 'ENOSPC')

  await assert.rejects(() => atomicWriteJson(ctx, file, { n: 2 }), (error) => {
    assert.equal(error.code, 'ENOSPC')
    return true
  })

  assert.equal(ctx.fs.text(file), 'keep me')
  assert.deepEqual(ctx.fs.names(STATE), ['app.json'])
})

test('[AC-029] atomic-write-eperm-retry: win32 retries EPERM with 10/20/40/80/160 ms delays', async () => {
  const first = makeCtx({ platform: 'win32' })
  const recorder = recordSleep(first)
  const file = path.join(STATE, 'app.json')
  first.fs.failNext('renameSync', 'EPERM', 2)

  await atomicWriteJson(first, file, { ok: true })

  assert.deepEqual(recorder.sleeps, [10, 20])
  assert.equal(recorder.elapsed(), 30)
  assert.equal(first.fs.text(file), JSON.stringify({ ok: true }, null, 2) + '\n')

  const second = makeCtx({ platform: 'win32' })
  const stubborn = recordSleep(second)
  const target = path.join(STATE, 'keep.json')
  second.fs.setFile(target, 'keep')
  second.fs.failAlways('renameSync', 'EPERM')

  await assert.rejects(() => atomicWriteJson(second, target, { ok: false }), (error) => {
    assert.equal(error.code, 'EPERM')
    return true
  })

  assert.deepEqual(stubborn.sleeps, RENAME_RETRY_DELAYS_MS)
  assert.equal(stubborn.sleeps.length, RENAME_RETRY_DELAYS_MS.length)
  assert.equal(second.fs.text(target), 'keep')
  assert.deepEqual(second.fs.names(STATE), ['keep.json'])
})

test('[AC-029] atomic-write-posix-no-retry: other platforms surface EPERM at once', async () => {
  const ctx = makeCtx({ platform: 'linux' })
  const recorder = recordSleep(ctx)
  const file = path.join(STATE, 'app.json')
  ctx.fs.failNext('renameSync', 'EPERM')

  await assert.rejects(() => atomicWriteJson(ctx, file, { n: 3 }), (error) => {
    assert.equal(error.code, 'EPERM')
    return true
  })

  assert.deepEqual(recorder.sleeps, [])
  assert.equal(ctx.fs.text(file), null)
})

test('[AC-029] atomic-write-bad-value: undefined is rejected before any write', async () => {
  const ctx = makeCtx()

  await assert.rejects(() => atomicWriteJson(ctx, path.join(STATE, 'app.json'), undefined), TypeError)

  for (const method of ['writeFileSync', 'appendFileSync', 'renameSync', 'rmSync']) {
    assert.equal(ctx.fs.calls.includes(method), false, `unexpected ${method} call`)
  }
})

test('[AC-029] jsonl-append-shape: one append call, one line, no raw newline in the value', () => {
  const ctx = makeCtx()
  const file = path.join(STATE, 'audit.jsonl')
  const row = { id: 'a', text: 'line1\nline2' }

  appendJsonl(ctx, file, row)

  assert.equal(ctx.fs.calls.filter((method) => method === 'appendFileSync').length, 1)
  const text = ctx.fs.text(file)
  assert.equal(text, JSON.stringify(row) + '\n')
  assert.equal(text.split('\n').length - 1, 1)
  assert.equal(ensureDir(ctx, STATE), STATE)
})

test('[AC-029] jsonl-read: missing file is empty, CRLF is fine, bad lines report their number', () => {
  const ctx = makeCtx()
  const file = path.join(STATE, 'data.jsonl')

  assert.deepEqual(readJsonl(ctx, file), [])

  ctx.fs.setFile(file, '{"a":1}\r\n\r\n{"b":2}\n')
  assert.deepEqual(readJsonl(ctx, file), [{ a: 1 }, { b: 2 }])

  const broken = path.join(STATE, 'broken.jsonl')
  ctx.fs.setFile(broken, '{"a":1}\nnope\n{"b":2}\n')
  assert.throws(() => readJsonl(ctx, broken), (error) => {
    assert.ok(error instanceof SyntaxError)
    assert.match(error.message, /line 2/)
    return true
  })
  assert.deepEqual(readJsonl(ctx, broken, { skipInvalid: true }), [{ a: 1 }, { b: 2 }])
})

test('[AC-029] store-fs-surface: every recorded fs method is in the context contract', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/context/context.v1.json'), 'utf8'))
  const allowed = new Set(contract.fs_methods)
  const seen = new Set()
  for (const instance of INSTANCES) for (const method of instance.calls) seen.add(method)

  assert.ok(seen.size > 0)
  for (const method of seen) assert.ok(allowed.has(method), `unexpected fs method ${method}`)
})
