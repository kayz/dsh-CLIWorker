import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createFakeClock } from '../helpers/clock.mjs'
import { createMemFs } from '../fixtures/store/memfs.mjs'
import { drive } from '../fixtures/store/drive.mjs'
import { LOCK_DEFAULTS, acquireLock, isPidAlive, lockFilePath, withLock } from '../../lib/lock.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const STATE = '/state'
const STALE = { lock_stale_ms: 30000, lock_wait_ms: 200000, lock_poll_ms: 50 }

function word(...parts) {
  return parts.join('')
}

function seededRandom(seed = 11) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

function makeCtx() {
  const clock = createFakeClock()
  const memfs = createMemFs({ clock })
  return { ctx: { fs: memfs, clock, platform: 'linux', random: seededRandom() }, clock, memfs }
}

function countSleeps(clock) {
  const sleeps = { count: 0 }
  const base = clock.sleep.bind(clock)
  clock.sleep = (ms) => {
    sleeps.count += 1
    return base(ms)
  }
  return sleeps
}

test('[AC-029] lock-free-acquire: no lock means an immediate handle and no sleep', async () => {
  const { ctx, clock, memfs } = makeCtx()
  const sleeps = countSleeps(clock)
  const lockPath = lockFilePath(STATE)
  const before = clock.now()

  const handle = await acquireLock(ctx, lockPath, { pid: 1234 })

  assert.equal(clock.now(), before)
  assert.equal(sleeps.count, 0)
  const payload = JSON.parse(memfs.text(lockPath))
  assert.equal(payload.pid, 1234)
  assert.equal(payload.at, before)
  assert.equal(typeof payload.token, 'string')
  assert.ok(payload.token.length > 0)
  assert.equal(isPidAlive(process.pid), true)
  assert.equal(isPidAlive(0), false)

  await handle.release()
  assert.equal(memfs.text(lockPath), null)
})

test('[AC-029] lock-dead-pid: a lock held by a dead pid is reclaimed without any sleep', async () => {
  const { ctx, clock, memfs } = makeCtx()
  const sleeps = countSleeps(clock)
  const lockPath = lockFilePath(STATE)
  const before = clock.now()
  memfs.setFile(lockPath, JSON.stringify({ pid: 4242, at: before, token: 'held-by-4242' }))

  const handle = await acquireLock(ctx, lockPath, { pid: 999, isPidAlive: () => false })

  assert.equal(sleeps.count, 0)
  assert.equal(clock.now(), before)
  const payload = JSON.parse(memfs.text(lockPath))
  assert.equal(payload.pid, 999)
  assert.notEqual(payload.token, 'held-by-4242')
  await handle.release()
})

test('[AC-029] lock-stale-advance: reclaim only once the age passes lock_stale_ms', async () => {
  // age exactly lock_stale_ms: still a live lock, so the first poll must be spent before reclaiming
  const equal = makeCtx()
  const equalSleeps = countSleeps(equal.clock)
  const equalPath = lockFilePath(STATE)
  const equalStart = equal.clock.now()
  equal.memfs.setFile(equalPath, JSON.stringify({ pid: 4242, at: equalStart - 30000, token: 'old' }))

  const equalHandle = await drive(
    equal.clock,
    acquireLock(equal.ctx, equalPath, { pid: 7, isPidAlive: () => true, policy: STALE }),
    { step: 50 }
  )

  assert.ok(equalSleeps.count >= 1)
  assert.equal(equal.clock.now() - equalStart, 50)
  await equalHandle.release()

  // one millisecond past the limit: reclaimed at once, no virtual time spent
  const past = makeCtx()
  const pastSleeps = countSleeps(past.clock)
  const pastPath = lockFilePath(STATE)
  const pastStart = past.clock.now()
  past.memfs.setFile(pastPath, JSON.stringify({ pid: 4242, at: pastStart - 30001, token: 'old' }))

  const pastHandle = await acquireLock(past.ctx, pastPath, { pid: 7, isPidAlive: () => true, policy: STALE })

  assert.equal(pastSleeps.count, 0)
  assert.equal(past.clock.now(), pastStart)
  await pastHandle.release()

  // a live, fresh lock: reclaimed only after virtual time passes lock_stale_ms
  const fresh = makeCtx()
  const freshSleeps = countSleeps(fresh.clock)
  const freshPath = lockFilePath(STATE)
  const freshStart = fresh.clock.now()
  fresh.memfs.setFile(freshPath, JSON.stringify({ pid: 4242, at: freshStart, token: 'live' }))

  const freshHandle = await drive(
    fresh.clock,
    acquireLock(fresh.ctx, freshPath, { pid: 7, isPidAlive: () => true, policy: STALE }),
    { step: 50 }
  )

  assert.ok(freshSleeps.count > 0)
  assert.ok(fresh.clock.now() - freshStart > 30000)
  await freshHandle.release()
})

test('[AC-029] lock-timeout-retries: E_STATE_LOCKED after ceil(lock_wait_ms/lock_poll_ms) polls', async () => {
  const cases = [
    [5000, 50],
    [120, 50],
    [100, 50],
    [1, 50],
  ]

  for (const [wait, poll] of cases) {
    const { ctx, clock, memfs } = makeCtx()
    const sleeps = countSleeps(clock)
    const lockPath = lockFilePath(STATE)
    const start = clock.now()
    const held = JSON.stringify({ pid: 4242, at: start, token: 'live-holder' })
    memfs.setFile(lockPath, held)
    const policy = { lock_stale_ms: 1000000, lock_wait_ms: wait, lock_poll_ms: poll }

    await assert.rejects(
      () => drive(clock, acquireLock(ctx, lockPath, { pid: 7, isPidAlive: () => true, policy }), { step: poll }),
      (error) => {
        assert.equal(error.code, 'E_STATE_LOCKED')
        return true
      }
    )

    assert.equal(sleeps.count, Math.ceil(wait / poll))
    assert.ok(clock.now() - start >= wait)
    assert.equal(memfs.text(lockPath), held)
  }
})

test('[AC-029] lock-release-token: release only removes a lock it still owns', async () => {
  const { ctx, clock, memfs } = makeCtx()
  const lockPath = lockFilePath(STATE)

  const handle = await acquireLock(ctx, lockPath, { pid: 11 })
  await handle.release()
  assert.equal(memfs.text(lockPath), null)
  await handle.release()

  const second = await acquireLock(ctx, lockPath, { pid: 33 })
  memfs.setFile(lockPath, JSON.stringify({ pid: 44, at: clock.now(), token: 'someone-else' }))
  await second.release()

  const payload = JSON.parse(memfs.text(lockPath))
  assert.equal(payload.token, 'someone-else')
  assert.equal(LOCK_DEFAULTS.lock_stale_ms, 30000)
})

test('[AC-029] lock-with-lock: withLock returns the result and always releases', async () => {
  const { ctx, memfs } = makeCtx()
  const lockPath = lockFilePath(STATE)

  const value = await withLock(
    ctx,
    lockPath,
    async () => {
      assert.notEqual(memfs.text(lockPath), null)
      return 42
    },
    { pid: 5 }
  )

  assert.equal(value, 42)
  assert.equal(memfs.text(lockPath), null)

  await assert.rejects(
    () =>
      withLock(
        ctx,
        lockPath,
        async () => {
          throw new Error('boom')
        },
        { pid: 6 }
      ),
    /boom/
  )
  assert.equal(memfs.text(lockPath), null)
})

test('[AC-029] lock-corrupt-content: empty or unparsable locks use mtime, never a dead lock', async () => {
  const stale = makeCtx()
  const staleSleeps = countSleeps(stale.clock)
  const stalePath = lockFilePath(STATE)
  stale.memfs.setFile(stalePath, '')
  stale.clock.setNow(stale.clock.now() + 30001)

  const handle = await acquireLock(stale.ctx, stalePath, { pid: 8, policy: STALE })

  assert.equal(staleSleeps.count, 0)
  assert.equal(JSON.parse(stale.memfs.text(stalePath)).pid, 8)
  await handle.release()

  const fresh = makeCtx()
  const freshPath = lockFilePath(STATE)
  fresh.memfs.setFile(freshPath, 'not json at all')
  const policy = { lock_stale_ms: 30000, lock_wait_ms: 120, lock_poll_ms: 50 }

  await assert.rejects(
    () => drive(fresh.clock, acquireLock(fresh.ctx, freshPath, { pid: 9, policy }), { step: 50 }),
    (error) => {
      assert.equal(error.code, 'E_STATE_LOCKED')
      return true
    }
  )
})

test('[AC-029] lock-seams: the module never imports fs or touches a time primitive', () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib/lock.mjs'), 'utf8')
  const banned = ['node:fs', 'Date.now', word('set', 'Timeout'), word('set', 'Interval'), word('set', 'Immediate'), 'node:timers']

  for (const needle of banned) assert.equal(source.includes(needle), false, `lib/lock.mjs must not contain ${needle}`)
})
