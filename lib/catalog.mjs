import { codedError } from './output.mjs'
import { loadConfig } from './config.mjs'
import { withLock, lockFilePath } from './lock.mjs'
import { atomicWriteJson } from './store.mjs'

const levels = ['Top', 'High', 'Middle', 'Quick']
const fail = () => { throw codedError('E_CONFIG', 'invalid catalog configuration or model record') }
const levelOf = value => typeof value === 'string' ? levels.find(x => x.toLowerCase() === value.trim().toLowerCase()) : undefined
const validTime = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value))

function validate(model) {
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
  const evidence = value => exact(value, ['kind', 'ref', 'at']) && typeof value.ref === 'string' && validTime(value.at)
  if (!exact(model, ['schema', 'key', 'id', 'cli', 'provider', 'vendor', 'aliases', 'allowed', 'level', 'level_source', 'availability', 'identity', 'capabilities', 'prices', 'source', 'deprecated']) || model.schema !== 'cliworker.model/v1' || !['key', 'id', 'cli', 'provider', 'vendor'].every(k => typeof model[k] === 'string') || !Array.isArray(model.aliases) || !model.aliases.every(x => typeof x === 'string') || typeof model.allowed !== 'boolean' || typeof model.deprecated !== 'boolean' || !['verified', 'unverified', 'mismatch'].includes(model.identity)) fail()
  if (!(model.level === null || levels.includes(model.level)) || !(model.level_source === null || (evidence(model.level_source) && ['config', 'measured', 'cli'].includes(model.level_source.kind)))) fail()
  const c = model.capabilities, p = model.prices, a = model.availability, s = model.source
  if (!exact(c, ['context_tokens', 'readonly', 'stdin']) || !Number.isSafeInteger(c.context_tokens) || c.context_tokens < 0 || typeof c.readonly !== 'boolean' || typeof c.stdin !== 'boolean' || !exact(p, ['input_per_mtok', 'output_per_mtok', 'source']) || !['input_per_mtok', 'output_per_mtok'].every(k => typeof p[k] === 'number' && Number.isFinite(p[k]) && p[k] >= 0) || typeof p.source !== 'string' || !exact(a, ['state', 'reason', 'at', 'ttl_s', 'evidence']) || !['unverified', 'callable', 'blocked', 'unavailable', 'deprecated'].includes(a.state) || !(a.reason === null || typeof a.reason === 'string') || !(a.at === null || typeof a.at === 'string') || !(a.ttl_s === null || Number.isInteger(a.ttl_s)) || !(a.evidence === null || (typeof a.evidence === 'object' && !Array.isArray(a.evidence))) || !evidence(s) || !['subcommand', 'help', 'cache', 'api', 'manual'].includes(s.kind)) fail()
}

/** Merge already-normalized records; this function never reads a CLI or cache. */
export function listModels(config, { models, ctx } = {}) {
  if (!Array.isArray(models)) fail()
  const catalog = config?.catalog
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (!isObject(catalog) || !Array.isArray(catalog.manual) || !Array.isArray(catalog.allow) || !catalog.allow.every(value => typeof value === 'string') || !isObject(catalog.levels) || !isObject(catalog.aliases) || !isObject(catalog.deprecated) || !Object.values(catalog.deprecated).every(value => typeof value === 'boolean')) fail()
  const groups = new Map()
  for (const input of [...models, ...catalog.manual]) {
    validate(input)
    const group = groups.get(input.key) || []
    group.push(structuredClone(input))
    groups.set(input.key, group)
  }
  const keys = new Set(groups.keys()), aliases = new Map()
  function addAlias(alias, key) {
    if (typeof alias !== 'string' || !alias.trim() || alias === key || keys.has(alias) || !keys.has(key) || (aliases.has(alias) && aliases.get(alias) !== key)) fail()
    aliases.set(alias, key)
  }
  for (const [key, group] of groups) for (const row of group) for (const alias of row.aliases) addAlias(alias, key)
  for (const [alias, key] of Object.entries(catalog.aliases || {})) addAlias(alias, key)
  const allowed = new Set(catalog.allow.map(key => keys.has(key) ? key : aliases.get(key)).filter(Boolean))
  for (const value of Object.values(catalog.levels || {})) if (!levelOf(value)) fail()
  const result = []
  for (const [key, group] of groups) {
    const row = structuredClone(group[group.length - 1])
    row.aliases = [...aliases].filter(([, target]) => target === key).map(([alias]) => alias).sort()
    row.allowed = allowed.has(key)
    let selected = null
    const configured = catalog.levels?.[key]
    if (Object.hasOwn(catalog.levels || {}, key)) {
      const matching = group.find(x => x.level_source?.kind === 'config' && levelOf(x.level) === levelOf(configured))
      let source = matching?.level_source
      if (!source) {
        let at
        if (config._file && ctx?.fs?.statSync) {
          try { at = new Date(ctx.fs.statSync(config._file).mtimeMs).toISOString() } catch { fail() }
        } else at = ctx?.clock?.nowIso()
        if (!validTime(at)) fail()
        source = { kind: 'config', ref: `${config._file || ''}#catalog.levels.${key}`, at }
      }
      selected = { level: levelOf(configured), source }
    } else {
      for (const kind of ['measured', 'cli']) {
        const candidates = group.filter(x => x.level != null && x.level_source?.kind === kind).map(x => {
          if (!levelOf(x.level) || typeof x.level_source.ref !== 'string' || !validTime(x.level_source.at)) fail()
          return { level: levelOf(x.level), source: x.level_source }
        }).sort((a, b) => Date.parse(b.source.at) - Date.parse(a.source.at))
        if (candidates.length) {
          if (candidates.some(x => Date.parse(x.source.at) === Date.parse(candidates[0].source.at) && x.level !== candidates[0].level)) fail()
          selected = candidates[0]; break
        }
      }
    }
    row.level = selected?.level ?? null
    row.level_source = selected ? structuredClone(selected.source) : null
    row.deprecated = group.some(x => x.deprecated) || catalog.deprecated?.[key] === true
    if (row.deprecated) { row.availability.state = 'deprecated'; row.availability.reason = 'deprecated' }
    result.push(row)
  }
  return result.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

export function resolveModel(models, key) {
  return models.find(model => model.key === key || model.aliases.includes(key)) || null
}

export function filterAllowed(models) { return models.filter(model => model.allowed === true) }

export function selectModels(models) {
  const selected = [], rejected = []
  for (const model of filterAllowed(models)) {
    const reason = model.deprecated ? 'deprecated' : model.level == null ? 'level_unassigned' : null
    if (reason) rejected.push({ key: model.key, reason })
    else selected.push(model)
  }
  return { models: selected, rejected }
}

// T-017 has not yet supplied a public cache reader. Failing here avoids treating an
// unavailable source as a complete empty catalog or modifying the wrong model.
export function readCatalogModels() {
  throw codedError('E_CONFIG', 'model catalog source is not available')
}

export function managementView(models) {
  return models.map(model => {
    const copy = structuredClone(model)
    if (!copy.allowed) copy.availability.reason = 'not_allowed'
    return copy
  })
}

export function modelCommandArgs(argv, operation) {
  const args = argv.slice(2), positional = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--config') {
      if (++i >= args.length || !args[i] || args[i].startsWith('-')) throw codedError('E_REQUEST_INVALID', 'invalid model command arguments')
    } else if (arg === '--all' && operation === 'list') {
      continue
    } else if (arg.startsWith('-')) throw codedError('E_REQUEST_INVALID', 'invalid model command arguments')
    else positional.push(arg)
  }
  if (operation === 'level' && positional.length === 1) throw codedError('E_LEVEL_REQUIRED', 'model level is required')
  const count = operation === 'list' ? 0 : ['level', 'alias'].includes(operation) ? 2 : 1
  if (positional.length !== count || positional.some(value => !value.trim())) throw codedError('E_REQUEST_INVALID', 'invalid model command arguments')
  if (operation === 'level' && !levelOf(positional[1])) throw codedError('E_LEVEL_UNKNOWN', 'unknown model level')
  return positional
}

// The caller supplies normalized records obtained from the upstream reader. File I/O
// remains in this function and all decisions are repeated against the locked config.
export async function writeCatalog(operation, positional, { ctx, config, models }) {
  const invalid = () => { throw codedError('E_REQUEST_INVALID', 'invalid model command target') }
  return withLock(ctx, lockFilePath(config._home), async () => {
    let raw, current
    try {
      raw = JSON.parse(ctx.fs.readFileSync(config._file, 'utf8'))
      if (raw.schema !== 'cliworker.config/v2') fail()
      current = loadConfig({ file: config._file, ctx })
    } catch { fail() }
    const directory = listModels(current, { models, ctx })
    const catalog = raw.catalog
    const target = resolveModel(directory, operation === 'alias' ? positional[1] : positional[0])
    if (!target || (operation === 'alias' && target.key !== positional[1])) invalid()
    if (operation === 'allow' || operation === 'deny') {
      const normalized = [...new Set(catalog.allow.map(value => resolveModel(directory, value)?.key || value))]
      catalog.allow = operation === 'allow' ? [...new Set([...normalized, target.key])] : normalized.filter(key => key !== target.key)
    } else if (operation === 'level') {
      catalog.levels[target.key] = levelOf(positional[1])
    } else if (operation === 'alias') {
      const alias = positional[0], existing = resolveModel(directory, alias)
      if (!alias.trim() || alias === target.key || (existing && existing.key !== target.key)) invalid()
      catalog.aliases[alias] = target.key
    } else invalid()
    try { await atomicWriteJson(ctx, config._file, raw) } catch { throw codedError('E_CONFIG', 'cannot write model catalog configuration') }
    return { ok: true }
  }, { policy: config.policy })
}
