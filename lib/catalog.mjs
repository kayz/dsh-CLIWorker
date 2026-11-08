import { codedError } from './output.mjs'

const levels = ['Top', 'High', 'Middle', 'Quick']
const fail = () => { throw codedError('E_CONFIG', 'invalid catalog configuration or model record') }
const levelOf = value => typeof value === 'string' ? levels.find(x => x.toLowerCase() === value.trim().toLowerCase()) : undefined
const validTime = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value))

function validate(model) {
  if (!model || model.schema !== 'cliworker.model/v1' || !['key', 'id', 'cli', 'provider', 'vendor'].every(k => typeof model[k] === 'string') || !Array.isArray(model.aliases) || !model.aliases.every(x => typeof x === 'string') || typeof model.deprecated !== 'boolean') fail()
  const c = model.capabilities, p = model.prices, a = model.availability, s = model.source
  if (!c || !Number.isSafeInteger(c.context_tokens) || c.context_tokens < 0 || typeof c.readonly !== 'boolean' || typeof c.stdin !== 'boolean' || !p || !['input_per_mtok', 'output_per_mtok'].every(k => typeof p[k] === 'number' && Number.isFinite(p[k]) && p[k] >= 0) || typeof p.source !== 'string' || !a || !['unverified', 'callable', 'blocked', 'unavailable', 'deprecated'].includes(a.state) || !s || !['subcommand', 'help', 'cache', 'api', 'manual'].includes(s.kind) || typeof s.ref !== 'string' || !validTime(s.at)) fail()
}

/** Merge already-normalized records; this function never reads a CLI or cache. */
export function listModels(config, { models, ctx } = {}) {
  if (!Array.isArray(models)) fail()
  const catalog = config?.catalog
  if (!catalog || !Array.isArray(catalog.manual) || !Array.isArray(catalog.allow)) fail()
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
    if (configured !== undefined) {
      let at
      try { const stat = ctx.fs.statSync(config._file); at = new Date(stat.mtimeMs).toISOString() } catch { at = ctx?.clock?.nowIso() }
      if (!validTime(at)) fail()
      selected = { level: levelOf(configured), source: { kind: 'config', ref: `${config._file || ''}#catalog.levels.${key}`, at } }
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
