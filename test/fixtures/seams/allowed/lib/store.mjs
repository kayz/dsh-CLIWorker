import fs from 'node:fs'

export function read(file) {
  return fs.readFileSync(file, 'utf8')
}
