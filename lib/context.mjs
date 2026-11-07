import fs from 'node:fs'
import { run } from './exec.mjs'

export const TEST_CLOCK_ENV = 'CLIWORKER_TEST_CLOCK_FILE'

const NUMBER_RE = /^[0-9]+(\.[0-9]+)?$/

function resolve(value, fallback) {
  return value === undefined ? fallback : value
}

export function createRealClock({ env, fs: fsApi } = {}) {
  const readEnv = env || {}
  const io = fsApi || fs

  const clock = {
    now() {
      const file = readEnv[TEST_CLOCK_ENV]
      if (typeof file !== 'string' || file === '') return Date.now()
      const raw = String(io.readFileSync(file, 'utf8')).trim()
      const value = NUMBER_RE.test(raw) ? Number(raw) : Date.parse(raw)
      if (!Number.isFinite(value)) throw new Error(`invalid ${TEST_CLOCK_ENV} content`)
      return value
    },
    nowIso() {
      return new Date(clock.now()).toISOString()
    },
    setTimeout(fn, ms) {
      return setTimeout(fn, ms)
    },
    clearTimeout(handle) {
      clearTimeout(handle)
    },
    sleep(ms) {
      return new Promise((done) => { setTimeout(done, ms) })
    },
  }

  return clock
}

export function createContext(overrides = {}) {
  const o = overrides || {}
  const env = resolve(o.env, process.env)
  const fsApi = resolve(o.fs, fs)
  const exec = resolve(o.exec, run)
  const clock = resolve(o.clock, createRealClock({ env, fs: fsApi }))

  return {
    exec,
    fs: fsApi,
    fetch: resolve(o.fetch, (...a) => globalThis.fetch(...a)),
    env,
    platform: resolve(o.platform, process.platform),
    stdout: resolve(o.stdout, process.stdout),
    stderr: resolve(o.stderr, process.stderr),
    random: resolve(o.random, () => Math.random()),
    clock,
    now: resolve(o.now, () => clock.now()),
  }
}

export function systemNow() {
  return createRealClock({ env: process.env, fs }).now()
}
