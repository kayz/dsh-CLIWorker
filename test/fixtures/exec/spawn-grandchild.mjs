// Spawns a grandchild, records both pids, then stays alive. Argument 1 is the directory that
// receives the `pids.json` barrier file.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const dir = process.argv[2]
const sleeper = fileURLToPath(new URL('./sleep-forever.mjs', import.meta.url))
const grandchild = spawn(process.execPath, [sleeper], { stdio: 'ignore' })
const payload = JSON.stringify({ child: process.pid, grandchild: grandchild.pid })
const temporary = path.join(dir, `pids-${process.pid}.tmp`)
fs.writeFileSync(temporary, payload)
fs.renameSync(temporary, path.join(dir, 'pids.json'))
setInterval(() => {}, 1000)
