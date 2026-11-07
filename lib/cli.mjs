import { loadConfig } from './config.mjs'
import * as providersList from './commands/providers/list.mjs'
import * as modelsList from './commands/models/list.mjs'
import * as modelsSelect from './commands/models/select.mjs'
import * as modelsForecast from './commands/models/forecast.mjs'
import * as usageRecord from './commands/usage/record.mjs'
import * as usageSummary from './commands/usage/summary.mjs'
import * as paths from './commands/paths.mjs'
import * as init from './commands/init.mjs'
import { arg } from './commands/_util.mjs'

const USAGE = 'usage: cliworker providers | models list|select|forecast | usage record|summary | init | paths'

const CONFIG_FREE = new Set(['paths', 'init'])
const CONFIG_ERROR_CODES = new Set(['E_CONFIG', 'E_CONFIG_EXAMPLE', 'E_CONFIG_EXISTS'])

const ROUTES = [
  { cmd: 'providers', sub: null, module: providersList },
  { cmd: 'models', sub: null, module: modelsList },
  { cmd: 'models', sub: 'select', module: modelsSelect },
  { cmd: 'models', sub: 'forecast', module: modelsForecast },
  { cmd: 'usage', sub: 'record', module: usageRecord },
  { cmd: 'usage', sub: 'summary', module: usageSummary },
  { cmd: 'paths', sub: null, module: paths },
  { cmd: 'init', sub: null, module: init },
]

function resolveRoute(argv) {
  const cmd = argv[0]
  let sub = argv[1] === undefined ? null : argv[1]
  if (cmd === 'providers' || cmd === 'paths' || cmd === 'init') sub = null
  else if (cmd === 'models') { if (sub === '' || sub === 'list') sub = null }
  else if (cmd !== 'usage') return null
  const match = ROUTES.find((route) => route.cmd === cmd && route.sub === sub)
  return match ? match.module : null
}

function warnAboutTestClock(ctx, result) {
  const file = ctx.env ? ctx.env.CLIWORKER_TEST_CLOCK_FILE : undefined
  if (typeof file !== 'string' || file === '') return
  if (!result || typeof result !== 'object') return
  if (Array.isArray(result.warnings)) result.warnings.push({ code: 'W_TEST_CLOCK' })
  else result.warnings = [{ code: 'W_TEST_CLOCK' }]
}

export async function main(argv, ctx) {
  const route = resolveRoute(argv)
  if (!route) {
    ctx.stderr.write(`ERROR: ${USAGE}\n`)
    return { exitCode: 1 }
  }
  try {
    const config = CONFIG_FREE.has(argv[0]) ? null : loadConfig({ file: arg(argv, '--config'), ctx })
    const result = await route.run({ argv, ctx, config })
    warnAboutTestClock(ctx, result)
    ctx.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return { exitCode: 0 }
  } catch (e) {
    if (e && CONFIG_ERROR_CODES.has(e.code)) {
      const body = { ok: false, error: { code: e.code, message: e.message, retryable: false, retry_after: null } }
      ctx.stdout.write(JSON.stringify(body, null, 2) + '\n')
      return { exitCode: 3 }
    }
    ctx.stderr.write(`ERROR: ${e.message}\n`)
    return { exitCode: e.exitCode ?? 1 }
  }
}
