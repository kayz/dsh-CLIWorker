import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { createContext } from '../../lib/context.mjs'
import { buildDirectCall } from '../../lib/adapters/call.mjs'
import {
  createCliDescriptor,
  createDeepSeekDescriptor,
  createHttpDescriptor,
  identityFromResponse,
  usageFromResponse,
} from '../../lib/providers/registry.mjs'
import { callHttpProvider } from '../../lib/providers/http-openai.mjs'
import { commitHttpUsage } from '../../lib/usage/ledger.mjs'
import { readJsonl } from '../../lib/store.mjs'
import { usageFile } from '../../lib/commands/_util.mjs'
import { evaluatePools } from '../../lib/pools.mjs'

const STATE = '/state'
const SECRET = 'sk-contract-secret-value'
const START = Date.parse('2026-11-09T00:00:00.000Z')
const MODELS = ['deepseek-flash', 'deepseek-v4-pro']

async function flush() {
  for (let index = 0; index < 50; index += 1) await Promise.resolve()
}

function makeClock(start = START) {
  let now = start
  let seq = 0
  const timers = new Map()
  const clock = {
    now: () => now,
    nowIso: () => new Date(now).toISOString(),
    setNow: (value) => { now = value },
    setTimeout(fn, ms) {
      const handle = { id: (seq += 1) }
      timers.set(handle, { fn, due: now + Math.max(0, Number(ms) || 0), id: handle.id })
      return handle
    },
    clearTimeout(handle) { timers.delete(handle) },
    pending: () => timers.size,
    sleep(ms) { now += ms; return Promise.resolve() },
    async advance(ms) {
      const target = now + ms
      for (;;) {
        let next = null
        for (const [handle, timer] of timers) {
          if (timer.due > target) continue
          if (!next || timer.due < next.timer.due || (timer.due === next.timer.due && timer.id < next.timer.id)) {
            next = { handle, timer }
          }
        }
        if (!next) break
        now = Math.max(now, next.timer.due)
        timers.delete(next.handle)
        next.timer.fn()
        await Promise.resolve()
      }
      now = target
    },
  }
  return clock
}

function makeMemFs({ clock, files = {} } = {}) {
  const entries = new Map()
  const dirs = new Set()
  const calls = []
  const failures = new Map()
  const nowMs = () => clock.now()
  const norm = (target) => path.resolve(String(target))

  for (const [key, value] of Object.entries(files)) entries.set(norm(key), String(value))

  const touch = (method) => {
    calls.push(method)
    const plan = failures.get(method)
    if (!plan) return
    if (plan.remaining !== Infinity) {
      plan.remaining -= 1
      if (plan.remaining <= 0) failures.delete(method)
    }
    throw Object.assign(new Error(`injected ${method} failure`), { code: plan.code })
  }
  const missing = (target) => Object.assign(new Error(`ENOENT: ${target}`), { code: 'ENOENT' })
  const put = (target, text) => entries.set(target, { text, mtimeMs: nowMs() })

  const api = {
    readFileSync(target, encoding) {
      const file = norm(target)
      touch('readFileSync')
      const entry = entries.get(file)
      if (!entry) throw missing(file)
      return encoding ? entry.text : Buffer.from(entry.text, 'utf8')
    },
    writeFileSync(target, data, options) {
      const file = norm(target)
      touch('writeFileSync')
      const opts = typeof options === 'string' ? {} : options || {}
      if (opts.flag === 'wx' && entries.has(file)) {
        throw Object.assign(new Error(`EEXIST: ${file}`), { code: 'EEXIST' })
      }
      put(file, String(data))
    },
    appendFileSync(target, data) {
      const file = norm(target)
      touch('appendFileSync')
      const entry = entries.get(file)
      put(file, (entry ? entry.text : '') + String(data))
    },
    mkdirSync(target) {
      const dir = norm(target)
      touch('mkdirSync')
      dirs.add(dir)
      for (let parent = path.dirname(dir); parent !== dir; parent = path.dirname(parent)) {
        dirs.add(parent)
        if (path.dirname(parent) === parent) break
      }
    },
    existsSync(target) {
      const file = norm(target)
      touch('existsSync')
      return entries.has(file) || dirs.has(file)
    },
    statSync(target) {
      const file = norm(target)
      touch('statSync')
      const entry = entries.get(file)
      if (entry) return { isFile: () => true, isDirectory: () => false, size: entry.text.length, mtimeMs: entry.mtimeMs }
      if (dirs.has(file)) return { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: nowMs() }
      throw missing(file)
    },
    renameSync(from, to) {
      const source = norm(from)
      const destination = norm(to)
      touch('renameSync')
      const entry = entries.get(source)
      if (!entry) throw missing(source)
      entries.delete(source)
      entries.set(destination, entry)
    },
    rmSync(target) {
      const file = norm(target)
      touch('rmSync')
      if (!entries.delete(file)) dirs.delete(file)
    },
  }

  api.calls = calls
  api.text = (target) => {
    const entry = entries.get(norm(target))
    return entry ? entry.text : null
  }
  api.setFile = (target, text) => put(norm(target), String(text))
  api.failNext = (method, code) => failures.set(method, { code, remaining: 1 })
  api.files = () => [...entries.values()].map((entry) => entry.text)
  return api
}

function makeHeaders(values = {}) {
  const map = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]))
  return { get(name) { return map.has(String(name).toLowerCase()) ? map.get(String(name).toLowerCase()) : null } }
}

function makeResponse({ status = 200, body, headers = {} } = {}) {
  const text = typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: makeHeaders(headers),
    async text() { return text },
  }
}

function makeFetch(sequence) {
  const calls = []
  let index = 0
  const fn = async (url, init) => {
    calls.push({ url, init })
    const next = sequence[index]
    index += 1
    if (typeof next === 'function') return next(url, init)
    if (next instanceof Error) throw next
    if (next === undefined) throw new Error('unexpected fetch')
    return makeResponse(next)
  }
  fn.calls = calls
  fn.count = () => calls.length
  return fn
}

function fakeStream() {
  const parts = []
  return {
    write(chunk) { parts.push(String(chunk)); return true },
    text() { return parts.join('') },
  }
}

function makeCtx({ env = {}, fetch, files = {}, clock = makeClock() } = {}) {
  const fs = makeMemFs({ clock, files })
  const stdout = fakeStream()
  const stderr = fakeStream()
  const execCalls = []
  const exec = (...args) => {
    execCalls.push(args)
    throw new Error('exec must not be called')
  }
  exec.calls = execCalls
  let seed = 123456789
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const ctx = createContext({ env, fs, clock, fetch, exec, random, platform: 'linux', stdout, stderr })
  return { ctx, fs, clock, exec, stdout, stderr }
}

function makeConfig({ pools = [], apiKeyEnv = 'DEEPSEEK_API_KEY', secrets = {} } = {}) {
  return { _home: STATE, apiKeyEnv, pools, secrets, policy: {} }
}

function descriptorFor(models = MODELS, provider = 'deepseek') {
  return createHttpDescriptor({
    provider,
    base_url: 'https://api.deepseek.com',
    chat_path: '/chat/completions',
    supported_models: models,
  })
}

function httpModel(id = 'deepseek-flash') {
  return { key: id, id, provider: 'deepseek', prices: { input_per_mtok: 1, output_per_mtok: 2 } }
}

function cliModel(id = 'deepseek-flash') {
  return { key: id, id, provider: 'codebuddy', prices: { input_per_mtok: 1, output_per_mtok: 2 } }
}

function replyBody(options = {}) {
  const model = Object.hasOwn(options, 'model') ? options.model : 'deepseek-flash'
  const content = Object.hasOwn(options, 'content') ? options.content : 'hello'
  const usage = Object.hasOwn(options, 'usage') ? options.usage : { prompt_tokens: 123, completion_tokens: 45 }
  const body = { choices: [{ message: { role: 'assistant', content } }] }
  if (model !== undefined) body.model = model
  if (usage !== undefined) body.usage = usage
  return body
}

async function run(sequence, {
  env = { DEEPSEEK_API_KEY: SECRET },
  config = makeConfig(),
  descriptor = descriptorFor(),
  model = httpModel(),
  messages = [{ role: 'user', content: 'hi' }],
  timeout_ms,
} = {}) {
  const clock = makeClock()
  const fetch = makeFetch(sequence)
  const made = makeCtx({ env, fetch, clock })
  const result = await callHttpProvider({
    descriptor, config, model, ctx: made.ctx, messages, timeout_ms,
  })
  return { result, fetch, ...made }
}

test('[AC-078] registry exposes both transports, the exact DeepSeek endpoint and injected models', async () => {
  const descriptor = descriptorFor()
  const deepseek = createDeepSeekDescriptor({ supported_models: MODELS })
  assert.equal(deepseek.endpoint, 'https://api.deepseek.com/chat/completions')
  assert.equal(deepseek.transport, 'http')
  assert.equal(deepseek.provider, 'deepseek')

  assert.equal(descriptor.transport, 'http')
  assert.equal(descriptor.base_url, 'https://api.deepseek.com')
  assert.equal(descriptor.chat_path, '/chat/completions')
  assert.equal(descriptor.endpoint, 'https://api.deepseek.com/chat/completions')
  assert.deepEqual(descriptor.supported_models, MODELS)
  assert.equal(typeof descriptor.identity_hook, 'function')
  assert.equal(typeof descriptor.usage_hook, 'function')
  assert.equal(Object.isFrozen(descriptor), true)

  const cli = createCliDescriptor({ provider: 'codebuddy' })
  assert.equal(cli.transport, 'cli')
  const options = {
    model: { provider: 'codebuddy', id: 'deepseek-flash' },
    config: { discovery: { cli_overrides: { codebuddy: { cli: 'codebuddy' } } } },
    cwd: '/work',
    platform: 'linux',
    readonly: false,
  }
  assert.deepEqual(cli.buildCall(options), buildDirectCall(options))

  const custom = descriptorFor(['injected-model'])
  const { result, fetch, exec } = await run([
    { status: 200, body: replyBody({ model: 'injected-model' }) },
  ], { descriptor: custom, model: httpModel('injected-model') })
  assert.equal(result.ok, true)
  assert.equal(result.identity, 'verified')
  assert.equal(JSON.parse(fetch.calls[0].init.body).model, 'injected-model')
  assert.equal(exec.calls.length, 0)
})

test('[AC-078] full library path: env reference, non-streaming POST, 123/45 ledger row', async () => {
  const config = makeConfig({
    pools: [{ id: 'deepseek:pool', capacity_mtok: { 'deepseek:deepseek-flash': { value: 10 } } }],
  })
  const beforeConfig = structuredClone(config)
  const env = { DEEPSEEK_API_KEY: SECRET }
  const clock = makeClock()
  const fetch = makeFetch([{ status: 200, body: replyBody() }])
  const { ctx, fs, exec, stdout, stderr } = makeCtx({ env, fetch, clock })
  const messages = [{ role: 'user', content: 'hello' }]

  const result = await callHttpProvider({
    descriptor: descriptorFor(), config, model: httpModel(), ctx, messages,
  })

  assert.equal(result.ok, true)
  assert.equal(result.reply, 'hello')
  assert.equal(result.identity, 'verified')
  assert.equal(result.identity_source, 'response.model')
  assert.deepEqual(result.usage, { input_tokens: 123, output_tokens: 45, known: true })
  assert.equal(result.attempts, 1)
  assert.equal(fetch.count(), 1)
  assert.equal(exec.calls.length, 0)

  const call = fetch.calls[0]
  assert.equal(call.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.redirect, 'manual')
  assert.equal(call.init.headers.Authorization, `Bearer ${SECRET}`)
  assert.deepEqual(JSON.parse(call.init.body), { model: 'deepseek-flash', messages, stream: false })
  assert.equal(call.url.includes(SECRET), false)
  assert.equal(call.init.body.includes(SECRET), false)
  assert.equal('Authorization' in result, false)
  assert.equal(result.reason, null)

  assert.deepEqual(config, beforeConfig)
  assert.deepEqual(env, { DEEPSEEK_API_KEY: SECRET })

  const committed = await commitHttpUsage(config, {
    ctx, descriptor: descriptorFor(), model: httpModel(), result, idempotency_key: 'task:one',
  })
  assert.equal(committed.written, true)
  const rows = readJsonl(ctx, usageFile(config, ctx))
  assert.equal(rows.length, 1)
  const row = rows[0]
  assert.equal(row.schema, 'cliworker.usage/v1')
  assert.equal(row.model, 'deepseek:deepseek-flash')
  assert.deepEqual(row.pools, ['deepseek:pool'])
  assert.equal(row.input_tokens, 123)
  assert.equal(row.output_tokens, 45)
  assert.equal(row.cache_read_tokens, 0)
  assert.equal(row.cache_write_tokens, 0)
  assert.equal(row.kind, 'task')
  assert.equal(row.at, clock.nowIso())

  const everything = [
    JSON.stringify(result), JSON.stringify(row), ...fs.files(), stdout.text(), stderr.text(),
  ].join('\n')
  assert.equal(everything.includes(SECRET), false)
  assert.equal(everything.includes('Authorization'), false)
})

test('[AC-078] a response or exception that echoes the secret is redacted everywhere', async () => {
  const echoed = await run([{
    status: 200,
    body: replyBody({ model: SECRET, content: `the credential is ${SECRET}` }),
  }])
  assert.equal(echoed.result.ok, true)
  assert.equal(echoed.result.identity, 'observed')
  assert.equal(echoed.result.reported_model, '[REDACTED]')
  assert.equal(echoed.result.reply.includes('[REDACTED]'), true)
  const echoedText = [JSON.stringify(echoed.result), echoed.stdout.text(), echoed.stderr.text(), ...echoed.fs.files()].join('\n')
  assert.equal(echoedText.includes(SECRET), false)

  const failed = await run([new Error(`backend said ${SECRET}`)])
  assert.equal(failed.result.ok, false)
  assert.equal(failed.result.error.code, 'E_PROVIDER_FAILED')
  assert.equal(failed.result.error.message.includes(SECRET), false)
  const failedText = [JSON.stringify(failed.result), failed.stdout.text(), failed.stderr.text(), ...failed.fs.files()].join('\n')
  assert.equal(failedText.includes(SECRET), false)
})

test('[AC-078] credential references and invalid local input fail before any fetch', async () => {
  const cases = [
    { name: 'missing env', env: {}, code: 'E_SECRET_BACKEND', message: /DEEPSEEK_API_KEY/, config: makeConfig() },
    { name: 'empty env', env: { DEEPSEEK_API_KEY: '' }, code: 'E_SECRET_BACKEND', message: /DEEPSEEK_API_KEY/, config: makeConfig() },
    { name: 'invalid name', env: { 'BAD-NAME': 'x' }, code: 'E_REQUEST_INVALID', config: makeConfig({ apiKeyEnv: 'BAD-NAME' }) },
    { name: 'inline field', env: { DEEPSEEK_API_KEY: 'x' }, code: 'E_CONFIG_SECRET_INLINE', config: { ...makeConfig(), apiKey: SECRET } },
    { name: 'inline secrets field', env: { DEEPSEEK_API_KEY: 'x' }, code: 'E_CONFIG_SECRET_INLINE', config: { ...makeConfig(), secrets: { deepseek: SECRET } } },
    { name: 'inline env shape', env: {}, code: 'E_CONFIG_SECRET_INLINE', config: makeConfig({ apiKeyEnv: `env:DEEPSEEK_API_KEY` }) },
    { name: 'inline key shape', env: {}, code: 'E_CONFIG_SECRET_INLINE', config: makeConfig({ apiKeyEnv: SECRET }) },
    { name: 'unsupported model', env: { DEEPSEEK_API_KEY: SECRET }, code: 'E_REQUEST_INVALID', model: httpModel('unknown-model') },
    { name: 'empty messages', env: { DEEPSEEK_API_KEY: SECRET }, code: 'E_REQUEST_INVALID', messages: [] },
    { name: 'invalid timeout', env: { DEEPSEEK_API_KEY: SECRET }, code: 'E_REQUEST_INVALID', timeout_ms: 0 },
  ]

  for (const item of cases) {
    const { result, fetch, exec } = await run([], {
      env: item.env,
      config: item.config || makeConfig(),
      model: item.model || httpModel(),
      messages: item.messages || [{ role: 'user', content: 'hi' }],
      timeout_ms: item.timeout_ms,
    })
    assert.equal(result.ok, false, item.name)
    assert.equal(result.error.code, item.code, item.name)
    assert.equal(result.error.retryable, false, item.name)
    assert.equal(fetch.count(), 0, item.name)
    assert.equal(exec.calls.length, 0, item.name)
    assert.notEqual(result.error.code, 'E_SECRET_MISSING')
    assert.notEqual(result.error.code, 'E_AUTH')
    if (item.message) assert.match(result.error.message, item.message, item.name)
    assert.equal(JSON.stringify(result).includes(SECRET), false, item.name)
  }
})

test('[AC-078] HTTP status and transport failures map to the existing codes with the fixed retry budget', async () => {
  const retryAfterDate = 'Wed, 09 Nov 2026 00:00:30 GMT'
  const cases = [
    { name: '401', sequence: [{ status: 401, body: { error: { message: 'bad key' } } }], code: 'E_PROVIDER_AUTH', retryable: false, calls: 1 },
    { name: '403', sequence: [{ status: 403, body: { error: { message: 'forbidden' } } }], code: 'E_PROVIDER_AUTH', retryable: false, calls: 1 },
    { name: '429 seconds', sequence: [{ status: 429, headers: { 'Retry-After': '30' }, body: {} }], code: 'E_PROVIDER_QUOTA', retryable: false, calls: 1, retry_after: new Date(START + 30000).toISOString() },
    { name: '429 date', sequence: [{ status: 429, headers: { 'Retry-After': retryAfterDate }, body: {} }], code: 'E_PROVIDER_QUOTA', retryable: false, calls: 1, retry_after: new Date(Date.parse(retryAfterDate)).toISOString() },
    { name: '429 absent', sequence: [{ status: 429, body: {} }], code: 'E_PROVIDER_QUOTA', retryable: false, calls: 1, retry_after: null },
    { name: '429 invalid', sequence: [{ status: 429, headers: { 'Retry-After': 'soon' }, body: {} }], code: 'E_PROVIDER_QUOTA', retryable: false, calls: 1, retry_after: null },
    { name: '429 negative', sequence: [{ status: 429, headers: { 'Retry-After': '-5' }, body: {} }], code: 'E_PROVIDER_QUOTA', retryable: false, calls: 1, retry_after: null },
    { name: '402', sequence: [{ status: 402, body: {} }], code: 'E_PROVIDER_QUOTA', retryable: false, calls: 1 },
    { name: 'quota evidence in 5xx', sequence: [{ status: 500, body: { error: { code: 'insufficient_quota' } } }], code: 'E_PROVIDER_QUOTA', retryable: false, calls: 1 },
    { name: 'quota evidence in 4xx', sequence: [{ status: 400, body: { error: { code: 'insufficient_quota' } } }], code: 'E_PROVIDER_QUOTA', retryable: false, calls: 1 },
    { name: '500 then success', sequence: [{ status: 500, body: { error: { message: 'oops' } } }, { status: 200, body: replyBody() }], code: null, calls: 2 },
    { name: '503 then success', sequence: [{ status: 503, body: { error: { message: 'down' } } }, { status: 200, body: replyBody() }], code: null, calls: 2 },
    { name: '500 twice', sequence: [{ status: 500, body: {} }, { status: 500, body: {} }], code: 'E_PROVIDER_FAILED', retryable: true, calls: 2 },
    { name: '503 twice', sequence: [{ status: 503, body: {} }, { status: 503, body: {} }], code: 'E_PROVIDER_FAILED', retryable: true, calls: 2 },
    { name: '5xx then 401', sequence: [{ status: 500, body: {} }, { status: 401, body: {} }], code: 'E_PROVIDER_AUTH', retryable: false, calls: 2 },
    { name: '5xx then 403', sequence: [{ status: 500, body: {} }, { status: 403, body: {} }], code: 'E_PROVIDER_AUTH', retryable: false, calls: 2 },
    { name: '5xx then 429', sequence: [{ status: 500, body: {} }, { status: 429, body: {} }], code: 'E_PROVIDER_QUOTA', retryable: false, calls: 2 },
    { name: 'other 4xx', sequence: [{ status: 400, body: {} }], code: 'E_REQUEST_INVALID', retryable: false, calls: 1 },
    { name: 'redirect', sequence: [{ status: 302, headers: { Location: 'https://elsewhere.invalid' }, body: {} }], code: 'E_PROVIDER_FAILED', retryable: false, calls: 1 },
    { name: 'network', sequence: [new Error('socket closed')], code: 'E_PROVIDER_FAILED', retryable: false, calls: 1 },
    { name: 'invalid json', sequence: [{ status: 200, body: 'not json' }], code: 'E_PROVIDER_FAILED', retryable: false, calls: 1 },
    { name: 'missing choices', sequence: [{ status: 200, body: { model: 'deepseek-flash', usage: { prompt_tokens: 1, completion_tokens: 2 } } }], code: 'E_PROVIDER_FAILED', retryable: false, calls: 1 },
  ]

  for (const item of cases) {
    const { result, fetch, exec } = await run(item.sequence)
    assert.equal(fetch.count(), item.calls, item.name)
    assert.equal(exec.calls.length, 0, item.name)
    if (item.code === null) {
      assert.equal(result.ok, true, item.name)
      assert.equal(result.reply, 'hello', item.name)
      assert.equal(result.attempts, item.calls, item.name)
    } else {
      assert.equal(result.ok, false, item.name)
      assert.equal(result.error.code, item.code, item.name)
      assert.equal(result.error.retryable, item.retryable, item.name)
      assert.equal(result.attempts, item.calls, item.name)
      if (Object.hasOwn(item, 'retry_after')) assert.equal(result.error.retry_after, item.retry_after, item.name)
      assert.notEqual(result.error.code, 'E_SECRET_MISSING', item.name)
      assert.notEqual(result.error.code, 'E_AUTH', item.name)
      assert.notEqual(result.error.code, 'E_INTERNAL', item.name)
    }
  }
})

test('[AC-078] timeout covers fetch and body reads, keeps confirmed usage and leaves no timer', async () => {
  const hanging = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })
  const hangingBody = (url, init) => ({
    ok: true,
    status: 200,
    headers: makeHeaders(),
    text: () => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }),
  })

  const first = makeClock()
  const firstFetch = makeFetch([hanging, { status: 200, body: replyBody() }])
  const firstCtx = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch: firstFetch, clock: first })
  const firstPending = callHttpProvider({
    descriptor: descriptorFor(), config: makeConfig(), model: httpModel(), ctx: firstCtx.ctx, messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(first.pending(), 1)
  await first.advance(20000)
  const firstResult = await firstPending
  assert.equal(firstResult.ok, true)
  assert.equal(firstResult.attempts, 2)
  assert.deepEqual(firstResult.usage, { input_tokens: 123, output_tokens: 45, known: true })
  assert.equal(firstFetch.count(), 2)
  assert.equal(first.pending(), 0)

  const firstConfig = makeConfig()
  await commitHttpUsage(firstConfig, {
    ctx: firstCtx.ctx, descriptor: descriptorFor(), model: httpModel(), result: firstResult, idempotency_key: 'timeout-then-success',
  })
  const firstRow = readJsonl(firstCtx.ctx, usageFile(firstConfig, firstCtx.ctx))[0]
  assert.equal(firstRow.input_tokens, 123)
  assert.equal(firstRow.output_tokens, 45)

  const second = makeClock()
  const secondFetch = makeFetch([hanging, hanging])
  const secondCtx = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch: secondFetch, clock: second })
  const secondPending = callHttpProvider({
    descriptor: descriptorFor(), config: makeConfig(), model: httpModel(), ctx: secondCtx.ctx, messages: [{ role: 'user', content: 'hi' }],
  })
  await second.advance(20000)
  await flush()
  assert.equal(second.pending(), 1)
  await second.advance(20000)
  const secondResult = await secondPending
  assert.equal(secondResult.ok, false)
  assert.equal(secondResult.error.code, 'E_TIMEOUT')
  assert.equal(secondResult.error.retryable, true)
  assert.equal(secondResult.attempts, 2)
  assert.equal(secondFetch.count(), 2)
  assert.equal(second.pending(), 0)

  const secondConfig = makeConfig()
  const noRow = await commitHttpUsage(secondConfig, {
    ctx: secondCtx.ctx, descriptor: descriptorFor(), model: httpModel(), result: secondResult, idempotency_key: 'both-timeout',
  })
  assert.equal(noRow.written, false)
  assert.equal(noRow.reason, 'usage_unknown')
  assert.deepEqual(readJsonl(secondCtx.ctx, usageFile(secondConfig, secondCtx.ctx)), [])

  const third = makeClock()
  const thirdFetch = makeFetch([hangingBody, { status: 200, body: replyBody() }])
  const thirdCtx = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch: thirdFetch, clock: third })
  const thirdPending = callHttpProvider({
    descriptor: descriptorFor(), config: makeConfig(), model: httpModel(), ctx: thirdCtx.ctx, messages: [{ role: 'user', content: 'hi' }],
  })
  await third.advance(20000)
  const thirdResult = await thirdPending
  assert.equal(thirdResult.ok, true)
  assert.equal(thirdResult.attempts, 2)
  assert.equal(thirdResult.usage.input_tokens, 123)
  assert.equal(third.pending(), 0)
})

test('[AC-078] identity is verified only on a strict model match and observed otherwise', async () => {
  const cases = [
    { name: 'match', model: 'deepseek-flash', identity: 'verified', reported: 'deepseek-flash', reason: null },
    { name: 'missing', model: undefined, identity: 'observed', reported: null, reason: /did not report/ },
    { name: 'empty', model: '', identity: 'observed', reported: null, reason: /did not report/ },
    { name: 'number', model: 7, identity: 'observed', reported: null, reason: /did not report/ },
    { name: 'mismatch', model: 'other-model', identity: 'observed', reported: 'other-model', reason: /does not match/ },
  ]

  for (const item of cases) {
    const body = replyBody({ model: item.model })
    const { result } = await run([{ status: 200, body }])
    assert.equal(result.ok, true, item.name)
    assert.equal(result.reply, 'hello', item.name)
    assert.equal(result.identity, item.identity, item.name)
    assert.equal(result.identity_source, 'response.model', item.name)
    assert.equal(result.reported_model, item.reported, item.name)
    assert.deepEqual(result.usage, { input_tokens: 123, output_tokens: 45, known: true }, item.name)
    if (item.reason === null) assert.equal(result.reason, null, item.name)
    else assert.match(result.reason, item.reason, item.name)
    const hook = identityFromResponse({ request_model: 'deepseek-flash', response_model: body.model })
    assert.equal(result.identity, hook.identity, item.name)
    assert.equal(result.reported_model, hook.reported_model, item.name)
    assert.equal(result.reason, hook.reason, item.name)
  }
})

test('[AC-078] usage is exact, zero is valid, unknown stays unknown and cache details are ignored', async () => {
  assert.deepEqual(usageFromResponse({ usage: { prompt_tokens: 123, completion_tokens: 45 } }), { input_tokens: 123, output_tokens: 45, known: true })
  assert.deepEqual(usageFromResponse({ usage: { prompt_tokens: 0, completion_tokens: 0 } }), { input_tokens: 0, output_tokens: 0, known: true })
  for (const usage of [undefined, {}, { prompt_tokens: -1, completion_tokens: 1 }, { prompt_tokens: 1.5, completion_tokens: 1 }, { prompt_tokens: '1', completion_tokens: 1 }, { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 1 }]) {
    assert.deepEqual(usageFromResponse({ usage }), { input_tokens: null, output_tokens: null, known: false })
  }

  const zero = await run([{ status: 200, body: replyBody({ usage: { prompt_tokens: 0, completion_tokens: 0 } }) }])
  assert.equal(zero.result.ok, true)
  assert.deepEqual(zero.result.usage, { input_tokens: 0, output_tokens: 0, known: true })
  const zeroCommit = await commitHttpUsage(makeConfig(), {
    ctx: zero.ctx, descriptor: descriptorFor(), model: httpModel(), result: zero.result, idempotency_key: 'zero',
  })
  assert.equal(zeroCommit.written, true)
  assert.equal(readJsonl(zero.ctx, usageFile(makeConfig(), zero.ctx))[0].input_tokens, 0)

  const cache = await run([{
    status: 200,
    body: replyBody({ usage: { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 50 } }),
  }])
  assert.deepEqual(cache.result.usage, { input_tokens: 100, output_tokens: 10, known: true })
  const cacheConfig = makeConfig()
  await commitHttpUsage(cacheConfig, {
    ctx: cache.ctx, descriptor: descriptorFor(), model: httpModel(), result: cache.result, idempotency_key: 'cache',
  })
  const cacheRow = readJsonl(cache.ctx, usageFile(cacheConfig, cache.ctx))[0]
  assert.equal(cacheRow.input_tokens, 100)
  assert.equal(cacheRow.cache_read_tokens, 0)
  assert.equal(cacheRow.cache_write_tokens, 0)

  for (const usage of [undefined, { prompt_tokens: -1, completion_tokens: 1 }, { prompt_tokens: 1.5, completion_tokens: 1 }, { prompt_tokens: '1', completion_tokens: 1 }]) {
    const config = makeConfig()
    const unknown = await run([{ status: 200, body: replyBody({ usage }) }], { config })
    assert.equal(unknown.result.ok, true)
    assert.equal(unknown.result.usage.known, false)
    const committed = await commitHttpUsage(config, {
      ctx: unknown.ctx, descriptor: descriptorFor(), model: httpModel(), result: unknown.result, idempotency_key: 'unknown',
    })
    assert.equal(committed.written, false)
    assert.equal(committed.reason, 'usage_unknown')
    assert.deepEqual(readJsonl(unknown.ctx, usageFile(config, unknown.ctx)), [])
  }
})

test('[AC-078] observed identity still books confirmed usage to the requested channel', async () => {
  const config = makeConfig({
    pools: [{ id: 'deepseek:pool', capacity_mtok: { 'deepseek:deepseek-flash': { value: 10 } } }],
  })
  const { result, ctx, fetch } = await run([
    { status: 200, body: replyBody({ model: 'other-model', usage: { prompt_tokens: 123, completion_tokens: 45 } }) },
  ], { config })
  assert.equal(result.identity, 'observed')
  assert.equal(result.reported_model, 'other-model')
  await commitHttpUsage(config, {
    ctx, descriptor: descriptorFor(), model: httpModel(), result, idempotency_key: 'observed',
  })
  const row = readJsonl(ctx, usageFile(config, ctx))[0]
  assert.equal(row.model, 'deepseek:deepseek-flash')
  assert.equal(row.input_tokens, 123)
  assert.equal(row.output_tokens, 45)
  assert.equal(fetch.count(), 1)
})

test('[AC-078] same model in two channels uses distinct keys and pools without cross-charge', async () => {
  const pools = [
    {
      id: 'codebuddy:pool',
      capacity_mtok: { 'codebuddy:deepseek-flash': { value: 10 } },
      window: { length_s: 18000, anchor: 'rolling', start_at: '2026-11-09T00:00:00.000Z' },
    },
    {
      id: 'deepseek:pool',
      capacity_mtok: { 'deepseek:deepseek-flash': { value: 10 } },
      window: { length_s: 18000, anchor: 'rolling', start_at: '2026-11-09T00:00:00.000Z' },
    },
  ]
  const config = makeConfig({ pools })
  const { ctx, clock } = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch: makeFetch([]), clock: makeClock() })
  const cli = createCliDescriptor({ provider: 'codebuddy' })

  await commitHttpUsage(config, {
    ctx,
    descriptor: cli,
    model: cliModel(),
    result: { usage: { input_tokens: 10, output_tokens: 5, known: true } },
    idempotency_key: 'task:cli',
  })
  const afterCliRows = readJsonl(ctx, usageFile(config, ctx))
  const afterCliCli = evaluatePools({
    models: ['codebuddy:deepseek-flash'],
    pools,
    rows: afterCliRows.filter((row) => row.model === 'codebuddy:deepseek-flash'),
    now: clock.now(),
  })
  const afterCliHttp = evaluatePools({
    models: ['deepseek:deepseek-flash'],
    pools,
    rows: afterCliRows.filter((row) => row.model === 'deepseek:deepseek-flash'),
    now: clock.now(),
  })
  assert.equal(afterCliCli['codebuddy:deepseek-flash'].status, 'known')
  assert.equal(afterCliCli['codebuddy:deepseek-flash'].pools[0].pool_id, 'codebuddy:pool')
  assert.ok(afterCliCli['codebuddy:deepseek-flash'].pools[0].used_mtok > 0)
  assert.equal(afterCliHttp['deepseek:deepseek-flash'].pools[0].pool_id, 'deepseek:pool')
  assert.equal(afterCliHttp['deepseek:deepseek-flash'].pools[0].used_mtok, 0)

  await commitHttpUsage(config, {
    ctx,
    descriptor: descriptorFor(),
    model: httpModel(),
    result: { usage: { input_tokens: 123, output_tokens: 45, known: true } },
    idempotency_key: 'task:http',
  })
  const rows = readJsonl(ctx, usageFile(config, ctx))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((row) => row.model).sort(), ['codebuddy:deepseek-flash', 'deepseek:deepseek-flash'])
  assert.deepEqual(rows.find((row) => row.model === 'codebuddy:deepseek-flash').pools, ['codebuddy:pool'])
  assert.deepEqual(rows.find((row) => row.model === 'deepseek:deepseek-flash').pools, ['deepseek:pool'])

  const afterBothCli = evaluatePools({
    models: ['codebuddy:deepseek-flash'],
    pools,
    rows: rows.filter((row) => row.model === 'codebuddy:deepseek-flash'),
    now: clock.now(),
  })
  const afterBothHttp = evaluatePools({
    models: ['deepseek:deepseek-flash'],
    pools,
    rows: rows.filter((row) => row.model === 'deepseek:deepseek-flash'),
    now: clock.now(),
  })
  assert.equal(afterBothCli['codebuddy:deepseek-flash'].pools[0].used_mtok, afterCliCli['codebuddy:deepseek-flash'].pools[0].used_mtok)
  assert.ok(afterBothHttp['deepseek:deepseek-flash'].pools[0].used_mtok > 0)
  assert.equal(afterBothHttp['deepseek:deepseek-flash'].pools[0].pool_id, 'deepseek:pool')
})

test('[AC-078] a pool shared by two channels is rejected before the paid request', async () => {
  const shared = [{
    id: 'shared:pool',
    capacity_mtok: {
      'codebuddy:deepseek-flash': { value: 10 },
      'deepseek:deepseek-flash': { value: 10 },
    },
    window: { length_s: 18000, anchor: 'rolling', start_at: '2026-11-09T00:00:00.000Z' },
  }]
  const config = makeConfig({ pools: shared })
  const { result, fetch, exec, ctx } = await run([
    { status: 200, body: replyBody() },
  ], { config })

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'E_REQUEST_INVALID')
  assert.equal(result.error.retryable, false)
  assert.equal(fetch.count(), 0)
  assert.equal(exec.calls.length, 0)
  assert.deepEqual(readJsonl(ctx, usageFile(config, ctx)), [])

  await assert.rejects(() => commitHttpUsage(config, {
    ctx,
    descriptor: descriptorFor(),
    model: httpModel(),
    result: { usage: { input_tokens: 1, output_tokens: 1, known: true } },
    idempotency_key: 'shared',
  }), { code: 'E_REQUEST_INVALID' })
  assert.deepEqual(readJsonl(ctx, usageFile(config, ctx)), [])
})

test('[AC-078] idempotent replay, cross-source keys and storage failures never re-charge or truncate', async () => {
  const config = makeConfig()
  const { ctx, fs } = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch: makeFetch([]) })
  const result = { usage: { input_tokens: 123, output_tokens: 45, known: true } }
  const args = { ctx, descriptor: descriptorFor(), model: httpModel(), result, idempotency_key: 'same-key' }

  const first = await commitHttpUsage(config, args)
  const replay = await commitHttpUsage(config, args)
  assert.equal(first.written, true)
  assert.equal(replay.written, false)
  assert.equal(readJsonl(ctx, usageFile(config, ctx)).length, 1)

  await commitHttpUsage(config, {
    ctx, descriptor: createCliDescriptor({ provider: 'codebuddy' }), model: cliModel(), result, idempotency_key: 'same-key',
  })
  const rows = readJsonl(ctx, usageFile(config, ctx))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((row) => row.idempotency_key), ['same-key', 'same-key'])
  assert.deepEqual(rows.map((row) => row.model).sort(), ['codebuddy:deepseek-flash', 'deepseek:deepseek-flash'])

  const concurrentConfig = makeConfig()
  const concurrent = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch: makeFetch([]) })
  await Promise.all([
    commitHttpUsage(concurrentConfig, { ...args, ctx: concurrent.ctx }),
    commitHttpUsage(concurrentConfig, { ...args, ctx: concurrent.ctx }),
  ])
  assert.equal(readJsonl(concurrent.ctx, usageFile(concurrentConfig, concurrent.ctx)).length, 1)

  const brokenConfig = makeConfig()
  const broken = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch: makeFetch([]) })
  const brokenFile = usageFile(brokenConfig, broken.ctx)
  broken.fs.setFile(brokenFile, '{"schema":"cliworker.usage/v1"}\nnot json\n')
  const before = broken.fs.text(brokenFile)
  await assert.rejects(() => commitHttpUsage(brokenConfig, {
    ...args, ctx: broken.ctx,
  }), (error) => error instanceof SyntaxError)
  assert.equal(broken.fs.text(brokenFile), before)

  const appendConfig = makeConfig()
  const append = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch: makeFetch([]) })
  const appendFile = usageFile(appendConfig, append.ctx)
  append.fs.setFile(appendFile, '{"schema":"cliworker.usage/v1"}\n')
  const appendBefore = append.fs.text(appendFile)
  append.fs.failNext('appendFileSync', 'EIO')
  await assert.rejects(() => commitHttpUsage(appendConfig, {
    ...args, ctx: append.ctx,
  }), { code: 'EIO' })
  assert.equal(append.fs.text(appendFile), appendBefore)
})

test('[AC-078] retry accounting sums every confirmed usage exactly once', async () => {
  const first = await run([
    { status: 500, body: { error: { message: 'oops' }, usage: { prompt_tokens: 10, completion_tokens: 5 } } },
    { status: 200, body: replyBody({ usage: { prompt_tokens: 123, completion_tokens: 45 } }) },
  ])
  assert.equal(first.result.ok, true)
  assert.deepEqual(first.result.usage, { input_tokens: 133, output_tokens: 50, known: true })
  assert.equal(first.result.attempts, 2)

  const second = await run([
    { status: 500, body: { error: { message: 'oops' }, usage: { prompt_tokens: 10, completion_tokens: 5 } } },
    { status: 503, body: { error: { message: 'down' }, usage: { prompt_tokens: 20, completion_tokens: 10 } } },
  ])
  assert.equal(second.result.ok, false)
  assert.equal(second.result.error.code, 'E_PROVIDER_FAILED')
  assert.equal(second.result.error.retryable, true)
  assert.deepEqual(second.result.usage, { input_tokens: 30, output_tokens: 15, known: true })
  assert.equal(second.result.attempts, 2)

  const config = makeConfig()
  await commitHttpUsage(config, {
    ctx: second.ctx, descriptor: descriptorFor(), model: httpModel(), result: second.result, idempotency_key: 'failed-but-billed',
  })
  const row = readJsonl(second.ctx, usageFile(config, second.ctx))[0]
  assert.equal(row.input_tokens, 30)
  assert.equal(row.output_tokens, 15)
})
