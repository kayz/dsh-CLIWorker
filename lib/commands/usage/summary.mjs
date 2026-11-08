import { readUsageLedger } from '../../usage.mjs'

export const route = { cmd: 'usage', sub: 'summary' }

export async function run({ ctx, config }) {
  const ledger = readUsageLedger({ ctx, config })
  const body = { schema: 'cliworker.usage/v1', records: ledger.rows }
  if (ledger.legacy) body.warnings = [{ code: 'W_LEGACY_USAGE' }]
  return body
}
