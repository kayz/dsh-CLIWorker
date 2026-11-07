import { normalizePrices, forecast } from './forecast.mjs'

export const SCHEMA = 'cliworker.selection/v1'
export const LEVELS = ['Top', 'High', 'Middle', 'Quick']
export const USAGES = ['Heavy', 'Normal', 'Light']

function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }
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

export function selectModels(config, request = {}, { status = {}, usage = [] } = {}) {
  const level = normLevel(request.level || request.tier)
  const usageKind = normUsage(request.usage)
  const models = listModels(config, { status, includeDeprecated: true })
  const count = Math.max(1, Math.min(10, Number(request.count || 1)))
  const requireVerified = request.require_verified !== false
  const requireReadonly = request.require_readonly === true
  const exclude = new Set(request.exclude || [])
  const allowed = request.candidates ? new Set(request.candidates) : null
  const rejected = []
  if (!level) return { schema: SCHEMA, ok: false, request, level: null, usage: usageKind, models: [], calls: [], rejected, reason: 'E_LEVEL_REQUIRED' }

  const candidates = models.filter((m) => {
    if (exclude.has(m.key)) { rejected.push({ key: m.key, reason: 'excluded' }); return false }
    if (allowed && !allowed.has(m.key)) { rejected.push({ key: m.key, reason: 'not_in_workspace_order' }); return false }
    if (m.level !== level) { rejected.push({ key: m.key, reason: `level:${m.level}` }); return false }
    if (!m.callable) { rejected.push({ key: m.key, reason: `availability:${m.availability}` }); return false }
    if (requireVerified && m.identity !== 'verified') { rejected.push({ key: m.key, reason: 'identity_unverified' }); return false }
    if (requireReadonly && !m.readonly) { rejected.push({ key: m.key, reason: 'readonly_unavailable' }); return false }
    const f = forecast({ records: usage, model: m.key, prices: m.prices, quota: config.quotas?.[m.provider] || null })
    if (usageKind === 'Heavy' && (f.risk === 'critical' || f.risk === 'exhausted' || f.risk === 'low_reserve')) {
      rejected.push({ key: m.key, reason: 'E_FORECAST_EXHAUSTION', forecast: f }); return false
    }
    return true
  })

  const rank = (m) => {
    const f = forecast({ records: usage, model: m.key, prices: m.prices, quota: config.quotas?.[m.provider] || null })
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
    const f = forecast({ records: usage, model: m.key, prices: m.prices, quota: config.quotas?.[m.provider] || null })
    const call = cliCall(config, m, request)
    return {
      schema: 'cliworker.handle/v1', key: m.key, provider: m.provider, id: m.id, level: m.level,
      adapter: config.providers[m.provider]?.adapter || null,
      identity: m.identity, identity_group: m.identity_group, vendor: m.vendor,
      readonly: m.readonly, prices: m.prices, quota: config.quotas?.[m.provider] || null,
      forecast: f, call,
    }
  })
  return {
    schema: SCHEMA, ok: picked.length > 0, request, level, usage: usageKind,
    models: picked, calls: picked.map((x) => x.call), rejected,
    reason: picked.length ? null : 'no_eligible_model',
    truncated: picked.length < count,
  }
}
