import os from 'node:os'
import path from 'node:path'

export const SCHEMA = 'cliworker.config/v1'

export function defaultHome(env = process.env) {
  return env.CLIWORKER_HOME || path.join(os.homedir(), '.cliworker')
}

export function loadConfig({ file, ctx } = {}) {
  if (!ctx || !ctx.fs) throw new TypeError('loadConfig requires ctx.fs')
  const root = path.resolve(file || ctx.env.CLIWORKER_CONFIG || path.join(defaultHome(ctx.env), 'config.json'))
  let raw
  try { raw = JSON.parse(ctx.fs.readFileSync(root, 'utf8')) } catch (e) {
    const error = new Error(`cannot read CLIWorker config ${root}: ${e.message}`)
    error.code = 'E_CONFIG'
    throw error
  }
  if (!raw || raw.schema && raw.schema !== SCHEMA) throw new Error(`unsupported CLIWorker config schema: ${raw.schema}`)
  if (!raw.providers || typeof raw.providers !== 'object') throw new Error('providers is required')
  if (!raw.models || typeof raw.models !== 'object') throw new Error('models is required')
  return { ...raw, _file: root, _home: defaultHome(ctx.env) }
}

export function ensureDir(dir, ctx) { ctx.fs.mkdirSync(dir, { recursive: true }); return dir }

export function readUsage(file, ctx) {
  try {
    return ctx.fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
  } catch { return [] }
}

export function appendUsage(file, row, ctx) {
  ensureDir(path.dirname(file), ctx)
  ctx.fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf8')
}
