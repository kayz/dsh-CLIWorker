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
import { createContext } from './context.mjs'
import { loadConfig, defaultHome } from './config.mjs'
import { providerStatus } from './availability.mjs'
import { listModels, selectModels } from './select.mjs'
import { forecast } from './forecast.mjs'

export const name = 'cliworker'

let report = null

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

export function createPlugin(hostCtx, settings = {}, deps = {}) {
  const s = settings || {}
  const ctx = deps.ctx || createContext()
  const registered = []
  const errors = []
  report = { registered, errors }

  const file = s.configPath || ctx.env.CLIWORKER_CONFIG || path.join(defaultHome(ctx.env), 'config.json')
  const getConfig = () => loadConfig({ file, ctx })

  const fail = (where, error) => {
    const message = String((error && error.message) || error)
    errors.push({ path: where, message })
    ctx.stderr.write(`[cliworker] route registration failed: ${where === null ? '(inject)' : where}: ${message}\n`)
  }

  const route = (httpCtx, routePath, label, handler) => {
    try {
      httpCtx.effect(() => httpCtx.webServer.register({ kind: 'exact', path: routePath, handler }), label)
      registered.push(routePath)
    } catch (e) {
      fail(routePath, e)
    }
  }

  try {
    if (!hostCtx || typeof hostCtx.inject !== 'function') throw new Error('host context has no inject()')
    hostCtx.inject(['webServer'], (httpCtx) => {
      route(httpCtx, '/cliworker/providers', 'cliworker: providers', async (_req, res) => {
        try { const c = getConfig(); send(res, { ok: true, providers: providerStatus(c, { ctx }) }) } catch (e) { send(res, { ok: false, error: String(e.message || e) }, 500) }
      })
      route(httpCtx, '/cliworker/models', 'cliworker: models', async (_req, res) => {
        try { const c = getConfig(); send(res, { ok: true, models: listModels(c, { status: providerStatus(c, { ctx }), includeDeprecated: false }) }) } catch (e) { send(res, { ok: false, error: String(e.message || e) }, 500) }
      })
      route(httpCtx, '/cliworker/select', 'cliworker: select', async (req, res) => {
        try {
          const c = getConfig()
          const body = req.method === 'GET' ? { request: JSON.parse(new URL(req.url || '/', 'http://local').searchParams.get('request') || '{}') } : await readBody(req)
          const request = body.request || body
          send(res, { ok: true, ...selectModels(c, request, { status: providerStatus(c, { ctx }) }) })
        } catch (e) { send(res, { ok: false, error: String(e.message || e) }, 400) }
      })
      route(httpCtx, '/cliworker/forecast', 'cliworker: forecast', async (req, res) => {
        try {
          const c = getConfig()
          const model = new URL(req.url || '/', 'http://local').searchParams.get('model')
          send(res, { ok: true, forecast: forecast({ model, prices: model ? c.models[model]?.prices : undefined, quota: model ? c.quotas?.[c.models[model]?.provider] : null, now: ctx.now() }) })
        } catch (e) { send(res, { ok: false, error: String(e.message || e) }, 500) }
      })
    })
  } catch (e) {
    fail(null, e)
  }

  return { registered, errors }
}

export function getRegistration() {
  if (!report) return { status: 'failed', registered: [], errors: [{ path: null, message: 'plugin not applied' }] }
  const errors = report.errors.map((item) => ({ path: item.path, message: item.message }))
  return { status: errors.length > 0 ? 'failed' : 'ok', registered: report.registered.slice(), errors }
}

export function apply(hostCtx, settings = {}, deps = {}) {
  const s = settings || {}
  const result = createPlugin(hostCtx, s, deps)
  if (s.strict === true && result.errors.length > 0) {
    const detail = result.errors.map((item) => `${item.path === null ? '(inject)' : item.path}: ${item.message}`).join('; ')
    const error = new Error(`cliworker: route registration failed: ${detail}`)
    error.registration = getRegistration()
    throw error
  }
}
