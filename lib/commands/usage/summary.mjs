import { readUsage } from '../../config.mjs'
import { usageFile } from '../_util.mjs'

export async function run({ ctx, config }) {
  return { schema: 'cliworker.usage/v1', records: readUsage(usageFile(config, ctx), ctx) }
}
