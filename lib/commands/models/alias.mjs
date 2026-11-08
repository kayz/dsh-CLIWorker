import { modelCommandArgs, readCatalogModels, writeCatalog } from '../../catalog.mjs'
export const route = { cmd: 'models', sub: 'alias' }
export async function run({ argv, ctx, config }) {
  const positional = modelCommandArgs(argv, 'alias')
  const models = readCatalogModels(config, { ctx })
  return writeCatalog('alias', positional, { ctx, config, models })
}
