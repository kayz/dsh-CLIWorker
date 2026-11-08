import { readProbeModels } from '../availability.mjs'
import { listModels } from '../catalog.mjs'
import { buildForecast } from '../forecast.mjs'
import { readUsageLedger } from '../usage.mjs'
import { effectivePools } from '../commands/pools/state.mjs'
import { billedTokens } from '../pools.mjs'
import { redactString } from '../redact.mjs'
import path from 'node:path'

// Free-form evidence can contain credentials or host paths. Only publish strings that
// are safe identifiers; arbitrary command output is not needed for the projection.
const identifier = value => typeof value === 'string' && /^[\w.:-]+(?:\/[\w.:-]+)*$/.test(value) && !/^(?:[A-Za-z]:|\/)/.test(value) ? redactString(value) : null
const evidence = item => item == null ? null : { kind: identifier(item.kind), ref: null, at: item.at ?? null }

export function readSnapshot({ ctx, config }) {
  const now = ctx.clock.now()
  const at = new Date(now).toISOString()
  const models = listModels(config, { ctx, models: readProbeModels(config, { ctx }) })
  const rows = readUsageLedger({ ctx, config }).rows
  const pools = effectivePools(ctx, config)
  const projected = models.map(m => ({
    ...m,
    key: identifier(m.key), id: identifier(m.id), cli: identifier(m.cli), provider: identifier(m.provider), vendor: identifier(m.vendor),
    aliases: m.aliases.map(identifier).filter(Boolean), level_source: evidence(m.level_source), source: evidence(m.source),
    availability: { ...m.availability, reason: identifier(m.availability.reason), evidence: m.availability.evidence ? {
      probe_id: identifier(m.availability.evidence.probe_id), cmd_redacted: null, exit: m.availability.evidence.exit,
      duration_ms: m.availability.evidence.duration_ms, nonce_ok: m.availability.evidence.nonce_ok,
      reported_model: identifier(m.availability.evidence.reported_model), tokens: m.availability.evidence.tokens,
    } : null },
    prices: { ...m.prices, source: identifier(m.prices.source) },
  }))
  const forecast = models.map(m => {
    const samples = rows.filter(row => row.model === m.key && row.kind === 'task').map(row => ({ mtok: billedTokens(row, config.policy?.cache_read_weight ?? 0) / 1e6, cost_usd: row.cost_usd }))
    const value = buildForecast({ model: m.key, quota: config.quotas?.[m.provider], pools, rows, samples, now, policy: config.policy })
    return { ...value, model: identifier(value.model), pools: value.pools.map(pool => ({ ...pool, pool_id: identifier(pool.pool_id) })) }
  })
  const source = ctx.fs.existsSync(path.join(config._home, 'probes.json')) ? 'config, probes' : 'config, probes unknown'
  return { models: projected, forecast, source, at, last_error: null }
}
