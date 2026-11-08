import { collectHealth } from '../health.mjs'
import { createPlugin } from '../index.js'
import { arg } from './_util.mjs'
import { errorBody, exitCodeFor, writeJson } from '../output.mjs'
import { legacyUsageWarnings } from '../paths.mjs'

export const route = { cmd: 'doctor', sub: null, streamed: true }

export async function run({ argv, ctx, hostCtx }) {
  const host = hostCtx || { inject(_services, callback) { callback({ effect(fn) { fn() }, webServer: { register() {} } }) } }
  const result = createPlugin(host, { configPath: arg(argv, '--config') }, { ctx })
  const report = await collectHealth({ ctx, configPath: arg(argv, '--config'), registration: result.errors.length ? 'failed' : 'ok' })
  const warnings = legacyUsageWarnings({ ctx })
  if (report.test_clock) warnings.push({ code: 'W_TEST_CLOCK' })
  if (warnings.length) report.warnings = warnings
  if (report.status === 'ok') { writeJson(ctx, report); return { streamed: true, exitCode: 0 } }
  const body = errorBody('E_HEALTH_DEGRADED', JSON.stringify(report))
  writeJson(ctx, body)
  return { streamed: true, exitCode: exitCodeFor('E_HEALTH_DEGRADED') }
}
