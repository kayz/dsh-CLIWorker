import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXAMPLE_URL = new URL('../config/cliworker.example.json', import.meta.url)

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

export function resolvePaths({ configPath, env, platform, cwd, homedir, stateDir } = {}) {
  const readEnv = env || {}
  const target = platform || process.platform
  const P = target === 'win32' ? path.win32 : path.posix
  const work = cwd || process.cwd()
  const userHome = homedir || os.homedir()

  const home = P.resolve(work, firstString(readEnv.CLIWORKER_HOME) || P.join(userHome, '.cliworker'))
  const config = P.resolve(work, firstString(configPath, readEnv.CLIWORKER_CONFIG) || P.join(home, 'config.json'))

  let state
  if (typeof stateDir === 'string' && stateDir !== '') {
    state = P.resolve(P.dirname(config), stateDir)
  } else {
    const key = target === 'win32' ? config.toLowerCase() : config
    const hash = crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 12)
    state = P.join(home, 'state', hash)
  }

  return { config, state_dir: state, home }
}

export function legacyUsageWarnings({ ctx, homedir } = {}) {
  const file = path.join(homedir ?? os.homedir(), '.cliworker', 'usage.jsonl')
  if (ctx && ctx.fs && ctx.fs.existsSync(file)) return [{ code: 'W_LEGACY_USAGE' }]
  return []
}

export function bundledExamplePath() {
  return fileURLToPath(EXAMPLE_URL)
}
