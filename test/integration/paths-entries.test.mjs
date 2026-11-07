import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'

import { main } from '../../lib/cli.mjs'
import { loadConfig } from '../../lib/config.mjs'
import { createPlugin } from '../../lib/index.js'
import { resolvePaths } from '../../lib/paths.mjs'
import { run as recordUsage } from '../../lib/commands/usage/record.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'
import { createHostStub } from '../helpers/host-stub.mjs'

const BASE = path.join(os.tmpdir(), 'cw-t005-paths-entries')
const HOME = path.join(BASE, 'home')
const ENV = { CLIWORKER_HOME: HOME }
const FIRST = path.join(BASE, 'a', 'config.json')
const BODY = JSON.stringify({ providers: { p1: { cli: 'p1cli' } }, models: {} })

function expected(configPath, extra = {}) {
  return resolvePaths({ configPath, env: ENV, platform: process.platform, cwd: process.cwd(), ...extra })
}

test('[AC-012] cliworker paths --config X reports the same config and state_dir as resolvePaths', async () => {
  const ctx = createFakeContext({ files: { [FIRST]: BODY }, env: ENV, platform: process.platform })
  const result = await main(['paths', '--config', FIRST], ctx)

  assert.equal(result.exitCode, 0)
  assert.equal(ctx.stderr.text(), '')
  const reported = JSON.parse(ctx.stdout.text())
  const want = expected(FIRST)

  assert.deepEqual(Object.keys(reported), ['ok', 'config', 'state_dir', 'warnings'])
  assert.equal(reported.ok, true)
  assert.equal(reported.config, want.config)
  assert.equal(reported.state_dir, want.state_dir)
  assert.deepEqual(reported.warnings, [])
  assert.equal(ctx.stdout.text(), JSON.stringify(reported, null, 2) + '\n')
})

test('[AC-012] createPlugin with configPath X reads the same config file that paths reports', async () => {
  const ctx = createFakeContext({ files: { [FIRST]: BODY }, env: ENV, platform: process.platform })
  await main(['paths', '--config', FIRST], ctx)
  const reported = JSON.parse(ctx.stdout.text())

  const plugCtx = createFakeContext({ files: { [FIRST]: BODY }, env: ENV, platform: process.platform })
  const host = createHostStub()
  const created = createPlugin(host.ctx, { configPath: FIRST }, { ctx: plugCtx })
  assert.deepEqual(created.errors, [])
  assert.ok(created.registered.includes('/cliworker/providers'))

  await host.request('/cliworker/providers')
  const reads = plugCtx.fs.accessed.filter((item) => item.method === 'readFileSync').map((item) => item.path)
  assert.ok(reads.includes(path.resolve(reported.config)))

  const config = loadConfig({ file: FIRST, ctx: plugCtx })
  assert.equal(config._file, reported.config)
  assert.equal(config._home, reported.state_dir)
})

test('[AC-012] usage record writes under the state_dir that paths reports', async () => {
  const ctx = createFakeContext({ files: { [FIRST]: BODY }, env: ENV, platform: process.platform })
  await main(['paths', '--config', FIRST], ctx)
  const reported = JSON.parse(ctx.stdout.text())
  const config = loadConfig({ file: FIRST, ctx })

  await recordUsage({ argv: ['--json', JSON.stringify({ model: 'nope' })], ctx, config })

  const usage = path.join(config._home, 'usage.jsonl')
  assert.equal(ctx.fs.existsSync(usage), true)
  assert.ok(ctx.fs.readFileSync(usage, 'utf8').includes('nope'))
  assert.equal(path.resolve(usage).startsWith(path.resolve(reported.state_dir) + path.sep), true)
})

test('[AC-012] paths reports W_LEGACY_USAGE in warnings when the legacy usage file exists', async () => {
  const legacy = path.join(os.homedir(), '.cliworker', 'usage.jsonl')
  const ctx = createFakeContext({ files: { [FIRST]: BODY, [legacy]: 'row\n' }, env: ENV, platform: process.platform })

  const result = await main(['paths', '--config', FIRST], ctx)
  assert.equal(result.exitCode, 0)
  assert.deepEqual(JSON.parse(ctx.stdout.text()).warnings, [{ code: 'W_LEGACY_USAGE' }])
})
