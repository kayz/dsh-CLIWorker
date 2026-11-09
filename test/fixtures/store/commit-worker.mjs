import fs from 'node:fs'
import path from 'node:path'
import { createContext } from '../../../lib/context.mjs'
import { withLock, lockFilePath } from '../../../lib/lock.mjs'
import { readJson, atomicWriteJson } from '../../../lib/store.mjs'

const [stateDir, workerId, barrierDir] = process.argv.slice(2)

async function main() {
  if (process.env.CROSS_PROCESS_SPAWN_LOG) {
    fs.appendFileSync(process.env.CROSS_PROCESS_SPAWN_LOG, `${stateDir}\t${workerId}\t${process.pid}\n`)
  }
  if (barrierDir) {
    fs.writeFileSync(path.join(barrierDir, `ready-${workerId}`), '')
    const deadline = Date.now() + 60000
    while (!fs.existsSync(path.join(barrierDir, 'go'))) {
      if (Date.now() >= deadline) {
        console.error('barrier timeout')
        process.exitCode = 3
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  const ctx = createContext()
  await withLock(ctx, lockFilePath(stateDir), async () => {
    const file = path.join(stateDir, 'ledger.json')
    const ledger = readJson(ctx, file, { entries: [] })
    if (process.env.CROSS_PROCESS_FAULT_DROP_ID !== workerId) {
      ledger.entries.push({ id: workerId, pid: process.pid })
      await atomicWriteJson(ctx, file, ledger)
    }
  }, { policy: { lock_wait_ms: 60000, lock_poll_ms: 10 } })
  console.log(`COMMITTED ${workerId}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
