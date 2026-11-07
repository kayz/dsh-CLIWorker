import path from 'node:path'
import { createFakeClock } from './clock.mjs'

export function fakeStream() {
  const parts = []
  return {
    write(chunk) { parts.push(String(chunk)); return true },
    text() { return parts.join('') },
  }
}

export function fakeExec(handler) {
  const calls = []
  const fn = (command, args = [], opts = {}) => {
    const o = opts || {}
    calls.push({ command, args, envNames: o.env ? Object.keys(o.env) : [], timeout: o.timeout })
    if (typeof handler !== 'function') return { ok: false, code: null, stdout: '', stderr: '', error: 'fakeExec: no handler' }
    return handler(command, args, o)
  }
  fn.calls = calls
  Object.defineProperty(fn, 'count', { get() { return calls.length } })
  return fn
}

export function fakeFs(files = {}) {
  const store = new Map()
  const accessed = []
  const norm = (p) => path.resolve(String(p))
  const track = (method, p) => {
    const resolved = norm(p)
    accessed.push({ method, path: resolved })
    return resolved
  }
  const miss = (p) => {
    const error = new Error(`ENOENT: no such file or directory, open '${p}'`)
    error.code = 'ENOENT'
    return error
  }
  const hasDir = (p) => {
    const prefix = p.endsWith(path.sep) ? p : p + path.sep
    for (const key of store.keys()) if (key.startsWith(prefix)) return true
    return false
  }

  for (const [key, value] of Object.entries(files || {})) store.set(norm(key), String(value))

  const api = {
    readFileSync(p, encoding) {
      const resolved = track('readFileSync', p)
      if (!store.has(resolved)) throw miss(resolved)
      const value = store.get(resolved)
      return encoding ? value : Buffer.from(value)
    },
    writeFileSync(p, data) {
      store.set(track('writeFileSync', p), String(data))
    },
    appendFileSync(p, data) {
      const resolved = track('appendFileSync', p)
      store.set(resolved, (store.get(resolved) || '') + String(data))
    },
    mkdirSync(p) {
      track('mkdirSync', p)
      return undefined
    },
    existsSync(p) {
      const resolved = track('existsSync', p)
      return store.has(resolved) || hasDir(resolved)
    },
    statSync(p) {
      const resolved = track('statSync', p)
      if (store.has(resolved)) return { isFile: () => true, isDirectory: () => false, size: store.get(resolved).length }
      if (hasDir(resolved)) return { isFile: () => false, isDirectory: () => true, size: 0 }
      throw miss(resolved)
    },
    readdirSync(p) {
      const resolved = track('readdirSync', p)
      const prefix = resolved.endsWith(path.sep) ? resolved : resolved + path.sep
      const names = []
      for (const key of store.keys()) {
        if (!key.startsWith(prefix)) continue
        const name = key.slice(prefix.length).split(path.sep)[0]
        if (!names.includes(name)) names.push(name)
      }
      if (names.length === 0) throw miss(resolved)
      return names
    },
    renameSync(from, to) {
      const source = track('renameSync', from)
      if (!store.has(source)) throw miss(source)
      store.set(norm(to), store.get(source))
      store.delete(source)
    },
    rmSync(p) {
      store.delete(track('rmSync', p))
    },
  }

  api.files = store
  api.accessed = accessed
  return api
}

export function fakeFetch() {
  const calls = []
  const fn = (url, init) => {
    calls.push({ url, init })
    return Promise.reject(new Error('fakeFetch: no network'))
  }
  fn.calls = calls
  return fn
}

export const fakeClock = createFakeClock

export function createFakeContext({ files, env, platform, exec, now } = {}) {
  const clock = createFakeClock(now === undefined ? {} : { start: now })
  const fs = fakeFs(files || {})
  let seed = 20261107
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }

  return {
    exec: fakeExec(exec),
    fs,
    fetch: fakeFetch(),
    env: env || {},
    platform: platform || 'linux',
    stdout: fakeStream(),
    stderr: fakeStream(),
    random,
    clock,
    now: () => clock.now(),
  }
}
