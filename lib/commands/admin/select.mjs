import { requestFromArgv } from '../../request.mjs'
import { runSelection, withWarnings } from '../../select.mjs'
import { codedError } from '../../output.mjs'

export const route = { cmd: 'admin', sub: 'select' }

/**
 * The only entry point that returns the complete view. It shares the same selection and lease
 * implementation as models select, so one request never reserves twice; every handle carries the
 * admin detail (model key, cli, vendor, funding, pools, forecast, direct_call).
 */
export async function run({ argv, ctx, config }) {
  const { request, warnings } = requestFromArgv(argv, ctx)
  const result = await runSelection({ ctx, config, request })
  if (!result.ok) {
    const error = result.error
    throw codedError(error.code, error.message, {
      retryable: error.retryable,
      retry_after: error.retry_after,
    })
  }
  return withWarnings(result.full, warnings)
}
