import { listModels, managementView, modelCommandArgs, readCatalogModels } from '../../catalog.mjs'
import { providerStatus } from '../../availability.mjs'
import { listModels as legacyListModels } from '../../select.mjs'
import { flag } from '../_util.mjs'

export const route = { cmd: 'models', sub: null }

// v1 configs migrate their models into catalog.manual in the legacy shape, which catalog's
// model/v1 validation intentionally rejects. Keep the old selector for that compatibility
// path; native v2 configs always go through lib/catalog.mjs.
const isLegacy = config => Array.isArray(config?.warnings) && config.warnings.some(warning => warning.code === 'W_CONFIG_V1')

export async function run({ argv, ctx, config }) {
  modelCommandArgs(argv, 'list')
  if (isLegacy(config)) {
    const status = providerStatus(config, { ctx })
    return { schema: 'cliworker.models/v1', models: legacyListModels(config, { status, includeDeprecated: flag(argv, '--all') }) }
  }
  const models = readCatalogModels(config)
  return { schema: 'cliworker.models/v1', models: managementView(listModels(config, { models, ctx })) }
}
