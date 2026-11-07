import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loadConfig } from '../../lib/config.mjs'
import { main } from '../../lib/cli.mjs'
import { bundledExamplePath, resolvePaths } from '../../lib/paths.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const PLATFORM = process.platform
const BASE = path.join(os.tmpdir(), 'cw-t005-config-fake')
const HOME = path.join(BASE, 'home')
const ENV = { CLIWORKER_HOME: HOME }
const EXAMPLE = fs.readFileSync(bundledExamplePath(), 'utf8')

function context(files, extra = {}) {
  return createFakeContext({ files, env: ENV, platform: PLATFORM, ...extra })
}

function prefixOf(file) {
  return 'cannot load CLIWorker config ' + path.resolve(file) + ': '
}

function catchError(fn) {
  try {
    fn()
  } catch (error) {
    return error
  }
  assert.fail('expected the call to throw')
}

function strippedExample(indent = 2) {
  const copy = JSON.parse(EXAMPLE)
  delete copy._example
  return JSON.stringify(copy, null, indent)
}

test('[AC-013] loadConfig rejects _example true with E_CONFIG_EXAMPLE', () => {
  const file = path.join(BASE, 'marked.json')
  const ctx = context({ [file]: JSON.stringify({ _example: true, providers: { a: { cli: 'a' } }, models: {} }) })

  const error = catchError(() => loadConfig({ file, ctx }))
  assert.equal(error.code, 'E_CONFIG_EXAMPLE')
  assert.equal(error instanceof TypeError, false)
  assert.ok(error.message.startsWith(prefixOf(file)))
  assert.ok(error.message.includes('this is the bundled example; copy it and edit it'))
})

test('[AC-013] loadConfig rejects a re-indented copy of the bundled example without the marker with E_CONFIG_EXAMPLE', () => {
  const file = path.join(BASE, 'reindented.json')
  const ctx = context({ [file]: strippedExample(4), [bundledExamplePath()]: EXAMPLE })

  const error = catchError(() => loadConfig({ file, ctx }))
  assert.equal(error.code, 'E_CONFIG_EXAMPLE')
  assert.equal(error instanceof TypeError, false)
  assert.ok(error.message.startsWith(prefixOf(file)))
  assert.ok(error.message.includes('this is the bundled example; copy it and edit it'))
})

test('[AC-013] loadConfig accepts the bundled example after a real edit', () => {
  const file = path.join(BASE, 'edited.json')
  const edited = JSON.parse(EXAMPLE)
  delete edited._example
  edited.quotas.claude.window = 'edited'
  const ctx = context({ [file]: JSON.stringify(edited), [bundledExamplePath()]: EXAMPLE })

  const config = loadConfig({ file, ctx })
  assert.equal(config._file, path.resolve(file))
  assert.equal(typeof config._home, 'string')
  assert.notEqual(config._home, config._file)
  assert.equal(config._home, resolvePaths({ configPath: file, env: ENV, platform: PLATFORM }).state_dir)
})

test('[AC-013] init refuses to overwrite an existing file with E_CONFIG_EXISTS and leaves it unchanged', async () => {
  const file = path.join(BASE, 'exists.json')
  const ctx = context({ [file]: 'KEEP' })

  const result = await main(['init', '--config', file], ctx)
  assert.equal(result.exitCode, 3)
  assert.equal(ctx.stderr.text(), '')

  const body = JSON.parse(ctx.stdout.text())
  assert.deepEqual(Object.keys(body), ['ok', 'error'])
  assert.deepEqual(Object.keys(body.error), ['code', 'message', 'retryable', 'retry_after'])
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'E_CONFIG_EXISTS')
  assert.ok(body.error.message.includes(path.resolve(file)))
  assert.equal(body.error.retryable, false)
  assert.equal(body.error.retry_after, null)
  assert.equal(ctx.stdout.text(), JSON.stringify(body, null, 2) + '\n')
  assert.equal(ctx.fs.readFileSync(file, 'utf8'), 'KEEP')
})

test('[AC-013] init writes the bundled example when the target is missing', async () => {
  const file = path.join(BASE, 'nested', 'config.json')
  const ctx = context({ [bundledExamplePath()]: EXAMPLE })

  const result = await main(['init', '--config', file], ctx)
  assert.equal(result.exitCode, 0)
  assert.equal(ctx.stderr.text(), '')

  const body = JSON.parse(ctx.stdout.text())
  assert.deepEqual(Object.keys(body), ['ok', 'config', 'state_dir', 'warnings'])
  assert.equal(body.ok, true)
  assert.equal(body.config, path.resolve(file))
  assert.equal(body.state_dir, resolvePaths({ configPath: file, env: ENV, platform: PLATFORM }).state_dir)
  assert.deepEqual(body.warnings, [])
  assert.equal(ctx.fs.readFileSync(file, 'utf8'), EXAMPLE)
})

test('[AC-013] the CLI maps E_CONFIG_EXAMPLE and E_CONFIG_EXISTS to ok false with exit code 3', async () => {
  const example = path.join(BASE, 'cli-reindented.json')
  const exists = path.join(BASE, 'cli-exists.json')

  const exampleCtx = context({ [example]: strippedExample(4), [bundledExamplePath()]: EXAMPLE })
  const exampleRun = await main(['providers', '--config', example], exampleCtx)
  assert.equal(exampleRun.exitCode, 3)
  assert.equal(exampleCtx.stderr.text(), '')
  const exampleBody = JSON.parse(exampleCtx.stdout.text())
  assert.deepEqual(Object.keys(exampleBody), ['ok', 'error'])
  assert.deepEqual(Object.keys(exampleBody.error), ['code', 'message', 'retryable', 'retry_after'])
  assert.equal(exampleBody.error.code, 'E_CONFIG_EXAMPLE')
  assert.equal(exampleBody.error.retryable, false)
  assert.equal(exampleBody.error.retry_after, null)
  assert.ok(exampleBody.error.message.includes(path.resolve(example)))

  const existsCtx = context({ [exists]: 'KEEP' })
  const existsRun = await main(['init', '--config', exists], existsCtx)
  assert.equal(existsRun.exitCode, 3)
  assert.equal(existsCtx.stderr.text(), '')
  const existsBody = JSON.parse(existsCtx.stdout.text())
  assert.equal(existsBody.error.code, 'E_CONFIG_EXISTS')
  assert.equal(existsBody.error.retryable, false)
  assert.equal(existsBody.error.retry_after, null)
  assert.ok(existsBody.error.message.includes(path.resolve(exists)))
})

const BAD_CONFIGS = [
  ['null.json', 'null', 'root must be a JSON object'],
  ['arr.json', '[]', 'root must be a JSON object'],
  ['num.json', '42', 'root must be a JSON object'],
  ['bad.json', '{', null],
  ['nop.json', JSON.stringify({}), 'providers is required'],
  ['nom.json', JSON.stringify({ providers: {} }), 'models is required'],
  ['arrprov.json', JSON.stringify({ providers: [], models: {} }), 'providers is required'],
  ['arrmod.json', JSON.stringify({ providers: {}, models: [] }), 'models is required'],
  ['st.json', JSON.stringify({ providers: {}, models: {}, state_dir: 1 }), 'state_dir must be a non-empty string'],
  ['emptystr.json', JSON.stringify({ providers: {}, models: {}, state_dir: '' }), 'state_dir must be a non-empty string'],
]

test('[AC-014] loadConfig throws E_CONFIG with the absolute path and a reason for null, [], 42, non-JSON, missing providers and missing models', () => {
  for (const [name, contents, reason] of BAD_CONFIGS) {
    const file = path.join(BASE, 'bad', name)
    const ctx = context({ [file]: contents })
    const error = catchError(() => loadConfig({ file, ctx }))

    assert.equal(error instanceof TypeError, false, name)
    assert.equal(error.code, 'E_CONFIG', name)
    assert.ok(error.message.startsWith(prefixOf(file)), name + ' ' + error.message)
    assert.ok(error.message.length > prefixOf(file).length, name)
    if (reason) assert.ok(error.message.includes(reason), name + ' ' + error.message)
  }
})

test('[AC-014] the CLI prints ok false E_CONFIG on stdout, exits 3 and writes nothing to stderr for each bad config', async () => {
  for (const [name, contents, reason] of BAD_CONFIGS) {
    const file = path.join(BASE, 'bad', name)
    const ctx = context({ [file]: contents })

    const result = await main(['providers', '--config', file], ctx)
    assert.equal(result.exitCode, 3, name)
    assert.equal(ctx.stderr.text(), '', name)
    assert.equal(ctx.stdout.text().includes('TypeError'), false, name)

    const body = JSON.parse(ctx.stdout.text())
    assert.deepEqual(Object.keys(body), ['ok', 'error'], name)
    assert.deepEqual(Object.keys(body.error), ['code', 'message', 'retryable', 'retry_after'], name)
    assert.equal(body.ok, false, name)
    assert.equal(body.error.code, 'E_CONFIG', name)
    assert.equal(body.error.retryable, false, name)
    assert.equal(body.error.retry_after, null, name)
    assert.ok(body.error.message.includes(path.resolve(file)), name)
    if (reason) assert.ok(body.error.message.includes(reason), name)
    assert.equal(ctx.stdout.text(), JSON.stringify(body, null, 2) + '\n', name)
  }
})
