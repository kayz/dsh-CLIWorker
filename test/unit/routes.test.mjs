import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { listCommandFiles } from '../../lib/context.mjs'
import { collectRoutes, matchRoute } from '../../lib/routes.mjs'
import { main } from '../../lib/cli.mjs'
import * as pathsCommand from '../../lib/commands/paths.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const COMMANDS = path.join(ROOT, 'lib', 'commands')
const CONFIG = '/cw/config.json'

function configContext() {
  return createFakeContext({ files: { [CONFIG]: JSON.stringify({ providers: {}, models: {} }) } })
}

test('listCommandFiles returns every .mjs under lib/commands as a sorted absolute path', () => {
  const files = listCommandFiles()

  assert.ok(files.length > 0, 'expected at least one command module')
  assert.deepEqual(files, [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
  for (const file of files) {
    assert.equal(path.isAbsolute(file), true, `${file} is not absolute`)
    assert.match(file, /\.mjs$/)
  }
  assert.ok(files.includes(path.join(COMMANDS, 'paths.mjs')))
  assert.ok(files.includes(path.join(COMMANDS, 'init.mjs')))
  assert.ok(files.includes(path.join(COMMANDS, 'models', 'list.mjs')), 'expected recursion into subdirectories')
})

test('listCommandFiles covers a missing directory with an empty list', () => {
  const missing = path.join(ROOT, 'lib', 'commands-does-not-exist')
  assert.deepEqual(listCommandFiles(missing), [])
  assert.deepEqual(listCommandFiles(''), [])
})

test('collectRoutes finds the self-registered modules of lib/commands', async () => {
  const routes = await collectRoutes()

  const paths = matchRoute(routes, 'paths', null)
  assert.ok(paths, 'paths did not self-register')
  assert.equal(typeof paths.module.run, 'function')

  const init = matchRoute(routes, 'init', null)
  assert.ok(init, 'init did not self-register')
  assert.equal(typeof init.module.run, 'function')

  const migrate = matchRoute(routes, 'config', 'migrate')
  assert.ok(migrate, 'config migrate did not self-register')
  assert.equal(migrate.sub, 'migrate')

  for (const route of routes) {
    assert.equal(typeof route.cmd, 'string')
    assert.ok(route.sub === null || typeof route.sub === 'string')
    assert.ok(route.module && typeof route.module === 'object')
  }
})

test('collectRoutes imports an arbitrary directory and skips modules without a route or that fail to load', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-routes-'))
  try {
    fs.writeFileSync(
      path.join(dir, 'demo.mjs'),
      "export const route = { cmd: 'demo', sub: 'go' }\nexport const marker = 42\n"
    )
    fs.writeFileSync(path.join(dir, 'default-sub.mjs'), "export const route = { cmd: 'demo' }\n")
    fs.writeFileSync(path.join(dir, 'noise.mjs'), 'export async function run() { return {} }\n')
    fs.writeFileSync(path.join(dir, 'broken.mjs'), "throw new Error('boom: this module must be skipped')\n")

    const routes = await collectRoutes(dir)

    assert.deepEqual(routes.map((route) => [route.cmd, route.sub]), [
      ['demo', null],
      ['demo', 'go'],
    ])
    assert.equal(routes[1].module.marker, 42)
    assert.equal(matchRoute(routes, 'demo', null), routes[0])
    assert.equal(matchRoute(routes, 'demo', 'go'), routes[1])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('matchRoute matches cmd and sub exactly, with null meaning no subcommand', () => {
  const silent = { run() {} }
  const select = { run() {} }
  const routes = [
    { cmd: 'models', sub: null, module: silent },
    { cmd: 'models', sub: 'select', module: select },
  ]

  assert.equal(matchRoute(routes, 'models', null), routes[0])
  assert.equal(matchRoute(routes, 'models'), routes[0], 'an omitted sub means no subcommand')
  assert.equal(matchRoute(routes, 'models', 'select'), routes[1])
  assert.equal(matchRoute(routes, 'models', 'list'), null)
  assert.equal(matchRoute(routes, 'auth', null), null)
  assert.equal(matchRoute(routes, 'models', ''), null)
  assert.equal(matchRoute([], 'models', null), null)
  assert.equal(matchRoute(null, 'models', null), null)
})

test('cli keeps resolving migrated commands to the same module as the static table', async () => {
  const dynamic = matchRoute(await collectRoutes(), 'paths', null)
  assert.ok(dynamic)
  assert.equal(dynamic.module, pathsCommand, 'dynamic registration must reuse the statically imported module instance')

  const ctx = configContext()
  const result = await main(['paths', '--config', CONFIG], ctx)
  assert.equal(result.exitCode, 0)
  assert.equal(ctx.stderr.text(), '')
  const body = JSON.parse(ctx.stdout.text())
  assert.equal(body.ok, true)
  assert.equal(typeof body.config, 'string')
})

test('cli keeps the static fallback and usage errors unchanged', async () => {
  const listed = configContext()
  const result = await main(['models', 'list', '--config', CONFIG], listed)
  assert.equal(result.exitCode, 0)
  assert.equal(JSON.parse(listed.stdout.text()).schema, 'cliworker.models/v1')

  const unknown = configContext()
  const unknownResult = await main(['no-such-command'], unknown)
  assert.equal(unknownResult.exitCode, 2)
  assert.equal(JSON.parse(unknown.stdout.text()).error.code, 'E_UNKNOWN_COMMAND')

  const usage = configContext()
  const usageResult = await main([], usage)
  assert.equal(usageResult.exitCode, 1)
  assert.ok(usage.stderr.text().startsWith('ERROR: usage: cliworker'))
})
