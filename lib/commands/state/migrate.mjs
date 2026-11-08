// `state migrate`: bring the state directory up to this program's version. lib/migrate.mjs owns
// version comparison, the pre-migration backup, staging and rollback; this module only shapes the
// CLI result.

import { migrateState } from '../../migrate.mjs'

export const route = { cmd: 'state', sub: 'migrate' }

export async function run({ ctx, config }) {
  const result = await migrateState(ctx, config)
  return {
    ok: true,
    migrated: result.migrated,
    from: result.from,
    to: result.to,
    backup: result.backup,
    ...(result.recovered ? { recovered: result.recovered } : {}),
  }
}
