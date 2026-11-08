import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { main } from '../../lib/cli.mjs'
import { getCode } from '../../lib/contract/registry.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FIXTURE = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'adapters', 'resolve.json'), 'utf8')
const CONFIG = '/cw/resolve.json'
const CWD = 'C:/work/repo'
const EXIT = getCode('E_NO_CANDIDATE').exit

function context() {
  return createFakeContext({
    files: { [CONFIG]: FIXTURE },
    env: { CLIWORKER_HOME: '/cw', CLIWORKER_TEST_CLOCK_FILE: '' },
    platform: 'linux',
  })
}

async function resolve(argv) {
  const ctx = context()
  const result = await main(['cli', 'resolve', ...argv], ctx)
  return { exitCode: result.exitCode, stderr: ctx.stderr.text(), body: JSON.parse(ctx.stdout.text()) }
}

function assertRejected(result, key, reason) {
  assert.equal(result.exitCode, EXIT, key)
  assert.equal(result.stderr, '', key)
  assert.deepEqual(Object.keys(result.body), ['ok', 'error'], key)
  assert.equal(result.body.ok, false, key)
  assert.equal(result.body.error.code, 'E_NO_CANDIDATE', key)
  assert.equal(result.body.error.retryable, false, key)
  assert.equal(result.body.error.retry_after, null, key)
  assert.ok(result.body.error.message.includes(key), key)
  assert.ok(result.body.error.message.includes(`not selectable: ${reason}`), result.body.error.message)
  assert.equal(Object.hasOwn(result.body, 'direct_call'), false, key)
  assert.equal(Object.hasOwn(result.body, 'models'), false, key)
}

test('[AC-044] a model outside the allow list is rejected by the production directory gate', async () => {
  assertRejected(await resolve(['--model', 'claude:notallowed', '--cwd', CWD, '--config', CONFIG]), 'claude:notallowed', 'not_allowed')
})

test('[AC-044] a deprecated model is rejected before any direct call is built', async () => {
  assertRejected(await resolve(['--model', 'claude:deprecated', '--cwd', CWD, '--config', CONFIG]), 'claude:deprecated', 'deprecated')
})

test('[AC-044] a model whose availability is not callable is rejected with its state', async () => {
  assertRejected(await resolve(['--model', 'claude:offline', '--cwd', CWD, '--config', CONFIG]), 'claude:offline', 'availability:unavailable')
})

test('[AC-044] a provider without a declared argument vector is adapter_unverified, never guessed', async () => {
  assertRejected(await resolve(['--model', 'weird:demo', '--cwd', CWD, '--config', CONFIG]), 'weird:demo', 'adapter_unverified')
})

test('[AC-044] a read-only request the provider cannot honour is rejected as readonly_unavailable', async () => {
  assertRejected(
    await resolve(['--model', 'codebuddy:demo', '--readonly', '--cwd', CWD, '--config', CONFIG]),
    'codebuddy:demo',
    'readonly_unavailable'
  )
})

test('[AC-044] an unknown model is a request error, not an empty successful call', async () => {
  const result = await resolve(['--model', 'claude:ghost', '--config', CONFIG])
  assert.equal(result.exitCode, getCode('E_REQUEST_INVALID').exit)
  assert.deepEqual(Object.keys(result.body), ['ok', 'error'])
  assert.equal(result.body.error.code, 'E_REQUEST_INVALID')
  assert.ok(result.body.error.message.includes('claude:ghost'))
})
