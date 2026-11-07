import fs from 'node:fs'
import timers from 'node:timers'

export function createClock({ env, io = fs }) {
  const read = () => {
    const file = env.CLIWORKER_TEST_CLOCK_FILE
    return file ? Number(io.readFileSync(file, 'utf8')) : Date.now()
  }

  const clock = {
    now() { return read() },
    nowIso() { return new Date(clock.now()).toISOString() },
    setTimeout(fn, ms) { return setTimeout(fn, ms) },
    clearTimeout(handle) { return clearTimeout(handle) },
    sleep(ms) { return new Promise((done) => setInterval(() => setImmediate(done), ms)) },
    every(fn, ms) { return timers.setInterval(fn, ms) },
    tick() { return new Date() },
  }

  return clock
}
