import { legacyUsageWarnings, resolvePaths } from '../paths.mjs'
import { arg } from './_util.mjs'

function looseStateDir(ctx, file) {
  try {
    const raw = JSON.parse(ctx.fs.readFileSync(file, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.state_dir === 'string' && raw.state_dir !== '') {
      return raw.state_dir
    }
  } catch {
    // A missing file, invalid JSON or the bundled example must not fail `paths`.
  }
  return undefined
}

export async function run({ argv, ctx }) {
  const configPath = arg(argv, '--config')
  const base = resolvePaths({ configPath, env: ctx.env, platform: ctx.platform })
  const stateDir = looseStateDir(ctx, base.config)
  const { config, state_dir } = stateDir === undefined
    ? base
    : resolvePaths({ configPath, env: ctx.env, platform: ctx.platform, stateDir })
  return { ok: true, config, state_dir, warnings: legacyUsageWarnings({ ctx }) }
}
