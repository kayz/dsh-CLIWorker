// In-memory ctx.fs for unit tests: exactly the nine methods of the context contract, plus call
// recording and injectable failures (with a chosen error code).

import path from 'node:path'

const MUTATING = new Set(['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'rmSync'])

function codedFailure(code, method) {
  const error = new Error(`${code}: injected ${method} failure`)
  error.code = code
  return error
}

function missing(target) {
  const error = new Error(`ENOENT: no such file or directory, open '${target}'`)
  error.code = 'ENOENT'
  return error
}

export function createMemFs({ clock, files = {} } = {}) {
  const entries = new Map()
  const dirs = new Set()
  const calls = []
  const failures = new Map()

  const nowMs = () => (clock && typeof clock.now === 'function' ? clock.now() : 0)
  const norm = (target) => path.resolve(String(target))

  for (const [key, value] of Object.entries(files || {})) {
    entries.set(norm(key), { text: String(value), mtimeMs: nowMs() })
  }

  const touch = (method) => {
    calls.push(method)
    const plan = failures.get(method)
    if (!plan) return
    if (plan.remaining !== Infinity) {
      plan.remaining -= 1
      if (plan.remaining <= 0) failures.delete(method)
    }
    throw codedFailure(plan.code, method)
  }

  const put = (target, text) => {
    entries.set(target, { text, mtimeMs: nowMs() })
  }

  const api = {
    readFileSync(target, encoding) {
      const file = norm(target)
      touch('readFileSync')
      const entry = entries.get(file)
      if (!entry) throw missing(file)
      return encoding ? entry.text : Buffer.from(entry.text, 'utf8')
    },
    writeFileSync(target, data, options) {
      const file = norm(target)
      touch('writeFileSync')
      const opts = typeof options === 'string' ? { flag: undefined } : options || {}
      if (opts.flag === 'wx' && entries.has(file)) {
        const error = new Error(`EEXIST: file already exists, open '${file}'`)
        error.code = 'EEXIST'
        throw error
      }
      put(file, String(data))
    },
    appendFileSync(target, data) {
      const file = norm(target)
      touch('appendFileSync')
      const entry = entries.get(file)
      put(file, (entry ? entry.text : '') + String(data))
    },
    mkdirSync(target) {
      const dir = norm(target)
      touch('mkdirSync')
      dirs.add(dir)
      let parent = path.dirname(dir)
      while (parent !== dir) {
        dirs.add(parent)
        const next = path.dirname(parent)
        if (next === parent) break
        parent = next
      }
    },
    existsSync(target) {
      const file = norm(target)
      touch('existsSync')
      return entries.has(file) || dirs.has(file)
    },
    statSync(target) {
      const file = norm(target)
      touch('statSync')
      const entry = entries.get(file)
      if (entry) {
        return { isFile: () => true, isDirectory: () => false, size: entry.text.length, mtimeMs: entry.mtimeMs }
      }
      if (dirs.has(file)) return { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: nowMs() }
      throw missing(file)
    },
    readdirSync(target) {
      const dir = norm(target)
      touch('readdirSync')
      const names = []
      for (const key of entries.keys()) {
        if (path.dirname(key) !== dir) continue
        const name = path.basename(key)
        if (!names.includes(name)) names.push(name)
      }
      if (names.length === 0 && !dirs.has(dir)) throw missing(dir)
      return names
    },
    renameSync(from, to) {
      const source = norm(from)
      const destination = norm(to)
      touch('renameSync')
      const entry = entries.get(source)
      if (!entry) throw missing(source)
      entries.delete(source)
      entries.set(destination, entry)
    },
    rmSync(target, options) {
      const file = norm(target)
      touch('rmSync')
      const opts = options || {}
      if (entries.delete(file)) return
      if (dirs.delete(file)) return
      if (opts.force !== true) throw missing(file)
    },
  }

  api.calls = calls
  api.mutatingCalls = () => calls.filter((method) => MUTATING.has(method))
  api.text = (target) => {
    const entry = entries.get(norm(target))
    return entry ? entry.text : null
  }
  api.setFile = (target, text) => {
    put(norm(target), String(text))
  }
  api.exists = (target) => entries.has(norm(target)) || dirs.has(norm(target))
  api.names = (dir) => api.readdirSync(dir)
  api.failNext = (method, code, times = 1) => {
    failures.set(method, { code, remaining: times })
  }
  api.failAlways = (method, code) => {
    failures.set(method, { code, remaining: Infinity })
  }
  api.clearFailures = () => failures.clear()
  api.resetCalls = () => {
    calls.length = 0
  }

  return api
}
