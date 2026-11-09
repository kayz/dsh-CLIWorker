import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync('lib/client.js', 'utf8')
const session = { schema: 'cliworker.session/v1', session: 'secret-session', csrf: 'secret-csrf' }
const snapshot = changes => ({ at: '2026-01-01T00:00:00Z', source: 'fixture', models: [{ key: 'model', provider: 'p', allowed: false, level: 0, availability: { state: 'callable', at: '2026-01-01T00:00:00Z', ttl_s: 60, evidence: {} } }], forecast: [{ model: 'model', tasks_left: 0 }], issues: [{ subject: 'issue', detail: 'detail' }], config: { path: '/config', providers: [{ name: 'p', cli: 'cli', resolved: true }] }, ...changes })
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const nodes = tree => tree == null || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)]
const content = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : tree.children.map(content).join(' ')
const section = (app, title) => nodes(app.tree).find(n => n.type === 'section' && n.children.some(c => c?.type === 'h2' && content(c) === title))
const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && content(n) === label)
function shell(app) {
  assert.ok(nodes(app.tree).some(n => n.type === 'h1' && content(n) === 'CLIWorker'))
  assert.ok(nodes(app.tree).some(n => n.props.role === 'status'))
  assert.ok(button(app.tree, '刷新'))
  for (const title of ['模型', '问题', '配置']) assert.ok(section(app, title), title)
}
function setup(fetcher) {
  let entry, tree, cursor = 0, effect, cleanup, mounted = true
  const hooks = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { assert.ok(mounted); hooks[i] = value; render() }] },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial } },
    useEffect(fn) { cursor++; if (!effect) effect = fn },
  }
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { entry = value } } }, fetch: fetcher })
  const client = entry.factory(() => React), registered = []
  client.apply({ slots: { inject: (name, cb) => cb(), register: (meta, component) => registered.push({ meta, component }) } })
  const Page = registered.find(item => item.meta.name === 'main').component
  function render() { cursor = 0; tree = Page() }
  render()
  return { get tree() { return tree }, mount() { cleanup = effect(); return this }, unmount() { cleanup(); mounted = false } }
}

test('[AC-091] loading, success, failure and retry retain section ownership', async () => {
  const s = deferred(), d = deferred(), calls = []
  let mode = 'delayed'
  const app = setup((path, options) => { calls.push([path, options]); if (mode === 'delayed') return path.endsWith('session') ? s.promise : d.promise; return Promise.resolve(response(snapshot())) })
  for (const phase of [0, 1, 2]) {
    shell(app); for (const title of ['模型', '问题', '配置']) assert.match(content(section(app, title)), /加载中/)
    assert.equal(button(app.tree, '刷新').props.disabled, true); assert.doesNotMatch(content(app.tree), /暂无模型/)
    if (phase === 0) app.mount()
    if (phase === 1) { s.resolve(response(session)); await tick() }
  }
  d.resolve(response({}, 500)); await tick(); shell(app)
  assert.match(content(section(app, '模型')), /读取失败.*snapshot.*HTTP 500/)
  assert.match(content(section(app, '问题')), /暂无问题数据/)
  assert.match(content(section(app, '配置')), /配置摘要不可用.*README\.md.*unknown.*unknown/)
  assert.doesNotMatch(content(section(app, '配置')), /未找到|\/config|HTTP 500/)
  mode = 'success'; button(section(app, '模型'), '重试').props.onClick(); await tick(); shell(app)
  assert.match(content(section(app, '模型')), /model.*false.*0.*callable.*remaining 0/)
  assert.match(content(section(app, '问题')), /issue.*detail/)
  assert.match(content(section(app, '配置')), /\/config.*已解析/)
  assert.doesNotMatch(content(app.tree), /读取失败|secret-session|secret-csrf/)
  assert.ok(calls.every(([, options]) => options.method === 'GET')); assert.equal(button(app.tree, '刷新').props.disabled, false)
  app.unmount()
})

test('[AC-091] independent missing and malformed fields', async () => {
  let value = snapshot(); const app = setup(async path => response(path.endsWith('session') ? session : value)).mount(); await tick()
  async function show(changes) { value = snapshot(changes); button(app.tree, '刷新').props.onClick(); await tick(); shell(app) }
  for (const config of [undefined, null, 'bad', []]) { await show({ config }); assert.match(content(section(app, '配置')), /配置摘要不可用.*README\.md/); assert.match(content(section(app, '模型')), /model/); assert.match(content(section(app, '问题')), /issue/) }
  for (const models of [[], undefined, null, 'bad']) { await show({ models }); assert.match(content(section(app, '模型')), /暂无模型.*下方配置区.*刷新/); assert.match(content(section(app, '配置')), /\/config.*已解析/); assert.match(content(section(app, '问题')), /issue/) }
  for (const issues of [undefined, null, 'bad']) { await show({ issues }); assert.match(content(section(app, '问题')), /暂无问题数据.*刷新/) }
  await show({ issues: [] }); assert.match(content(section(app, '问题')), /暂无问题/)
  for (const forecast of [undefined, 'bad']) { await show({ forecast }); assert.match(content(section(app, '模型')), /model.*remaining unknown/) }
  await show({ models: [null, {}, { key: 'm', availability: { state: 'callable', at: '2026-01-01T00:00:00Z', ttl_s: 60 } }], forecast: [{ model: 'm', tasks_left_assumed: 0 }], issues: [null, {}], config: { path: '/x', providers: [null, { resolved: true }, { resolved: false }, {}] } })
  assert.match(content(section(app, '模型')), /unknown.*m.*availability unknown.*assumed 0/)
  assert.match(content(section(app, '问题')), /unknown/); assert.match(content(section(app, '配置')), /已解析.*未找到.*unknown/)
  for (const providers of [undefined, 'bad']) { await show({ config: { path: '/x', providers } }); assert.match(content(section(app, '配置')), /\/x.*解析状态不可用/) }
  app.unmount()
})

test('[AC-091] failures preserve previous snapshot and recovery replaces it', async () => {
  let next = response(snapshot()); const app = setup(async path => path.endsWith('session') ? response(session) : next).mount(); await tick()
  next = response({}, 500); button(app.tree, '刷新').props.onClick(); await tick()
  assert.match(content(section(app, '模型')), /stale.*读取失败.*model.*stale/); assert.match(content(section(app, '问题')), /issue/); assert.match(content(section(app, '配置')), /上次数据.*\/config.*已解析/)
  next = response(snapshot({ models: [{ key: 'new' }], config: null, issues: null })); button(section(app, '模型'), '重试').props.onClick(); await tick()
  assert.match(content(section(app, '模型')), /new/); assert.doesNotMatch(content(app.tree), /读取失败|\/config|issue/); assert.match(content(section(app, '问题')), /暂无问题数据/); assert.match(content(section(app, '配置')), /配置摘要不可用/)
  next = response(snapshot({ last_error: { code: 'E_INTERNAL' } })); button(app.tree, '刷新').props.onClick(); await tick(); assert.match(content(section(app, '模型')), /stale.*last_error.*model.*stale/)
  app.unmount()
})

test('[AC-091] initial request failures remain inline', async () => {
  for (const [failure, expected, sessionFailure] of [[response({}, 403), /session.*403/, true], [null, /snapshot.*network error/, false], [{ ok: true, status: 200, json: async () => { throw Error('secret') } }, /snapshot.*invalid JSON/, false], ...[null, [], {}].map(value => [response(value), /snapshot.*invalid response/, false])]) {
    const app = setup(async path => { if (path.endsWith('session') && !sessionFailure) return response(session); if (failure === null) throw Error('secret'); return failure }).mount(); await tick(); shell(app)
    assert.match(content(section(app, '模型')), expected); assert.ok(button(section(app, '模型'), '重试')); assert.match(content(section(app, '配置')), /unknown/); assert.doesNotMatch(content(app.tree), /secret/); app.unmount()
  }
})
