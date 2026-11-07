import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createRealClock, TEST_CLOCK_ENV } from '../../lib/context.mjs'
import { main } from '../../lib/cli.mjs'
import { createFakeClock } from '../helpers/clock.mjs'
import { createFakeContext, fakeFs } from '../helpers/ctx.mjs'

test('[AC-072] advance moves the fake clock and setNow moves it either way', async () => {
  const clock = createFakeClock({ start: 1000 })
  assert.equal(clock.now(), 1000)
  await clock.advance(1000)
  assert.equal(clock.now(), 2000)

  clock.setNow(5)
  assert.equal(clock.now(), 5)
  clock.setNow(9000)
  assert.equal(clock.now(), 9000)
  clock.setNow(Date.parse('2026-01-01T00:00:00Z'))
  assert.equal(clock.nowIso(), '2026-01-01T00:00:00.000Z')
})

test('[AC-072] timers fire in due order and pending tracks the queue', async () => {
  const clock = createFakeClock({ start: 9000 })
  const log = []
  const seen = []

  clock.setTimeout(() => log.push('b2'), 200)
  clock.setTimeout(() => { log.push('a1'); seen.push(clock.now()) }, 100)
  clock.setTimeout(() => log.push('b3'), 200)
  const cancelled = clock.setTimeout(() => log.push('cancelled'), 150)
  clock.clearTimeout(cancelled)
  clock.setTimeout(() => log.push('far'), 1000)
  assert.equal(clock.pending(), 4)

  await clock.advance(99)
  assert.deepEqual(log, [])
  assert.equal(clock.pending(), 4)

  await clock.advance(1)
  assert.deepEqual(log, ['a1'])
  assert.deepEqual(seen, [9100])
  assert.equal(clock.pending(), 3)

  await clock.advance(100)
  assert.deepEqual(log, ['a1', 'b2', 'b3'])
  assert.equal(clock.pending(), 1)

  clock.clearTimeout({ id: 'unknown' })
  assert.equal(clock.pending(), 1)
})

test('[AC-072] sleep resolves only after advance reaches the deadline', async () => {
  const clock = createFakeClock({ start: 0 })
  let done = false
  const sleeping = clock.sleep(500).then(() => { done = true })
  assert.equal(clock.pending(), 1)

  await clock.advance(499)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(done, false)

  await clock.advance(1)
  await sleeping
  assert.equal(done, true)
  assert.equal(clock.pending(), 0)
})

test('[AC-072] overdue timers fire on the next advance and negative delays are rejected', async () => {
  const clock = createFakeClock({ start: 0 })
  const log = []
  clock.setTimeout(() => log.push('a'), 10)
  clock.setTimeout(() => log.push('b'), 20)

  clock.setNow(100)
  await clock.advance(0)
  assert.deepEqual(log, ['a', 'b'])
  assert.equal(clock.pending(), 0)

  await assert.rejects(() => clock.advance(-1), RangeError)
  await assert.rejects(() => clock.advance(Number.NaN), RangeError)
})

test('[AC-072] the real clock rereads the clock file on every call', () => {
  const io = fakeFs({ '/clock.txt': '1000' })
  const clock = createRealClock({ env: { [TEST_CLOCK_ENV]: '/clock.txt' }, fs: io })

  assert.equal(clock.now(), 1000)
  io.writeFileSync('/clock.txt', '2500')
  assert.equal(clock.now(), 2500)
  io.writeFileSync('/clock.txt', '2026-11-07T00:00:00.000Z')
  assert.equal(clock.now(), Date.parse('2026-11-07T00:00:00.000Z'))
  assert.equal(clock.nowIso(), '2026-11-07T00:00:00.000Z')
  io.writeFileSync('/clock.txt', '  1000.5  ')
  assert.equal(clock.now(), 1000.5)
})

test('[AC-072] an invalid clock file raises an error naming the variable', () => {
  const file = path.join(os.tmpdir(), `cw-clock-${process.pid}.txt`)
  try {
    fs.writeFileSync(file, 'not a time')
    const clock = createRealClock({ env: { [TEST_CLOCK_ENV]: file }, fs })
    assert.throws(() => clock.now(), (error) => error.message.includes(TEST_CLOCK_ENV))
  } finally {
    fs.rmSync(file, { force: true })
  }
})

test('[AC-072] main adds W_TEST_CLOCK only when the clock file variable is set', async () => {
  const config = JSON.stringify({ providers: {}, models: {} })
  const run = async (env) => {
    const ctx = createFakeContext({ files: { '/cw/config.json': config }, env })
    const result = await main(['usage', 'summary', '--config', '/cw/config.json'], ctx)
    return { result, body: ctx.stdout.text() }
  }

  const on = await run({ CLIWORKER_HOME: '/cw/home', [TEST_CLOCK_ENV]: '/cw/clock.txt' })
  assert.equal(on.result.exitCode, 0)
  const warned = JSON.parse(on.body)
  assert.ok(warned.warnings.some((warning) => warning.code === 'W_TEST_CLOCK'))

  for (const env of [{ CLIWORKER_HOME: '/cw/home' }, { CLIWORKER_HOME: '/cw/home', [TEST_CLOCK_ENV]: '' }]) {
    const off = await run(env)
    assert.equal(off.result.exitCode, 0)
    assert.equal(off.body.includes('W_TEST_CLOCK'), false)
    assert.equal('warnings' in JSON.parse(off.body), false)
  }
})

test('[AC-072] the fake context now() aliases its clock', async () => {
  const ctx = createFakeContext({ now: 42 })
  assert.equal(ctx.now(), 42)
  await ctx.clock.advance(8)
  assert.equal(ctx.now(), ctx.clock.now())
  assert.equal(ctx.now(), 50)
})
