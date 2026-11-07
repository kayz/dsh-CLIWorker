import { loadConfig } from './config.mjs'
import * as providersList from './commands/providers/list.mjs'
import * as modelsList from './commands/models/list.mjs'
import * as modelsSelect from './commands/models/select.mjs'
import * as modelsForecast from './commands/models/forecast.mjs'
import * as usageRecord from './commands/usage/record.mjs'
import * as usageSummary from './commands/usage/summary.mjs'
import { arg } from './commands/_util.mjs'

const USAGE = 'usage: cliworker providers | models list|select|forecast | usage record|summary'

const ROUTES = [
  { cmd: 'providers', sub: null, module: providersList },
  { cmd: 'models', sub: null, module: modelsList },
  { cmd: 'models', sub: 'select', module: modelsSelect },
  { cmd: 'models', sub: 'forecast', module: modelsForecast },
  { cmd: 'usage', sub: 'record', module: usageRecord },
  { cmd: 'usage', sub: 'summary', module: usageSummary },
]

function resolveRoute(argv) {
  const cmd = argv[0]
  let sub = argv[1] === undefined ? null : argv[1]
  if (cmd === 'providers') sub = null
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
    const config = loadConfig({ file: arg(argv, '--config'), ctx })
    const result = await route.run({ argv, ctx, config })
    warnAboutTestClock(ctx, result)
    ctx.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return { exitCode: 0 }
  } catch (e) {
    ctx.stderr.write(`ERROR: ${e.message}\n`)
    return { exitCode: e.exitCode ?? 1 }
  }
}
