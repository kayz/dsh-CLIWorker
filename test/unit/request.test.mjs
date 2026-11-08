import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { REQUEST_SCHEMA, gateView, normalizeRequest, requestFromArgv } from '../../lib/request.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const README = path.join(ROOT, 'README.md')

function ctxWith(body) {
  return { fs: { readFileSync: () => JSON.stringify(body) } }
}

function codeOf(fn) {
  try {
    fn()
  } catch (e) {
    return e.code
  }
  return 'NO_THROW'
}

function fencedBlocks(text, language) {
  const pattern = new RegExp('```' + language + '\\r?\\n([\\s\\S]*?)```', 'g')
  return [...text.matchAll(pattern)].map((match) => match[1])
}

function shellTokens(rest) {
  const tokens = rest.match(/'[^']*'|"[^"]*"|\S+/g) || []
  return tokens.map((token) => (/^('.*'|".*")$/.test(token) ? token.slice(1, -1) : token))
}

test('[AC-024] --request, --request-file and the single flags give the same request', () => {
  const body = {
    level: 'Top',
    count: 2,
    usage: 'Heavy',
    importance: 'high',
    request_id: 'r-001',
    cwd: 'C:/work/repo',
  }
  const inline = requestFromArgv(['--request', JSON.stringify(body)], ctxWith(body))
  const file = requestFromArgv(['--request-file', 'request.json'], ctxWith(body))
  const flags = requestFromArgv(
    ['--level', 'Top', '--count', '2', '--usage', 'Heavy', '--importance', 'high', '--request-id', 'r-001', '--cwd', 'C:/work/repo'],
    ctxWith({})
  )

  assert.deepEqual(file, inline)
  assert.deepEqual(flags, inline)
  assert.deepEqual(inline.warnings, [])
  assert.deepEqual(inline.request, {
    request_id: 'r-001',
    level: 'Top',
    count: 2,
    usage: 'Heavy',
    importance: 'high',
    cwd: 'C:/work/repo',
  })
})

test('[AC-024] flags override the JSON body and unset fields fall back to their defaults', () => {
  const ctx = ctxWith({ level: 'Quick' })
  const overridden = requestFromArgv(['--request', '{"level":"quick"}', '--level', 'High'], ctx)

  assert.equal(overridden.request.level, 'High')
  assert.equal(overridden.request.count, 1)
  assert.equal(overridden.request.usage, 'Normal')
  assert.equal(overridden.request.importance, 'normal')
})

test('[AC-024] role is W_FIELD_IGNORED and tier is W_FIELD_DEPRECATED', () => {
  const role = normalizeRequest({ level: 'Quick', role: 'dev', importance: 'high' })
  assert.deepEqual(role.warnings, [{ code: 'W_FIELD_IGNORED', field: 'role' }])
  assert.equal('role' in role.request, false)
  assert.equal(role.request.importance, 'high')

  const tier = normalizeRequest({ tier: 'top' })
  assert.deepEqual(tier.warnings, [{ code: 'W_FIELD_DEPRECATED', field: 'tier' }])
  assert.equal(tier.request.level, 'Top')
  assert.equal('tier' in tier.request, false)

  const both = normalizeRequest({ level: 'Middle', tier: 'top', foo: 1, bar: 2 })
  assert.equal(both.request.level, 'Middle')
  assert.deepEqual(both.warnings, [
    { code: 'W_FIELD_DEPRECATED', field: 'tier' },
    { code: 'W_FIELD_IGNORED', field: 'foo' },
    { code: 'W_FIELD_IGNORED', field: 'bar' },
  ])

  const legacy = normalizeRequest({ level: 'Quick', exclude: ['m1'], candidates: ['m2'], require_verified: false })
  assert.deepEqual(legacy.warnings, [])
  assert.deepEqual(legacy.request.exclude, ['m1'])
  assert.deepEqual(legacy.request.candidates, ['m2'])
  assert.equal(legacy.request.require_verified, false)
})

test('[AC-024] v1 fields the draft view does not read yet are kept without a warning', () => {
  const result = normalizeRequest({
    schema: REQUEST_SCHEMA,
    level: 'Quick',
    require_readonly: true,
    timeout_ms: 500,
    exclude_handles: ['h1'],
    compat: 'draft',
  })

  assert.deepEqual(result.warnings, [])
  assert.equal(result.request.schema, REQUEST_SCHEMA)
  assert.equal(result.request.require_readonly, true)
  assert.equal(result.request.timeout_ms, 500)
  assert.deepEqual(result.request.exclude_handles, ['h1'])
  assert.equal(result.request.compat, 'draft')
})

test('[AC-024] invalid values map to the registry codes', () => {
  const base = { level: 'Quick' }
  for (const importance of ['urgent', 'High', 'low', 1, null, true]) {
    assert.equal(codeOf(() => normalizeRequest({ ...base, importance })), 'E_REQUEST_INVALID', String(importance))
  }
  for (const count of [0, 11, 1.5, '2', -1, null]) {
    assert.equal(codeOf(() => normalizeRequest({ ...base, count })), 'E_REQUEST_INVALID', String(count))
  }
  assert.equal(normalizeRequest({ ...base, count: 10 }).request.count, 10)
  assert.equal(normalizeRequest({ ...base, count: 1 }).request.count, 1)

  assert.equal(codeOf(() => normalizeRequest({ ...base, usage: 'Extreme' })), 'E_REQUEST_INVALID')
  assert.equal(normalizeRequest({ ...base, usage: 'heavy' }).request.usage, 'Heavy')

  assert.equal(codeOf(() => normalizeRequest({})), 'E_LEVEL_REQUIRED')
  assert.equal(codeOf(() => normalizeRequest({ level: '' })), 'E_LEVEL_REQUIRED')
  assert.equal(codeOf(() => normalizeRequest({ level: 'Ultra' })), 'E_LEVEL_UNKNOWN')
  assert.equal(codeOf(() => normalizeRequest({ level: 5 })), 'E_LEVEL_UNKNOWN')
  assert.equal(normalizeRequest({ level: 'tOp' }).request.level, 'Top')

  assert.equal(codeOf(() => normalizeRequest({ schema: 'cliworker.request/v2', level: 'Top' })), 'E_SCHEMA_UNSUPPORTED')
  assert.equal(codeOf(() => normalizeRequest(null)), 'E_REQUEST_INVALID')
  assert.equal(codeOf(() => normalizeRequest([])), 'E_REQUEST_INVALID')
  assert.equal(codeOf(() => normalizeRequest({ ...base, compat: 'full' })), 'E_REQUEST_INVALID')
  assert.equal(codeOf(() => normalizeRequest({ ...base, view: 'everything' })), 'E_REQUEST_INVALID')
  assert.equal(codeOf(() => normalizeRequest({ ...base, timeout_ms: 0 })), 'E_REQUEST_INVALID')
  assert.equal(codeOf(() => normalizeRequest({ ...base, exclude_handles: [1] })), 'E_REQUEST_INVALID')
})

test('[AC-024] argv problems map to E_REQUEST_INVALID', () => {
  const ctx = { fs: { readFileSync() { throw new Error('ENOENT') } } }

  assert.equal(codeOf(() => requestFromArgv(['--request', '{bad'], ctx)), 'E_REQUEST_INVALID')
  assert.equal(codeOf(() => requestFromArgv(['--request-file', 'C:/nope.json'], ctx)), 'E_REQUEST_INVALID')
  assert.equal(codeOf(() => requestFromArgv(['--request', '{}', '--request-file', 'C:/x.json'], ctx)), 'E_REQUEST_INVALID')
  assert.equal(codeOf(() => requestFromArgv(['--level', 'Top', '--count', 'abc'], ctx)), 'E_REQUEST_INVALID')
  assert.equal(codeOf(() => requestFromArgv(['--level'], ctx)), 'E_REQUEST_INVALID')
  assert.equal(codeOf(() => requestFromArgv([], ctx)), 'E_LEVEL_REQUIRED')
})

test('[AC-024] every README request example parses without warnings', () => {
  const readme = fs.readFileSync(README, 'utf8')
  const ctx = ctxWith({ schema: REQUEST_SCHEMA, level: 'Top' })

  const blocks = fencedBlocks(readme, 'json request')
  assert.ok(blocks.length >= 1, 'README needs at least one ```json request block')
  for (const block of blocks) {
    assert.deepEqual(requestFromArgv(['--request', block], ctx).warnings, [])
  }

  const lines = fencedBlocks(readme, 'bash')
    .flatMap((block) => block.split(/\r?\n/))
    .filter((line) => line.includes('models select'))
  assert.ok(lines.length >= 2, 'README needs at least two models select examples')
  for (const line of lines) {
    const rest = line.slice(line.indexOf('models select') + 'models select'.length)
    assert.deepEqual(requestFromArgv(shellTokens(rest), ctx).warnings, [])
  }

  assert.equal(/"(role|tier)"/.test(readme), false, 'README must not show role or tier request fields')
})

test('[AC-024] gateView resolves draft and agentline and forbids full on the CLI', () => {
  const view = (raw) => gateView(normalizeRequest(raw).request)

  assert.deepEqual(view({ level: 'Top' }), { view: 'draft', warnings: [{ code: 'W_DRAFT_DEPRECATED' }] })
  assert.deepEqual(view({ schema: REQUEST_SCHEMA, level: 'Top', compat: 'draft' }), {
    view: 'draft',
    warnings: [{ code: 'W_DRAFT_DEPRECATED' }],
  })
  assert.deepEqual(view({ schema: REQUEST_SCHEMA, level: 'Top' }), { view: 'agentline', warnings: [] })
  assert.equal(codeOf(() => view({ schema: REQUEST_SCHEMA, level: 'Top', view: 'full' })), 'E_VIEW_FORBIDDEN')
  assert.equal(codeOf(() => view({ level: 'Top', view: 'full' })), 'E_VIEW_FORBIDDEN')
})
