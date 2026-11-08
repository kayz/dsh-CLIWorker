// `state restore --from <name>`: replace the live state with a named backup. `--from` accepts
// only a backup name; lib/migrate.mjs rejects separators, `..`, drives and unknown names with
// E_REQUEST_INVALID, so the live state is never touched by a malformed request.

import { arg } from '../_util.mjs'
import { codedError } from '../../output.mjs'
import { restoreState } from '../../migrate.mjs'

export const route = { cmd: 'state', sub: 'restore' }

export async function run({ argv, ctx, config }) {
  const from = arg(argv, '--from')
  if (typeof from !== 'string' || from === '' || from.startsWith('--')) {
    throw codedError('E_REQUEST_INVALID', '--from requires a backup name')
  }
  const result = await restoreState(ctx, config, { from })
  return {
    ok: true,
    restored: result.restored,
    files: result.files,
    state_version: result.state_version,
    ...(result.recovered ? { recovered: result.recovered } : {}),
  }
}
