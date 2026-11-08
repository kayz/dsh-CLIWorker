import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { createContext } from '../../lib/context.mjs'
import { createCliDescriptor, createHttpDescriptor, usageFromResponse } from '../../lib/providers/registry.mjs'
import { callHttpProvider } from '../../lib/providers/http-openai.mjs'
import {
  channelOfKey,
  commitHttpUsage,
  poolsFor,
  sourceModelKey,
} from '../../lib/usage/ledger.mjs'
import { readJsonl } from '../../lib/store.mjs'
import { usageFile } from '../../lib/commands/_util.mjs'
import { evaluatePools } from '../../lib/pools.mjs'

const STATE = '/state'
const SECRET = 'sk-unit-secret-value'
const START = Date.parse('2026-11-09T00:00:00.000Z')
const MODELS = ['deepseek-flash', 'deepseek-v4-pro']

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
  }
  return clock
}

function makeMemFs({ clock, files = {} } = {}) {
  const entries = new Map()
  const dirs = new Set()
  const failures = new Map()
  const nowMs = () => clock.now()
  const norm = (target) => path.resolve(String(target))
  for (const [key, value] of Object.entries(files)) entries.set(norm(key), String(value))

  const touch = (method) => {
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
      if (opts.flag === 'wx' && entries.has(file)) throw Object.assign(new Error(`EEXIST: ${file}`), { code: 'EEXIST' })
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

  api.text = (target) => {
    const entry = entries.get(norm(target))
    return entry ? entry.text : null
  }
  api.setFile = (target, text) => put(norm(target), String(text))
  api.failNext = (method, code) => failures.set(method, { code, remaining: 1 })
  api.files = () => [...entries.values()].map((entry) => entry.text)
  return api
}

function makeResponse({ status = 200, body, headers = {} } = {}) {
  const map = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]))
  const text = typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return map.has(String(name).toLowerCase()) ? map.get(String(name).toLowerCase()) : null } },
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

function makeCtx({ env = {}, fetch, files = {}, clock = makeClock() } = {}) {
  const fs = makeMemFs({ clock, files })
  const execCalls = []
  const exec = (...args) => {
    execCalls.push(args)
    throw new Error('exec must not be called')
  }
  exec.calls = execCalls
  let seed = 987654321
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  return { ctx: createContext({ env, fs, clock, fetch, exec, random, platform: 'linux' }), fs, clock, exec }
}

function makeConfig({ pools = [] } = {}) {
  return { _home: STATE, apiKeyEnv: 'DEEPSEEK_API_KEY', pools, secrets: {}, policy: {} }
}

function descriptorFor(models = MODELS) {
  return createHttpDescriptor({
    provider: 'deepseek',
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

function body(options = {}) {
  const model = Object.hasOwn(options, 'model') ? options.model : 'deepseek-flash'
  const content = Object.hasOwn(options, 'content') ? options.content : 'hello'
  const usage = Object.hasOwn(options, 'usage') ? options.usage : { prompt_tokens: 123, completion_tokens: 45 }
  const value = { choices: [{ message: { role: 'assistant', content } }] }
  if (model !== undefined) value.model = model
  if (usage !== undefined) value.usage = usage
  return value
}

async function run(sequence, { config = makeConfig(), model = httpModel() } = {}) {
  const fetch = makeFetch(sequence)
  const made = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch, clock: makeClock() })
  const result = await callHttpProvider({
    descriptor: descriptorFor(), config, model, ctx: made.ctx, messages: [{ role: 'user', content: 'hi' }],
  })
  return { result, fetch, ...made }
}

test('[AC-078] unit: exact token mapping preserves explicit zero', async () => {
  assert.deepEqual(usageFromResponse({ usage: { prompt_tokens: 123, completion_tokens: 45 } }), {
    input_tokens: 123, output_tokens: 45, known: true,
  })
  assert.deepEqual(usageFromResponse({ usage: { prompt_tokens: 0, completion_tokens: 0 } }), {
    input_tokens: 0, output_tokens: 0, known: true,
  })

  const { result } = await run([{ status: 200, body: body({ usage: { prompt_tokens: 0, completion_tokens: 0 } }) }])
  assert.equal(result.ok, true)
  assert.deepEqual(result.usage, { input_tokens: 0, output_tokens: 0, known: true })
})

test('[AC-078] unit: missing, negative, fractional, non-numeric and unsafe usage stays unknown', async () => {
  const variants = [
    undefined,
    {},
    { prompt_tokens: -1, completion_tokens: 1 },
    { prompt_tokens: 1, completion_tokens: -1 },
    { prompt_tokens: 1.5, completion_tokens: 1 },
    { prompt_tokens: 1, completion_tokens: 2.5 },
    { prompt_tokens: '1', completion_tokens: 1 },
    { prompt_tokens: 1, completion_tokens: '2' },
    { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 1 },
  ]

  for (const usage of variants) {
    const config = makeConfig()
    const { result, ctx, fetch } = await run([{ status: 200, body: body({ usage }) }], { config })
    assert.equal(result.ok, true)
    assert.deepEqual(result.usage, { input_tokens: null, output_tokens: null, known: false })
    const committed = await commitHttpUsage(config, {
      ctx, descriptor: descriptorFor(), model: httpModel(), result, idempotency_key: 'unknown',
    })
    assert.equal(committed.written, false)
    assert.equal(committed.reason, 'usage_unknown')
    assert.deepEqual(readJsonl(ctx, usageFile(config, ctx)), [])
    assert.equal(fetch.count(), 1)
  }
})

test('[AC-078] unit: cache details do not inflate prompt tokens', async () => {
  const config = makeConfig()
  const { result, ctx } = await run([{
    status: 200,
    body: body({ usage: { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60 } }),
  }], { config })

  assert.deepEqual(result.usage, { input_tokens: 100, output_tokens: 10, known: true })
  await commitHttpUsage(config, {
    ctx, descriptor: descriptorFor(), model: httpModel(), result, idempotency_key: 'cache',
  })
  const row = readJsonl(ctx, usageFile(config, ctx))[0]
  assert.equal(row.input_tokens, 100)
  assert.equal(row.output_tokens, 10)
  assert.equal(row.cache_read_tokens, 0)
  assert.equal(row.cache_write_tokens, 0)
})

test('[AC-078] unit: observed identity still books to the requested source', async () => {
  const config = makeConfig({
    pools: [{ id: 'deepseek:pool', capacity_mtok: { 'deepseek:deepseek-flash': { value: 10 } } }],
  })
  const { result, ctx } = await run([
    { status: 200, body: body({ model: 'different-model' }) },
  ], { config })

  assert.equal(result.identity, 'observed')
  assert.equal(result.reported_model, 'different-model')
  await commitHttpUsage(config, {
    ctx, descriptor: descriptorFor(), model: httpModel(), result, idempotency_key: 'observed',
  })
  const row = readJsonl(ctx, usageFile(config, ctx))[0]
  assert.equal(row.model, 'deepseek:deepseek-flash')
  assert.deepEqual(row.pools, ['deepseek:pool'])
})

test('[AC-078] unit: source keys and pools are distinct and evaluate independently', async () => {
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
  const http = descriptorFor()
  const cli = createCliDescriptor({ provider: 'codebuddy' })

  assert.equal(sourceModelKey(http, httpModel()), 'deepseek:deepseek-flash')
  assert.equal(sourceModelKey(cli, cliModel()), 'codebuddy:deepseek-flash')
  assert.notEqual(sourceModelKey(http, httpModel()), sourceModelKey(cli, cliModel()))
  assert.equal(channelOfKey('deepseek:deepseek-flash'), 'deepseek')
  assert.equal(channelOfKey('deepseek-flash'), null)
  assert.deepEqual(poolsFor(config, 'deepseek:deepseek-flash'), ['deepseek:pool'])
  assert.deepEqual(poolsFor(config, 'codebuddy:deepseek-flash'), ['codebuddy:pool'])

  const { ctx, clock } = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch: makeFetch([]) })
  await commitHttpUsage(config, {
    ctx, descriptor: cli, model: cliModel(), result: { usage: { input_tokens: 10, output_tokens: 5, known: true } }, idempotency_key: 'cli',
  })
  const rows = readJsonl(ctx, usageFile(config, ctx))
  const evaluatedCli = evaluatePools({
    models: ['codebuddy:deepseek-flash'], pools, rows: rows.filter((row) => row.model === 'codebuddy:deepseek-flash'), now: clock.now(),
  })
  const evaluatedHttp = evaluatePools({
    models: ['deepseek:deepseek-flash'], pools, rows: rows.filter((row) => row.model === 'deepseek:deepseek-flash'), now: clock.now(),
  })
  assert.ok(evaluatedCli['codebuddy:deepseek-flash'].pools[0].used_mtok > 0)
  assert.equal(evaluatedHttp['deepseek:deepseek-flash'].pools[0].used_mtok, 0)
  assert.equal(evaluatedHttp['deepseek:deepseek-flash'].pools[0].pool_id, 'deepseek:pool')
})

test('[AC-078] unit: same idempotency key is scoped to the source model key', async () => {
  const config = makeConfig()
  const { ctx } = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch: makeFetch([]) })
  const usage = { usage: { input_tokens: 123, output_tokens: 45, known: true } }

  const first = await commitHttpUsage(config, {
    ctx, descriptor: descriptorFor(), model: httpModel(), result: usage, idempotency_key: 'same',
  })
  const replay = await commitHttpUsage(config, {
    ctx, descriptor: descriptorFor(), model: httpModel(), result: usage, idempotency_key: 'same',
  })
  assert.equal(first.written, true)
  assert.equal(replay.written, false)

  await commitHttpUsage(config, {
    ctx, descriptor: createCliDescriptor({ provider: 'codebuddy' }), model: cliModel(), result: usage, idempotency_key: 'same',
  })
  const rows = readJsonl(ctx, usageFile(config, ctx))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((row) => row.model).sort(), ['codebuddy:deepseek-flash', 'deepseek:deepseek-flash'])
  assert.deepEqual(rows.map((row) => row.idempotency_key), ['same', 'same'])
})

test('[AC-078] unit: concurrent replay appends one row', async () => {
  const config = makeConfig()
  const { ctx } = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch: makeFetch([]) })
  const args = {
    ctx,
    descriptor: descriptorFor(),
    model: httpModel(),
    result: { usage: { input_tokens: 1, output_tokens: 2, known: true } },
    idempotency_key: 'concurrent',
  }
  await Promise.all([commitHttpUsage(config, args), commitHttpUsage(config, args)])
  assert.equal(readJsonl(ctx, usageFile(config, ctx)).length, 1)
})

test('[AC-078] unit: retry aggregation records confirmed usage once', async () => {
  const config = makeConfig()
  const { result, ctx } = await run([
    { status: 500, body: { error: { message: 'oops' }, usage: { prompt_tokens: 10, completion_tokens: 5 } } },
    { status: 200, body: body({ usage: { prompt_tokens: 123, completion_tokens: 45 } }) },
  ], { config })

  assert.equal(result.ok, true)
  assert.deepEqual(result.usage, { input_tokens: 133, output_tokens: 50, known: true })
  await commitHttpUsage(config, {
    ctx, descriptor: descriptorFor(), model: httpModel(), result, idempotency_key: 'retry',
  })
  const rows = readJsonl(ctx, usageFile(config, ctx))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].input_tokens, 133)
  assert.equal(rows[0].output_tokens, 50)
})

test('[AC-078] unit: a ledger write failure never triggers another paid request', async () => {
  const config = makeConfig()
  const fetch = makeFetch([{ status: 200, body: body() }])
  const { ctx, fs } = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch, clock: makeClock() })
  const result = await callHttpProvider({
    descriptor: descriptorFor(), config, model: httpModel(), ctx, messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(result.ok, true)
  assert.equal(fetch.count(), 1)

  fs.failNext('appendFileSync', 'EIO')
  await assert.rejects(() => commitHttpUsage(config, {
    ctx, descriptor: descriptorFor(), model: httpModel(), result, idempotency_key: 'write-failure',
  }), { code: 'EIO' })
  assert.equal(fetch.count(), 1)

  const retry = await commitHttpUsage(config, {
    ctx, descriptor: descriptorFor(), model: httpModel(), result, idempotency_key: 'write-failure',
  })
  assert.equal(retry.written, true)
  assert.equal(fetch.count(), 1)
})

test('[AC-078] unit: a corrupted ledger fails without truncating existing bytes', async () => {
  const config = makeConfig()
  const { ctx, fs } = makeCtx({ env: { DEEPSEEK_API_KEY: SECRET }, fetch: makeFetch([]) })
  const file = usageFile(config, ctx)
  fs.setFile(file, '{"schema":"cliworker.usage/v1"}\nbroken\n')
  const before = fs.text(file)
  await assert.rejects(() => commitHttpUsage(config, {
    ctx,
    descriptor: descriptorFor(),
    model: httpModel(),
    result: { usage: { input_tokens: 1, output_tokens: 1, known: true } },
    idempotency_key: 'corrupt',
  }), (error) => error instanceof SyntaxError)
  assert.equal(fs.text(file), before)
})
