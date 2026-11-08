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
import { errorBody, errorBodyFrom, exitCodeFor, writeJson } from './output.mjs'

const USAGE = 'usage: cliworker providers | models list|select|forecast | usage record|summary | init | paths'

const CONFIG_FREE = new Set(['paths', 'init'])

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
  if (argv.length === 0) {
    ctx.stderr.write(`ERROR: ${USAGE}\n`)
    return { exitCode: 1 }
  }

  const route = resolveRoute(argv)
  if (!route) {
    const body = errorBody('E_UNKNOWN_COMMAND', `unknown command: ${argv.slice(0, 2).join(' ')}`)
    writeJson(ctx, body)
    return { exitCode: exitCodeFor(body.error.code) }
  }

  try {
    const config = CONFIG_FREE.has(argv[0]) ? null : loadConfig({ file: arg(argv, '--config'), ctx })
    const result = await route.run({ argv, ctx, config })
    warnAboutTestClock(ctx, result)
    writeJson(ctx, result)
    return { exitCode: 0 }
  } catch (e) {
    const body = errorBodyFrom(e)
    writeJson(ctx, body)
    return { exitCode: exitCodeFor(body.error.code) }
  }
}
