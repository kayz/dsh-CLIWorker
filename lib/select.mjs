import { normalizePrices, forecast } from './forecast.mjs'

export const SCHEMA = 'cliworker.selection/v1'

function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

function vendorOf(provider) {
  const p = String(provider || '').toLowerCase()
  if (p.includes('claude')) return 'anthropic'
  if (p.includes('codex') || p.includes('openai')) return 'openai'
  if (p.includes('codebuddy') || p.includes('tencent')) return 'tencent'
  if (p.includes('cursor') || p.includes('xai') || p.includes('grok')) return 'xai'
  if (p.includes('gemini') || p.includes('google')) return 'google'
  return p
}

export function listModels(config, { status = {}, includeDeprecated = false } = {}) {
  return Object.entries(config.models).map(([key, m]) => {
    const st = status[m.provider] || { state: 'unavailable', detail: 'provider not checked' }
    const callable = st.state === 'callable' && !m.deprecated
    return {
      schema: 'cliworker.model/v1', key, provider: m.provider, id: m.id || key,
      vendor: m.vendor || vendorOf(m.provider), tier: m.tier || 'unknown',
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
  const models = listModels(config, { status, includeDeprecated: true })
  const tier = request.tier || null
  const count = Math.max(1, Math.min(10, Number(request.count || 1)))
  const requireVerified = request.require_verified !== false
  const requireReadonly = request.require_readonly === true
  const exclude = new Set(request.exclude || [])
  const allowed = request.candidates ? new Set(request.candidates) : null
  const rejected = []
  const candidates = models.filter((m) => {
    if (exclude.has(m.key)) { rejected.push({ key: m.key, reason: 'excluded' }); return false }
    if (allowed && !allowed.has(m.key)) { rejected.push({ key: m.key, reason: 'not_in_workspace_order' }); return false }
    if (!m.callable) { rejected.push({ key: m.key, reason: `availability:${m.availability}` }); return false }
    if (tier && m.tier !== tier) { rejected.push({ key: m.key, reason: `tier:${m.tier}` }); return false }
    if (requireVerified && m.identity !== 'verified') { rejected.push({ key: m.key, reason: 'identity_unverified' }); return false }
    if (requireReadonly && !m.readonly) { rejected.push({ key: m.key, reason: 'readonly_unavailable' }); return false }
    const f = forecast({ records: usage, model: m.key, prices: m.prices, quota: config.quotas?.[m.provider] || null })
    if (request.importance === 'critical' || request.importance === 'high') {
      if (f.risk === 'critical' || f.risk === 'exhausted') { rejected.push({ key: m.key, reason: 'E_FORECAST_EXHAUSTION', forecast: f }); return false }
    }
    return true
  })
  const rank = (m) => {
    const f = forecast({ records: usage, model: m.key, prices: m.prices, quota: config.quotas?.[m.provider] || null })
    const price = m.prices.input_per_mtok + m.prices.output_per_mtok
    return [f.risk === 'unknown' ? 1 : 0, price, m.key]
  }
  candidates.sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    for (let i = 0; i < ra.length; i++) { if (ra[i] < rb[i]) return -1; if (ra[i] > rb[i]) return 1 }
    return 0
  })
  const picked = candidates.slice(0, count).map((m) => ({
    schema: 'cliworker.handle/v1', key: m.key, provider: m.provider, id: m.id,
    adapter: config.providers[m.provider]?.adapter || null,
    command: config.providers[m.provider]?.cli || null,
    identity: m.identity, identity_group: m.identity_group, vendor: m.vendor, tier: m.tier,
    readonly: m.readonly, prices: m.prices,
    quota: config.quotas?.[m.provider] || null,
    forecast: forecast({ records: usage, model: m.key, prices: m.prices, quota: config.quotas?.[m.provider] || null }),
  }))
  return {
    schema: SCHEMA, ok: picked.length > 0, request: isObject(request) ? request : {},
    models: picked, rejected, reason: picked.length ? null : 'no_eligible_model',
  }
}
