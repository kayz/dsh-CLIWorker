import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createContext } from '../../lib/context.mjs'
import { atomicWriteJson, readJson } from '../../lib/store.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const APPEND_WORKER = path.join(ROOT, 'test', 'fixtures', 'store', 'append-worker.mjs')
const COUNTER_WORKER = path.join(ROOT, 'test', 'fixtures', 'store', 'counter-worker.mjs')

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-store-'))
}

function runWorker(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => resolve({ code: null, stderr: `${stderr}${String(error && error.message)}` }))
    child.on('close', (code) => resolve({ code, stderr }))
  })
}

test('[AC-029] append-20x50: twenty processes append fifty rows each without losing one', async () => {
  const dir = tempDir()
  const file = path.join(dir, 'events.jsonl')
  const workers = 20
  const perWorker = 50

  try {
    const runs = []
    for (let worker = 0; worker < workers; worker += 1) {
      runs.push(runWorker(APPEND_WORKER, [file, `w${worker}`, String(perWorker)]))
    }
    const results = await Promise.all(runs)
    for (const result of results) assert.equal(result.code, 0, `worker failed: ${result.stderr}`)

    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
    assert.equal(lines.length, workers * perWorker)

    const rows = lines.map((line) => JSON.parse(line))
    const ids = new Set(rows.map((row) => row.id))
    assert.equal(ids.size, workers * perWorker)

    for (let worker = 0; worker < workers; worker += 1) {
      const mine = rows.filter((row) => row.worker === `w${worker}`)
      assert.equal(mine.length, perWorker)
      assert.deepEqual(
        mine.map((row) => row.i),
        Array.from({ length: perWorker }, (unused, index) => index)
      )
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-029] lock-counter: five processes increment one counter under the lock', async () => {
  const dir = tempDir()
  const file = path.join(dir, 'counter.json')
  const ctx = createContext()

  try {
    await atomicWriteJson(ctx, file, { n: 0 })

    const runs = []
    for (let worker = 0; worker < 5; worker += 1) runs.push(runWorker(COUNTER_WORKER, [dir, '10']))
    const results = await Promise.all(runs)
    for (const result of results) assert.equal(result.code, 0, `worker failed: ${result.stderr}`)

    assert.equal(readJson(ctx, file, { n: null }).n, 50)

    const leftovers = fs.readdirSync(dir).filter((name) => /\.lock$|\.stale-|\.tmp$/.test(name))
    assert.deepEqual(leftovers, [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
