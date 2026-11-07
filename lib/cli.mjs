import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, defaultHome, readUsage, appendUsage } from './config.mjs'
import { providerStatus } from './availability.mjs'
import { listModels, selectModels, SCHEMA as SELECT_SCHEMA } from './select.mjs'
import { forecast, estimateCost } from './forecast.mjs'

function out(x) { process.stdout.write(JSON.stringify(x, null, 2) + '\n') }
function fail(message, code = 1) { process.stderr.write(`ERROR: ${message}\n`); process.exit(code) }
function arg(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback }
function flag(name) { return process.argv.includes(name) }
function usageFile(config) { return path.join(config._home || defaultHome(), 'usage.jsonl') }

function load() {
  try { return loadConfig({ file: arg('--config') }) } catch (e) { fail(e.message) }
}

function main() {
  const cmd = process.argv[2]
  const sub = process.argv[3]
  const config = load()
  if (cmd === 'providers') {
    const status = providerStatus(config)
    out({ schema: 'cliworker.providers/v1', providers: Object.entries(config.providers).map(([id, p]) => ({ id, cli: p.cli, readonly: !!p.readonly, ...status[id] })) })
    return
  }
  if (cmd === 'models' && (!sub || sub === 'list')) {
    const status = providerStatus(config)
    out({ schema: 'cliworker.models/v1', models: listModels(config, { status, includeDeprecated: flag('--all') }) })
    return
  }
  if (cmd === 'models' && sub === 'select') {
    let req = {}
    const raw = arg('--request')
    if (raw) { try { req = JSON.parse(raw) } catch (e) { fail(`bad --request JSON: ${e.message}`) } }
    const status = providerStatus(config)
    out(selectModels(config, req, { status, usage: readUsage(usageFile(config)) }))
    return
  }
  if (cmd === 'models' && sub === 'forecast') {
    const key = arg('--model', null)
    const usage = readUsage(usageFile(config))
    out({ schema: 'cliworker.forecast/v1', forecast: forecast({ records: usage, model: key, prices: key ? config.models[key]?.prices : undefined, quota: key ? config.quotas?.[config.models[key]?.provider] : null }) })
    return
  }
  if (cmd === 'usage' && sub === 'record') {
    let row
    const raw = arg('--json')
    try { row = JSON.parse(raw) } catch (e) { fail(`bad --json: ${e.message}`) }
    if (!row.model) fail('usage record requires model')
    const m = config.models[row.model]
    if (m) row.cost_usd = row.cost_usd ?? estimateCost({ input_tokens: row.input_tokens, output_tokens: row.output_tokens, prices: m.prices })
    row.at = row.at || new Date().toISOString()
    appendUsage(usageFile(config), row)
    out({ schema: 'cliworker.usage/v1', ok: true, recorded: row })
    return
  }
  if (cmd === 'usage' && sub === 'summary') {
    out({ schema: 'cliworker.usage/v1', records: readUsage(usageFile(config)) })
    return
  }
  fail('usage: cliworker providers | models list|select|forecast | usage record|summary')
}

main()
