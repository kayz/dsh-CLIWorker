import { createHash } from 'node:crypto'
import path from 'node:path'

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]))
  }
  return value
}

export function configDigest(config) {
  let home = path.resolve(config._home)
  if (process.platform === 'win32') home = home.toLowerCase()
  return createHash('sha256').update(JSON.stringify([home, sortedJson(config)]), 'utf8').digest('hex')
}
