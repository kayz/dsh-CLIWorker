import { estimateCost } from '../../forecast.mjs'
import { arg } from '../_util.mjs'
import { writeUsageRow } from '../../usage.mjs'

export const route = { cmd: 'usage', sub: 'record' }

export async function run({ argv, ctx, config }) {
  const raw = arg(argv, '--json')
  let input
  try {
    input = JSON.parse(raw)
  } catch (error) {
    // Kept as a bare Error so the existing envelope reports E_INTERNAL for a broken payload.
    throw new Error(`bad --json: ${error.message}`)
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('bad --json: object required')
  if (!input.model) throw new Error('usage record requires model')

  const model = config.models ? config.models[input.model] : null
  if (model && input.cost_usd === undefined) {
    input.cost_usd = estimateCost({
      input_tokens: input.input_tokens ?? 0,
      output_tokens: input.output_tokens ?? 0,
      prices: model.prices,
    })
  }

  const result = await writeUsageRow({ ctx, config, input })
  return { schema: 'cliworker.usage/v1', ok: true, recorded: result.row }
}
