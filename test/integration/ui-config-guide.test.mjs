import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPlugin } from '../../lib/index.js'
import { createContext } from '../../lib/context.mjs'
import { probeModels } from '../../lib/probe.mjs'
import { run as discover } from '../../lib/commands/discover.mjs'
import { startApp } from '../../ui/app.mjs'
import { renderConfigHtml, renderIssuesHtml } from '../../ui/render.mjs'
import { createHostStub } from '../helpers/host-stub.mjs'
import { createFakeClock } from '../helpers/clock.mjs'
import { baseConfig } from '../fixtures/usage/harness.mjs'

// A small DOM seam parses the mounted markup into observable controls and articles.
function page() {
  const decode = value => value.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity])
  const element = () => ({ html: '', textContent: '', hidden: false, children: [], listeners: {}, attributes: {},
    set innerHTML(value) { this.html = value }, get innerHTML() { return this.html },
    appendChild(child) { this.children.push(child) }, addEventListener(event, cb) { this.listeners[event] = cb }, setAttribute(key, value) { this.attributes[key] = value },
    querySelector(selector) {
      if (selector !== 'input') return null
      const match = this.html.match(/<input\s+readonly\s+value="([^"]*)">/)
      return match ? { value: decode(match[1]), readOnly: true } : null
    },
    querySelectorAll(selector) {
      if (selector !== 'article') return []
      return [...this.html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)].map(match => ({ innerHTML: match[1], textContent: decode(match[1].replace(/<[^>]*>/g, ' ')) }))
    },
  })
  const elements = new Map()
  for (const id of ['issues', 'models', 'issues-tab', 'models-tab', 'status', 'model-list', 'issue-source']) elements.set(id, element())
  const main = element()
  return { elements, main, document: { getElementById: id => elements.get(id), createElement: element, querySelector: () => main, querySelectorAll: () => [] } }
}

test('[AC-090] cached missing and resolved probes reach the mounted guide', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-guide-'))
  try {
    const state = path.join(root, 'state'), file = path.join(root, 'config.json')
    const config = baseConfig(state); config._home = state
    config.catalog.manual[0].availability.state = 'unverified'
    fs.writeFileSync(file, JSON.stringify(config), 'utf8')
    const clock = createFakeClock(), host = createHostStub()
    let mode = 'missing', executions = 0, fail = false, posts = 0
    const ctx = createContext({ env: {}, clock, exec(_command, args, options) {
      executions++
      if (args.includes('--version')) return mode === 'missing' ? { code: null, error: 'ENOENT', stdout: '', stderr: '' } : mode === 'nonzero' ? { code: 3, stdout: '', stderr: 'private output' } : { ok: true, code: 0, stdout: '1.2.3', stderr: '' }
      const nonce = options.input.trim().split(/\s+/).at(-1)
      return { ok: true, code: 0, stdout: JSON.stringify({ type: 'result', model: 'claude:test-model', text: nonce, usage: { input_tokens: 1 } }), stderr: '' }
    } })
    createPlugin(host.ctx, { configPath: file }, { ctx })
    const auth = JSON.parse((await host.request('/cliworker/api/session')).body)
    const read = async () => JSON.parse((await host.request('/cliworker/api/snapshot', { headers: { 'x-cliworker-session': auth.session } })).body)
    assert.equal((await read()).config.providers[0].resolved, false)
    await probeModels(config, { ctx })
    const count = executions, data = await read()
    assert.equal(executions, count)
    assert.deepEqual(Object.keys(data).sort(), ['at', 'config', 'forecast', 'issues', 'last_error', 'models', 'source'])
    assert.deepEqual(Object.keys(data.config).sort(), ['hint', 'path', 'providers'])
    assert.equal(data.config.path, file)
    assert.deepEqual(Object.keys(data.config.providers[0]).sort(), ['cli', 'name', 'resolved'])
    assert.equal(data.config.providers[0].resolved, false)
    assert.ok(JSON.parse(data.config.hint).discovery.cli_overrides)
    assert.equal(data.issues[0].detail, 'command missing')
    const { elements, main, document } = page()
    const buttons = ['discover', 'probe'].map(job => ({ dataset: { job }, addEventListener(_event, listener) { this.click = listener } }))
    document.querySelectorAll = () => buttons
    const calls = []
    const fetch = async (url, options = {}) => { calls.push({ url, options }); if (options.method === 'POST') posts++; if (fail && url.endsWith('/snapshot')) throw Error('offline'); const response = await host.request(url, { method: options.method || 'GET', headers: options.headers, body: options.body }); return { ok: response.statusCode < 400, json: async () => JSON.parse(response.body) } }
    const app = startApp({ document, fetch, setTimeout: clock.setTimeout, now: clock.now })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(main.children.length, 1)
    const section = main.children[0]
    assert.equal(section.querySelector('input').value, file); assert.equal(section.querySelector('input').readOnly, true)
    assert.match(section.innerHTML, /配置文件路径/); assert.ok(section.innerHTML.includes(file.replace(/&/g, '&amp;')))
    assert.match(section.innerHTML, /✘ 未找到/); assert.match(section.innerHTML, /把 CLI 装进 PATH/); assert.match(section.innerHTML, /把 cli 指向可执行文件绝对路径/)
    assert.match(elements.get('issues').children[0].innerHTML, /下一步.*claude.*PATH/)
    elements.get('models-tab').listeners.click(); assert.equal(section.hidden, false); assert.equal(elements.get('issues').hidden, true); assert.equal(elements.get('models').hidden, false)
    elements.get('issues-tab').listeners.click(); assert.equal(section.hidden, false); assert.equal(elements.get('issues').hidden, false); assert.equal(elements.get('models').hidden, true)
    const previous = section.innerHTML, previousIssues = elements.get('issues').children[0].innerHTML; fail = true; await app.read(); assert.equal(section.innerHTML, previous); assert.equal(elements.get('issues').children[0].innerHTML, previousIssues); assert.match(elements.get('status').textContent, /stale/)
    fail = false; mode = 'nonzero'; await clock.advance(1000); await probeModels(config, { ctx }); await app.read()
    assert.match(section.innerHTML, /✔ 已解析/); assert.match(section.innerHTML, /把 CLI 装进 PATH/)
    mode = 'success'; await clock.advance(1000); await probeModels(config, { ctx }); config.catalog.manual[0].availability.state = 'callable'
    const unavailable = structuredClone(config.catalog.manual[0]); unavailable.key = 'claude:other'; unavailable.id = 'other'; unavailable.availability.state = 'unverified'; config.catalog.manual.push(unavailable)
    fs.writeFileSync(file, JSON.stringify(config), 'utf8'); await clock.advance(15000); await new Promise(resolve => setImmediate(resolve))
    const mixed = await read(); assert.ok(mixed.models.some(model => model.availability.state === 'callable')); assert.ok(mixed.models.some(model => model.availability.state !== 'callable'))
    assert.doesNotMatch(section.innerHTML, /把 CLI 装进 PATH/); assert.match(section.innerHTML, /配置/)
    assert.equal(main.children.length, 1); assert.equal(posts, 0)
    for (const button of buttons) await button.click()
    for (const job of ['discover', 'probe']) { const call = calls.find(item => item.url === `/cliworker/api/${job}`); assert.equal(call.options.method, 'POST'); assert.ok(call.options.headers['x-cliworker-session']); assert.ok(call.options.headers['x-cliworker-csrf']) }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-090] newer missing and same-time missing beat discovery and gone does not resolve', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-guide-conflict-'))
  try {
    const state = path.join(root, 'state'), file = path.join(root, 'config.json'), bin = path.join(root, 'bin')
    fs.mkdirSync(bin)
    const executable = path.join(bin, process.platform === 'win32' ? 'claude.cmd' : 'claude')
    fs.writeFileSync(executable, 'fixture', 'utf8')
    const config = baseConfig(state); config._home = state; config.catalog.manual[0].availability.state = 'unverified'
    const clock = createFakeClock(), host = createHostStub()
    let missing = false
    const ctx = createContext({ clock, env: { PATH: bin }, exec() { return missing ? { code: null, error: 'ENOENT', stdout: '', stderr: '' } : { ok: true, code: 0, stdout: '1.2.3', stderr: '' } } })
    fs.writeFileSync(file, JSON.stringify(config), 'utf8')
    await discover({ argv: ['discover'], ctx, config })
    createPlugin(host.ctx, { configPath: file }, { ctx })
    const session = JSON.parse((await host.request('/cliworker/api/session')).body).session
    const read = async () => JSON.parse((await host.request('/cliworker/api/snapshot', { headers: { 'x-cliworker-session': session } })).body)
    assert.equal((await read()).config.providers[0].resolved, true)
    missing = true; await probeModels(config, { ctx })
    assert.equal((await read()).config.providers[0].resolved, false, 'missing wins a timestamp tie')
    missing = false; await clock.advance(1000); await discover({ argv: ['discover', '--full'], ctx, config })
    assert.equal((await read()).config.providers[0].resolved, true, 'newer present wins')
    missing = true; await clock.advance(1000); await probeModels(config, { ctx })
    const latest = await read(); assert.equal(latest.config.providers[0].resolved, false, 'newer missing wins')
    const { document, main } = page()
    const fetch = async (url, options = {}) => { const res = await host.request(url, { headers: options.headers }); return { ok: res.statusCode < 400, json: async () => JSON.parse(res.body) } }
    startApp({ document, fetch, setTimeout: clock.setTimeout, now: clock.now }); await new Promise(resolve => setImmediate(resolve))
    assert.match(main.children[0].innerHTML, /✘ 未找到/)
    fs.unlinkSync(executable); await clock.advance(1000); await discover({ argv: ['discover', '--full'], ctx, config })
    assert.equal((await read()).config.providers[0].resolved, false)
    const inventory = JSON.parse(fs.readFileSync(path.join(state, 'inventory.json'), 'utf8'))
    assert.ok(inventory.entries.some(entry => entry.status === 'gone'))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-090] discovery evidence matches the original target and expires without leaking its directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-private-person-'))
  try {
    const state = path.join(root, 'state'), file = path.join(root, 'config.json'), bin = path.join(root, 'private-cli-dir')
    fs.mkdirSync(bin)
    const executable = path.join(bin, process.platform === 'win32' ? 'claude.cmd' : 'claude')
    fs.writeFileSync(executable, 'fixture', 'utf8')
    const config = baseConfig(state); config._home = state; config.catalog.manual[0].availability.state = 'unverified'
    config.discovery.cli_overrides.claude.cli = executable
    const clock = createFakeClock(), host = createHostStub()
    let executions = 0
    const ctx = createContext({ clock, env: { PATH: bin, PRIVATE_CONTROLLED: 'controlled-env-value' }, exec() { executions++; return { ok: true, code: 0, stdout: '1.2.3 secret-output-value', stderr: 'private-stderr-value' } } })
    fs.writeFileSync(file, JSON.stringify(config), 'utf8')
    await discover({ argv: ['discover'], ctx, config })
    createPlugin(host.ctx, { configPath: file }, { ctx })
    const session = JSON.parse((await host.request('/cliworker/api/session')).body).session
    const read = async () => JSON.parse((await host.request('/cliworker/api/snapshot', { headers: { 'x-cliworker-session': session } })).body)
    const count = executions, first = await read()
    assert.equal(executions, count); assert.equal(first.config.path, file)
    assert.equal(first.config.providers[0].cli, path.basename(executable))
    assert.equal(first.config.providers[0].resolved, true)
    const clean = structuredClone(first); delete clean.config.path
    assert.doesNotMatch(JSON.stringify(clean), /cw-private-person|private-cli-dir|PRIVATE_CONTROLLED|controlled-env-value|secret-output-value|private-stderr-value/)
    assert.equal(JSON.stringify(clean).includes(JSON.stringify(file).slice(1, -1)), false)
    assert.ok(JSON.parse(first.config.hint).discovery.cli_overrides)
    config.discovery.cli_overrides.claude.cli = path.join(root, 'other', path.basename(executable))
    fs.writeFileSync(file, JSON.stringify(config), 'utf8')
    assert.equal((await read()).config.providers[0].resolved, false)
    config.discovery.cli_overrides.claude.cli = executable
    fs.writeFileSync(file, JSON.stringify(config), 'utf8')
    await clock.advance((config.policy.probe_ttl_s + 1) * 1000)
    assert.equal((await read()).config.providers[0].resolved, false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-090] empty and legacy configs render their own mapping locations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-guide-&-'))
  try {
    const file = path.join(root, 'config.json'), clock = createFakeClock(), host = createHostStub()
    const config = baseConfig(path.join(root, 'state'))
    config.catalog.manual = []; config.discovery.cli_overrides = {}
    fs.writeFileSync(file, JSON.stringify(config), 'utf8')
    const ctx = createContext({ env: {}, clock, exec() { throw Error('unexpected execution') } })
    createPlugin(host.ctx, { configPath: file }, { ctx })
    const session = JSON.parse((await host.request('/cliworker/api/session')).body).session
    const read = async () => JSON.parse((await host.request('/cliworker/api/snapshot', { headers: { 'x-cliworker-session': session } })).body)
    const empty = await read()
    assert.deepEqual(empty.models, []); assert.deepEqual(empty.config.providers, [])
    assert.deepEqual(JSON.parse(empty.config.hint), { discovery: { cli_overrides: { claude: { cli: 'claude' } } } })
    const { document, main } = page()
    const fetch = async (url, options = {}) => { const response = await host.request(url, { headers: options.headers }); return { ok: response.statusCode < 400, json: async () => JSON.parse(response.body) } }
    const app = startApp({ document, fetch, setTimeout: clock.setTimeout, now: clock.now })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(main.children[0].querySelector('input').value, file)
    assert.match(main.children[0].innerHTML, /&amp;/); assert.match(main.children[0].innerHTML, /把 CLI 装进 PATH/)
    assert.doesNotMatch(main.children[0].innerHTML, /<script| on\w+=|<a\b/i)
    fs.writeFileSync(file, JSON.stringify({ state_dir: path.join(root, 'state'), providers: { claude: { cli: 'claude', adapter: 'claude' } }, models: {}, quotas: {} }), 'utf8')
    const legacy = await read()
    assert.deepEqual(JSON.parse(legacy.config.hint), { providers: { claude: { cli: 'claude' } } })
    await app.read(); assert.equal(main.children.length, 1); assert.match(main.children[0].innerHTML, /claude/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-090] every missing issue has its own next step and reads do not probe or write', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-private-person-'))
  try {
    const state = path.join(root, 'state'), file = path.join(root, 'config.json'), config = baseConfig(state)
    config._home = state; config.catalog.manual[0].availability.state = 'unverified'
    const second = structuredClone(config.catalog.manual[0]), third = structuredClone(second)
    second.key = 'codex:second'; second.id = 'second'; second.cli = 'codex'; second.provider = 'codex'
    third.key = 'claude:third'; third.id = 'third'; third.cli = 'claude'; third.provider = 'claude'
    config.catalog.manual.push(second, third); config.catalog.allow = [config.catalog.manual[0].key, second.key, third.key]
    config.discovery.cli_overrides.codex = { cli: 'codex' }; config.discovery.cli_overrides.gemini = { cli: 'gemini' }
    config.secrets = { claude: { ref: 'env:PRIVATE_REFERENCE_SENTINEL' } }
    fs.writeFileSync(file, JSON.stringify(config), 'utf8')
    let executions = 0, writes = 0, networks = 0, secretReads = 0
    const io = new Proxy(fs, { get(target, key) { const value = target[key]; if (['writeFileSync', 'appendFileSync', 'renameSync', 'mkdirSync', 'unlinkSync'].includes(key)) return (...args) => { writes++; return value(...args) }; return value } })
    const env = new Proxy({ PRIVATE_REFERENCE_SENTINEL: 'controlled-secret-value' }, { get(target, key) { if (key === 'PRIVATE_REFERENCE_SENTINEL') secretReads++; return target[key] } })
    const clock = createFakeClock(), host = createHostStub()
    const ctx = createContext({ fs: io, env, clock, fetch() { networks++; throw Error('unexpected network') }, exec(command) { executions++; return command === 'codex' ? { code: 3, stdout: 'private-stdout-value', stderr: 'private-stderr-value' } : { code: null, error: 'ENOENT', stdout: 'private-stdout-value', stderr: 'private-stderr-value' } } })
    await probeModels(config, { ctx }); createPlugin(host.ctx, { configPath: file }, { ctx })
    const session = JSON.parse((await host.request('/cliworker/api/session')).body).session
    const before = { executions, writes, networks, secretReads }
    const response = await host.request('/cliworker/api/snapshot', { headers: { 'x-cliworker-session': session } })
    assert.equal(response.statusCode, 200)
    const snapshot = JSON.parse(response.body)
    assert.equal(executions, before.executions); assert.equal(writes, before.writes); assert.equal(networks, before.networks); assert.ok(secretReads > before.secretReads)
    assert.equal(snapshot.config.path, file)
    const clean = structuredClone(snapshot); delete clean.config.path
    assert.doesNotMatch(JSON.stringify(clean), /cw-private-person|PRIVATE_REFERENCE_SENTINEL|controlled-secret-value|private-stdout-value|private-stderr-value/)
    const missing = snapshot.issues.filter(issue => issue.detail === 'command missing')
    assert.equal(missing.length, 2)
    const records = JSON.parse(fs.readFileSync(path.join(state, 'probes.json'), 'utf8'))
    const repeat = JSON.parse((await host.request('/cliworker/api/snapshot', { headers: { 'x-cliworker-session': session } })).body)
    for (const issue of missing) {
      assert.deepEqual(Object.keys(issue).sort(), ['at', 'detail', 'evidence_ref', 'id', 'kind', 'subject'])
      const record = records.find(item => issue.evidence_ref === `probes.json#${encodeURIComponent(item.key)}/${encodeURIComponent(item.availability.evidence.probe_id)}`)
      assert.ok(record); assert.equal(issue.at, record.availability.at); assert.equal(issue.kind, 'unavailable'); assert.equal(issue.subject, 'claude')
      assert.deepEqual(repeat.issues.find(item => item.id === issue.id), issue)
    }
    assert.ok(snapshot.issues.some(issue => issue.detail === 'non-zero exit'))
    const { document, elements } = page()
    const fetch = async (url, options = {}) => { const res = await host.request(url, { headers: options.headers }); return { ok: res.statusCode < 400, json: async () => JSON.parse(res.body) } }
    startApp({ document, fetch, setTimeout: clock.setTimeout, now: clock.now })
    await new Promise(resolve => setImmediate(resolve))
    const articles = elements.get('issues').children[0].querySelectorAll('article')
    for (const issue of missing) { const article = articles.find(item => item.textContent.includes(issue.evidence_ref)); assert.ok(article); assert.match(article.textContent, /下一步/); assert.match(article.textContent, /PATH/); assert.match(article.textContent, /cli/); assert.doesNotMatch(article.innerHTML, /cw-private-person|PRIVATE_REFERENCE_SENTINEL|controlled-secret-value/) }
    const other = articles.find(item => item.textContent.includes('non-zero exit')); assert.ok(other); assert.doesNotMatch(other.textContent, /下一步/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-090] probe evidence cannot cross providers that declare the same target', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-guide-provider-'))
  try {
    const state = path.join(root, 'state'), file = path.join(root, 'config.json'), config = baseConfig(state)
    config._home = state; config.catalog.manual[0].availability.state = 'unverified'
    config.discovery.cli_overrides.codex = { cli: 'claude' }
    fs.writeFileSync(file, JSON.stringify(config), 'utf8')
    const clock = createFakeClock(), host = createHostStub()
    const ctx = createContext({ env: {}, clock, exec() { return { code: 4, stdout: '', stderr: '' } } })
    await probeModels(config, { ctx }); createPlugin(host.ctx, { configPath: file }, { ctx })
    const session = JSON.parse((await host.request('/cliworker/api/session')).body).session
    const response = await host.request('/cliworker/api/snapshot', { headers: { 'x-cliworker-session': session } })
    const snapshot = JSON.parse(response.body)
    assert.deepEqual(snapshot.config.providers.map(item => [item.name, item.resolved]), [['claude', true], ['codex', false]])
    const { document, main } = page()
    const fetch = async (url, options = {}) => { const res = await host.request(url, { headers: options.headers }); return { ok: res.statusCode < 400, json: async () => JSON.parse(res.body) } }
    startApp({ document, fetch, setTimeout: clock.setTimeout, now: clock.now }); await new Promise(resolve => setImmediate(resolve))
    assert.match(main.children[0].innerHTML, /✔ 已解析/); assert.match(main.children[0].innerHTML, /✘ 未找到/); assert.match(main.children[0].innerHTML, /把 CLI 装进 PATH/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-090] unknown snapshot fallback is mounted without inventing a config path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-guide-fallback-'))
  try {
    const state = path.join(root, 'state'), file = path.join(root, 'config.json'), config = baseConfig(state)
    config.catalog.manual = []; config.discovery.cli_overrides = {}
    fs.writeFileSync(file, JSON.stringify(config), 'utf8'); fs.mkdirSync(state, { recursive: true }); fs.writeFileSync(path.join(state, 'usage.jsonl'), '{broken', 'utf8')
    const clock = createFakeClock(), host = createHostStub(), ctx = createContext({ env: {}, clock, exec() { throw Error('unexpected execution') } })
    createPlugin(host.ctx, { configPath: file }, { ctx })
    const auth = JSON.parse((await host.request('/cliworker/api/session')).body)
    const headers = { 'x-cliworker-session': auth.session, 'x-cliworker-csrf': auth.csrf }
    const accepted = JSON.parse((await host.request('/cliworker/api/read-usage', { method: 'POST', headers, body: {} })).body)
    await clock.advance(0); await new Promise(resolve => setImmediate(resolve))
    assert.equal(JSON.parse((await host.request(`/cliworker/api/jobs/${accepted.job_id}`, { headers })).body).status, 'failed')
    const snapshot = JSON.parse((await host.request('/cliworker/api/snapshot', { headers })).body)
    assert.equal(snapshot.source, 'unknown'); assert.equal(snapshot.last_error, 'E_CONFIG'); assert.equal(snapshot.config, undefined)
    const { document, main, elements } = page()
    const fetch = async (url, options = {}) => { const res = await host.request(url, { headers: options.headers }); return { ok: res.statusCode < 400, json: async () => JSON.parse(res.body) } }
    startApp({ document, fetch, setTimeout: clock.setTimeout, now: clock.now }); await new Promise(resolve => setImmediate(resolve))
    assert.equal(main.children[0].innerHTML, ''); assert.equal(main.children[0].querySelector('input'), null); assert.match(elements.get('status').textContent, /stale/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-090] dynamic text is escaped in configuration and issue markup', () => {
  const html = renderConfigHtml({ models: [], config: { path: 'C:\\a"<&\'b', hint: '{"<script>":"&"}', providers: [{ name: '<script>', cli: '" onfocus="x', resolved: false }] } })
  assert.match(html, /&quot;/); assert.match(html, /&lt;script&gt;/); assert.match(html, /&amp;/); assert.match(html, /&#39;/)
  assert.doesNotMatch(html, /<script>|<a\b| onfocus="x/)
  const issues = renderIssuesHtml([{ id: '<id>', kind: 'unavailable', subject: '<script>', detail: 'command missing', evidence_ref: '"<&', at: '2026-11-07T00:00:00Z' }])
  assert.match(issues, /下一步/); assert.match(issues, /&lt;script&gt;/); assert.doesNotMatch(issues, /<script>|<a\b/)
})
