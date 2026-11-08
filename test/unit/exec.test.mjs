import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_TIMEOUT_MS,
  SAFE_ARG_RE,
  checkCmdArgs,
  createExec,
  resolveShim,
  run,
} from '../../lib/exec.mjs'
import { fakeClock, fakeFs } from '../helpers/ctx.mjs'

const SHIMS = fileURLToPath(new URL('../fixtures/exec/shims/', import.meta.url))
const HOSTILE = ['&', '|', ';', '^', '%', '!', ' ', '"', '\n', '`']
const BIN = path.win32.normalize('C:/tools/bin')
const NODE_PATH = path.win32.normalize('C:/node/node.exe')
const COMSPEC = path.win32.normalize('C:/Windows/System32/cmd.exe')

function win(name) {
  return path.win32.join(BIN, name)
}

function shimText(name) {
  return fs.readFileSync(path.join(SHIMS, `${name}.cmd.txt`), 'utf8')
}

/** A fake file system holding the four shim samples plus the scripts they point at. */
function shimFs() {
  return fakeFs({
    [win('npm-v6.cmd')]: shimText('npm-v6'),
    [win('npm-v7.cmd')]: shimText('npm-v7'),
    [win('pnpm.cmd')]: shimText('pnpm'),
    [win('bun.cmd')]: shimText('bun'),
    [win('plain-batch.cmd')]: shimText('plain-batch'),
    [path.win32.join(BIN, 'node_modules', 'foo', 'bin', 'foo.js')]: '// fixture\n',
    [path.win32.normalize('C:/tools/foo/bin/foo.js')]: '// fixture\n',
  })
}

function recordSync(handler) {
  const calls = []
  const fn = (file, args, options) => {
    calls.push({ file, args, options })
    return handler ? handler(file, args, options) : { status: 0, stdout: '', stderr: '', error: null }
  }
  return { fn, calls }
}

function stream() {
  const handlers = []
  return {
    destroyed: false,
    on(event, handler) {
      if (event === 'data') handlers.push(handler)
      return this
    },
    push(chunk) {
      for (const handler of handlers) handler(chunk)
    },
    destroy() {
      this.destroyed = true
    },
  }
}

let nextPid = 9000

/** Minimal stand-in for a ChildProcess: exit/close are driven by the test. */
function child(pid = (nextPid += 1)) {
  const events = new Map()
  const node = {
    pid,
    exitCode: null,
    signalCode: null,
    stdout: stream(),
    stderr: stream(),
    killed: false,
    on(event, handler) {
      const list = events.get(event) ?? []
      list.push(handler)
      events.set(event, list)
      return node
    },
    once(event, handler) {
      return node.on(event, handler)
    },
    emit(event, ...args) {
      for (const handler of events.get(event) ?? []) handler(...args)
      return node
    },
    kill() {
      node.killed = true
      node.exit(0)
    },
    exit(code = 0) {
      if (node.exitCode !== null || node.signalCode !== null) return
      node.exitCode = code
      node.emit('exit', code, null)
      node.emit('close', code, null)
    },
    signal(name = 'SIGKILL') {
      if (node.exitCode !== null || node.signalCode !== null) return
      node.signalCode = name
      node.emit('exit', null, name)
      node.emit('close', null, name)
    },
  }
  return node
}

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

test('[AC-026] the exported defaults and the cmd argument allowlist match the spec', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 20_000)
  assert.equal(DEFAULT_MAX_CONCURRENT, 4)
  assert.equal(SAFE_ARG_RE.test('--version'), true)
  assert.equal(checkCmdArgs(['a', 'b=c']).ok, true)
  assert.deepEqual(checkCmdArgs(['a', 'two words']), { ok: false, index: 1 })
  assert.deepEqual(checkCmdArgs(['']), { ok: false, index: 0 })
  for (const value of HOSTILE) assert.deepEqual(checkCmdArgs([value]), { ok: false, index: 0 }, value)
  assert.equal(typeof run, 'function')
  assert.equal(run('exec-fixture-missing-binary', ['--version']).ok, false)
})

test('[AC-026] the npm v6, npm v7+, pnpm and bun shims resolve to node plus script', () => {
  const store = shimFs()
  const expected = {
    'npm-v6': path.win32.join(BIN, 'node_modules', 'foo', 'bin', 'foo.js'),
    'npm-v7': path.win32.join(BIN, 'node_modules', 'foo', 'bin', 'foo.js'),
    pnpm: path.win32.normalize('C:/tools/foo/bin/foo.js'),
    bun: path.win32.normalize('C:/tools/foo/bin/foo.js'),
  }
  for (const [name, script] of Object.entries(expected)) {
    assert.deepEqual(resolveShim(win(`${name}.cmd`), { fs: store, nodePath: NODE_PATH }), {
      node: NODE_PATH,
      script,
    })
  }
  assert.equal(resolveShim(win('plain-batch.cmd'), { fs: store, nodePath: NODE_PATH }), null)
  assert.equal(resolveShim(win('missing.cmd'), { fs: store, nodePath: NODE_PATH }), null)

  const withLocalNode = fakeFs({
    [win('npm-v6.cmd')]: shimText('npm-v6'),
    [path.win32.join(BIN, 'node.exe')]: 'node',
    [path.win32.join(BIN, 'node_modules', 'foo', 'bin', 'foo.js')]: '// fixture\n',
  })
  assert.equal(resolveShim(win('npm-v6.cmd'), { fs: withLocalNode, nodePath: NODE_PATH }).node, path.win32.join(BIN, 'node.exe'))
})

test('[AC-026] every runSync spawn passes shell: false on the direct, node and cmd.exe paths', () => {
  const store = shimFs()

  const direct = recordSync()
  createExec({ platform: 'linux', spawnSync: direct.fn }).runSync('tool', ['--version'])
  assert.equal(direct.calls.length, 1)
  assert.equal(direct.calls[0].file, 'tool')

  const exe = recordSync()
  store.writeFileSync(win('tool.exe'), '')
  createExec({ platform: 'win32', fs: store, env: {}, spawnSync: exe.fn }).runSync(win('tool.exe'), ['--version'])
  assert.equal(exe.calls.length, 1)
  assert.equal(exe.calls[0].file, win('tool.exe'))

  const shim = recordSync()
  createExec({ platform: 'win32', fs: store, env: {}, nodePath: NODE_PATH, spawnSync: shim.fn }).runSync(win('npm-v7.cmd'), ['a&b'])
  assert.equal(shim.calls.length, 1)
  assert.equal(shim.calls[0].file, NODE_PATH)

  const fallback = recordSync((file) => {
    if (file.toLowerCase().endsWith('.cmd')) {
      return { status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' }) }
    }
    return { status: 0, stdout: 'ok', stderr: '', error: null }
  })
  const result = createExec({
    platform: 'win32',
    fs: store,
    env: { ComSpec: COMSPEC },
    nodePath: NODE_PATH,
    spawnSync: fallback.fn,
  }).runSync(win('plain-batch.cmd'), ['--version'])
  assert.equal(result.ok, true)
  assert.equal(fallback.calls.length, 2)
  assert.equal(fallback.calls[1].file, COMSPEC)
  assert.deepEqual(fallback.calls[1].args, ['/d', '/s', '/c', `""${win('plain-batch.cmd')}" --version"`])
  assert.equal(fallback.calls[1].options.windowsVerbatimArguments, true)

  for (const call of [...direct.calls, ...exe.calls, ...shim.calls, ...fallback.calls]) {
    assert.equal(call.options.shell, false, `${call.file} ran with shell ${String(call.options.shell)}`)
  }
})

test('[AC-026] every runAsync spawn passes shell: false on the node and taskkill paths', async () => {
  const store = shimFs()
  const calls = []
  const kids = []
  const spawn = (file, args, options) => {
    calls.push({ file, args, options })
    const node = child()
    kids.push(node)
    return node
  }
  const clock = fakeClock()
  const exec = createExec({ platform: 'win32', fs: store, env: {}, nodePath: NODE_PATH, spawn, clock })

  const shimRun = exec.runAsync(win('npm-v7.cmd'), ['a&b'])
  await flush()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].file, NODE_PATH)
  kids[0].exit(0)
  assert.equal((await shimRun).ok, true)

  const timedOut = exec.runAsync('tool', [], { timeout: 1000 })
  await flush()
  await clock.advance(1000)
  assert.equal(calls.length, 3)
  assert.equal(path.win32.basename(String(calls[2].file)), 'taskkill')
  kids[1].exit(1)
  kids[2].emit('close', 0, null)
  assert.equal((await timedOut).error_code, 'E_TIMEOUT')

  for (const call of calls) assert.equal(call.options.shell, false, `${call.file} ran with shell`)
})

test('[AC-026] ten hostile arguments reach a directly executed program unchanged', () => {
  const linux = recordSync()
  createExec({ platform: 'linux', spawnSync: linux.fn }).runSync('tool', HOSTILE)
  assert.deepEqual(linux.calls[0].args, HOSTILE)

  const store = fakeFs({ [win('tool.exe')]: '' })
  const win32 = recordSync()
  createExec({ platform: 'win32', fs: store, env: {}, spawnSync: win32.fn }).runSync(win('tool.exe'), HOSTILE)
  assert.deepEqual(win32.calls[0].args, HOSTILE)
  assert.equal(win32.calls[0].file, win('tool.exe'))
})

test('[AC-026] ten hostile arguments return E_UNSAFE_ARG on the cmd fallback path', () => {
  const store = shimFs()
  for (const value of HOSTILE) {
    const calls = recordSync()
    const result = createExec({ platform: 'win32', fs: store, env: {}, spawnSync: calls.fn }).runSync(
      win('plain-batch.cmd'),
      [value]
    )
    assert.equal(result.ok, false)
    assert.equal(result.error_code, 'E_UNSAFE_ARG', JSON.stringify(value))
    assert.equal(result.code, null)
    assert.equal(calls.calls.length, 0, 'nothing may be spawned for an unsafe argument')
  }
})

test('[AC-026] a resolvable shim still receives the hostile arguments unchanged', () => {
  const store = shimFs()
  const calls = recordSync()
  const result = createExec({ platform: 'win32', fs: store, env: {}, nodePath: NODE_PATH, spawnSync: calls.fn }).runSync(
    win('npm-v7.cmd'),
    HOSTILE
  )
  assert.equal(result.ok, true)
  assert.equal(calls.calls.length, 1)
  assert.equal(calls.calls[0].file, NODE_PATH)
  assert.deepEqual(calls.calls[0].args, [path.win32.join(BIN, 'node_modules', 'foo', 'bin', 'foo.js'), ...HOSTILE])
})

test('[AC-026] an EINVAL batch spawn falls back to node plus script', async () => {
  const store = shimFs()
  const script = path.win32.join(BIN, 'node_modules', 'foo', 'bin', 'foo.js')

  const sync = recordSync((file) => {
    if (file === win('npm-v7.cmd')) {
      return { status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' }) }
    }
    return { status: 0, stdout: '[]', stderr: '', error: null }
  })
  const syncResult = createExec({
    platform: 'win32',
    fs: store,
    env: {},
    nodePath: NODE_PATH,
    spawnSync: sync.fn,
  }).runSync(win('npm-v7.cmd'), ['--version'])
  assert.equal(syncResult.ok, true)
  assert.equal(sync.calls.length, 2)
  assert.equal(sync.calls[1].file, NODE_PATH)
  assert.deepEqual(sync.calls[1].args, [script, '--version'])

  const spawned = []
  const main = child(5151)
  const spawn = (file, args) => {
    spawned.push({ file, args })
    if (file === win('npm-v7.cmd')) throw Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' })
    return main
  }
  const exec = createExec({ platform: 'win32', fs: store, env: {}, nodePath: NODE_PATH, spawn, clock: fakeClock() })
  const pending = exec.runAsync(win('npm-v7.cmd'), ['--version'])
  await flush()
  main.exit(0)
  const asyncResult = await pending
  assert.equal(asyncResult.ok, true)
  assert.equal(spawned.length, 2)
  assert.equal(spawned[1].file, NODE_PATH)
  assert.deepEqual(spawned[1].args, [script, '--version'])
})

test('[AC-026] the unsafe error names the index and never echoes the argument value', () => {
  const store = shimFs()
  const calls = recordSync()
  const result = createExec({ platform: 'win32', fs: store, env: {}, spawnSync: calls.fn }).runSync(
    win('plain-batch.cmd'),
    ['ok', 'secret;value']
  )
  assert.equal(result.error, 'E_UNSAFE_ARG: unsafe argument at index 1')
  assert.equal(JSON.stringify(result).includes('secret'), false)
  assert.equal(calls.calls.length, 0)

  const badPath = createExec({ platform: 'win32', fs: fakeFs(), env: {}, spawnSync: calls.fn }).runSync(
    'C:/tmp/bad&name.cmd',
    ['ok']
  )
  assert.equal(badPath.error, 'E_UNSAFE_ARG: unsafe argument at index command')
})

test('[AC-028] ten asynchronous tasks never run more than four at once', async () => {
  const clock = fakeClock()
  const children = []
  let peak = 0
  const spawn = () => {
    const node = child()
    children.push(node)
    const live = children.filter((item) => item.exitCode === null && item.signalCode === null).length
    peak = Math.max(peak, live)
    return node
  }
  const exec = createExec({ platform: 'linux', spawn, clock, maxConcurrent: 4 })
  const pending = Array.from({ length: 10 }, (_, index) => exec.runAsync('tool', [String(index)], { timeout: 1000 }))

  await flush()
  assert.equal(children.length, 4, 'the first four start immediately')
  assert.equal(clock.pending(), 4, 'a queued task must not register a timer')
  assert.equal(peak, 4)

  for (let index = 0; index < 10; index += 1) {
    children[index].exit(0)
    await flush()
  }

  const results = await Promise.all(pending)
  assert.equal(results.length, 10)
  for (const result of results) assert.equal(result.ok, true)
  assert.equal(peak, 4)
  assert.equal(children.length, 10)
  assert.equal(clock.pending(), 0)
})

test('[AC-028] the timeout timer goes through the injected clock and is cleared on success', async () => {
  const clock = fakeClock()
  const node = child(777)
  const exec = createExec({ platform: 'linux', spawn: () => node, clock })
  const pending = exec.runAsync('tool', [], { timeout: 1234 })

  await flush()
  assert.equal(clock.pending(), 1, 'exactly one timer is registered while the child runs')

  node.stdout.push('partial')
  node.exit(0)
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(result.stdout, 'partial')
  assert.equal(clock.pending(), 0, 'a normal finish clears the timer')
})

test('[AC-028] advancing the clock kills the win32 process tree with taskkill and reports E_TIMEOUT', async () => {
  const clock = fakeClock()
  const calls = []
  const main = child(4242)
  let killer = null
  const spawn = (file, args, options) => {
    calls.push({ file, args, options })
    if (String(file).toLowerCase().includes('taskkill')) {
      killer = child(4343)
      return killer
    }
    return main
  }
  const exec = createExec({ platform: 'win32', spawn, clock })
  const pending = exec.runAsync('tool', [], { timeout: 5000 })

  await flush()
  assert.equal(clock.pending(), 1)
  await clock.advance(5000)

  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1].args, ['/PID', '4242', '/T', '/F'])
  assert.equal(calls[1].options.shell, false)

  main.exit(1)
  killer.emit('close', 0, null)
  const result = await pending
  assert.equal(main.stdout.destroyed, true, 'the pipes are destroyed so close cannot hang')
  assert.equal(result.ok, false)
  assert.equal(result.code, null)
  assert.equal(result.error_code, 'E_TIMEOUT')
  assert.equal(result.error, 'E_TIMEOUT: timed out after 5000ms')
  assert.equal(clock.pending(), 0)
})

test('[AC-028] advancing the clock kills the POSIX process group and reports E_TIMEOUT', async () => {
  const clock = fakeClock()
  const calls = []
  const kills = []
  const main = child(4242)
  const spawn = (file, args, options) => {
    calls.push({ file, args, options })
    return main
  }
  const exec = createExec({ platform: 'linux', spawn, clock, kill: (pid, signal) => { kills.push({ pid, signal }) } })
  const pending = exec.runAsync('tool', [], { timeout: 5000 })

  await flush()
  await clock.advance(5000)

  assert.equal(calls[0].options.detached, true)
  assert.deepEqual(kills, [{ pid: -4242, signal: 'SIGKILL' }])

  main.signal('SIGKILL')
  const result = await pending
  assert.equal(result.error_code, 'E_TIMEOUT')
  assert.equal(result.code, null)
  assert.equal(clock.pending(), 0)
})

test('[AC-028] runAsync requires a clock and createExec rejects a bad concurrency limit', () => {
  assert.throws(() => createExec({}).runAsync('tool'), {
    name: 'TypeError',
    message: 'createExec requires clock for runAsync',
  })
  assert.throws(() => createExec({ maxConcurrent: 0 }), RangeError)
  assert.throws(() => createExec({ maxConcurrent: 2.5 }), RangeError)
})
