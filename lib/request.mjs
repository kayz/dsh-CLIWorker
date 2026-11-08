// ModelRequest v1 parsing for the CLI: flags, --request and --request-file all normalize to one
// request object, plus the field warnings and the CLI view gate. Pure except for the injected
// `ctx.fs` read of --request-file.

import { codedError } from './output.mjs'
import { VIEW_NAMES, resolveView } from './contract/views.mjs'

export const REQUEST_SCHEMA = 'cliworker.request/v1'

const LEVELS = ['Top', 'High', 'Middle', 'Quick']
const USAGES = ['Heavy', 'Normal', 'Light']
const IMPORTANCES = ['normal', 'high']

// Single-value flags and the request field each one writes. Flag values win over JSON values.
const FLAGS = [
  ['--level', 'level'],
  ['--count', 'count'],
  ['--usage', 'usage'],
  ['--importance', 'importance'],
  ['--request-id', 'request_id'],
  ['--cwd', 'cwd'],
]

const KNOWN_FIELDS = new Set([
  'schema',
  'request_id',
  'level',
  'count',
  'usage',
  'importance',
  'require_readonly',
  'cwd',
  'timeout_ms',
  'exclude_handles',
  'view',
  'compat',
  'exclude',
  'candidates',
  'require_verified',
])

// Typed optional fields, in the order they are copied into the normalized request. `timeout_ms`
// and `exclude_handles` are part of v1 but the draft selection does not consume them yet.
const OPTIONAL_FIELDS = [
  ['require_readonly', (value) => typeof value === 'boolean'],
  ['cwd', (value) => typeof value === 'string'],
  ['timeout_ms', (value) => typeof value === 'number' && Number.isInteger(value) && value > 0],
  ['exclude_handles', (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')],
  ['view', (value) => VIEW_NAMES.includes(value)],
  ['compat', (value) => value === 'draft'],
]

// Draft-era fields the selection still reads: known, kept as-is, never a warning.
const LEGACY_FIELDS = ['exclude', 'candidates', 'require_verified']

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(message) {
  return codedError('E_REQUEST_INVALID', message)
}

function normalizeLevel(raw) {
  let value = raw.level
  if (value === undefined || value === null || value === '') value = raw.tier
  if (value === undefined || value === null || value === '') {
    throw codedError('E_LEVEL_REQUIRED', 'request needs a level')
  }
  if (typeof value !== 'string') throw codedError('E_LEVEL_UNKNOWN', `unknown level: ${String(value)}`)
  const match = LEVELS.find((level) => level.toLowerCase() === value.toLowerCase())
  if (!match) throw codedError('E_LEVEL_UNKNOWN', `unknown level: ${value}`)
  return match
}

function normalizeCount(value) {
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10) {
    throw invalid('count must be an integer from 1 to 10')
  }
  return value
}

function normalizeUsage(value) {
  if (value === undefined) return 'Normal'
  if (typeof value !== 'string') throw invalid('usage must be Heavy, Normal or Light')
  const match = USAGES.find((usage) => usage.toLowerCase() === value.toLowerCase())
  if (!match) throw invalid(`unknown usage: ${value}`)
  return match
}

function normalizeImportance(value) {
  if (value === undefined) return 'normal'
  if (typeof value !== 'string' || !IMPORTANCES.includes(value)) {
    throw invalid('importance must be normal or high')
  }
  return value
}

function fieldWarnings(raw) {
  const warnings = []
  for (const key of Object.keys(raw)) {
    if (key === 'tier') warnings.push({ code: 'W_FIELD_DEPRECATED', field: 'tier' })
    else if (!KNOWN_FIELDS.has(key)) warnings.push({ code: 'W_FIELD_IGNORED', field: key })
  }
  return warnings
}

/** Normalize one request object. Throws a coded Error for anything the contract rejects. */
export function normalizeRequest(raw) {
  if (!isPlainObject(raw)) throw invalid('request must be a JSON object')
  if (raw.schema !== undefined && raw.schema !== REQUEST_SCHEMA) {
    throw codedError('E_SCHEMA_UNSUPPORTED', `unsupported request schema: ${String(raw.schema)}`)
  }

  const level = normalizeLevel(raw)
  const count = normalizeCount(raw.count)
  const usage = normalizeUsage(raw.usage)
  const importance = normalizeImportance(raw.importance)

  if (raw.request_id !== undefined && typeof raw.request_id !== 'string') {
    throw invalid('request_id must be a string')
  }
  for (const [field, accepts] of OPTIONAL_FIELDS) {
    if (raw[field] !== undefined && !accepts(raw[field])) throw invalid(`${field} has an invalid value`)
  }

  const request = {}
  if (raw.schema !== undefined) request.schema = REQUEST_SCHEMA
  if (raw.request_id !== undefined) request.request_id = raw.request_id
  request.level = level
  request.count = count
  request.usage = usage
  request.importance = importance
  for (const [field] of OPTIONAL_FIELDS) {
    if (raw[field] !== undefined) request[field] = raw[field]
  }
  for (const field of LEGACY_FIELDS) {
    if (raw[field] !== undefined) request[field] = raw[field]
  }

  return { request, warnings: fieldWarnings(raw) }
}

function flagValue(argv, flag) {
  const index = argv.indexOf(flag)
  const value = argv[index + 1]
  if (typeof value !== 'string') throw invalid(`${flag} needs a value`)
  return value
}

function parseBody(text, source) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw invalid(`cannot parse ${source}: ${e && e.message ? e.message : 'invalid JSON'}`)
  }
  if (!isPlainObject(parsed)) throw invalid(`${source} must be a JSON object`)
  return parsed
}

function readRequestFile(argv, ctx) {
  const file = flagValue(argv, '--request-file')
  let text
  try {
    text = ctx.fs.readFileSync(file, 'utf8')
  } catch (e) {
    throw invalid(`cannot read --request-file ${file}: ${e && e.message ? e.message : 'read failed'}`)
  }
  return parseBody(text, '--request-file')
}

function countValue(value) {
  return /^\d+$/.test(value) ? Number(value) : value
}

/** Build the normalized request from argv: --request, --request-file or the single-value flags. */
export function requestFromArgv(argv, ctx) {
  const args = Array.isArray(argv) ? argv : []
  const hasRequest = args.includes('--request')
  const hasFile = args.includes('--request-file')
  if (hasRequest && hasFile) throw invalid('use --request or --request-file, not both')

  let raw = {}
  if (hasRequest) raw = parseBody(flagValue(args, '--request'), '--request')
  else if (hasFile) raw = readRequestFile(args, ctx)

  for (const [flag, field] of FLAGS) {
    if (!args.includes(flag)) continue
    const value = flagValue(args, flag)
    raw[field] = field === 'count' ? countValue(value) : value
  }

  return normalizeRequest(raw)
}

/** Resolve the selection view for the CLI, refusing the views a plain CLI call may not ask for. */
export function gateView(request) {
  const resolved = resolveView({ transport: 'cli', request })
  if (resolved.error === 'E_VIEW_FORBIDDEN') {
    throw codedError('E_VIEW_FORBIDDEN', 'view full is not available from the CLI')
  }
  return { view: resolved.view, warnings: resolved.warnings.map((warning) => ({ ...warning })) }
}
