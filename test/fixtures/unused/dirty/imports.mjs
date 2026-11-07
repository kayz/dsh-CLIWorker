import fs from 'node:fs'
import { readFileSync, existsSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import * as os from 'node:os'

// join is mentioned here, and the string below names os and fs, but neither is a reference.
const note = 'os.platform() and fs.readFileSync() are only text here'

export function probe() {
  return existsSync(note)
}
