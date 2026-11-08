// `state backup`: snapshot the state directory through lib/migrate.mjs. The command only reports
// the backup name, file count and the version that was backed up; file contents never reach stdout.

import { backupState, readStateVersion } from '../../migrate.mjs'

export const route = { cmd: 'state', sub: 'backup' }

export async function run({ ctx, config }) {
  const result = await backupState(ctx, config)
  return {
    ok: true,
    backup: result.name,
    files: result.files,
    state_version: readStateVersion(ctx, config._home),
    ...(result.recovered ? { recovered: result.recovered } : {}),
  }
}
