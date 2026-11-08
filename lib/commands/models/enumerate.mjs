import { configuredModels, parseModelOptions } from '../../models/directory.mjs'

export const route = { cmd: 'models', sub: 'enumerate' }

// Enumerates the configured model directory. `--full` keeps deprecated records, which are
// omitted from the default view. `--config` is consumed by lib/cli.mjs.
export async function run({ argv, ctx, config }) {
  const { flags } = parseModelOptions(argv, { flags: ['--full'], valued: [] })
  return {
    schema: 'cliworker.models/v1',
    models: configuredModels(config, { ctx, full: flags.has('--full') }),
  }
}
