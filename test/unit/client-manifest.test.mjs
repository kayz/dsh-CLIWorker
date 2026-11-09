import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { runNpmPack } from '../../scripts/check-package-contents.mjs'

const source = fs.readFileSync('lib/client.js', 'utf8')
const session = { schema: 'cliworker.session/v1', session: 'secret-session', csrf: 'secret-csrf' }
const snapshot = overrides => ({ models: [], forecast: [], issues: [], source: 'fixture', at: '2026-01-01', last_error: null, ...overrides })
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const tick = () => new Promise(resolve => setImmediate(resolve))

function setup(fetcher = () => { throw Error('unexpected fetch') }) {
  let entry, tree, cursor = 0, effect, cleanup, mounted = true, updates = 0
  const hooks = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { if (!mounted) throw Error('update after unmount'); hooks[i] = value; updates++; render() }] },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial } },
    useEffect(fn) { cursor++; if (!effect) effect = fn },
  }
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { entry = value } } }, fetch: fetcher })
  const client = entry.factory(id => { assert.equal(id, 'react'); return React })
  const registered = []
  function render() { cursor = 0; tree = Page() }
  client.apply({ slots: { inject: (name, cb) => cb(), register: (meta, component) => registered.push({ meta, component }) } })
  const Page = registered.find(item => item.meta.name === 'main').component
  return { entry, client, registered, mount() { render(); cleanup = effect(); return this }, get tree() { return tree }, get updates() { return updates }, unmount() { cleanup(); mounted = false } }
}
function nodes(tree) { return tree == null || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)] }
function content(tree) { return tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : tree.children.map(content).join(' ') }
function refresh(app) { nodes(app.tree).find(node => node.type === 'button').props.onClick() }

test('[AC-089] manifest and icon', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json'))
  const plugin = JSON.parse(fs.readFileSync('dsh.plugin.json'))
  assert.equal(plugin.client.platform, 'web'); assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['./client'], './lib/client.js'); assert.equal(pkg.exports['./icon'], './icon.svg'); assert.ok(pkg.files.includes('icon.svg'))
  for (const file of [pkg.exports['./client'], pkg.exports['./icon']]) assert.ok(fs.statSync(file).size)
  const svg = fs.readFileSync('icon.svg', 'utf8')
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/); assert.match(svg, /viewBox="0 0 24 24"/); assert.match(svg, /currentColor/); assert.match(svg, /<path/); assert.doesNotMatch(svg, /<(?:script|image|foreignObject)\b/)
  const pack = runNpmPack(process.cwd()); assert.equal(pack.error, null)
  for (const file of ['lib/client.js', 'icon.svg', 'dsh.plugin.json', 'package.json']) assert.ok(pack.files.includes(file), file)
})
test('[AC-089] loader exports and slots', () => {
  const app = setup(); assert.equal(app.entry.id, 'dsh-cliworker'); assert.equal(app.client.name, 'dsh-cliworker'); assert.deepEqual(Array.from(app.client.inject), ['slots']); assert.equal(typeof app.client.apply, 'function')
  assert.equal(app.registered.length, 2); assert.equal(app.registered[0].meta.id, 'cliworker'); assert.equal(app.registered[0].meta.order, 30); assert.equal(app.registered[0].meta.label, 'CLIWorker'); assert.equal(app.registered[1].meta.key, 'cliworker')
  const icon = app.registered[0].component(); assert.equal(icon.type, 'svg'); assert.equal(icon.props.viewBox, '0 0 24 24'); assert.equal(icon.props.stroke, 'currentColor')
})
test('[AC-089] missing slots', () => {
  const { client } = setup()
  for (const ctx of [undefined, null, {}, { slots: {} }, { slots: { inject(cb) {} } }, { get slots() { throw Error('no') } }]) assert.doesNotThrow(() => client.apply(ctx))
})
test('[AC-089] registration failure isolation', () => {
  const { client } = setup()
  for (const failed of ['main', 'sidebar.panellist']) for (const phase of ['inject', 'register']) {
    const successes = []
    assert.doesNotThrow(() => client.apply({ slots: { inject(name, cb) { if (phase === 'inject' && name === failed) throw Error(); cb() }, register(meta) { if (phase === 'register' && meta.name === failed) throw Error(); successes.push(meta.name) } } }))
    assert.deepEqual(successes, [failed === 'main' ? 'sidebar.panellist' : 'main'])
  }
})
test('[AC-089] deferred registration failure isolation', () => {
  const { client } = setup()
  for (const failed of ['main', 'sidebar.panellist']) {
    const callbacks = [], successes = []
    client.apply({ slots: { inject(name, cb) { callbacks.push(cb) }, register(meta) { if (meta.name === failed) throw Error(); successes.push(meta.name) } } })
    callbacks.forEach(cb => assert.doesNotThrow(cb)); assert.deepEqual(successes, [failed === 'main' ? 'sidebar.panellist' : 'main'])
  }
  const callbacks = []; client.apply({ slots: { inject(name, cb) { callbacks.push(cb) } } }); callbacks.forEach(cb => assert.doesNotThrow(cb))
})
test('[AC-089] session and snapshot rendering', async () => {
  const calls = []; let value = snapshot({ models: [{ key: '<model>', provider: 'p', allowed: false, level: 0, availability: { state: 'callable', at: new Date().toISOString(), ttl_s: 60, evidence: {} } }], forecast: [{ model: '<model>', tasks_left: 0 }], issues: [{ subject: '<issue>', detail: 'detail', at: 'time', evidence_ref: 'evidence' }] })
  const app = setup(async (path, options) => { calls.push([path, options]); return response(path.endsWith('/session') ? session : value) }).mount()
  await tick(); assert.deepEqual(calls.map(c => c[0]), ['/cliworker/api/session', '/cliworker/api/snapshot']); assert.equal(calls[1][1].headers['x-cliworker-session'], session.session); assert.ok(calls.every(c => c[1].method === 'GET'))
  assert.match(content(app.tree), /<model>.*false.*0.*callable.*remaining 0/); assert.match(content(app.tree), /<issue>.*detail.*evidence/); assert.ok(!nodes(app.tree).some(n => n.props.dangerouslySetInnerHTML))
  value = snapshot({ models: [{ key: 'second', provider: 'other' }] }); refresh(app); await tick(); assert.match(content(app.tree), /second/); assert.doesNotMatch(content(app.tree), /<model>/); app.unmount()
})
test('[AC-089] errors and retry', async () => {
  let queue = [response({}, 403), response(session), response(snapshot())]; const calls = []
  const app = setup(async path => { calls.push(path); const next = queue.shift(); if (next instanceof Error) throw next; return next }).mount()
  await tick(); assert.match(content(app.tree), /session.*403/); assert.doesNotMatch(content(app.tree), /暂无模型/); refresh(app); await tick(); assert.match(content(app.tree), /暂无模型/)
  for (const failure of [response({}, 500), Error('network'), { ok: true, status: 200, json: async () => { throw Error() } }, response({})]) {
    queue = [failure]; refresh(app); await tick(); assert.match(content(app.tree), /stale.*snapshot/); assert.match(content(app.tree), /暂无模型/)
  }
  queue = [response({ error: { code: 'E_ADMIN_REQUIRED' } }, 403), response(session), response({ error: { code: 'E_ADMIN_REQUIRED' } }, 403)]; const before = calls.length; refresh(app); await tick(); assert.equal(calls.length - before, 3); assert.match(content(app.tree), /E_ADMIN_REQUIRED/)
  queue = [response(snapshot({ source: 'recovered' }))]; refresh(app); await tick(); assert.match(content(app.tree), /recovered/); assert.doesNotMatch(content(app.tree), /E_ADMIN_REQUIRED|secret-session|secret-csrf/); app.unmount()
})
test('[AC-089] empty stale and unmount', async () => {
  let resolvePending; let calls = 0; let value = snapshot()
  const app = setup(async path => { calls++; if (path.endsWith('/session')) return response(session); if (value === null) return new Promise(resolve => { resolvePending = resolve }); return response(value) }).mount()
  await tick(); assert.match(content(app.tree), /暂无模型/)
  value = snapshot({ models: [{ key: 'm', allowed: false, level: 0, availability: { state: 'callable', at: new Date().toISOString(), ttl_s: 100 } }], forecast: [{ model: 'm', tasks_left_assumed: 0 }] }); refresh(app); await tick(); assert.match(content(app.tree), /false.*0.*unknown.*assumed 0/)
  value = snapshot({ models: [{ key: 'invalid', availability: { state: 'unknown', at: new Date().toISOString(), ttl_s: 100 } }], forecast: [{ model: 'invalid', tasks_left: 'bad', remaining_fraction: null }] }); refresh(app); await tick(); assert.match(content(app.tree), /invalid.*remaining unknown/)
  value = snapshot({ models: [{ key: 'old', availability: { state: 'callable', at: '2000-01-01', ttl_s: 1 } }], last_error: { code: 'E_INTERNAL' } }); refresh(app); await tick(); assert.match(content(app.tree), /stale.*last_error/); assert.match(content(app.tree), /old.*stale/)
  value = null; refresh(app); const before = calls; refresh(app); assert.equal(calls, before); const updates = app.updates; app.unmount(); resolvePending(response({ error: { code: 'E_ADMIN_REQUIRED' } }, 403)); await tick(); assert.equal(calls, before); assert.equal(app.updates, updates)
})
