import { providerStatus } from '../../availability.mjs'
import { selectModels } from '../../select.mjs'
import { readUsage } from '../../config.mjs'
import { arg, usageFile } from '../_util.mjs'

export async function run({ argv, ctx, config }) {
  let req = {}
  const raw = arg(argv, '--request')
  if (raw) {
    try { req = JSON.parse(raw) } catch (e) { throw new Error(`bad --request JSON: ${e.message}`) }
  }
  const status = providerStatus(config, { ctx })
  return selectModels(config, req, { status, usage: readUsage(usageFile(config, ctx), ctx) })
}
