import { parseModelOptions } from '../../models/directory.mjs'
import { probeModels } from '../../probe.mjs'

export const route = { cmd: 'models', sub: 'probe' }

export async function run({ argv, ctx, config }) {
  parseModelOptions(argv)
  return { schema: 'cliworker.models/v1', models: await probeModels(config, { ctx }) }
}
