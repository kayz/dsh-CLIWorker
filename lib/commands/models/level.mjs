import { modelCommandArgs, readCatalogModels, writeCatalog } from '../../catalog.mjs'
export const route = { cmd: 'models', sub: 'level' }
export async function run({ argv, ctx, config }) {
  const positional = modelCommandArgs(argv, 'level')
  const models = readCatalogModels(config, { ctx })
  return writeCatalog('level', positional, { ctx, config, models })
}
