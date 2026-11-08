import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createExec } from '../../lib/exec.mjs'

test('exec forwards synchronous input without changing argv', () => {
  let observed
  const exec = createExec({ spawnSync: (file, args, options) => {
    observed = { file, args, options }
    return { status: 0, stdout: '', stderr: '' }
  } })
  assert.equal(exec.runSync('tool', ['argument'], { input: 'input value' }).ok, true)
  assert.deepEqual(observed.args, ['argument'])
  assert.equal(observed.options.input, 'input value')
  assert.equal(observed.options.shell, false)
})

test('exec sends empty asynchronous input and handles stdin errors', async () => {
  let stdin
  let options
  const clock = { setTimeout: () => 1, clearTimeout: () => {} }
  const exec = createExec({ clock, spawn: (file, args, opts) => {
    options = opts
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    stdin = child.stdin = new EventEmitter()
    stdin.end = value => { assert.equal(value, ''); queueMicrotask(() => stdin.emit('error', new Error('EPIPE'))) }
    return child
  } })
  const result = await exec.runAsync('tool', [], { input: '' })
  assert.equal(options.stdio[0], 'pipe')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'stdin write failed')
})
