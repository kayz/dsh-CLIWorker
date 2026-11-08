import { arg } from '../_util.mjs'
import { codedError } from '../../output.mjs'
import { atomicWriteJson } from '../../store.mjs'
import { withLock, lockFilePath } from '../../lock.mjs'
import { mergePools, readStatePools } from './state.mjs'

export const route = { cmd: 'pools', sub: 'set' }

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(message) {
  return codedError('E_REQUEST_INVALID', message)
}

function configError(message) {
  return codedError('E_CONFIG', message)
}

function readConfigFile(ctx, file) {
  let text
  try {
    text = ctx.fs.readFileSync(file, 'utf8')
  } catch {
    throw configError('configuration cannot be read')
  }
  let value
  try {
    value = JSON.parse(String(text))
  } catch {
    throw configError('configuration is not valid JSON')
  }
  if (!isObject(value) || !Array.isArray(value.pools)) throw configError('configuration has no pools array')
  return value
}

export async function run({ argv, ctx, config }) {
  const raw = arg(argv, '--json')
  let pool
  try {
    pool = JSON.parse(raw)
  } catch {
    throw invalid('pools set requires a valid --json object')
  }
  if (!isObject(pool) || typeof pool.id !== 'string' || pool.id === '') {
    throw invalid('pools set requires a pool object with a non-empty id')
  }

  const saved = await withLock(
    ctx,
    lockFilePath(config._home),
    async () => {
      const document = readConfigFile(ctx, config._file)
      const index = document.pools.findIndex((item) => isObject(item) && item.id === pool.id)
      if (index < 0) throw invalid('unknown pool id')
      document.pools[index] = pool
      await atomicWriteJson(ctx, config._file, document)
      return document.pools
    },
    { policy: config.policy }
  )

  return { ok: true, pools: mergePools(saved, readStatePools(ctx, config)) }
}
