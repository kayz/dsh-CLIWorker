import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SCHEMA = 'cliworker.config/v1'

export function defaultHome() {
  return process.env.CLIWORKER_HOME || path.join(os.homedir(), '.cliworker')
}

export function loadConfig({ file } = {}) {
  const root = path.resolve(file || process.env.CLIWORKER_CONFIG || path.join(defaultHome(), 'config.json'))
  let raw
  try { raw = JSON.parse(fs.readFileSync(root, 'utf8')) } catch (e) {
    const error = new Error(`cannot read CLIWorker config ${root}: ${e.message}`)
    error.code = 'E_CONFIG'
    throw error
  }
  if (!raw || raw.schema && raw.schema !== SCHEMA) throw new Error(`unsupported CLIWorker config schema: ${raw.schema}`)
  if (!raw.providers || typeof raw.providers !== 'object') throw new Error('providers is required')
  if (!raw.models || typeof raw.models !== 'object') throw new Error('models is required')
  return { ...raw, _file: root, _home: path.join(path.dirname(root), 'state') }
}

export function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); return dir }

export function readUsage(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
  } catch { return [] }
}

export function appendUsage(file, row) {
  ensureDir(path.dirname(file))
  fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf8')
}
