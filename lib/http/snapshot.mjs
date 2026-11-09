import { readProbeModels } from '../availability.mjs'
import { listModels } from '../catalog.mjs'
import { buildForecast } from '../forecast.mjs'
import { readUsageLedger } from '../usage.mjs'
import { effectivePools } from '../commands/pools/state.mjs'
import { billedTokens } from '../pools.mjs'
import { redactString } from '../redact.mjs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { validate } from '../contract/validate.mjs'
import { codedError } from '../output.mjs'
import { readJson } from '../store.mjs'
import { projectProbeIssues } from './issues-api.mjs'

const inventorySchema = createRequire(import.meta.url)('../../contracts/schemas/inventory.v1.schema.json')

// Free-form evidence can contain credentials or host paths. Only publish strings that
// are safe identifiers; arbitrary command output is not needed for the projection.
const identifier = value => typeof value === 'string' && /^[\w.:-]+(?:\/[\w.:-]+)*$/.test(value) && !/^(?:[A-Za-z]:|\/)/.test(value) ? redactString(value) : null
const instant = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null
const evidence = item => item == null ? null : { kind: identifier(item.kind), ref: null, at: item.at ?? null }

export function readSnapshot({ ctx, config }) {
  const now = ctx.clock.now()
  const at = new Date(now).toISOString()
  const probes = readProbeModels(config, { ctx })
  const inventoryPath = path.join(config._home, 'inventory.json')
  const inventory = readJson(ctx, inventoryPath, null)
  if ((inventory !== null || ctx.fs.existsSync(inventoryPath)) && !validate(inventorySchema, inventory).ok) throw codedError('E_CONFIG', 'invalid inventory cache')
  const issues = projectProbeIssues({ probes, inventory, config, ctx, at })
// v1 配置会被迁移成 legacy 形状的 catalog.manual，model/v1 校验会拒绝它（W_CONFIG_V1）。
  // 这里不能抛 500：UI 需要能打开并明确告诉用户"配置是旧格式"，所以降级为一条 issue。
  const legacyConfig = Array.isArray(config?.warnings) && config.warnings.some(warning => warning.code === 'W_CONFIG_V1')
  let models
  let configIssue = null
  try {
    models = listModels(config, { ctx, models: probes })
  } catch (error) {
    if (!legacyConfig) throw error
    models = []
    configIssue = {
      id: 'config-invalid',
      kind: 'unavailable',
      subject: 'config',
      detail: '配置为 v1 旧格式，模型目录未迁移；运行 cliworker state migrate 后重新加载',
      evidence_ref: 'config:catalog',
      at,
    }
  }
  const rows = readUsageLedger({ ctx, config }).rows
  const pools = effectivePools(ctx, config)
  const projected = models.map(m => ({
    ...m,
    key: identifier(m.key), id: identifier(m.id), cli: identifier(m.cli), provider: identifier(m.provider), vendor: identifier(m.vendor),
    aliases: m.aliases.map(identifier).filter(Boolean), level_source: evidence(m.level_source), source: evidence(m.source),
    availability: { ...m.availability, at: instant(m.availability.at), reason: identifier(m.availability.reason), evidence: m.availability.evidence ? {
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
  const probeSource = ctx.fs.existsSync(path.join(config._home, 'probes.json')) ? 'config, probes' : 'config, probes unknown'
  const hasDiscoveryEvidence = inventory?.entries.some(entry => entry.evidence.some(item => item.kind === 'probe' && /^[a-f0-9]{64}$/.test(item.digest)))
  const source = hasDiscoveryEvidence ? `${probeSource}, discover` : probeSource
  const allIssues = configIssue ? [configIssue, ...issues] : issues
  return { models: projected, forecast, source, at, last_error: null, issues: allIssues }
}
