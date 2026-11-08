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

test('actual exact entry serves assets and guarded snapshot without executing a command', async () => {
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
    assert.equal(page.body, fs.readFileSync(fileURLToPath(new URL('../../ui/index.html', import.meta.url)), 'utf8'))
    assert.ok(page.body.indexOf('问题') < page.body.indexOf('模型'))
    for (const name of ['app.mjs', 'render.mjs']) {
      const result = await host.request(`/cliworker/ui/${name}`)
      assert.equal(result.statusCode, 200)
      assert.match(result.headers['content-type'], /javascript/)
      assert.equal(result.body, fs.readFileSync(fileURLToPath(new URL(`../../ui/${name}`, import.meta.url)), 'utf8'))
      assert.equal((await host.request(`/cliworker/ui/${name}`, { remoteAddress: '192.0.2.1' })).statusCode, 403)
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

test('injected raw response remains guarded and ends once', async () => {
  const host = createHostStub()
  let count = 0
  createPlugin(host.ctx, {}, { handlers: { '/cliworker/ui': ({ res }) => { count++; res.end('custom') } } })
  assert.equal((await host.request('/cliworker/ui', { host: 'example.com' })).statusCode, 403)
  assert.equal(count, 0)
  assert.equal((await host.request('/cliworker/ui')).body, 'custom')
  assert.equal(count, 1)
})

test('app uses session then snapshot and polls through the real exact registry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ui-app-'))
  try {
    const configPath = path.join(root, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({ schema: 'cliworker.config/v2', state_dir: path.join(root, 'state'), discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: { session_ttl_s: 1 }, secrets: {} }), 'utf8')
    const clock = createFakeClock(), host = createHostStub(), calls = []
    let execs = 0
    const ctx = createContext({ env: { CLIWORKER_HOME: root }, clock, exec() { execs++; throw new Error('unexpected exec') } })
    createPlugin(host.ctx, { configPath }, { ctx })
    const elements = new Map()
    for (const id of ['issues', 'models', 'issues-tab', 'models-tab', 'status', 'model-list']) elements.set(id, { hidden: false, textContent: '', innerHTML: '', addEventListener() {}, setAttribute() {} })
    const document = { getElementById: id => elements.get(id), querySelectorAll: () => [] }
    const fetch = async (url, options = {}) => {
      calls.push({ url, headers: options.headers })
      const result = await host.request(url, { method: options.method || 'GET', headers: options.headers, body: options.body })
      return { ok: result.statusCode < 400, json: async () => JSON.parse(result.body) }
    }
    startApp({ document, fetch, setTimeout: clock.setTimeout, now: clock.now })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls.map(x => x.url), ['/cliworker/api/session', '/cliworker/api/snapshot'])
    assert.ok(calls[1].headers['x-cliworker-session'])
    await clock.advance(15000)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls.map(x => x.url), ['/cliworker/api/session', '/cliworker/api/snapshot', '/cliworker/api/snapshot', '/cliworker/api/session', '/cliworker/api/snapshot'])
    assert.notEqual(calls[1].headers['x-cliworker-session'], calls[4].headers['x-cliworker-session'])
    assert.equal(clock.pending(), 1)
    assert.equal(execs, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('accepted jobs register an instance-specific exact route after the write guards', async () => {
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
    const unknown = JSON.parse((await host.request('/cliworker/api/snapshot', { headers })).body)
    assert.equal(unknown.source, 'unknown')
    assert.equal(unknown.last_error, 'E_INTERNAL')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
