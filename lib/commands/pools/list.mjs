import { effectivePools } from './state.mjs'

export const route = { cmd: 'pools', sub: 'list' }

export async function run({ ctx, config }) {
  return { ok: true, pools: effectivePools(ctx, config) }
}
