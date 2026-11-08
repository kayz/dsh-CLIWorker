import { deny, modelCommandArgs } from '../../catalog.mjs'

export const route = { cmd: 'models', sub: 'deny' }

export async function run({ argv, ctx, config }) {
  return deny(modelCommandArgs(argv, 'deny'), { ctx, config })
}
