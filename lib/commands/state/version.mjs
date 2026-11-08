// `--version`: package version without loading config or touching state. Streamed so lib/cli.mjs
// skips loadConfig (the same mechanism doctor uses) and writes this module's JSON verbatim.

import { currentVersion } from '../../migrate.mjs'
import { writeJson } from '../../output.mjs'

export const route = { cmd: '--version', sub: null, streamed: true }

export async function run({ ctx }) {
  const body = { ok: true, version: currentVersion(ctx) }
  const clockFile = ctx.env ? ctx.env.CLIWORKER_TEST_CLOCK_FILE : undefined
  if (typeof clockFile === 'string' && clockFile !== '') body.warnings = [{ code: 'W_TEST_CLOCK' }]
  writeJson(ctx, body)
  return { streamed: true, exitCode: 0 }
}
