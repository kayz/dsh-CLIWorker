// Convert v1 configuration without mutating the source.
export function migrateConfig(raw, { stateDir, file, ctx }) {
  const at = ctx.clock.nowIso()
  const models = structuredClone(raw.models)
  const manual = Object.entries(models).map(([key, model]) => ({ key, ...model }))
  const levels = Object.fromEntries(manual.map(({ key, level, tier }) => [key, ['Top', 'High', 'Middle', 'Quick'].includes(level) ? level : ({ top: 'Top', advanced: 'High', standard: 'Middle' }[tier] || 'Quick')]))
  const pools = []
  for (const [cli, q] of Object.entries(raw.quotas || {})) {
    const add = (kind, funding, capacity_mtok, used_fraction, credits_per_mtok = null) => pools.push({ id: `${cli}:${kind}`, cli, kind, funding, window: null, capacity_mtok, used_fraction, credits_per_mtok })
    const reading = (value) => ({ value, source: 'config', at })
    const capacity = (value) => Object.fromEntries(manual.filter(m => m.provider === cli).map(m => [m.key, { value, source: 'config' }]))
    if (Number.isFinite(q.remaining_pct)) add(q.window === 'weekly' ? 'plan_weekly' : 'plan_window', 'plan', {}, reading(1 - q.remaining_pct / 100))
    if (Number.isFinite(q.remaining) && q.unit === 'tokens') add('credits', 'paid', capacity(q.remaining / 1e6), reading(0))
    if (Number.isFinite(q.remaining) && q.unit === 'credits') {
      const rate = Number.isFinite(q.credits_per_mtok) && q.credits_per_mtok > 0 ? q.credits_per_mtok : null
      add('credits', 'paid', rate ? capacity(q.remaining / rate) : {}, rate ? reading(0) : null, rate)
    }
    if (Number.isFinite(q.remaining_usd)) add('prepaid_usd', 'paid', {}, null)
  }
  return {
    schema: 'cliworker.config/v2', state_dir: stateDir, secrets: {},
    discovery: { extra_dirs: [], wsl: true, probe_unknown: false, unknown_patterns: ['*-cli', '*agent*'], cli_overrides: structuredClone(raw.providers) },
    catalog: { allow: manual.map(m => m.key), levels, aliases: {}, deprecated: {}, manual: manual.map(m => ({ ...m, level_source: { kind: 'config', ref: file, at } })) },
    pools,
    policy: { probe_ttl_s: 21600, lease_ttl_s: 7200, reading_ttl_s: 600, lock_stale_ms: 30000, lock_wait_ms: 5000, lock_poll_ms: 50, session_ttl_s: 43200, reserve_fraction_for_high: 0.15, unknown_policy: 'after_known', usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 }, cache_read_weight: 0, probe_schedule: null },
  }
}
