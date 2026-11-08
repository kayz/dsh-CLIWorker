import path from 'node:path'
import { loadConfig } from '../../config.mjs'
import { arg } from '../_util.mjs'

export async function run({ argv, ctx }) {
  const input = arg(argv, '--in')
  const output = arg(argv, '--out')
  if (!input || !output || input.startsWith('--') || output.startsWith('--') || path.resolve(input) === path.resolve(output)) {
    const error = new Error('input and output must be different paths')
    error.code = 'E_REQUEST_INVALID'
    throw error
  }
  const config = loadConfig({ file: input, ctx })
  if (!config.warnings.some(w => w.code === 'W_CONFIG_V1')) {
    const error = new Error('input must be v1')
    error.code = 'E_CONFIG'
    throw error
  }
  try {
    ctx.fs.writeFileSync(output, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  } catch (cause) {
    if (cause.code !== 'EEXIST') throw cause
    const error = new Error('output already exists')
    error.code = 'E_CONFIG_EXISTS'
    throw error
  }
  return { ok: true, warnings: config.warnings }
}
