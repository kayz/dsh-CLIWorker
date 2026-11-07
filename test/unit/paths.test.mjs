import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import path from 'node:path'

import { resolvePaths, legacyUsageWarnings } from '../../lib/paths.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const CWD = '/work'
const HOMEDIR = '/users/someone'

function hash12(configPath, platform) {
  const key = platform === 'win32' ? configPath.toLowerCase() : configPath
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)
}

test('[AC-012] resolvePaths takes configPath from the argument, then CLIWORKER_CONFIG, then CLIWORKER_HOME/config.json', () => {
  const env = { CLIWORKER_HOME: '/data/home', CLIWORKER_CONFIG: '/data/from-env.json' }
  const byArg = resolvePaths({ configPath: 'rel/cfg.json', env, platform: 'linux', cwd: CWD, homedir: HOMEDIR })
  assert.equal(byArg.config, path.posix.resolve(CWD, 'rel/cfg.json'))
  assert.equal(byArg.home, '/data/home')

  const byEnv = resolvePaths({ env, platform: 'linux', cwd: CWD, homedir: HOMEDIR })
  assert.equal(byEnv.config, '/data/from-env.json')

  const blankArg = resolvePaths({ configPath: '', env, platform: 'linux', cwd: CWD, homedir: HOMEDIR })
  assert.equal(blankArg.config, byEnv.config)

  const blankEnv = resolvePaths({ env: { CLIWORKER_HOME: '/data/home', CLIWORKER_CONFIG: '' }, platform: 'linux', cwd: CWD, homedir: HOMEDIR })
  const homeOnly = resolvePaths({ env: { CLIWORKER_HOME: '/data/home' }, platform: 'linux', cwd: CWD, homedir: HOMEDIR })
  assert.equal(blankEnv.config, homeOnly.config)
  assert.equal(homeOnly.config, '/data/home/config.json')

  const byDefault = resolvePaths({ env: {}, platform: 'linux', cwd: CWD, homedir: HOMEDIR })
  assert.equal(byDefault.home, '/users/someone/.cliworker')
  assert.equal(byDefault.config, '/users/someone/.cliworker/config.json')
})

test('[AC-012] resolvePaths derives state_dir from CLIWORKER_HOME/state/<sha256 prefix 12> of the config path', () => {
  const env = { CLIWORKER_HOME: '/data/home' }
  const out = resolvePaths({ env, platform: 'linux', cwd: CWD, homedir: HOMEDIR })
  const prefix = hash12(out.config, 'linux')
  assert.equal(prefix.length, 12)
  assert.equal(/^[0-9a-f]{12}$/.test(prefix), true)
  assert.equal(out.state_dir, path.posix.join(out.home, 'state', prefix))
  assert.equal(out.state_dir, `/data/home/state/${prefix}`)

  const other = resolvePaths({ env, platform: 'linux', cwd: CWD, homedir: HOMEDIR, configPath: '/work/other.json' })
  assert.notEqual(other.state_dir, out.state_dir)
})

test('[AC-012] resolvePaths lower-cases the config path before hashing on win32', () => {
  const opts = { env: { CLIWORKER_HOME: 'C:\\H' }, platform: 'win32', cwd: 'C:\\work', homedir: 'C:\\Users\\x' }
  const upper = resolvePaths({ ...opts, configPath: 'C:\\A\\cfg.json' })
  const lower = resolvePaths({ ...opts, configPath: 'c:\\a\\cfg.json' })
  assert.notEqual(upper.config, lower.config)
  assert.equal(upper.state_dir, lower.state_dir)
  assert.equal(upper.state_dir, path.win32.join(upper.home, 'state', hash12(upper.config, 'win32')))

  const linuxUpper = resolvePaths({ configPath: '/A/cfg.json', env: { CLIWORKER_HOME: '/H' }, platform: 'linux', cwd: '/work', homedir: '/u' })
  const linuxLower = resolvePaths({ configPath: '/a/cfg.json', env: { CLIWORKER_HOME: '/H' }, platform: 'linux', cwd: '/work', homedir: '/u' })
  assert.notEqual(linuxUpper.state_dir, linuxLower.state_dir)
})

test('[AC-012] resolvePaths resolves a relative explicit stateDir against the config file directory', () => {
  const opts = { configPath: '/cfg/a.json', env: {}, platform: 'linux', cwd: CWD, homedir: HOMEDIR }
  const relative = resolvePaths({ ...opts, stateDir: 'rel-state' })
  assert.equal(relative.state_dir, '/cfg/rel-state')

  const absolute = resolvePaths({ ...opts, stateDir: '/var/state' })
  assert.equal(absolute.state_dir, '/var/state')

  const hashed = resolvePaths(opts)
  const blank = resolvePaths({ ...opts, stateDir: '' })
  assert.equal(blank.state_dir, hashed.state_dir)
})

test('[AC-012] two different config paths get disjoint state_dir values', () => {
  const env = { CLIWORKER_HOME: '/data/home' }
  const a = resolvePaths({ configPath: '/cfg/a.json', env, platform: 'linux', cwd: CWD, homedir: HOMEDIR })
  const b = resolvePaths({ configPath: '/cfg/b.json', env, platform: 'linux', cwd: CWD, homedir: HOMEDIR })
  assert.notEqual(a.state_dir, b.state_dir)
  assert.equal(a.state_dir.startsWith(b.state_dir), false)
  assert.equal(b.state_dir.startsWith(a.state_dir), false)
})

test('[AC-012] legacyUsageWarnings reports W_LEGACY_USAGE only when the legacy usage file exists', () => {
  const homedir = '/users/someone'
  const legacy = path.join(homedir, '.cliworker', 'usage.jsonl')

  const present = createFakeContext({ files: { [legacy]: 'row\n' } })
  assert.deepEqual(legacyUsageWarnings({ ctx: present, homedir }), [{ code: 'W_LEGACY_USAGE' }])

  const missing = createFakeContext({ files: {} })
  assert.deepEqual(legacyUsageWarnings({ ctx: missing, homedir }), [])
})
