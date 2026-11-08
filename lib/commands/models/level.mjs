import { modelCommandArgs, setLevel } from '../../catalog.mjs'

export const route = { cmd: 'models', sub: 'level' }

export async function run({ argv, ctx, config }) {
  return setLevel(modelCommandArgs(argv, 'level'), { ctx, config })
}
