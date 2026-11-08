// `run --lease <id>` — the streamed executor entry point. This command opts in to the CLI's
// streamed contract: it owns config loading and error rendering so that a valid lease id always
// produces cliworker.event/v1 JSONL instead of the ordinary single JSON envelope.

import { loadConfig } from '../config.mjs'
import { arg } from './_util.mjs'
import { codedError, errorBodyFrom, exitCodeFor } from '../output.mjs'
import { createEventWriter } from '../events.mjs'
import { runLease } from '../runner.mjs'

export const route = { cmd: 'run', sub: null, streamed: true }

const LEASE_ID_RE = /^l_[A-Za-z0-9]+$/

function required(argv, flag) {
  const value = arg(argv, flag)
  if (typeof value !== 'string' || value === '') {
    throw codedError('E_REQUEST_INVALID', `run requires ${flag} <value>`)
  }
  return value
}

export async function run({ argv, ctx }) {
  const leaseId = required(argv, '--lease')
  if (!LEASE_ID_RE.test(leaseId)) {
    throw codedError('E_REQUEST_INVALID', 'run requires a valid --lease id')
  }
  const stateDir = required(argv, '--state-dir')
  const configFile = required(argv, '--config')

  const writer = createEventWriter(ctx, leaseId)
  writer.start()

  try {
    const config = loadConfig({ file: configFile, ctx })
    await runLease({
      ctx,
      config,
      stateDir,
      leaseId,
      readInput: () => ctx.fs.readFileSync(0, 'utf8'),
      writer,
    })
    return { exitCode: 0, streamed: true }
  } catch (error) {
    const { error: detail } = errorBodyFrom(error)
    writer.error(error)
    return { exitCode: exitCodeFor(detail.code), streamed: true }
  }
}
