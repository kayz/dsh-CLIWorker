import { gateView, requestFromArgv } from '../../request.mjs'
import { runSelection, withWarnings } from '../../select.mjs'
import { codedError } from '../../output.mjs'

export const route = { cmd: 'models', sub: 'select' }

/**
 * Shared selection path: request parsing and the view gate run before any cache read or lease
 * write. draft is served from the same computed result (never re-selecting); the AgentLine view
 * is the whitelisted envelope; view=full is refused by gateView.
 */
export async function run({ argv, ctx, config }) {
  const { request, warnings } = requestFromArgv(argv, ctx)
  const gated = gateView(request)
  const result = await runSelection({ ctx, config, request })
  const all = [...warnings, ...gated.warnings]

  // The draft projection and the legacy (v1 config) surface are returned as results: a failed
  // selection there is a normal `ok:false` outcome, not a command failure. Only a v1 AgentLine
  // selection failure leaves through the error envelope and its registry exit code.
  if (!result.ok) {
    if (gated.view === 'draft') return withWarnings(result.draft, all)
    if (result.legacy === true) return withWarnings(result.agentline, all)
    const error = result.error
    throw codedError(error.code, error.message, {
      retryable: error.retryable,
      retry_after: error.retry_after,
    })
  }
  if (gated.view === 'draft') return withWarnings(result.draft, all)
  return withWarnings(result.agentline, all)
}
