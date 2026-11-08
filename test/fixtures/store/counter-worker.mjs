// Child process entry: increments a shared counter under the file lock. Arguments:
// <stateDir> <rounds>.

import path from 'node:path'
import { createContext } from '../../../lib/context.mjs'
import { atomicWriteJson, readJson } from '../../../lib/store.mjs'
import { lockFilePath, withLock } from '../../../lib/lock.mjs'

const [stateDir, roundsText] = process.argv.slice(2)
const rounds = Number(roundsText)
const ctx = createContext()
const file = path.join(stateDir, 'counter.json')
const lockPath = lockFilePath(stateDir)
const policy = { lock_wait_ms: 30000, lock_poll_ms: 10 }

for (let round = 0; round < rounds; round += 1) {
  await withLock(
    ctx,
    lockPath,
    async () => {
      const current = readJson(ctx, file, { n: 0 })
      await atomicWriteJson(ctx, file, { n: current.n + 1 })
    },
    { policy }
  )
}
