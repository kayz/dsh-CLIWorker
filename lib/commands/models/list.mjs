import { listModels, managementView, modelCommandArgs, readCatalogModels } from '../../catalog.mjs'

export const route = { cmd: 'models', sub: null }

export async function run({ argv, ctx, config }) {
  modelCommandArgs(argv, 'list')
  const models = readCatalogModels(config, { ctx })
  return { schema: 'cliworker.models/v1', models: managementView(listModels(config, { models, ctx })) }
}
