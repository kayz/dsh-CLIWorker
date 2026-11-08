import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { main } from '../../lib/cli.mjs'
import { getCode } from '../../lib/contract/registry.mjs'
import { validate } from '../../lib/contract/validate.mjs'
import { bundledExamplePath } from '../../lib/paths.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ENVELOPE = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts', 'schemas', 'error-envelope.schema.json'), 'utf8'))
const BUNDLED = fs.readFileSync(bundledExamplePath(), 'utf8')

const CONFIG = JSON.stringify({
  providers: { claude: { cli: 'cw-no-such-cli', readonly: true } },
  models: { q: { provider: 'claude', id: 'q', level: 'Quick', identity: 'verified' } },
})
const CONFIG_FILE = '/cw/config.json'
const EXAMPLE_FILE = '/cw/example.json'
const REQUEST_FILE = '/cw/request.json'

function context(extraEnv = {}) {
  return createFakeContext({
    files: {
      [CONFIG_FILE]: CONFIG,
      [EXAMPLE_FILE]: JSON.stringify({ _example: true, providers: {}, models: {} }),
      [REQUEST_FILE]: JSON.stringify({ schema: 'cliworker.request/v1', level: 'Quick' }),
      [bundledExamplePath()]: BUNDLED,
    },
    env: { CLIWORKER_HOME: '/cw', CLIWORKER_TEST_CLOCK_FILE: '', ...extraEnv },
  })
}

async function run(argv, extraEnv) {
  const ctx = context(extraEnv)
  const result = await main(argv, ctx)
  return { exitCode: result.exitCode, stdout: ctx.stdout.text(), stderr: ctx.stderr.text(), ctx }
}

const SELECT = ['models', 'select', '--config', CONFIG_FILE]

const ERROR_CASES = [
  { label: 'bad --request JSON', argv: [...SELECT, '--request', '{bad'], code: 'E_REQUEST_INVALID' },
  { label: 'invalid importance', argv: [...SELECT, '--level', 'Quick', '--importance', 'urgent'], code: 'E_REQUEST_INVALID' },
  { label: 'missing level', argv: [...SELECT], code: 'E_LEVEL_REQUIRED' },
  { label: 'unknown level', argv: [...SELECT, '--level', 'Ultra'], code: 'E_LEVEL_UNKNOWN' },
  { label: 'unknown command', argv: ['bogus'], code: 'E_UNKNOWN_COMMAND' },
  { label: 'unknown sub-command', argv: ['models', 'bogus', '--config', CONFIG_FILE], code: 'E_UNKNOWN_COMMAND' },
  { label: 'missing config', argv: ['models', 'select', '--config', '/cw/missing.json', '--level', 'Quick'], code: 'E_CONFIG' },
  { label: 'example config', argv: ['models', 'select', '--config', EXAMPLE_FILE, '--level', 'Quick'], code: 'E_CONFIG_EXAMPLE' },
  {
    label: 'full view on the CLI',
    argv: [...SELECT, '--request', JSON.stringify({ schema: 'cliworker.request/v1', level: 'Quick', view: 'full' })],
    code: 'E_VIEW_FORBIDDEN',
  },
]

test('[AC-023] every CLI error is one JSON envelope with the registry code, exit code and retryable', async () => {
  const seen = new Set()
  for (const item of ERROR_CASES) {
    const result = await run(item.argv)
    const body = JSON.parse(result.stdout)
    const entry = getCode(item.code)
    seen.add(item.code)

    assert.equal(body.ok, false, item.label)
    assert.deepEqual(Object.keys(body), ['ok', 'error'], item.label)
    assert.deepEqual(Object.keys(body.error), ['code', 'message', 'retryable', 'retry_after'], item.label)
    assert.equal(body.error.code, item.code, item.label)
    assert.equal(typeof body.error.message, 'string', item.label)
    assert.ok(body.error.message.length > 0, item.label)
    assert.equal(body.error.retryable, entry.retryable, item.label)
    assert.equal(body.error.retry_after, null, item.label)
    assert.equal(result.exitCode, entry.exit, item.label)
    assert.equal(result.stderr, '', item.label)
    assert.deepEqual(validate(ENVELOPE, body), { ok: true, errors: [] }, item.label)
  }
  assert.deepEqual([...seen].sort(), [
    'E_CONFIG',
    'E_CONFIG_EXAMPLE',
    'E_LEVEL_REQUIRED',
    'E_LEVEL_UNKNOWN',
    'E_REQUEST_INVALID',
    'E_UNKNOWN_COMMAND',
    'E_VIEW_FORBIDDEN',
  ])
})

test('[AC-023] a command that throws without a code becomes E_INTERNAL and exits 1', async () => {
  const result = await run(['usage', 'record', '--json', '{bad', '--config', CONFIG_FILE])
  const body = JSON.parse(result.stdout)

  assert.equal(body.ok, false)
  assert.deepEqual(Object.keys(body), ['ok', 'error'])
  assert.equal(body.error.code, 'E_INTERNAL')
  assert.equal(body.error.retryable, false)
  assert.equal(body.error.retry_after, null)
  assert.equal(result.exitCode, 1)
  assert.equal(result.stderr, '')
  assert.deepEqual(validate(ENVELOPE, body), { ok: true, errors: [] })
})

test('[AC-023] every successful command writes one JSON value and nothing to stderr', async () => {
  const cases = [
    ['providers', '--config', CONFIG_FILE],
    ['models', 'list', '--config', CONFIG_FILE],
    ['models', 'select', '--config', CONFIG_FILE, '--level', 'Quick'],
    ['models', 'select', '--config', CONFIG_FILE, '--request-file', REQUEST_FILE],
    ['models', 'forecast', '--model', 'q', '--config', CONFIG_FILE],
    ['usage', 'summary', '--config', CONFIG_FILE],
    ['usage', 'record', '--json', JSON.stringify({ model: 'q', input_tokens: 10, output_tokens: 5 }), '--config', CONFIG_FILE],
    ['paths', '--config', CONFIG_FILE],
    ['init', '--config', '/cw/new.json'],
  ]

  for (const argv of cases) {
    const result = await run(argv)
    const body = JSON.parse(result.stdout)
    assert.equal(result.exitCode, 0, argv.join(' '))
    assert.equal(result.stderr, '', argv.join(' '))
    assert.equal(body === null || typeof body !== 'object' || Array.isArray(body), false, argv.join(' '))
  }
})

test('[AC-023] the test clock warning only lands on successful results', async () => {
  const ok = await run(['paths', '--config', CONFIG_FILE], { CLIWORKER_TEST_CLOCK_FILE: '/cw/clock.txt' })
  const okBody = JSON.parse(ok.stdout)
  assert.equal(ok.exitCode, 0)
  assert.ok(Array.isArray(okBody.warnings))
  assert.ok(okBody.warnings.some((warning) => warning.code === 'W_TEST_CLOCK'))

  const failed = await run(['bogus'], { CLIWORKER_TEST_CLOCK_FILE: '/cw/clock.txt' })
  const failedBody = JSON.parse(failed.stdout)
  assert.equal(failed.exitCode, 2)
  assert.deepEqual(Object.keys(failedBody), ['ok', 'error'])
})

test('[AC-023] no arguments keeps the legacy usage line on stderr', async () => {
  const result = await run([])

  assert.equal(result.exitCode, 1)
  assert.equal(result.stdout, '')
  assert.ok(result.stderr.startsWith('ERROR: usage: cliworker providers | models list|select|forecast'))
})
