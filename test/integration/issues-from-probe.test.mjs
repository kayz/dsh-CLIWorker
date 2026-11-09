import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createPlugin } from '../../lib/index.js'
import { createContext } from '../../lib/context.mjs'
import { probeModels } from '../../lib/probe.mjs'
import { compareVersions, projectProbeIssues } from '../../lib/http/issues-api.mjs'
import { startApp } from '../../ui/app.mjs'
import { renderIssuesHtml } from '../../ui/render.mjs'
import { run as discover } from '../../lib/commands/discover.mjs'
import { secretAction } from '../../lib/secrets/index.mjs'
import { createHostStub } from '../helpers/host-stub.mjs'
import { createFakeClock } from '../helpers/clock.mjs'
import { baseConfig } from '../fixtures/usage/harness.mjs'

test('[AC-086] actual probes reach the guarded snapshot and page, then clear', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-issues-'))
  try {
    const state = path.join(root, 'state'), configFile = path.join(root, 'config.json')
    const config = baseConfig(state); config._home = state
    fs.writeFileSync(configFile, JSON.stringify(config), 'utf8')
    const clock = createFakeClock(), host = createHostStub()
    let mode = 'command missing', executions = 0
    const ctx = createContext({ env: {}, clock, exec(_command, args, options) {
      executions++
      if (args.includes('--version')) {
        if (mode === 'command missing') return { code: null, error: 'ENOENT', stdout: '', stderr: '' }
        if (mode === 'non-zero exit') return { code: 3, stdout: '', stderr: '' }
        if (mode === 'unparsable output') return { code: 0, stdout: 'unknown', stderr: '' }
        return { ok: true, code: 0, stdout: '1.2.3', stderr: '' }
      }
      if (mode === 'timeout') return { code: null, error_code: 'E_TIMEOUT', stdout: '', stderr: '' }
      const nonce = options.input.trim().split(/\s+/).at(-1)
      return { ok: true, code: 0, stdout: JSON.stringify({ type: 'result', model: 'claude:test-model', text: nonce, usage: { input_tokens: 1 } }), stderr: '' }
    } })
    createPlugin(host.ctx, { configPath: configFile }, { ctx })
    const auth = JSON.parse((await host.request('/cliworker/api/session')).body)
    const headers = { 'x-cliworker-session': auth.session }
    const read = async () => JSON.parse((await host.request('/cliworker/api/snapshot', { headers })).body)
    assert.deepEqual((await read()).issues, [])
    for (mode of ['command missing', 'non-zero exit', 'unparsable output', 'timeout']) {
      await probeModels(config, { ctx })
      const before = executions, data = await read(), again = await read()
      assert.equal(executions, before)
      assert.deepEqual(Object.keys(data).sort(), ['at', 'forecast', 'issues', 'last_error', 'models', 'source'])
      assert.equal(data.issues.length, 1)
      const issue = data.issues[0]
      assert.deepEqual(Object.keys(issue).sort(), ['at', 'detail', 'evidence_ref', 'id', 'kind', 'subject'])
      assert.equal(issue.kind, 'unavailable'); assert.equal(issue.subject, 'claude'); assert.equal(issue.detail, mode)
      assert.match(issue.evidence_ref, /probes\.json#claude%3Atest-model\//)
      assert.equal(issue.id, again.issues[0].id)
    }
    const elements = new Map()
    for (const id of ['issues', 'models', 'issues-tab', 'models-tab', 'status', 'model-list', 'issue-source']) elements.set(id, { textContent: '', innerHTML: '', addEventListener() {}, setAttribute() {}, appendChild(child) { this.child = child } })
    const document = { getElementById: id => elements.get(id), createElement: () => ({ innerHTML: '' }), querySelectorAll: () => [] }
    const fetch = async (url, options = {}) => { const response = await host.request(url, { headers: options.headers }); return { ok: response.statusCode < 400, json: async () => JSON.parse(response.body) } }
    startApp({ document, fetch, setTimeout: clock.setTimeout, now: clock.now })
    await new Promise(resolve => setImmediate(resolve))
    const issue = (await read()).issues[0], html = elements.get('issues').child.innerHTML
    for (const value of Object.values(issue)) assert.ok(html.includes(value))
    assert.match(elements.get('issue-source').textContent, /已接入/)
    mode = 'success'; await probeModels(config, { ctx }); await clock.advance(15000); await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual((await read()).issues, [])
    assert.match(elements.get('issues').child.innerHTML, /暂无有证据的问题/)
    assert.doesNotMatch(elements.get('issues').child.innerHTML, /<article/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-086] semver precedence and declared rule evidence', () => {
  for (const [a, b, result] of [['1.9.10', '1.10.0', -1], ['1.2.10', '1.2.9', 1], ['1.0.0-alpha.2', '1.0.0-alpha.10', -1], ['1.0.0-rc.1', '1.0.0', -1], ['1.0.0+one', '1.0.0+two', 0], ['bad', '1.0.0', null]]) assert.equal(compareVersions(a, b), result)
  const e = { id: 'claude', platform: 'linux', version: '1.2.3', evidence: [{ kind: 'probe', exit: 0, at: '2026-11-07T00:00:00Z', digest: 'a'.repeat(64) }] }
  const input = { probes: [], inventory: { entries: [e] }, config: {}, ctx: {}, at: e.evidence[0].at }
  assert.equal(projectProbeIssues({ ...input, rules: [] }).length, 0)
  const issues = projectProbeIssues({ ...input, rules: [{ name: 'claude', minVersion: '1.10.0' }] })
  assert.equal(issues.length, 1); assert.equal(issues[0].kind, 'version-mismatch')
  assert.match(issues[0].detail, /1\.2\.3.*1\.10\.0/)
})

test('[AC-086] configured secrets are checked once and backend failures propagate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-secret-'))
  try {
    const config = baseConfig(root), model = config.catalog.manual[0]
    model.availability = { state: 'blocked', reason: 'auth', at: '2026-11-07T00:00:00Z', ttl_s: 100, evidence: { probe_id: 'one', cmd_redacted: 'claude', exit: 1, duration_ms: 1, nonce_ok: false, reported_model: null, tokens: null } }
    const other = structuredClone(model); other.key = 'claude:second'; other.availability.evidence.probe_id = 'two'
    let calls = 0, backend = 'missing'
    const ctx = createContext({ platform: 'linux', env: {}, exec() { calls++; return backend === 'missing' ? { ok: false, code: 1, stdout: '', stderr: '' } : backend === 'error' ? { code: null, error: 'error' } : { ok: true, code: 0, stdout: 'private-value', stderr: '' } } })
    const input = { probes: [model, other], inventory: null, config, ctx, at: '2026-11-07T00:00:00Z' }
    assert.equal(projectProbeIssues(input).filter(x => x.kind === 'missing-credential').length, 0); assert.equal(calls, 0)
    for (const ref of ['env:PRIVATE_ENV_NAME', 'session:PRIVATE_SESSION_NAME', 'keychain:PRIVATE_KEY_NAME']) {
      config.secrets.claude = { ref }
      const missing = projectProbeIssues(input).filter(x => x.kind === 'missing-credential')
      assert.equal(missing.length, 1); assert.doesNotMatch(JSON.stringify(missing), /PRIVATE_|private-value/)
      if (ref.startsWith('env:')) ctx.env.PRIVATE_ENV_NAME = 'private-value'
      if (ref.startsWith('session:')) secretAction(ctx, config, 'claude', 'set', 'private-value')
      if (ref.startsWith('keychain:')) backend = 'present'
      assert.equal(projectProbeIssues(input).filter(x => x.kind === 'missing-credential').length, 0)
    }
    backend = 'error'
    assert.throws(() => projectProbeIssues(input), { code: 'E_SECRET_BACKEND' })
    assert.equal(calls, 3)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-086] a declared minimum is applied by the real snapshot to discovery evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-rule-'))
  try {
    const script = `
      import { registerHooks } from 'node:module';
      registerHooks({ load(url, context, next) {
        const result = next(url, context);
        if (url.endsWith('/lib/discovery/rules.mjs')) result.source = String(result.source).replace("name: 'claude', versionArgs", "name: 'claude', minVersion: '1.10.0', versionArgs");
        return result;
      }});
      const [{ default: fs }, { default: path }, { createContext }, { run }, { createPlugin }, { createHostStub }, { baseConfig }] = await Promise.all([
        import('node:fs'), import('node:path'), import('./lib/context.mjs'), import('./lib/commands/discover.mjs'), import('./lib/index.js'), import('./test/helpers/host-stub.mjs'), import('./test/fixtures/usage/harness.mjs')
      ]);
      const root = process.env.CW_RULE_ROOT, bin = path.join(root, 'bin'), state = path.join(root, 'state');
      fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'claude.cmd' : 'claude'), 'fixture');
      const config = baseConfig(state); config._home = state;
      const configFile = path.join(root, 'config.json'); fs.writeFileSync(configFile, JSON.stringify(config));
      const ctx = createContext({ env: { PATH: bin }, exec: () => ({ ok: true, code: 0, stdout: '1.9.10', stderr: '' }) });
      const inventory = await run({ argv: ['discover'], ctx, config });
      const host = createHostStub(); createPlugin(host.ctx, { configPath: configFile }, { ctx });
      const session = JSON.parse((await host.request('/cliworker/api/session')).body).session;
      const data = JSON.parse((await host.request('/cliworker/api/snapshot', { headers: { 'x-cliworker-session': session } })).body);
      const issue = data.issues.find(item => item.kind === 'version-mismatch');
      if (!issue || !issue.detail.includes('1.9.10') || !issue.detail.includes('1.10.0') || !issue.evidence_ref.includes(inventory.entries[0].evidence[0].digest)) process.exit(1);
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), env: { ...process.env, CW_RULE_ROOT: root }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-086] snapshot checks configured credentials per provider and retains the page on backend failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-private-person-'))
  try {
    const state = path.join(root, 'state'), file = path.join(root, 'config.json')
    const config = baseConfig(state); config._home = state
    const clock = createFakeClock(), env = {}, host = createHostStub()
    let backend = 'missing', keychainReads = 0, probes = 0
    const fsApi = new Proxy(fs, { get(target, prop) {
      if (prop === 'readFileSync') return (name, ...args) => {
        if (typeof name === 'string' && name.endsWith('.dpapi')) {
          keychainReads++
          if (backend === 'missing') { const error = new Error('missing'); error.code = 'ENOENT'; throw error }
          if (backend === 'error') throw new Error('backend failed')
          return 'controlled-ciphertext'
        }
        return target.readFileSync(name, ...args)
      }
      return target[prop]
    } })
    const ctx = createContext({ fs: fsApi, env, clock, exec(command) {
      if (command === 'secret-tool' || command === 'pwsh') {
        if (command === 'secret-tool') keychainReads++
        if (backend === 'missing') return { ok: false, code: 1, stdout: '', stderr: '' }
        if (backend === 'present') return { ok: true, code: 0, stdout: 'sentinel-secret-value', stderr: '' }
        return { code: null, error: 'backend failed' }
      }
      probes++; return { code: null, error: 'ENOENT', stdout: '', stderr: 'sentinel-secret-value' }
    } })
    fs.writeFileSync(file, JSON.stringify(config), 'utf8')
    await probeModels(config, { ctx })
    const original = JSON.parse(fs.readFileSync(path.join(state, 'probes.json'), 'utf8'))[0]
    const second = structuredClone(original), third = structuredClone(original)
    second.key = 'claude:second'; second.id = 'second'; second.availability.evidence.probe_id = 'second'
    third.key = 'codex:third'; third.id = 'third'; third.cli = 'codex'; third.availability.evidence.probe_id = 'third'
    original.source.ref = path.join(root, 'sentinel-secret-value')
    fs.writeFileSync(path.join(state, 'probes.json'), JSON.stringify([original, second, third]), 'utf8')
    createPlugin(host.ctx, { configPath: file }, { ctx })
    const auth = JSON.parse((await host.request('/cliworker/api/session')).body)
    const headers = { 'x-cliworker-session': auth.session }
    const read = async () => { const response = await host.request('/cliworker/api/snapshot', { headers }); assert.equal(response.statusCode, 200); return JSON.parse(response.body) }
    const update = ref => { config.secrets = ref ? { claude: { ref } } : {}; fs.writeFileSync(file, JSON.stringify(config), 'utf8') }
    const credential = data => data.issues.filter(item => item.kind === 'missing-credential')
    assert.equal(credential(await read()).length, 0); assert.equal(keychainReads, 0)
    for (const ref of ['env:PRIVATE_ENV_NAME', 'session:PRIVATE_SESSION_NAME', 'keychain:PRIVATE_KEY_NAME']) {
      update(ref)
      const before = keychainReads, missing = await read()
      assert.deepEqual(credential(missing).map(item => item.subject).sort(), ['claude', 'codex'])
      assert.equal(keychainReads - before, ref.startsWith('keychain:') ? 1 : 0)
      const repeated = await read()
      assert.deepEqual(credential(repeated).map(item => item.id), credential(missing).map(item => item.id))
      if (ref.startsWith('env:')) env.PRIVATE_ENV_NAME = 'sentinel-secret-value'
      if (ref.startsWith('session:')) secretAction(ctx, config, 'claude', 'set', 'sentinel-secret-value')
      if (ref.startsWith('keychain:')) backend = 'present'
      assert.deepEqual(credential(await read()), [])
      assert.doesNotMatch(JSON.stringify(missing), /PRIVATE_|sentinel-secret-value|cw-private-person/)
    }
    backend = 'missing'
    const elements = new Map()
    for (const id of ['issues', 'models', 'issues-tab', 'models-tab', 'status', 'model-list', 'issue-source']) elements.set(id, { textContent: '', innerHTML: '', addEventListener() {}, setAttribute() {}, appendChild(child) { this.child = child } })
    const document = { getElementById: id => elements.get(id), createElement: () => ({ innerHTML: '' }), querySelectorAll: () => [] }
    const fetch = async (url, options = {}) => { const response = await host.request(url, { headers: options.headers }); return { ok: response.statusCode < 400, json: async () => JSON.parse(response.body) } }
    const app = startApp({ document, fetch, setTimeout: clock.setTimeout, now: clock.now })
    await new Promise(resolve => setImmediate(resolve))
    const before = elements.get('issues').child.innerHTML, executions = probes
    assert.match(before, /missing-credential/)
    backend = 'error'; await app.read()
    assert.equal(elements.get('issues').child.innerHTML, before)
    assert.match(elements.get('status').textContent, /stale/)
    assert.doesNotMatch(before, /PRIVATE_|sentinel-secret-value|cw-private-person/)
    assert.equal(probes, executions)
    const escaped = renderIssuesHtml([{ id: '"<id>', kind: 'x', subject: '<script>', detail: 'a&b', evidence_ref: '<ref>', at: '"' }])
    assert.doesNotMatch(escaped, /<script>|<ref>/); assert.match(escaped, /&lt;script&gt;/); assert.match(escaped, /a&amp;b/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-086] discover failure evidence reaches the snapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-discover-'))
  try {
    const state = path.join(root, 'state'), bin = path.join(root, 'bin'), file = path.join(root, 'config.json')
    fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'claude.cmd' : 'claude'), 'fixture')
    const config = baseConfig(state); config._home = state
    fs.writeFileSync(file, JSON.stringify(config), 'utf8')
    let count = 0, failed = false
    const ctx = createContext({ env: { PATH: bin }, exec() { count++; return failed ? { ok: false, code: 9, stdout: '', stderr: 'secret output' } : { ok: true, code: 0, stdout: '1.2.3', stderr: '' } } })
    await discover({ argv: ['discover'], ctx, config })
    const host = createHostStub(); createPlugin(host.ctx, { configPath: file }, { ctx })
    const session = JSON.parse((await host.request('/cliworker/api/session')).body).session
    const elements = new Map()
    for (const id of ['issues', 'models', 'issues-tab', 'models-tab', 'status', 'model-list', 'issue-source']) elements.set(id, { textContent: '', innerHTML: '', addEventListener() {}, setAttribute() {}, appendChild(child) { this.child = child } })
    const document = { getElementById: id => elements.get(id), createElement: () => ({ innerHTML: '' }), querySelectorAll: () => [] }
    const fetch = async (url, options = {}) => { const response = await host.request(url, { headers: options.headers }); return { ok: response.statusCode < 400, json: async () => JSON.parse(response.body) } }
    startApp({ document, fetch, setTimeout: () => 0 })
    await new Promise(resolve => setImmediate(resolve))
    assert.match(elements.get('issue-source').textContent, /已接入/)
    assert.match(elements.get('issues').child.innerHTML, /暂无有证据的问题/)
    assert.doesNotMatch(elements.get('issues').child.innerHTML, /<article/)
    failed = true
    const inventory = await discover({ argv: ['discover', '--full'], ctx, config })
    const before = count
    const response = await host.request('/cliworker/api/snapshot', { headers: { 'x-cliworker-session': session } })
    const issues = JSON.parse(response.body).issues
    assert.equal(count, before); assert.equal(issues.length, 1); assert.equal(issues[0].kind, 'unavailable')
    assert.equal(issues[0].subject, 'claude'); assert.equal(issues[0].detail, 'non-zero exit')
    assert.ok(issues[0].evidence_ref.includes(inventory.entries[0].evidence[0].digest))
    assert.doesNotMatch(response.body, /secret output|cw-discover-/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
