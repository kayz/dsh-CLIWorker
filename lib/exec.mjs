// Safe process execution layer.
//
// Every spawn goes through shell: false. On win32 a batch shim (npm/pnpm/bun `.cmd`) is never
// handed to cmd.exe unless nothing else works: the shim text is parsed and node is invoked
// directly, which keeps the argument vector intact. The async path owns its timeout through an
// injected clock, kills the whole process tree and enforces a concurrency limit.
//
// `node:path` is imported for the win32-only path helpers; it is not a seam (no I/O, no clock).
import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from 'node:child_process'
import path from 'node:path'

export const DEFAULT_TIMEOUT_MS = 20_000
export const DEFAULT_MAX_CONCURRENT = 4
// Arguments that may travel through the cmd.exe fallback: non-empty and free of metacharacters.
export const SAFE_ARG_RE = /^[A-Za-z0-9_@+=:,./\\-]+$/

const MAX_STREAM_CHARS = 4 * 1024 * 1024
const EXECUTABLE_EXTENSIONS = ['.exe', '.com', '.cmd', '.bat']
// A file path used as the first token of the cmd.exe string must not contain any of these.
const UNSAFE_PATH_RE = /["&|<>^%!;\r\n\u0060]/
const SHIM_SCRIPT_RE =
  /^\s*@?\s*(?:.*&\s*)?(?:"%_prog%"|"%~dp0\\?node\.exe"|"%dp0%\\?node\.exe"|node(?:\.exe)?)\s+"([^"]+\.(?:c|m)?js)"\s+%\*\s*$/i

function asText(value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

function normalizeArgs(args) {
  if (!Array.isArray(args)) return []
  return args.map((value) => (typeof value === 'string' ? value : String(value)))
}

function normalizeTimeout(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS
}

function clampStream(value) {
  const text = asText(value)
  return text.length > MAX_STREAM_CHARS ? text.slice(0, MAX_STREAM_CHARS) : text
}

function isBatchPath(file) {
  const ext = path.win32.extname(file).toLowerCase()
  return ext === '.cmd' || ext === '.bat'
}

function hasPathPart(command) {
  return command.includes('/') || command.includes('\\') || /^[A-Za-z]:/.test(command)
}

function executableNames(command) {
  if (path.win32.extname(command) !== '') return [command]
  const names = [command]
  for (const ext of EXECUTABLE_EXTENSIONS) names.push(`${command}${ext}`)
  return names
}

function firstExisting(fsApi, candidates) {
  for (const candidate of candidates) {
    try {
      if (fsApi.existsSync(candidate)) return candidate
    } catch {
      // an unreadable candidate counts as missing
    }
  }
  return null
}

function pathDirectories(env) {
  const raw = env && typeof env === 'object' ? env.Path || env.PATH || env.path : undefined
  if (typeof raw !== 'string') return []
  const dirs = []
  for (const item of raw.split(';')) {
    const trimmed = item.trim().replace(/^"(.*)"$/, '$1')
    if (trimmed !== '') dirs.push(trimmed)
  }
  return dirs
}

function resolveExecutable(command, deps) {
  const fsApi = deps.fs
  if (!fsApi || typeof fsApi.existsSync !== 'function') return command
  const names = executableNames(command)
  if (hasPathPart(command)) return firstExisting(fsApi, names) ?? command
  for (const dir of pathDirectories(deps.env)) {
    const found = firstExisting(fsApi, names.map((name) => path.win32.join(dir, name)))
    if (found !== null) return found
  }
  return command
}

function resolveComSpec(env) {
  const raw = env && typeof env.ComSpec === 'string' ? env.ComSpec : ''
  return path.win32.isAbsolute(raw) ? raw : 'cmd.exe'
}

/** Every argument must match SAFE_ARG_RE; returns the first offending index. */
export function checkCmdArgs(args) {
  const list = normalizeArgs(args)
  for (let index = 0; index < list.length; index += 1) {
    if (!SAFE_ARG_RE.test(list[index])) return { ok: false, index }
  }
  return { ok: true }
}

/**
 * Reads a `.cmd`/`.bat` shim and returns `{node, script}` when it is a node launcher whose script
 * exists. Anything unexpected (extra arguments after `%*`, leftover `%`, missing script) is null:
 * a failed parse must never fall through to shell execution.
 */
export function resolveShim(shimPath, deps = {}) {
  const fsApi = deps ? deps.fs : null
  if (typeof shimPath !== 'string' || shimPath === '') return null
  if (!fsApi || typeof fsApi.readFileSync !== 'function' || typeof fsApi.existsSync !== 'function') return null
  let text
  try {
    text = asText(fsApi.readFileSync(shimPath, 'utf8'))
  } catch {
    return null
  }

  const dir = path.win32.dirname(shimPath)
  const prefix = dir.endsWith('\\') ? dir : `${dir}\\`
  for (const line of text.split(/\r?\n/)) {
    const match = SHIM_SCRIPT_RE.exec(line)
    if (!match) continue
    const script = path.win32.normalize(match[1].replace(/%~dp0/gi, prefix).replace(/%dp0%/gi, prefix))
    if (script.includes('%') || script.includes('"')) return null
    try {
      if (!fsApi.existsSync(script)) return null
    } catch {
      return null
    }
    const localNode = path.win32.join(dir, 'node.exe')
    let localExists = false
    try {
      localExists = fsApi.existsSync(localNode)
    } catch {
      localExists = false
    }
    return { node: localExists ? localNode : deps.nodePath, script }
  }
  return null
}

function unsafeResult(index) {
  return {
    ok: false,
    code: null,
    stdout: '',
    stderr: '',
    error: `E_UNSAFE_ARG: unsafe argument at index ${index}`,
    error_code: 'E_UNSAFE_ARG',
  }
}

function failureResult(error) {
  return { ok: false, code: null, stdout: '', stderr: '', error: describeError(error), error_code: null }
}

function describeError(error) {
  if (!error) return null
  if (typeof error.message === 'string') return error.message
  return String(error)
}

function isWslList(command, args) {
  return /^(?:wsl|wsl\.exe)$/i.test(path.win32.basename(command)) &&
    Array.isArray(args) && args.length === 2 && args[0] === '-l' && args[1] === '-q'
}

function decodeWslList(value) {
  return Buffer.isBuffer(value) ? value.toString('utf16le').replace(/^\uFEFF/, '') : asText(value).replace(/^\uFEFF/, '')
}

function resultFromSync(r, wslList = false) {
  const code = r && typeof r.status === 'number' ? r.status : null
  const error = r && r.error ? describeError(r.error) : null
  return {
    ok: code === 0 && error === null,
    code,
    stdout: clampStream(wslList ? decodeWslList(r && r.stdout) : r && r.stdout),
    stderr: clampStream(r && r.stderr),
    error,
    error_code: r && r.error && r.error.code === 'ETIMEDOUT' ? 'E_TIMEOUT' : null,
  }
}

/**
 * Turns one command line into the ordered spawn attempts allowed by the design: direct, then the
 * shim's node+script, then the cmd.exe fallback. When no safe attempt exists the result carries the
 * offending argument index instead.
 */
function buildAttempts(command, args, deps) {
  const list = normalizeArgs(args)
  if (deps.platform !== 'win32') return { attempts: [{ file: command, args: list, verbatim: false }], unsafe: null }

  const file = resolveExecutable(command, deps)
  if (!isBatchPath(file)) return { attempts: [{ file, args: list, verbatim: false }], unsafe: null }

  const safe = checkCmdArgs(list)
  const attempts = []
  if (safe.ok) attempts.push({ file, args: list, verbatim: false })

  const shim = resolveShim(file, { fs: deps.fs, nodePath: deps.nodePath })
  if (shim !== null) {
    attempts.push({ file: shim.node, args: [shim.script, ...list], verbatim: false })
    return { attempts, unsafe: null }
  }

  if (safe.ok && !UNSAFE_PATH_RE.test(file)) {
    attempts.push({
      file: resolveComSpec(deps.env),
      args: ['/d', '/s', '/c', `""${file}" ${list.join(' ')}"`],
      verbatim: true,
    })
    return { attempts, unsafe: null }
  }

  return { attempts, unsafe: { index: safe.ok ? 'command' : safe.index } }
}

/**
 * Builds a sync/async executor pair. Every dependency is optional and exists so tests can inject a
 * fake process layer, file system and clock; `clock` is required only by `runAsync`.
 */
export function createExec(deps = {}) {
  const o = deps && typeof deps === 'object' ? deps : {}
  const spawnImpl = typeof o.spawn === 'function' ? o.spawn : nodeSpawn
  const spawnSyncImpl = typeof o.spawnSync === 'function' ? o.spawnSync : nodeSpawnSync
  const platform = typeof o.platform === 'string' && o.platform !== '' ? o.platform : process.platform
  const env = o.env && typeof o.env === 'object' ? o.env : process.env
  const fsApi = o.fs && typeof o.fs.existsSync === 'function' ? o.fs : null
  const nodePath = typeof o.nodePath === 'string' && o.nodePath !== '' ? o.nodePath : process.execPath
  const killImpl = typeof o.kill === 'function' ? o.kill : process.kill
  const clock =
    o.clock && typeof o.clock.setTimeout === 'function' && typeof o.clock.clearTimeout === 'function' ? o.clock : null
  const maxConcurrent = o.maxConcurrent === undefined ? DEFAULT_MAX_CONCURRENT : o.maxConcurrent
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError(`maxConcurrent must be a positive integer, got ${String(maxConcurrent)}`)
  }

  const baseDeps = { spawn: spawnImpl, spawnSync: spawnSyncImpl, platform, env, fs: fsApi, nodePath, kill: killImpl }

  // `lookup` lets a caller that still holds the old single-function ctx.exec supply fs/env/platform
  // per call without changing the module-level `run` signature.
  function withLookup(options) {
    const merged = { ...baseDeps }
    const lookup = options && typeof options.lookup === 'object' && options.lookup !== null ? options.lookup : null
    if (lookup !== null) {
      if (lookup.fs !== undefined) merged.fs = lookup.fs
      if (lookup.env !== undefined) merged.env = lookup.env
      if (lookup.platform !== undefined) merged.platform = lookup.platform
    }
    return merged
  }

  let active = 0
  const waiting = []

  function acquire() {
    if (active < maxConcurrent) {
      active += 1
      return Promise.resolve()
    }
    return new Promise((grant) => {
      waiting.push(grant)
    })
  }

  function release() {
    active -= 1
    const grant = waiting.shift()
    if (grant !== undefined) {
      active += 1
      grant()
    }
  }

  /**
   * Synchronous execution. Timeout is spawnSync's own (SIGTERM to the direct child); it cannot kill
   * a whole tree and it does not go through ctx.clock. Availability probes are short commands, so
   * this limitation is accepted here; the tree-kill guarantee lives in `runAsync`.
   */
  function runSync(command, args = [], opts = {}) {
    const options = opts && typeof opts === 'object' ? opts : {}
    const callDeps = withLookup(options)
    let plan
    try {
      plan = buildAttempts(command, args, callDeps)
    } catch (error) {
      return failureResult(error)
    }
    if (plan.unsafe !== null) return unsafeResult(plan.unsafe.index)

    const spawnOptions = {
      encoding: isWslList(command, args) ? null : 'utf8',
      timeout: normalizeTimeout(options.timeout),
      windowsHide: true,
      shell: false,
      maxBuffer: MAX_STREAM_CHARS,
    }
    if (options.cwd !== undefined) spawnOptions.cwd = options.cwd
    if (options.env !== undefined) spawnOptions.env = options.env
    if (options.input !== undefined) spawnOptions.input = options.input

    let failure = null
    for (const attempt of plan.attempts) {
      const attemptOptions = attempt.verbatim
        ? { ...spawnOptions, windowsVerbatimArguments: true }
        : { ...spawnOptions }
      let result
      try {
        result = spawnSyncImpl(attempt.file, attempt.args, attemptOptions)
      } catch (error) {
        failure = failureResult(error)
        continue
      }
      if (result && result.error && result.error.code === 'EINVAL') {
        // Node >= 20.12 refuses to spawn .cmd/.bat without a shell; try the next attempt.
        failure = resultFromSync(result)
        continue
      }
      return resultFromSync(result, isWslList(command, args))
    }
    return failure ?? failureResult(null)
  }

  /** Asynchronous execution; the returned promise never rejects. */
  function runAsync(command, args = [], opts = {}) {
    if (clock === null) throw new TypeError('createExec requires clock for runAsync')
    const options = opts && typeof opts === 'object' ? opts : {}
    const callDeps = withLookup(options)
    const timeout = normalizeTimeout(options.timeout)
    const wslList = isWslList(command, args)

    let plan
    try {
      plan = buildAttempts(command, args, callDeps)
    } catch (error) {
      return Promise.resolve(failureResult(error))
    }
    if (plan.unsafe !== null) return Promise.resolve(unsafeResult(plan.unsafe.index))

    return acquire().then(
      () =>
        new Promise((resolve) => {
          let settled = false
          let timer = null
          let timedOut = false
          let currentChild = null
          let lastError = null
          let outSize = 0
          let errSize = 0
          const outParts = []
          const errParts = []

          const settle = (value) => {
            if (settled) return
            settled = true
            if (timer !== null) {
              const handle = timer
              timer = null
              clock.clearTimeout(handle)
            }
            release()
            resolve(value)
          }

          const result = (code, error, errorCode) => ({
            ok: code === 0 && error === null,
            code,
            stdout: wslList ? decodeWslList(Buffer.concat(outParts)) : outParts.join(''),
            stderr: errParts.join(''),
            error,
            error_code: errorCode,
          })

          const pushOut = (chunk) => {
            if (outSize >= MAX_STREAM_CHARS) return
            if (wslList) {
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
              const slice = bytes.subarray(0, MAX_STREAM_CHARS - outSize)
              outParts.push(slice)
              outSize += slice.length
              return
            }
            const text = asText(chunk)
            if (text === '') return
            const room = MAX_STREAM_CHARS - outSize
            const slice = text.length > room ? text.slice(0, room) : text
            outParts.push(slice)
            outSize += slice.length
          }

          const pushErr = (chunk) => {
            if (errSize >= MAX_STREAM_CHARS) return
            const text = asText(chunk)
            if (text === '') return
            const room = MAX_STREAM_CHARS - errSize
            const slice = text.length > room ? text.slice(0, room) : text
            errParts.push(slice)
            errSize += slice.length
          }

          const destroyStreams = () => {
            if (currentChild === null) return
            for (const stream of [currentChild.stdout, currentChild.stderr]) {
              if (stream && typeof stream.destroy === 'function') stream.destroy()
            }
          }

          const timeoutResult = () => result(null, `E_TIMEOUT: timed out after ${timeout}ms`, 'E_TIMEOUT')

          const waitForExit = () => {
            destroyStreams()
            const gone =
              currentChild === null ||
              typeof currentChild.exitCode === 'number' ||
              (currentChild.signalCode !== null && currentChild.signalCode !== undefined)
            if (gone || typeof currentChild.once !== 'function') {
              settle(timeoutResult())
              return
            }
            currentChild.once('exit', () => settle(timeoutResult()))
          }

          const killWindowsTree = (pid) => {
            let killer = null
            try {
              killer = spawnImpl('taskkill', ['/PID', String(pid), '/T', '/F'], {
                shell: false,
                windowsHide: true,
                stdio: 'ignore',
              })
            } catch {
              killer = null
            }
            if (!killer || typeof killer.on !== 'function') {
              try {
                currentChild.kill()
              } catch {
                // the child may already be gone
              }
              waitForExit()
              return
            }
            let done = false
            const finish = () => {
              if (done) return
              done = true
              waitForExit()
            }
            killer.on('error', () => {
              try {
                currentChild.kill()
              } catch {
                // ignore
              }
              finish()
            })
            killer.on('close', finish)
          }

          const onTimeout = () => {
            timedOut = true
            timer = null
            if (currentChild === null || typeof currentChild.pid !== 'number') {
              settle(timeoutResult())
              return
            }
            if (callDeps.platform === 'win32') {
              killWindowsTree(currentChild.pid)
              return
            }
            try {
              killImpl(-currentChild.pid, 'SIGKILL')
            } catch (error) {
              if (error && error.code === 'ESRCH') {
                settle(timeoutResult())
                return
              }
              try {
                currentChild.kill('SIGKILL')
              } catch {
                // ignore
              }
            }
            waitForExit()
          }

          const attach = (child) => {
            if (child.stdout && typeof child.stdout.on === 'function') child.stdout.on('data', pushOut)
            if (child.stderr && typeof child.stderr.on === 'function') child.stderr.on('data', pushErr)
            if (typeof child.on !== 'function') return
            child.on('error', (error) => settle(failureResult(error)))
            child.on('close', (code) => {
              if (timedOut) return
              settle(result(typeof code === 'number' ? code : null, null, null))
            })
          }

          let index = 0
          const launch = () => {
            while (index < plan.attempts.length) {
              const attempt = plan.attempts[index]
              index += 1
              const spawnOptions = { shell: false, windowsHide: true, stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] }
              if (options.cwd !== undefined) spawnOptions.cwd = options.cwd
              if (options.env !== undefined) spawnOptions.env = options.env
              if (attempt.verbatim) spawnOptions.windowsVerbatimArguments = true
              // A detached child leads its own process group, so a timeout can kill the whole tree.
              if (callDeps.platform !== 'win32') spawnOptions.detached = true
              let child
              try {
                child = spawnImpl(attempt.file, attempt.args, spawnOptions)
              } catch (error) {
                lastError = error
                continue
              }
              currentChild = child
              attach(child)
              if (settled) return
              if (options.input !== undefined) {
                try {
                  child.stdin.on('error', () => settle(failureResult(new Error('stdin write failed'))))
                  child.stdin.end(options.input)
                } catch {
                  settle(failureResult(new Error('stdin write failed')))
                }
              }
              if (settled) return
              timer = clock.setTimeout(onTimeout, timeout)
              return
            }
            settle(failureResult(lastError))
          }

          try {
            launch()
          } catch (error) {
            settle(failureResult(error))
          }
        })
    )
  }

  return { runSync, runAsync }
}

const defaultExec = createExec({})

/** Backwards-compatible synchronous entry point used as the default `ctx.exec`. */
export function run(command, args = [], opts = {}) {
  return defaultExec.runSync(command, args, opts)
}
