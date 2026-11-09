import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPlugin } from '../../lib/index.js'
import { createContext } from '../../lib/context.mjs'
import { createHostStub } from '../helpers/host-stub.mjs'
import { createFakeClock } from '../helpers/clock.mjs'
import { startApp } from '../../ui/app.mjs'
import { baseConfig, MODEL_KEY } from '../fixtures/usage/harness.mjs'
import { renderModels } from '../../ui/render.mjs'
import { createJobs } from '../../lib/http/jobs.mjs'

test('[AC-063] [AC-077] actual exact entry serves assets and guarded snapshot without executing a command', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ui-'))
  try {
    const configPath = path.join(root, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({ schema: 'cliworker.config/v2', state_dir: path.join(root, 'state'), discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: {}, secrets: {} }), 'utf8')
    let count = 0
    const clock = createFakeClock()
    const ctx = createContext({ env: { CLIWORKER_HOME: root }, clock, exec() { count++; throw new Error('unexpected exec') } })
    const host = createHostStub()
    createPlugin(host.ctx, { configPath }, { ctx })
    assert.equal((await host.request('/cliworker/ui', { host: 'evil.example' })).statusCode, 403)
    const page = await host.request('/cliworker/ui')
    assert.equal(page.statusCode, 200)
    assert.match(page.headers['content-type'], /^text\/html/)
    assert.match(page.body, /id="issues-tab" aria-selected="true"/)
    assert.match(page.body, /问题来源未接入/)
    assert.equal(page.body, fs.readFileSync(fileURLToPath(new URL('../../ui/index.html', import.meta.url)), 'utf8'))
    assert.ok(page.body.indexOf('问题') < page.body.indexOf('模型'))
    for (const name of ['app.mjs', 'render.mjs']) {
      const result = await host.request(`/cliworker/ui/${name}`)
      assert.equal(result.statusCode, 200)
      assert.match(result.headers['content-type'], /javascript/)
      assert.equal(result.body, fs.readFileSync(fileURLToPath(new URL(`../../ui/${name}`, import.meta.url)), 'utf8'))
      assert.equal((await host.request(`/cliworker/ui/${name}`, { remoteAddress: '192.0.2.1' })).statusCode, 403)
      for (const url of [`/cliworker/ui/../${name}`, `/cliworker/ui/../ui/${name}`, `/cliworker/ui/%2e%2e/${name}`, `/cliworker/ui\\${name}`]) {
        const rejected = await host.request(`/cliworker/ui/${name}`, { url })
        assert.notEqual(rejected.statusCode, 200)
        assert.doesNotMatch(rejected.body, /[A-Za-z]:\\|\/Users\//)
      }
    }
    const denied = await host.request('/cliworker/api/snapshot')
    assert.equal(JSON.parse(denied.body).error.code, 'E_ADMIN_REQUIRED')
    const { session } = JSON.parse((await host.request('/cliworker/api/session')).body)
    const snapshot = await host.request('/cliworker/api/snapshot', { headers: { 'x-cliworker-session': session } })
    assert.equal(snapshot.statusCode, 200)
    assert.deepEqual(JSON.parse(snapshot.body).models, [])
    assert.equal(count, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-063] injected raw response remains guarded and ends once', async () => {
  const host = createHostStub()
  let count = 0
  createPlugin(host.ctx, {}, { handlers: { '/cliworker/ui': ({ res }) => { count++; res.end('custom') } } })
  assert.equal((await host.request('/cliworker/ui', { host: 'example.com' })).statusCode, 403)
  assert.equal(count, 0)
  assert.equal((await host.request('/cliworker/ui')).body, 'custom')
  assert.equal(count, 1)
})

test('[AC-063] [AC-077] app uses session then snapshot and polls through the real exact registry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ui-app-'))
  try {
    const configPath = path.join(root, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({ schema: 'cliworker.config/v2', state_dir: path.join(root, 'state'), discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: { session_ttl_s: 1 }, secrets: {} }), 'utf8')
    const clock = createFakeClock(), host = createHostStub(), calls = []
    let disconnected = false
    let execs = 0
    const ctx = createContext({ env: { CLIWORKER_HOME: root }, clock, exec() { execs++; throw new Error('unexpected exec') } })
    createPlugin(host.ctx, { configPath }, { ctx })
    const elements = new Map()
    for (const id of ['issues', 'models', 'issues-tab', 'models-tab', 'status', 'model-list', 'issue-source']) {
      const element = { hidden: false, textContent: '', innerHTML: '', attrs: {}, addEventListener() {}, setAttribute(name, value) { element.attrs[name] = String(value) } }
      elements.set(id, element)
    }
    const document = { getElementById: id => elements.get(id), querySelectorAll: () => [] }
    const fetch = async (url, options = {}) => {
      calls.push({ url, headers: options.headers })
      if (disconnected) throw new Error('network failure')
      const result = await host.request(url, { method: options.method || 'GET', headers: options.headers, body: options.body })
      return { ok: result.statusCode < 400, json: async () => JSON.parse(result.body) }
    }
    startApp({ document, fetch, setTimeout: clock.setTimeout, now: clock.now })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls.map(x => x.url), ['/cliworker/api/session', '/cliworker/api/snapshot'])
    assert.ok(calls[1].headers['x-cliworker-session'])
    assert.equal(elements.get('issues').hidden, false)
    assert.equal(elements.get('models').hidden, true)
    assert.equal(elements.get('issues-tab').attrs['aria-selected'], 'true')
    assert.equal(elements.get('models-tab').attrs['aria-selected'], 'false')
    assert.match(elements.get('issue-source').textContent, /问题来源未接入/)
    const firstSource = elements.get('issue-source').textContent
    await clock.advance(15000)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls.map(x => x.url), ['/cliworker/api/session', '/cliworker/api/snapshot', '/cliworker/api/snapshot', '/cliworker/api/session', '/cliworker/api/snapshot'])
    assert.notEqual(calls[1].headers['x-cliworker-session'], calls[4].headers['x-cliworker-session'])
    const expired = await host.request('/cliworker/api/snapshot', { headers: { 'x-cliworker-session': calls[1].headers['x-cliworker-session'] } })
    assert.equal(expired.statusCode, 403)
    assert.equal(JSON.parse(expired.body).error.code, 'E_ADMIN_REQUIRED')
    assert.equal(clock.pending(), 1)
    assert.equal(elements.get('status').textContent, '已更新')
    assert.match(elements.get('issue-source').textContent, /问题来源未接入/)
    assert.notEqual(elements.get('issue-source').textContent, firstSource)
    assert.equal(execs, 0)
    const lastView = elements.get('model-list').innerHTML
    disconnected = true
    await clock.advance(15000)
    await new Promise(resolve => setImmediate(resolve))
    assert.match(elements.get('status').textContent, /^stale：读取失败/)
    assert.match(elements.get('issue-source').textContent, /问题来源未接入/)
    assert.match(elements.get('issue-source').textContent, /unknown|stale/)
    assert.ok(elements.get('model-list').innerHTML.includes('source'))
    assert.ok(lastView.includes('source'))
    assert.equal(clock.pending(), 1)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-063] accepted jobs register an instance-specific exact route after the write guards', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ui-job-'))
  try {
    const configPath = path.join(root, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({ schema: 'cliworker.config/v2', state_dir: path.join(root, 'state'), discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: {}, secrets: {} }), 'utf8')
    const clock = createFakeClock(), ctx = createContext({ env: { CLIWORKER_HOME: root }, clock }), host = createHostStub(), other = createHostStub()
    createPlugin(host.ctx, { configPath }, { ctx })
    createPlugin(other.ctx, { configPath }, { ctx })
    const pathName = '/cliworker/api/read-usage'
    assert.equal(JSON.parse((await host.request(pathName, { method: 'POST', body: {} })).body).error.code, 'E_ADMIN_REQUIRED')
    const auth = JSON.parse((await host.request('/cliworker/api/session')).body)
    assert.equal(JSON.parse((await host.request(pathName, { method: 'POST', headers: { 'x-cliworker-session': auth.session }, body: {} })).body).error.code, 'E_CSRF')
    assert.equal(clock.pending(), 0)
    const headers = { 'x-cliworker-session': auth.session, 'x-cliworker-csrf': auth.csrf }
    const result = await host.request(pathName, { method: 'POST', headers, body: {} })
    const { job_id } = JSON.parse(result.body)
    assert.match(job_id, /^[A-Za-z0-9_-]+$/)
    const jobPath = `/cliworker/api/jobs/${job_id}`
    assert.equal(JSON.parse((await host.request(jobPath, { headers })).body).status, 'queued')
    assert.throws(() => other.handlerFor(jobPath))
    assert.equal(JSON.parse((await host.request(jobPath)).body).error.code, 'E_ADMIN_REQUIRED')
    await clock.advance(0)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(JSON.parse((await host.request(jobPath, { headers })).body).status, 'succeeded')
    fs.mkdirSync(path.join(root, 'state'), { recursive: true })
    fs.writeFileSync(path.join(root, 'state', 'usage.jsonl'), '{broken', 'utf8')
    const failed = JSON.parse((await host.request(pathName, { method: 'POST', headers, body: {} })).body)
    await clock.advance(0)
    await new Promise(resolve => setImmediate(resolve))
    const failedJob = JSON.parse((await host.request(`/cliworker/api/jobs/${failed.job_id}`, { headers })).body)
    assert.equal(failedJob.status, 'failed')
    assert.equal(failedJob.last_error, 'E_CONFIG')
    assert.equal(failedJob.error.code, 'E_CONFIG')
    const unknown = JSON.parse((await host.request('/cliworker/api/snapshot', { headers })).body)
    assert.equal(unknown.source, 'unknown')
    assert.equal(unknown.last_error, 'E_CONFIG')
    assert.deepEqual(unknown.issues, [])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-063] actual snapshot has evidence and retains prior values after a failed job', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ui-data-'))
  try {
    const state = path.join(root, 'state'), configPath = path.join(root, 'config.json')
    fs.mkdirSync(state, { recursive: true })
    const config = baseConfig(state), model = config.catalog.manual[0]
    const at = '2026-11-07T10:00:00Z'
    model.level = 'High'
    model.level_source = { kind: 'cli', ref: 'C:\\Users\\realperson\\secret-sk-testtoken123', at }
    model.source.ref = 'C:\\Users\\realperson\\secret-sk-testtoken123'
    model.availability = { state: 'callable', reason: null, at, ttl_s: 21600, evidence: { probe_id: 'probe-1', cmd_redacted: 'sk-testtoken123 C:\\Users\\realperson', exit: 0, duration_ms: 4, nonce_ok: true, reported_model: MODEL_KEY, tokens: null } }
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8')
    const clock = createFakeClock({ start: Date.parse('2026-11-07T10:05:00Z') }), host = createHostStub()
    let count = 0
    const ctx = createContext({ env: { CLIWORKER_HOME: root }, clock, exec() { count++; throw new Error('unexpected exec') } })
    createPlugin(host.ctx, { configPath }, { ctx })
    const sessionResponse = await host.request('/cliworker/api/session')
    const auth = JSON.parse(sessionResponse.body)
    assert.ok(sessionResponse.body.includes(auth.session))
    assert.ok(sessionResponse.body.includes(auth.csrf))
    const headers = { 'x-cliworker-session': auth.session, 'x-cliworker-csrf': auth.csrf }
    const read = async () => await host.request('/cliworker/api/snapshot', { headers })
    const first = await read(), data = JSON.parse(first.body)
    assert.equal(first.statusCode, 200)
    assert.deepEqual(Object.keys(data).sort(), ['at', 'config', 'forecast', 'issues', 'last_error', 'models', 'source'])
    assert.deepEqual(Object.keys(data).filter(key => key !== 'issues' && key !== 'config').sort(), ['at', 'forecast', 'last_error', 'models', 'source'])
    assert.equal(data.config.path, configPath)
    assert.deepEqual(data.issues, [])
    assert.equal(data.models.length, 1)
    assert.equal(data.models[0].key, MODEL_KEY)
    assert.equal(data.models[0].provider, 'claude')
    assert.equal(data.models[0].allowed, true)
    assert.equal(data.models[0].level, 'High')
    assert.equal(data.models[0].availability.state, 'callable')
    assert.deepEqual(Object.keys(data.models[0].availability.evidence).sort(), ['cmd_redacted', 'duration_ms', 'exit', 'nonce_ok', 'probe_id', 'reported_model', 'tokens'])
    assert.equal(data.models[0].availability.evidence.probe_id, 'probe-1')
    assert.equal(data.models[0].availability.evidence.exit, 0)
    assert.equal(data.models[0].availability.evidence.cmd_redacted, null)
    assert.equal(data.models[0].source.ref, null)
    assert.equal(data.models[0].level_source.ref, null)
    assert.equal(data.models[0].availability.at, at)
    assert.ok(Array.isArray(data.forecast))
    assert.equal(data.forecast[0].schema, 'cliworker.forecast/v1')
    assert.equal(data.forecast[0].model, MODEL_KEY)
    assert.equal(data.forecast[0].remaining_fraction, 0.5)
    assert.ok(Array.isArray(data.forecast[0].pools))
    assert.ok(data.source)
    assert.equal(data.at, '2026-11-07T10:05:00.000Z')
    assert.equal(data.last_error, null)
    const sanitized = structuredClone(data); delete sanitized.config.path
    assert.doesNotMatch(JSON.stringify(sanitized), /sk-testtoken123|realperson|C:\\\\Users/)
    assert.equal(first.body.includes(auth.session), false)
    assert.equal(first.body.includes(auth.csrf), false)
    const created = JSON.parse((await host.request('/cliworker/api/read-usage', { method: 'POST', headers, body: {} })).body)
    fs.writeFileSync(path.join(state, 'usage.jsonl'), '{broken', 'utf8')
    await clock.advance(1000)
    await new Promise(resolve => setImmediate(resolve))
    const jobResponse = await host.request(`/cliworker/api/jobs/${created.job_id}`, { headers })
    const job = JSON.parse(jobResponse.body)
    assert.equal(job.status, 'failed')
    assert.equal(job.last_error, 'E_CONFIG')
    assert.equal(job.error.code, 'E_CONFIG')
    const failureResponse = await read()
    const failure = JSON.parse(failureResponse.body)
    assert.deepEqual(failure.issues, data.issues)
    assert.equal(failure.forecast[0].remaining_fraction, 0.5)
    assert.equal(failure.models[0].availability.at, at)
    assert.equal(failure.last_error, 'E_CONFIG')
    assert.equal(failure.at, job.at)
    assert.match(renderModels(failure, clock.now()).rows[0].cells[2], /^stale/)
    const deniedResponse = await host.request('/cliworker/api/snapshot')
    assert.equal(deniedResponse.statusCode, 403)
    assert.equal(JSON.parse(deniedResponse.body).error.code, 'E_ADMIN_REQUIRED')
    const pageResponse = await host.request('/cliworker/ui')
    assert.equal(failure.config.path, configPath)
    const sanitizedFailure = structuredClone(failure); delete sanitizedFailure.config.path
    for (const body of [JSON.stringify(sanitizedFailure), jobResponse.body, deniedResponse.body, pageResponse.body]) {
      assert.doesNotMatch(body, /sk-testtoken123|realperson|C:\\\\Users/)
      assert.equal(body.includes(auth.session), false)
      assert.equal(body.includes(auth.csrf), false)
    }
    fs.rmSync(path.join(state, 'usage.jsonl'))
    config.pools[0].used_fraction.value = 0.25
    config.catalog.manual[0].availability.at = '2026-11-07T10:06:00Z'
    config.catalog.manual[0].availability.evidence.duration_ms = 77
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8')
    const retried = JSON.parse((await host.request('/cliworker/api/read-usage', { method: 'POST', headers, body: {} })).body)
    await clock.advance(0)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(JSON.parse((await host.request(`/cliworker/api/jobs/${retried.job_id}`, { headers })).body).status, 'succeeded')
    const refreshed = JSON.parse((await read()).body)
    assert.equal(refreshed.last_error, null)
    assert.equal(refreshed.forecast[0].remaining_fraction, 0.75)
    assert.equal(refreshed.models[0].availability.at, '2026-11-07T10:06:00Z')
    assert.equal(refreshed.models[0].availability.evidence.duration_ms, 77)
    assert.doesNotMatch(renderModels(refreshed, clock.now()).rows[0].cells[2], /^stale/)
    assert.equal(count, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-063] injected JSON handlers run after management and write guards', async () => {
  const host = createHostStub()
  let calls = 0
  const handlers = { '/cliworker/api/snapshot': () => ({ ok: true, source: 'injected' }), '/cliworker/api/probe': () => { calls++; return { ok: true } } }
  createPlugin(host.ctx, {}, { handlers })
  assert.equal(JSON.parse((await host.request('/cliworker/api/snapshot')).body).error.code, 'E_ADMIN_REQUIRED')
  assert.equal(JSON.parse((await host.request('/cliworker/api/probe', { method: 'POST', body: {} })).body).error.code, 'E_ADMIN_REQUIRED')
  const auth = JSON.parse((await host.request('/cliworker/api/session')).body)
  assert.deepEqual(JSON.parse((await host.request('/cliworker/api/snapshot', { headers: { 'x-cliworker-session': auth.session } })).body), { ok: true, source: 'injected' })
  assert.equal(JSON.parse((await host.request('/cliworker/api/probe', { method: 'POST', headers: { 'x-cliworker-session': auth.session }, body: {} })).body).error.code, 'E_CSRF')
  assert.equal(calls, 0)
  assert.deepEqual(JSON.parse((await host.request('/cliworker/api/probe', { method: 'POST', headers: { 'x-cliworker-session': auth.session, 'x-cliworker-csrf': auth.csrf }, body: {} })).body), { ok: true })
  assert.equal(calls, 1)
})

test('[AC-063] readonly and registration failures do not start work', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ui-reg-'))
  try {
    const configPath = path.join(root, 'config.json'), clock = createFakeClock()
    fs.writeFileSync(configPath, JSON.stringify(baseConfig(path.join(root, 'state'))), 'utf8')
    let executions = 0
    const ctx = createContext({ env: { CLIWORKER_HOME: root }, clock, exec() { executions++; throw new Error('unexpected exec') } })
    const readonly = createHostStub()
    createPlugin(readonly.ctx, { configPath, readonly: true }, { ctx })
    const auth = JSON.parse((await readonly.request('/cliworker/api/session')).body)
    const headers = { 'x-cliworker-session': auth.session, 'x-cliworker-csrf': auth.csrf }
    const denied = await readonly.request('/cliworker/api/probe', { method: 'POST', headers, body: {} })
    assert.equal(JSON.parse(denied.body).error.code, 'E_READONLY')
    const host = createHostStub(), original = host.ctx.inject
    host.ctx.inject = (services, callback) => original(services, httpCtx => {
      const register = httpCtx.webServer.register
      httpCtx.webServer.register = route => {
        if (route.path.startsWith('/cliworker/api/jobs/')) throw new Error('register failed')
        return register(route)
      }
      return callback(httpCtx)
    })
    createPlugin(host.ctx, { configPath }, { ctx })
    const session = JSON.parse((await host.request('/cliworker/api/session')).body)
    const response = await host.request('/cliworker/api/probe', { method: 'POST', headers: { 'x-cliworker-session': session.session, 'x-cliworker-csrf': session.csrf }, body: {} })
    assert.notEqual(response.statusCode, 200)
    assert.equal(JSON.parse(response.body).job_id, undefined)
    assert.equal(clock.pending(), 0)
    assert.equal(executions, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-063] [AC-077] failed writes do not replay and failed reads retain stale view', async () => {
  const clock = createFakeClock(), calls = [], elements = new Map()
  for (const id of ['issues', 'models', 'issues-tab', 'models-tab', 'status', 'model-list']) elements.set(id, { textContent: '', innerHTML: '', addEventListener() {}, setAttribute() {} })
  let click
  const button = { dataset: { job: 'probe' }, addEventListener(_name, listener) { click = listener } }
  const document = { getElementById: id => elements.get(id), querySelectorAll: () => [button] }
  let rejectReads = false
  const fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' })
    if (options.method === 'POST') throw new Error('network')
    if (url.endsWith('/session')) return { ok: true, json: async () => ({ session: 'session', csrf: 'csrf' }) }
    if (rejectReads) return { ok: false, json: async () => ({ error: { code: 'E_ADMIN_REQUIRED' } }) }
    return { ok: true, json: async () => ({ models: [], forecast: [], source: 'fixture', at: '2026-11-07T00:00:00Z', last_error: null }) }
  }
  startApp({ document, fetch, setTimeout: clock.setTimeout, now: clock.now })
  await new Promise(resolve => setImmediate(resolve))
  await click()
  assert.equal(calls.filter(call => call.method === 'POST').length, 1)
  rejectReads = true
  const before = calls.length
  await clock.advance(15000)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls.slice(before).map(call => call.url), ['/cliworker/api/snapshot', '/cliworker/api/session', '/cliworker/api/snapshot'])
  assert.match(elements.get('status').textContent, /^stale/)
  assert.match(elements.get('model-list').innerHTML, /source fixture/)
  assert.equal(clock.pending(), 1)
})

test('[AC-063] overlapping jobs execute in acceptance order', async () => {
  const clock = createFakeClock(), calls = []
  let release
  const wait = new Promise(resolve => { release = resolve })
  const jobs = createJobs({ ctx: { clock }, register: () => true, before: () => null, settled() {}, async run(operation) {
    calls.push(`start:${operation}`)
    if (operation === 'first') await wait
    calls.push(`end:${operation}`)
  } })
  const a = jobs.accept('first', {}, {}), b = jobs.accept('second', {}, {})
  await clock.advance(0)
  assert.deepEqual(calls, ['start:first'])
  assert.equal(jobs.get(`/cliworker/api/jobs/${a.job_id}`).status, 'running')
  assert.equal(jobs.get(`/cliworker/api/jobs/${b.job_id}`).status, 'queued')
  release()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['start:first', 'end:first', 'start:second', 'end:second'])
})
