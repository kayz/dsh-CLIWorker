// One concurrency slot. Argument 1 is the directory, argument 2 the task id.
// The `running-<id>` marker is created with the exclusive `wx` flag, the number of live markers is
// appended to observed.log, and the marker is removed after a short hold.
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
const id = process.argv[3]
const marker = path.join(dir, `running-${id}`)

fs.writeFileSync(marker, '', { flag: 'wx' })
const live = fs.readdirSync(dir).filter((name) => name.startsWith('running-')).length
fs.appendFileSync(path.join(dir, 'observed.log'), `${live}\n`)
await new Promise((resolve) => setTimeout(resolve, 150))
fs.rmSync(marker, { force: true })
