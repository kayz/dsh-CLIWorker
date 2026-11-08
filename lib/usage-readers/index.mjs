// Reader registry: each CLI has an independent parser plus an IO wrapper over ctx.fs.

import { codedError } from '../output.mjs'
import { readCodexReadings } from './codex.mjs'
import { readClaudeReadings } from './claude.mjs'

export { selectLatest } from './core.mjs'

const READERS = {
  codex: readCodexReadings,
  claude: readClaudeReadings,
}

export function readCliReadings(ctx, cli, target) {
  const reader = READERS[cli]
  if (typeof reader !== 'function') throw codedError('E_REQUEST_INVALID', 'unsupported usage CLI')
  return reader(ctx, target)
}
