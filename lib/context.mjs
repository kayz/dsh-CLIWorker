import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createExec } from './exec.mjs'

export const TEST_CLOCK_ENV = 'CLIWORKER_TEST_CLOCK_FILE'

const NUMBER_RE = /^[0-9]+(\.[0-9]+)?$/
const COMMANDS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'commands')

function collectCommandFiles(dir, found) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectCommandFiles(full, found)
    else if (entry.isFile() && entry.name.endsWith('.mjs')) found.push(full)
  }
}

/**
 * Every `.mjs` file below `dir` as an absolute path, sorted for deterministic callers. The
 * default directory is `lib/commands`; a missing or unreadable directory yields `[]` so route
 * discovery never turns a packaging accident into a crash.
 */
export function listCommandFiles(dir = COMMANDS_DIR) {
  if (typeof dir !== 'string' || dir === '') return []
  const found = []
  collectCommandFiles(path.resolve(dir), found)
  found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return found
}

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
  // 默认 exec 必须带上 fs/env/platform，否则 Windows 上不会做 PATHEXT 解析
  // （claude/codex 这类 npm 安装的 .cmd 垫片会被误报为 command missing）。
  const platform = resolve(o.platform, process.platform)
  const defaultExec = createExec({ fs: fsApi, env, platform })
  const exec = resolve(o.exec, (...a) => defaultExec.runSync(...a))
  const clock = resolve(o.clock, createRealClock({ env, fs: fsApi }))

  return {
    exec,
    fs: fsApi,
    fetch: resolve(o.fetch, (...a) => globalThis.fetch(...a)),
    env,
    platform,
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
