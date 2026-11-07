export const DEFAULT_PRICES = { input_per_mtok: 0, output_per_mtok: 0 }

export function normalizePrices(m = {}) {
  const p = m.prices || {}
  return {
    input_per_mtok: Number(p.input_per_mtok ?? DEFAULT_PRICES.input_per_mtok),
    output_per_mtok: Number(p.output_per_mtok ?? DEFAULT_PRICES.output_per_mtok),
  }
}

export function estimateCost({ input_tokens = 0, output_tokens = 0, prices = DEFAULT_PRICES }) {
  const p = { ...DEFAULT_PRICES, ...prices }
  return (Number(input_tokens) / 1e6) * p.input_per_mtok + (Number(output_tokens) / 1e6) * p.output_per_mtok
}

/** Deterministic, intentionally simple forecast. Unknown is a first-class state. */
export function forecast({ records = [], model, prices, quota = null, now = Date.now() } = {}) {
  const rows = records.filter((r) => !model || r.model === model)
  const samples = rows.map((r) => ({
    at: Date.parse(r.at || 0), input: Number(r.input_tokens || 0), output: Number(r.output_tokens || 0),
    cost: Number(r.cost_usd ?? estimateCost({ input_tokens: r.input_tokens, output_tokens: r.output_tokens, prices })),
  })).filter((r) => Number.isFinite(r.at) && r.at > 0)
  if (!samples.length) {
    return { status: 'unknown', samples: 0, reason: 'no usage samples', burn_per_task: null, tasks_left: null, eta_hours: null, confidence: 'none' }
  }
  const recent = samples.filter((r) => now - r.at <= 24 * 3600_000)
  const use = recent.length ? recent : samples.slice(-10)
  const burn = use.reduce((a, r) => a + r.cost, 0) / use.length
  const tokens = use.reduce((a, r) => a + r.input + r.output, 0) / use.length
  const spanHours = Math.max(1 / 60, (now - Math.min(...use.map((r) => r.at))) / 3600_000)
  const burnPerHour = use.reduce((a, r) => a + r.cost, 0) / spanHours
  let tasksLeft = null
  let etaHours = null
  if (quota && Number.isFinite(Number(quota.remaining_usd)) && burn > 0) {
    tasksLeft = Math.floor(Number(quota.remaining_usd) / burn)
    etaHours = burnPerHour > 0 ? Number(quota.remaining_usd) / burnPerHour : null
  } else if (quota && Number.isFinite(Number(quota.remaining)) && Number(quota.remaining) > 0 && tokens > 0 && quota.unit === 'tokens') {
    tasksLeft = Math.floor(Number(quota.remaining) / tokens)
  }
  const remainingFraction = quota && Number.isFinite(Number(quota.remaining_pct)) ? Number(quota.remaining_pct) / 100 : null
  const confidence = use.length >= 5 ? 'medium' : 'low'
  const risk = remainingFraction !== null
    ? 'low_reserve'
    : tasksLeft == null ? 'unknown' : tasksLeft <= 0 ? 'exhausted' : tasksLeft <= 2 ? 'critical' : tasksLeft <= 5 ? 'low_reserve' : 'ok'
  return {
    status: 'known', samples: use.length, burn_per_task: round(burn), tokens_per_task: Math.round(tokens),
    burn_per_hour: round(burnPerHour), tasks_left: tasksLeft, eta_hours: etaHours == null ? null : round(etaHours),
    confidence, risk, remaining_fraction: remainingFraction,
  }
}

function round(n) { return Math.round(n * 1e6) / 1e6 }
