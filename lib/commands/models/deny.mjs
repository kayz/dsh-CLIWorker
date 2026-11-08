import { modelCommandArgs, readCatalogModels, writeCatalog } from '../../catalog.mjs'
export const route = { cmd: 'models', sub: 'deny' }
export async function run({ argv, ctx, config }) {
  const positional = modelCommandArgs(argv, 'deny')
  const models = readCatalogModels(config, { ctx })
  return writeCatalog('deny', positional, { ctx, config, models })
}
