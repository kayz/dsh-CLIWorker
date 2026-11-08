import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { resolvePaths, bundledExamplePath } from './paths.mjs'
import { migrateConfig } from './config-migrate.mjs'

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

// The legacy selector accepts one quota per provider. Preserve only values that
// can be represented without inventing or combining balances.
function legacyQuotas(pools) {
  const grouped = new Map()
  for (const pool of pools) {
    const list = grouped.get(pool.cli) || []
    list.push(pool)
    grouped.set(pool.cli, list)
  }
  return Object.fromEntries([...grouped].map(([cli, list]) => {
    if (list.length !== 1) return [cli, {}]
    const pool = list[0]
    if ((pool.kind === 'plan_window' || pool.kind === 'plan_weekly') && pool.used_fraction)
      return [cli, { remaining_pct: (1 - pool.used_fraction.value) * 100 }]
    const values = Object.values(pool.capacity_mtok).map(entry => entry.value)
    if (pool.kind === 'credits' && pool.used_fraction && values.length && values.every(value => value === values[0]))
      return [cli, { remaining: values[0] * (1 - pool.used_fraction.value) * 1e6, unit: 'tokens' }]
    return [cli, {}]
  }))
}

export function loadConfig({ file, ctx } = {}) {
  if (!ctx || !ctx.fs) throw new TypeError('loadConfig requires ctx.fs')

  const { config } = resolvePaths({ configPath: file, env: ctx.env, platform: ctx.platform })

  let raw
  try {
    raw = JSON.parse(ctx.fs.readFileSync(config, 'utf8'))
  } catch (e) {
    throw configError(config, 'cannot read or parse the file')
  }

  if (!isPlainObject(raw)) throw configError(config, 'root must be a JSON object')

  const example = readBundledExample(ctx)
  if (raw._example === true || (isPlainObject(example) && isDeepStrictEqual(withoutExample(raw), withoutExample(example)))) {
    const error = new Error(`cannot load CLIWorker config ${config}: this is the bundled example; copy it and edit it`)
    error.code = 'E_CONFIG_EXAMPLE'
    throw error
  }

  const v1 = raw.schema === undefined || raw.schema === SCHEMA
  if (!v1 && raw.schema !== 'cliworker.config/v2') throw configError(config, 'unsupported schema')
  if (v1 && !isPlainObject(raw.providers)) throw configError(config, 'providers is required')
  if (v1 && !isPlainObject(raw.models)) throw configError(config, 'models is required')
  if (!v1 && (!isPlainObject(raw.discovery) || !isPlainObject(raw.catalog) || !Array.isArray(raw.catalog.manual) || !Array.isArray(raw.pools) || !isPlainObject(raw.policy) || !isPlainObject(raw.secrets))) throw configError(config, 'invalid v2 structure')
  const checkSecrets = (value) => {
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret|credential)$/i.test(key) && item != null && !(isPlainObject(item) && typeof item.ref === 'string' && /^[a-z]+:.+/.test(item.ref))) {
        const error = new Error('inline secret in configuration')
        error.code = 'E_CONFIG_SECRET_INLINE'
        throw error
      }
      checkSecrets(item)
    }
  }
  checkSecrets(raw)
  if (raw.state_dir !== undefined && (typeof raw.state_dir !== 'string' || raw.state_dir === '')) {
    throw configError(config, 'state_dir must be a non-empty string')
  }

  const { state_dir } = resolvePaths({
    configPath: file,
    env: ctx.env,
    platform: ctx.platform,
    stateDir: raw.state_dir,
  })

  const result = v1 ? migrateConfig(raw, { stateDir: state_dir, file: config, ctx }) : structuredClone(raw)
  Object.defineProperties(result, {
    _file: { value: config }, _home: { value: state_dir },
    warnings: { value: v1 ? [{ code: 'W_CONFIG_V1' }] : [] },
    models: { value: Object.fromEntries(result.catalog.manual.map(({ key, level_source, ...model }) => [key, model])) },
    providers: { value: result.discovery.cli_overrides },
    quotas: { value: legacyQuotas(result.pools) },
  })
  return result
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
