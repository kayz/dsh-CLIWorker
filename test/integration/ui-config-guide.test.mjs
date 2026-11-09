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
import { createHostStub } from '../helpers/host-stub.mjs'
import { createFakeClock } from '../helpers/clock.mjs'
import { baseConfig } from '../fixtures/usage/harness.mjs'

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
    const elements = new Map()
    const element = () => ({ innerHTML: '', textContent: '', children: [], listeners: {}, appendChild(child) { this.children.push(child) }, addEventListener(event, cb) { this.listeners[event] = cb }, setAttribute() {} })
    for (const id of ['issues', 'models', 'issues-tab', 'models-tab', 'status', 'model-list', 'issue-source']) elements.set(id, element())
    const main = element()
    const document = { getElementById: id => elements.get(id), createElement: element, querySelector: () => main, querySelectorAll: () => [] }
    const fetch = async (url, options = {}) => { if (options.method === 'POST') posts++; if (fail && url.endsWith('/snapshot')) throw Error('offline'); const response = await host.request(url, { headers: options.headers }); return { ok: response.statusCode < 400, json: async () => JSON.parse(response.body) } }
    const app = startApp({ document, fetch, setTimeout: clock.setTimeout, now: clock.now })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(main.children.length, 1)
    const section = main.children[0]
    assert.match(section.innerHTML, /配置文件路径/); assert.ok(section.innerHTML.includes(file.replace(/&/g, '&amp;')))
    assert.match(section.innerHTML, /✘ 未找到/); assert.match(section.innerHTML, /把 CLI 装进 PATH/); assert.match(section.innerHTML, /把 cli 指向可执行文件绝对路径/)
    assert.match(elements.get('issues').children[0].innerHTML, /下一步.*claude.*PATH/)
    elements.get('models-tab').listeners.click(); assert.equal(section.hidden, undefined)
    const previous = section.innerHTML; fail = true; await app.read(); assert.equal(section.innerHTML, previous); assert.match(elements.get('status').textContent, /stale/)
    fail = false; mode = 'nonzero'; await clock.advance(1000); await probeModels(config, { ctx }); await app.read()
    assert.match(section.innerHTML, /✔ 已解析/); assert.match(section.innerHTML, /把 CLI 装进 PATH/)
    mode = 'success'; await clock.advance(1000); await probeModels(config, { ctx }); config.catalog.manual[0].availability.state = 'callable'; fs.writeFileSync(file, JSON.stringify(config), 'utf8'); await app.read()
    assert.doesNotMatch(section.innerHTML, /把 CLI 装进 PATH/); assert.match(section.innerHTML, /配置/)
    assert.equal(main.children.length, 1); assert.equal(posts, 0)
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
