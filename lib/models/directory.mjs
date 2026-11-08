// Shared model-directory helpers for `models enumerate` and `models add`.
//
// The directory is the normalized model/v1 records already persisted in the v2 configuration
// (`catalog.manual`) combined with the existing catalog fields (allow, levels, aliases,
// deprecated) by lib/catalog.mjs. Nothing here invents an upstream catalog or a provider model
// table: reads only project the configured records and writes only append one explicit record.
import { listModels, managementView } from '../catalog.mjs'
import { lockFilePath, withLock } from '../lock.mjs'
import { codedError } from '../output.mjs'
import { atomicWriteJson } from '../store.mjs'

const LEVELS = ['Top', 'High', 'Middle', 'Quick']
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const LEVEL_FLAG = '--level'
const PROVIDER_FLAG = '--provider'
const ID_FLAG = '--id'

function fail(code, message) {
  throw codedError(code, message)
}

/**
 * Parses the arguments of a models subcommand. `argv` is the full process-style array, so its
 * first two entries are the command and subcommand. `--config` is accepted and skipped because
 * lib/cli.mjs already loaded it; only the operation-specific options are returned.
 */
export function parseModelOptions(argv, { flags = [], valued = [] } = {}) {
  const foundFlags = new Set()
  const values = {}
  const positionals = []
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--config') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value === '' || value.startsWith('-')) {
        fail('E_REQUEST_INVALID', 'invalid model command arguments')
      }
      i += 1
      continue
    }
    if (flags.includes(token)) {
      foundFlags.add(token)
      continue
    }
    if (valued.includes(token)) {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value === '' || value.startsWith('-')) {
        fail('E_REQUEST_INVALID', `missing value for ${token}`)
      }
      values[token] = value
      i += 1
      continue
    }
    if (typeof token === 'string' && token.startsWith('-')) {
      fail('E_REQUEST_INVALID', `unknown option: ${token}`)
    }
    positionals.push(token)
  }
  if (positionals.length > 0) fail('E_REQUEST_INVALID', 'invalid model command arguments')
  return { flags: foundFlags, values }
}

/** The four canonical levels, matched case-insensitively. */
export function normalizeLevel(value) {
  const match = typeof value === 'string'
    ? LEVELS.find((level) => level.toLowerCase() === value.trim().toLowerCase())
    : undefined
  if (!match) fail('E_LEVEL_UNKNOWN', `unknown model level: ${String(value)}`)
  return match
}

function requireName(value, flag) {
  if (typeof value !== 'string' || value === '' || value !== value.trim() || !NAME_RE.test(value)) {
    fail('E_REQUEST_INVALID', `${flag} requires a non-empty model identifier`)
  }
  return value
}

function knownProviders(config) {
  const overrides = config && config.discovery ? config.discovery.cli_overrides : undefined
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return {}
  return overrides
}

function modelConfig(config) {
  if (!config || typeof config !== 'object') fail('E_CONFIG', 'invalid model catalog configuration')
  if (!config.catalog || typeof config.catalog !== 'object' || Array.isArray(config.catalog)) {
    fail('E_CONFIG', 'invalid model catalog configuration')
  }
  if (!Array.isArray(config.catalog.manual)) fail('E_CONFIG', 'invalid model catalog configuration')
  return config
}

/** The configured directory in the shared `cliworker.models/v1` shape, sorted by key. */
export function configuredModels(config, { ctx, full = false } = {}) {
  const source = modelConfig(config)
  const rows = managementView(listModels(source, { models: [], ctx }))
  return full ? rows : rows.filter((row) => row.deprecated !== true)
}

function integerOption(values, name, fallback) {
  const text = values[`--${name}`]
  if (text === undefined) return fallback
  if (!/^[0-9]+$/.test(text)) fail('E_REQUEST_INVALID', `--${name} requires a non-negative integer`)
  const value = Number(text)
  if (!Number.isSafeInteger(value)) fail('E_REQUEST_INVALID', `--${name} requires a safe integer`)
  return value
}

function priceOption(values, name, fallback) {
  const text = values[`--${name}`]
  if (text === undefined) return fallback
  if (!/^[0-9]+(\.[0-9]+)?$/.test(text)) fail('E_REQUEST_INVALID', `--${name} requires a non-negative number`)
  const value = Number(text)
  if (!Number.isFinite(value)) fail('E_REQUEST_INVALID', `--${name} requires a finite number`)
  return value
}

function buildRecord({ values, flags }, { ctx, config }) {
  const provider = requireName(values[PROVIDER_FLAG], PROVIDER_FLAG)
  const id = requireName(values[ID_FLAG], ID_FLAG)
  const providers = knownProviders(config)
  if (!Object.hasOwn(providers, provider)) fail('E_REQUEST_INVALID', `unknown model provider: ${provider}`)
  const level = values[LEVEL_FLAG] === undefined ? null : normalizeLevel(values[LEVEL_FLAG])
  const overrides = providers[provider]
  const cli = overrides && typeof overrides.cli === 'string' && overrides.cli !== '' ? overrides.cli : provider
  const vendor = values['--vendor'] === undefined ? provider : requireName(values['--vendor'], '--vendor')
  const at = ctx.clock.nowIso()
  const key = `${provider}:${id}`
  return {
    schema: 'cliworker.model/v1',
    key,
    id,
    cli,
    provider,
    vendor,
    aliases: [],
    allowed: false,
    level,
    level_source: level === null ? null : { kind: 'config', ref: `${config._file || ''}#catalog.levels.${key}`, at },
    availability: { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null },
    identity: 'unverified',
    capabilities: {
      context_tokens: integerOption(values, 'context-tokens', 0),
      readonly: flags.has('--readonly'),
      stdin: flags.has('--stdin'),
    },
    prices: {
      input_per_mtok: priceOption(values, 'input-price', 0),
      output_per_mtok: priceOption(values, 'output-price', 0),
      source: 'manual',
    },
    source: { kind: 'manual', ref: `${config._file || ''}#catalog.manual.${key}`, at },
    deprecated: false,
  }
}

/**
 * Appends one explicit model/v1 record to `catalog.manual`. The configuration is re-read under
 * the existing state lock, the prospective document is validated with the same directory code
 * path, and only then is it written atomically. A duplicate key is an explicit error so a
 * repeated add never silently rewrites an existing record.
 */
export async function addModel(input, { ctx, config }) {
  const source = modelConfig(config)
  const record = buildRecord(input, { ctx, config: source })
  return withLock(ctx, lockFilePath(source._home), async () => {
    let raw
    try {
      raw = JSON.parse(ctx.fs.readFileSync(source._file, 'utf8'))
    } catch {
      fail('E_CONFIG', 'cannot read model catalog configuration')
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schema !== 'cliworker.config/v2') {
      fail('E_CONFIG', 'model catalog requires a cliworker.config/v2 configuration')
    }
    if (!raw.catalog || typeof raw.catalog !== 'object' || Array.isArray(raw.catalog) || !Array.isArray(raw.catalog.manual)) {
      fail('E_CONFIG', 'invalid model catalog configuration')
    }
    const existing = raw.catalog.manual.find(
      (entry) => entry && (entry.key === record.key || (entry.provider === record.provider && entry.id === record.id))
    )
    if (existing) fail('E_CONFIG_EXISTS', `model already exists: ${record.key}`)

    const prospective = structuredClone(raw)
    prospective.catalog.manual.push(record)
    if (record.level !== null) {
      if (!prospective.catalog.levels || typeof prospective.catalog.levels !== 'object' || Array.isArray(prospective.catalog.levels)) {
        prospective.catalog.levels = {}
      }
      prospective.catalog.levels[record.key] = record.level
    }

    // Validate the complete prospective document before touching the file. The wrapper only
    // supplies the non-enumerable metadata listModels needs; it is never serialized.
    const directory = managementView(listModels(
      { ...prospective, _file: source._file, _home: source._home },
      { models: [], ctx }
    ))

    try {
      await atomicWriteJson(ctx, source._file, prospective)
    } catch {
      fail('E_CONFIG', 'cannot write model catalog configuration')
    }
    return { schema: 'cliworker.models/v1', models: directory }
  }, { policy: source.policy })
}
