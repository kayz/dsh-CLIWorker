import fs from 'node:fs'

export function exists(file) {
  return fs.existsSync(file)
}
