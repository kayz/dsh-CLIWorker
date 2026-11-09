import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const N = 24
const ROUNDS = 5
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const WORKER = path.join(ROOT, 'test', 'fixtures', 'store', 'commit-worker.mjs')
const idsFor = (n) => Array.from({ length: n }, (unused, i) => `w${i}`)

function verifyEntries(entries, expectedIds) {
  assert.equal(entries.length, expectedIds.length)
  assert.deepEqual(entries.map((entry) => entry.id).sort(), [...expectedIds].sort())
}

async function runRound({ stateDir, barrierDir, n }) {
  const children = []
  const results = idsFor(n).map((id) => {
    const child = spawn(process.execPath, [WORKER, stateDir, id, barrierDir], { stdio: ['ignore', 'pipe', 'pipe'] })
    const result = { id, code: null, stdout: '', stderr: '' }
    children.push(child)
    child.stdout.on('data', (chunk) => { result.stdout += chunk })
    child.stderr.on('data', (chunk) => { result.stderr += chunk })
    result.done = new Promise((resolve) => {
      child.on('error', (error) => { result.stderr += String(error); resolve(result) })
      child.on('close', (code) => { result.code = code; resolve(result) })
    })
    return result
  })
  try {
    const deadline = Date.now() + 60000
    while (fs.readdirSync(barrierDir).filter((name) => name.startsWith('ready-')).length < n) {
      if (Date.now() >= deadline) throw new Error(`barrier timeout: ${results.map((r) => `${r.id}: ${r.stderr}`).join('\n')}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    fs.writeFileSync(path.join(barrierDir, 'go'), '')
    return await Promise.all(results.map((result) => result.done))
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill()
    await Promise.all(results.map((result) => result.done))
  }
}

function verifyLedger(stateDir, results, n) {
  for (const result of results) {
    assert.equal(result.code, 0, `${result.id} failed: ${result.stderr}`)
    assert.equal(result.stdout.trim(), `COMMITTED ${result.id}`, result.id)
  }
  const successes = results.filter((result) => result.code === 0).length
  assert.equal(successes, n)
  const { entries } = JSON.parse(fs.readFileSync(path.join(stateDir, 'ledger.json'), 'utf8'))
  assert.equal(entries.length, successes)
  verifyEntries(entries, idsFor(n))
  assert.deepEqual(fs.readdirSync(stateDir), ['ledger.json'])
}

async function rounds(stale) {
  for (let round = 0; round < ROUNDS; round += 1) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-xwrite-'))
    try {
      const stateDir = path.join(root, 'state')
      const barrierDir = path.join(root, 'barrier')
      fs.mkdirSync(stateDir)
      fs.mkdirSync(barrierDir)
      if (stale) {
        let pid = process.pid
        if (round % 2 === 1) {
          const exited = spawnSync(process.execPath, ['-e', ''])
          assert.equal(exited.status, 0)
          pid = exited.pid
        }
        fs.writeFileSync(path.join(stateDir, 'state.lock'), JSON.stringify({ pid, at: 1, token: 'planted' }))
      }
      try {
        verifyLedger(stateDir, await runRound({ stateDir, barrierDir, n: N }), N)
      } catch (error) {
        error.message = `round ${round + 1} (${stale ? 'stale lock' : 'clean'}): ${error.message}`
        throw error
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
}

test('[AC-083] xproc-commit-24x5 preserves every commit', { timeout: 180000 }, async () => {
  await rounds(false)
})

test('[AC-083] xproc-commit-stale-lock-24x5 preserves every commit', { timeout: 180000 }, async () => {
  await rounds(true)
})

test('[AC-083] xproc-verify-catches-loss and incorrect identities', { timeout: 180000 }, () => {
  const ids = idsFor(N)
  const entries = ids.map((id) => ({ id, pid: 1 }))
  assert.doesNotThrow(() => verifyEntries(entries, ids))
  const variants = [
    entries.slice(1),
    [entries[1], ...entries.slice(1)],
    [...entries, { id: 'unknown', pid: 1 }],
    [{ id: 'unknown', pid: 1 }, ...entries.slice(1)],
  ]
  for (const variant of variants) assert.throws(() => verifyEntries(variant, ids), assert.AssertionError)
})
