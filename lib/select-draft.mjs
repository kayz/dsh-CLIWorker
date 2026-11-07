// Pure draft-view helpers: the selection envelope and the per-model handle for the v1 draft
// surface. No imports, no clock, no IO — callers hand in every value they already computed.

export const SELECTION_SCHEMA = 'cliworker.selection/v1'
export const HANDLE_SCHEMA = 'cliworker.handle/v1'
export const HEAVY_REJECT_RISKS = Object.freeze(['exhausted', 'critical', 'low_reserve'])

/** A Heavy request never selects a model whose forecast is exhausted, critical or low reserve. */
export function heavyRejection({ key, usage, forecast } = {}) {
  if (usage !== 'Heavy') return null
  if (!HEAVY_REJECT_RISKS.includes(forecast?.risk)) return null
  return { key, reason: 'E_FORECAST_EXHAUSTION', forecast }
}

/** The draft handle: one call template, no legacy `cli` alias. */
export function draftHandle({ model, call, forecast, quota, adapter } = {}) {
  return {
    schema: HANDLE_SCHEMA,
    key: model.key,
    provider: model.provider,
    id: model.id,
    level: model.level,
    adapter,
    identity: model.identity,
    identity_group: model.identity_group,
    vendor: model.vendor,
    readonly: model.readonly,
    prices: model.prices,
    quota,
    forecast,
    call,
  }
}

/** The selection envelope shared by every select call, including the missing-level path. */
export function draftSelection({ request, level, usage, models, rejected, reason = null, count = 1 } = {}) {
  const picked = Array.isArray(models) ? models : []
  const refused = Array.isArray(rejected) ? rejected : []
  let resolvedReason = null
  if (picked.length === 0) resolvedReason = reason === null || reason === undefined ? 'no_eligible_model' : reason
  return {
    schema: SELECTION_SCHEMA,
    ok: picked.length > 0,
    request,
    level,
    usage,
    models: picked,
    calls: picked.map((item) => item.call),
    rejected: refused,
    reason: resolvedReason,
    truncated: picked.length < count,
  }
}
