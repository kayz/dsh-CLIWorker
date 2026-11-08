import { createContext } from './context.mjs'
import { loadConfig } from './config.mjs'
import { resolvePaths } from './paths.mjs'
import { providerStatus, readProbeModels } from './availability.mjs'
import { listModels, runSelection, withWarnings } from './select.mjs'
import { normalizeRequest } from './request.mjs'
import { resolveView } from './contract/views.mjs'
import { forecast } from './forecast.mjs'
import { collectHealth } from './health.mjs'
import { routes } from './http/routes.mjs'
import { createSessions } from './http/security.mjs'
import { gateRequest, readJson, sendError, sendJson } from './http/guard.mjs'
import { getCode } from './contract/registry.mjs'
import { run as setPool } from './commands/pools/set.mjs'
import { addModel } from './models/directory.mjs'
import { modelCommandArgs, writeCatalog } from './catalog.mjs'

export const name = 'cliworker'
let report = null

export function createPlugin(hostCtx, settings = {}, deps = {}) {
  const s = settings || {}
  const ctx = deps.ctx || createContext()
  const registered = [], errors = []
  report = { registered, errors }
  const { config: file } = resolvePaths({ configPath: s.configPath, env: ctx.env, platform: ctx.platform })
  const getConfig = () => loadConfig({ file, ctx })
  let initial
  try { initial = getConfig() } catch { /* self-bootstrap and health remain accessible */ }
  const sessions = createSessions(ctx.clock, initial?.policy?.session_ttl_s ?? 43200)
  const fail = (where) => {
    const message = 'registration failed'
    errors.push({ path: where, message })
    ctx.stderr.write(`[cliworker] route registration failed: ${where === null ? '(inject)' : where}: ${message}\n`)
  }

  async function dispatch(entry, req, res) {
    if (req.method !== entry.method) return sendError(res, 'E_REQUEST_INVALID')
    const gate = gateRequest(entry, req, sessions, s.readonly)
    if (gate) return sendError(res, gate)
    try {
      if (entry.path === '/cliworker/api/session') return sendJson(res, sessions.issue())
      if (entry.path === '/cliworker/ui') {
        res.statusCode = 200
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        return res.end('<!doctype html><html><head><title>CLIWorker</title></head><body></body></html>')
      }
      if (entry.path === '/cliworker/health') {
        const value = await collectHealth({ ctx, configPath: file, registration: errors.length || registered.length !== declarations.length ? 'failed' : 'ok' })
        return sendJson(res, value, value.status === 'ok' ? 200 : 503)
      }
      let body
      if (entry.method === 'POST') {
        try { body = await readJson(req) } catch { return sendError(res, 'E_REQUEST_INVALID') }
      }
      if (entry.level === 'select') {
        const raw = body && Object.hasOwn(body, 'request') ? body.request : body
        const view = resolveView({ transport: 'http', request: raw, hasSession: sessions.valid(req.headers?.['x-cliworker-session']) })
        if (view.error) return sendError(res, view.error)
        const { request, warnings } = normalizeRequest(raw)
        const result = await runSelection({ ctx, config: getConfig(), request })
        const output = withWarnings(result[view.view], [...warnings, ...view.warnings])
        const status = result.ok ? 200 : (getCode(result.error?.code)?.http_status ?? 500)
        return sendJson(res, output, status)
      }
      const injected = deps.handlers?.[entry.path]
      if (typeof injected === 'function') return sendJson(res, await injected({ req, body, ctx }))
      const c = getConfig()
      if (entry.path === '/cliworker/api/pool') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 'E_REQUEST_INVALID')
        return sendJson(res, await setPool({ argv: ['pools', 'set', '--json', JSON.stringify(body)], ctx, config: c }))
      }
      if (entry.path === '/cliworker/api/manual-model') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 'E_REQUEST_INVALID')
        if (body.capabilities && ['readonly', 'stdin'].some(key => body.capabilities[key] !== undefined && typeof body.capabilities[key] !== 'boolean')) return sendError(res, 'E_REQUEST_INVALID')
        const values = {}
        for (const [key, value] of Object.entries({ provider: body.provider, id: body.id, level: body.level, vendor: body.vendor, 'context-tokens': body.capabilities?.context_tokens, 'input-price': body.prices?.input_per_mtok, 'output-price': body.prices?.output_per_mtok })) {
          if (value !== undefined && value !== null) values[`--${key}`] = String(value)
        }
        const flags = new Set()
        if (body.capabilities?.readonly === true) flags.add('--readonly')
        if (body.capabilities?.stdin === true) flags.add('--stdin')
        return sendJson(res, await addModel({ values, flags }, { ctx, config: c }))
      }
      const operation = entry.path.slice('/cliworker/api/'.length)
      if (['allow', 'deny', 'level', 'alias'].includes(operation)) {
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.key !== 'string') return sendError(res, 'E_REQUEST_INVALID')
        const args = operation === 'alias' ? [body.aliases?.[0], body.key] : operation === 'level' ? [body.key, body.level] : [body.key]
        if (operation === 'alias' && (!Array.isArray(body.aliases) || body.aliases.length !== 1)) return sendError(res, 'E_REQUEST_INVALID')
        if (!args.every(arg => typeof arg === 'string')) return sendError(res, 'E_REQUEST_INVALID')
        const positional = modelCommandArgs(['models', operation, ...args], operation)
        return sendJson(res, await writeCatalog(operation, positional, { ctx, config: c, models: readProbeModels(c, { ctx }) }))
      }
      if (entry.path === '/cliworker/providers') return sendJson(res, { ok: true, providers: providerStatus(c, { ctx }) })
      if (entry.path === '/cliworker/models') return sendJson(res, { ok: true, models: listModels(c, { status: providerStatus(c, { ctx }), includeDeprecated: false }) })
      if (entry.path === '/cliworker/forecast') {
        const model = new URL(req.url || '/', 'http://local').searchParams.get('model')
        return sendJson(res, { ok: true, forecast: forecast({ model, prices: model ? c.models[model]?.prices : undefined, quota: model ? c.quotas?.[c.models[model]?.provider] : null, now: ctx.now() }) })
      }
      return sendError(res, 'E_INTERNAL')
    } catch (error) { return sendError(res, getCode(error?.code) ? error.code : 'E_INTERNAL') }
  }

  const declarations = routes.filter(item => !item.path.includes('<id>'))
  if (Array.isArray(deps.jobIds)) {
    for (const id of deps.jobIds) {
      if (typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id)) declarations.push({ method: 'GET', path: `/cliworker/api/jobs/${id}`, level: 'admin_read' })
    }
  }
  try {
    if (!hostCtx || typeof hostCtx.inject !== 'function') throw new Error()
    hostCtx.inject(['webServer'], (httpCtx) => {
      for (const entry of declarations) {
        try {
          httpCtx.effect(() => {
            try {
              httpCtx.webServer.register({ kind: 'exact', path: entry.path, handler: (req, res) => dispatch(entry, req, res) })
              registered.push(entry.path)
            } catch { fail(entry.path) }
          }, `cliworker: ${entry.path}`)
        } catch { fail(entry.path) }
      }
    })
  } catch { fail(null) }
  return { registered, errors }
}

export function getRegistration() {
  if (!report) return { status: 'failed', registered: [], errors: [{ path: null, message: 'plugin not applied' }] }
  return { status: report.errors.length ? 'failed' : 'ok', registered: report.registered.slice(), errors: report.errors.map(item => ({ ...item })) }
}

export function apply(hostCtx, settings = {}, deps = {}) {
  const result = createPlugin(hostCtx, settings || {}, deps)
  if (settings?.strict === true && result.errors.length) {
    const error = new Error('cliworker: route registration failed')
    error.registration = getRegistration()
    throw error
  }
}
