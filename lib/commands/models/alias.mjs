import { modelCommandArgs, setAlias } from '../../catalog.mjs'

export const route = { cmd: 'models', sub: 'alias' }

export async function run({ argv, ctx, config }) {
  return setAlias(modelCommandArgs(argv, 'alias'), { ctx, config })
}
