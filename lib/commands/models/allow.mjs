import { modelCommandArgs, readCatalogModels, writeCatalog } from '../../catalog.mjs'
export const route = { cmd: 'models', sub: 'allow' }
export async function run({ argv, ctx, config }) {
  const positional = modelCommandArgs(argv, 'allow')
  const models = readCatalogModels(config, { ctx })
  return writeCatalog('allow', positional, { ctx, config, models })
}
