// Child process entry: appends <count> rows to <file> through appendJsonl. Arguments:
// <file> <workerId> <count>.

import { createContext } from '../../../lib/context.mjs'
import { appendJsonl } from '../../../lib/store.mjs'

const [file, workerId, countText] = process.argv.slice(2)
const count = Number(countText)
const ctx = createContext()

for (let i = 0; i < count; i += 1) {
  appendJsonl(ctx, file, { id: `${workerId}-${i}`, worker: workerId, i })
}
