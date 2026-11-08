import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createExec } from '../../lib/exec.mjs'
import { fakeClock } from '../helpers/ctx.mjs'

const FIXTURES = fileURLToPath(new URL('../fixtures/exec/', import.meta.url))

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Real-time poll used only as a safety limit; the assertions never depend on wall clock values. */
async function waitFor(probe, limitMs) {
  const deadline = Date.now() + limitMs
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() >= deadline) return null
    await pause(25)
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

test('[AC-028] a timed out child and its grandchild are both killed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-exec-tree-'))
  const clock = fakeClock()
  const exec = createExec({ clock })
  try {
    const barrier = path.join(dir, 'pids.json')
    const pending = exec.runAsync(process.execPath, [path.join(FIXTURES, 'spawn-grandchild.mjs'), dir], {
      timeout: 60_000,
    })
    const pids = await waitFor(() => {
      if (!fs.existsSync(barrier)) return null
      try {
        return JSON.parse(fs.readFileSync(barrier, 'utf8'))
      } catch {
        return null
      }
    }, 10_000)
    assert.ok(pids && typeof pids.child === 'number' && typeof pids.grandchild === 'number', 'the barrier file appeared')

    await clock.advance(60_000)
    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(result.code, null)
    assert.equal(result.error_code, 'E_TIMEOUT')
    assert.equal(result.error, 'E_TIMEOUT: timed out after 60000ms')
    assert.equal(clock.pending(), 0)

    const childGone = await waitFor(() => !isAlive(pids.child), 5_000)
    assert.equal(childGone, true, `child ${pids.child} is still alive`)
    const grandchildGone = await waitFor(() => !isAlive(pids.grandchild), 5_000)
    assert.equal(grandchildGone, true, `grandchild ${pids.grandchild} is still alive`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-028] ten tasks run with at most four at a time', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-exec-slots-'))
  const clock = fakeClock()
  const exec = createExec({ maxConcurrent: 4, clock })
  try {
    const script = path.join(FIXTURES, 'slot-task.mjs')
    const tasks = Array.from({ length: 10 }, (_, index) =>
      exec.runAsync(process.execPath, [script, dir, String(index)], { timeout: 30_000 })
    )
    const results = await Promise.all(tasks)
    for (const result of results) assert.equal(result.ok, true, result.error)

    const observed = fs.readFileSync(path.join(dir, 'observed.log'), 'utf8').trim().split('\n').map(Number)
    assert.equal(observed.length, 10)
    const peak = Math.max(...observed)
    assert.ok(peak <= 4, `observed ${peak} concurrent tasks`)
    assert.equal(clock.pending(), 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
