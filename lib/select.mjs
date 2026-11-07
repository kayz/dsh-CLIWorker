import { normalizePrices, buildForecast } from './forecast.mjs'
import { billedTokens } from './pools.mjs'
import { systemNow } from './context.mjs'
import { SELECTION_SCHEMA, heavyRejection, draftHandle, draftSelection } from './select-draft.mjs'

export const SCHEMA = SELECTION_SCHEMA
export const LEVELS = ['Top', 'High', 'Middle', 'Quick']
export const USAGES = ['Heavy', 'Normal', 'Light']

function normLevel(v) {
  const s = String(v || '').trim().toLowerCase()
  return LEVELS.find((x) => x.toLowerCase() === s) || null
}
function normUsage(v) {
  const s = String(v || '').trim().toLowerCase()
  return USAGES.find((x) => x.toLowerCase() === s) || 'Normal'
}

function vendorOf(provider) {
  const p = String(provider || '').toLowerCase()
  if (p.includes('claude')) return 'anthropic'
  if (p.includes('codex') || p.includes('openai')) return 'openai'
  if (p.includes('codebuddy') || p.includes('tencent')) return 'tencent'
  if (p.includes('cursor') || p.includes('xai') || p.includes('grok')) return 'xai'
  if (p.includes('gemini') || p.includes('google')) return 'google'
  return p
}

function levelOf(m) {
  if (m.level && LEVELS.includes(m.level)) return m.level
  if (m.tier === 'top') return 'Top'
  if (m.tier === 'advanced') return 'High'
  if (m.tier === 'standard') return 'Middle'
  return 'Quick'
}

function cliCall(config, model, request) {
  const p = config.providers?.[model.provider] || {}
  const id = model.id
  const cwd = request.cwd || '<workspace>'
  if (model.provider === 'claude') {
    return { command: p.cli, args: ['-p', '--model', id, '--output-format', 'stream-json', '--verbose'], input: 'stdin', cwd }
  }
  if (model.provider === 'codex') {
    return { command: p.cli, args: ['exec', '--model', id, '-s', 'read-only', '--skip-git-repo-check', '--json'], input: 'stdin', cwd }
  }
  if (model.provider === 'codebuddy') {
    return { command: p.cli, args: ['-p', '--model', id, '--output-format', 'stream-json', '--verbose'], input: 'stdin', cwd }
  }
  if (model.provider === 'cursor-wsl') {
    return { command: p.cli, args: ['-e', 'bash', '-lc', `cd '${cwd}' && agent -p --force --model '${id}'`], input: 'stdin', cwd }
  }
  if (model.provider === 'gemini') {
    return { command: p.cli, args: ['-m', id, '-p'], input: 'stdin', cwd }
  }
  return { command: p.cli || null, args: [], input: 'stdin', cwd }
}

/** Usage ledger rows of one model projected to the forecast sample shape. */
export function usageSamples(records = [], model) {
  if (!Array.isArray(records)) return []
  return records
    .filter((row) => row && row.model === model)
    .map((row) => {
      const mtok = billedTokens(row) / 1e6
      return {
        mtok: Number.isFinite(mtok) && mtok > 0 ? mtok : null,
        cost_usd: Number.isFinite(row.cost_usd) ? row.cost_usd : null,
      }
    })
}

function defaultForecast({ model, quota, records, usage, now }) {
  return buildForecast({ model, quota, samples: usageSamples(records, model), usage, now })
}

export function listModels(config, { status = {}, includeDeprecated = false } = {}) {
  return Object.entries(config.models).map(([key, m]) => {
    const st = status[m.provider] || { state: 'unavailable', detail: 'provider not checked' }
    const callable = st.state === 'callable' && !m.deprecated
    return {
      schema: 'cliworker.model/v1', key, provider: m.provider, id: m.id || key,
      vendor: m.vendor || vendorOf(m.provider), tier: m.tier || 'unknown', level: levelOf(m),
      identity: m.identity === 'verified' ? 'verified' : 'unverified',
      identity_group: m.identity_group || null,
      deprecated: !!m.deprecated, deprecated_reason: m.deprecated_reason || null,
      callable, availability: callable ? 'callable' : (m.deprecated ? 'deprecated' : st.state),
      readonly: m.readonly === undefined ? !!(config.providers?.[m.provider]?.readonly) : !!m.readonly,
      prices: normalizePrices(m), source: 'config',
      provider_detail: st.detail || null,
    }
  }).filter((m) => includeDeprecated || !m.deprecated)
}

export function selectModels(config, request = {}, { status = {}, usage = [], ctx } = {}) {
  const level = normLevel(request.level || request.tier)
  const usageKind = normUsage(request.usage)
  const models = listModels(config, { status, includeDeprecated: true })
  const count = Math.max(1, Number(request.count || 1))
  const requireVerified = request.require_verified !== false
  const requireReadonly = request.require_readonly === true
  const exclude = new Set(request.exclude || [])
  const allowed = request.candidates ? new Set(request.candidates) : null
  const rejected = []
  const records = Array.isArray(usage) ? usage : []

  let clock = null
  const currentNow = () => {
    if (clock === null) clock = typeof ctx?.now === 'function' ? ctx.now() : systemNow()
    return clock
  }
  const forecastFn = typeof ctx?.forecast === 'function' ? ctx.forecast : defaultForecast
  const cache = new Map()
  // One quota read and one forecast call per model that clears the pre-filter, cached by key:
  // ranking and handle building only ever see the cached entry.
  const forecastOf = (m) => {
    const hit = cache.get(m.key)
    if (hit) return hit
    const quota = config.quotas?.[m.provider] ?? null
    const entry = {
      quota,
      forecast: forecastFn({ model: m.key, prices: m.prices, quota, records, usage: usageKind, now: currentNow() }),
    }
    cache.set(m.key, entry)
    return entry
  }

  if (!level) {
    return draftSelection({ request, level: null, usage: usageKind, models: [], rejected, reason: 'E_LEVEL_REQUIRED', count: 0 })
  }

  const candidates = models.filter((m) => {
    if (exclude.has(m.key)) { rejected.push({ key: m.key, reason: 'excluded' }); return false }
    if (allowed && !allowed.has(m.key)) { rejected.push({ key: m.key, reason: 'not_in_workspace_order' }); return false }
    if (m.level !== level) { rejected.push({ key: m.key, reason: `level:${m.level}` }); return false }
    if (!m.callable) { rejected.push({ key: m.key, reason: `availability:${m.availability}` }); return false }
    if (requireVerified && m.identity !== 'verified') { rejected.push({ key: m.key, reason: 'identity_unverified' }); return false }
    if (requireReadonly && !m.readonly) { rejected.push({ key: m.key, reason: 'readonly_unavailable' }); return false }
    const refused = heavyRejection({ key: m.key, usage: usageKind, forecast: forecastOf(m).forecast })
    if (refused) { rejected.push(refused); return false }
    return true
  })

  const rank = (m) => {
    const f = forecastOf(m).forecast
    const price = m.prices.input_per_mtok + m.prices.output_per_mtok
    const unknown = f.risk === 'unknown' ? 1 : 0
    if (usageKind === 'Heavy') return [unknown, -(f.tasks_left ?? -1), price, m.key]
    if (usageKind === 'Light') return [price, unknown, m.key]
    return [unknown, price, m.key]
  }
  candidates.sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    for (let i = 0; i < ra.length; i++) { if (ra[i] < rb[i]) return -1; if (ra[i] > rb[i]) return 1 }
    return 0
  })

  const picked = candidates.slice(0, count).map((m) => {
    const entry = forecastOf(m)
    return draftHandle({
      model: m,
      call: cliCall(config, m, request),
      forecast: entry.forecast,
      quota: entry.quota,
      adapter: config.providers?.[m.provider]?.adapter ?? null,
    })
  })
  return draftSelection({ request, level, usage: usageKind, models: picked, rejected, count })
}
