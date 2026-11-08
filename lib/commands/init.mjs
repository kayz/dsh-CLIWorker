import path from 'node:path'
import { bundledExamplePath, resolvePaths } from '../paths.mjs'
import { ensureDir } from '../config.mjs'
import { arg } from './_util.mjs'

export const route = { cmd: 'init', sub: null }

export async function run({ argv, ctx }) {
  const { config, state_dir } = resolvePaths({
    configPath: arg(argv, '--config'),
    env: ctx.env,
    platform: ctx.platform,
  })

  if (ctx.fs.existsSync(config)) {
    const error = new Error(`cannot init CLIWorker config ${config}: file already exists`)
    error.code = 'E_CONFIG_EXISTS'
    throw error
  }

  const example = bundledExamplePath()
  let text
  try {
    text = ctx.fs.readFileSync(example, 'utf8')
  } catch (e) {
    const error = new Error(`cannot read the bundled example ${example}: ${e && e.message ? e.message : 'unknown error'}`)
    error.code = 'E_CONFIG'
    throw error
  }

  ensureDir(path.dirname(config), ctx)
  ctx.fs.writeFileSync(config, text, 'utf8')

  return { ok: true, config, state_dir, warnings: [] }
}
