import { providerStatus } from '../../availability.mjs'

export async function run({ ctx, config }) {
  const status = providerStatus(config, { ctx })
  return {
    schema: 'cliworker.providers/v1',
    providers: Object.entries(config.providers).map(([id, p]) => ({ id, cli: p.cli, readonly: !!p.readonly, ...status[id] })),
  }
}
