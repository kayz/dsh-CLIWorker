import { providerStatus } from '../../availability.mjs'
import { listModels } from '../../select.mjs'
import { flag } from '../_util.mjs'

export async function run({ argv, ctx, config }) {
  const status = providerStatus(config, { ctx })
  return { schema: 'cliworker.models/v1', models: listModels(config, { status, includeDeprecated: flag(argv, '--all') }) }
}
