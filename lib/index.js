/**
 * dsh-cliworker — DSH host plugin.
 *
 * AgentLine and other clients only need the model source pointer:
 *   modelSource = { kind: "cliworker", command: "node",
 *                   args: [".../dsh-CLIWorker/bin/cliworker.mjs", "--config", "..."] }
 *
 * The plugin exposes the same selection contract over DSH routes for UI use.
 */
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../lib/config.mjs'
import { providerStatus } from '../lib/availability.mjs'
import { listModels, selectModels } from '../lib/select.mjs'
import { forecast } from '../lib/forecast.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULTS = {
  configPath: process.env.CLIWORKER_CONFIG || path.join(process.env.CLIWORKER_HOME || path.join(os.homedir(), '.cliworker'), 'config.json'),
  readonly: false,
}

function send(res, body, code = 200) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (d) => { raw += d.toString(); if (raw.length > 2_000_000) req.destroy() })
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

export const name = 'cliworker'

export function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...(config || {}) }
  const getConfig = () => loadConfig({ file: settings.configPath })

  try {
    ctx.inject(['webServer'], (httpCtx) => {
      const route = (p, name, handler) => httpCtx.effect(() => httpCtx.webServer.register({ kind: 'exact', path: p, handler }), name)

      route('/cliworker/providers', 'cliworker: providers', async (_req, res) => {
        try { const c = getConfig(); send(res, { ok: true, providers: providerStatus(c) }) } catch (e) { send(res, { ok: false, error: String(e.message || e) }, 500) }
      })
      route('/cliworker/models', 'cliworker: models', async (_req, res) => {
        try { const c = getConfig(); send(res, { ok: true, models: listModels(c, { status: providerStatus(c), includeDeprecated: false }) }) } catch (e) { send(res, { ok: false, error: String(e.message || e) }, 500) }
      })
      route('/cliworker/select', 'cliworker: select', async (req, res) => {
        try {
          const c = getConfig()
          const body = req.method === 'GET' ? { request: JSON.parse(new URL(req.url || '/', 'http://local').searchParams.get('request') || '{}') } : await readBody(req)
          const request = body.request || body
          send(res, { ok: true, ...selectModels(c, request, { status: providerStatus(c) }) })
        } catch (e) { send(res, { ok: false, error: String(e.message || e) }, 400) }
      })
      route('/cliworker/forecast', 'cliworker: forecast', async (req, res) => {
        try {
          const c = getConfig()
          const model = new URL(req.url || '/', 'http://local').searchParams.get('model')
          send(res, { ok: true, forecast: forecast({ model, prices: model ? c.models[model]?.prices : undefined, quota: model ? c.quotas?.[c.models[model]?.provider] : null }) })
        } catch (e) { send(res, { ok: false, error: String(e.message || e) }, 500) }
      })
    })
  } catch (e) {
    console.error('[cliworker] webServer inject failed:', e.message)
  }
}

