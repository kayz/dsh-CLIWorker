import { providerStatus, readProbeModels } from '../../availability.mjs'
import { selectModels } from '../../select.mjs'
import { readUsage } from '../../config.mjs'
import { usageFile } from '../_util.mjs'
import { gateView, requestFromArgv } from '../../request.mjs'

export async function run({ argv, ctx, config }) {
  const { request, warnings } = requestFromArgv(argv, ctx)
  const gated = gateView(request)
  const status = providerStatus(config, { ctx })
  const probeModels = readProbeModels(config, { ctx })
  const result = selectModels(config, request, { status, usage: readUsage(usageFile(config, ctx), ctx), ctx, probeModels })
  const all = [...warnings, ...gated.warnings]
  if (all.length > 0) result.warnings = all
  return result
}
