import { allow, modelCommandArgs } from '../../catalog.mjs'

export const route = { cmd: 'models', sub: 'allow' }

export async function run({ argv, ctx, config }) {
  return allow(modelCommandArgs(argv, 'allow'), { ctx, config })
}
