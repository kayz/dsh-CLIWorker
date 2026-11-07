import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { resolvePaths, bundledExamplePath } from './paths.mjs'

export const SCHEMA = 'cliworker.config/v1'

export function defaultHome(env = process.env) {
  return resolvePaths({ env }).home
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function configError(file, reason) {
  const error = new Error(`cannot load CLIWorker config ${file}: ${reason}`)
  error.code = 'E_CONFIG'
  return error
}

function withoutExample(value) {
  const copy = { ...value }
  delete copy._example
  return copy
}

function readBundledExample(ctx) {
  try {
    return JSON.parse(ctx.fs.readFileSync(bundledExamplePath(), 'utf8'))
  } catch {
    return null
  }
}

export function loadConfig({ file, ctx } = {}) {
  if (!ctx || !ctx.fs) throw new TypeError('loadConfig requires ctx.fs')

  const { config } = resolvePaths({ configPath: file, env: ctx.env, platform: ctx.platform })

  let raw
  try {
    raw = JSON.parse(ctx.fs.readFileSync(config, 'utf8'))
  } catch (e) {
    throw configError(config, e && e.message ? e.message : 'cannot read the file')
  }

  if (!isPlainObject(raw)) throw configError(config, 'root must be a JSON object')

  const example = readBundledExample(ctx)
  if (raw._example === true || (isPlainObject(example) && isDeepStrictEqual(withoutExample(raw), withoutExample(example)))) {
    const error = new Error(`cannot load CLIWorker config ${config}: this is the bundled example; copy it and edit it`)
    error.code = 'E_CONFIG_EXAMPLE'
    throw error
  }

  if (raw.schema !== undefined && raw.schema !== SCHEMA) throw configError(config, `unsupported schema ${String(raw.schema)}`)
  if (!isPlainObject(raw.providers)) throw configError(config, 'providers is required')
  if (!isPlainObject(raw.models)) throw configError(config, 'models is required')
  if (raw.state_dir !== undefined && (typeof raw.state_dir !== 'string' || raw.state_dir === '')) {
    throw configError(config, 'state_dir must be a non-empty string')
  }

  const { state_dir } = resolvePaths({
    configPath: file,
    env: ctx.env,
    platform: ctx.platform,
    stateDir: raw.state_dir,
  })

  return { ...raw, _file: config, _home: state_dir }
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
