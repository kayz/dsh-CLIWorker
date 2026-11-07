import { forecast } from '../../forecast.mjs'
import { readUsage } from '../../config.mjs'
import { arg, usageFile } from '../_util.mjs'

export async function run({ argv, ctx, config }) {
  const key = arg(argv, '--model', null)
  const usage = readUsage(usageFile(config, ctx), ctx)
  return {
    schema: 'cliworker.forecast/v1',
    forecast: forecast({
      records: usage,
      model: key,
      prices: key ? config.models[key]?.prices : undefined,
      quota: key ? config.quotas?.[config.models[key]?.provider] : null,
      now: ctx.now(),
    }),
  }
}
