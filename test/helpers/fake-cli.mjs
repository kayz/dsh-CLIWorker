// generateFakeCli({ dir, name, mode, help, version, models, modelsArgv, recordDir })
// creates an instance and returns its absolute executable path.
// readFakeCliRecords(recordDir) returns completed parsed invocation records.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const runtime = fs.readFileSync(fileURLToPath(new URL('../fixtures/fake-cli/runtime.js', import.meta.url)), 'utf8')

export function generateFakeCli({ dir, name, mode, help, version, models, modelsArgv, recordDir }) {
  const directory = path.resolve(dir)
  const config = { mode, help, version, models, modelsArgv, recordDir: path.resolve(recordDir) }
  fs.mkdirSync(directory, { recursive: true })
  fs.mkdirSync(config.recordDir, { recursive: true })
  const script = path.join(directory, process.platform === 'win32' ? `${name}.mjs` : name)
  fs.writeFileSync(script, `#!/usr/bin/env node\nconst config = ${JSON.stringify(config)}\n${runtime}`, { encoding: 'utf8', mode: 0o755 })
  fs.chmodSync(script, 0o755)
  if (process.platform !== 'win32') return script
  const shim = path.join(directory, `${name}.cmd`)
  fs.writeFileSync(shim, `@echo off\r\nnode "%~dp0${name}.mjs" %*\r\n`, 'utf8')
  return shim
}

export function readFakeCliRecords(recordDir) {
  try {
    return fs.readdirSync(recordDir).filter((name) => name.endsWith('.json')).sort().map((name) => JSON.parse(fs.readFileSync(path.join(recordDir, name), 'utf8')))
  } catch {
    throw new Error('Unable to read fake-cli records')
  }
}
