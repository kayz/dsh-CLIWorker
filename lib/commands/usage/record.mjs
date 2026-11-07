import { appendUsage } from '../../config.mjs'
import { estimateCost } from '../../forecast.mjs'
import { arg, usageFile } from '../_util.mjs'

export async function run({ argv, ctx, config }) {
  let row
  const raw = arg(argv, '--json')
  try { row = JSON.parse(raw) } catch (e) { throw new Error(`bad --json: ${e.message}`) }
  if (!row.model) throw new Error('usage record requires model')
  const m = config.models[row.model]
  if (m) row.cost_usd = row.cost_usd ?? estimateCost({ input_tokens: row.input_tokens, output_tokens: row.output_tokens, prices: m.prices })
  row.at = row.at || ctx.clock.nowIso()
  appendUsage(usageFile(config, ctx), row, ctx)
  return { schema: 'cliworker.usage/v1', ok: true, recorded: row }
}
