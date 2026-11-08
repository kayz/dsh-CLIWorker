// `cliworker cli resolve` — resolves one configured model to the executable provider command.
//
// The command is registered dynamically by `export const route`; lib/cli.mjs picks it up without
// a static table entry. It only builds a description: no lease, no execution, no state write.
import { buildDirectCall, parsePlatform } from '../../adapters/call.mjs'
import { renderPosix, renderPwsh } from '../../adapters/display.mjs'
import { listModels, resolveModel, selectModels } from '../../catalog.mjs'
import { parseModelOptions } from '../../models/directory.mjs'
import { codedError } from '../../output.mjs'

export const route = { cmd: 'cli', sub: 'resolve' }

const isLegacy = (config) =>
  Array.isArray(config?.warnings) && config.warnings.some((warning) => warning?.code === 'W_CONFIG_V1')

function refuse(model, reason) {
  throw codedError('E_NO_CANDIDATE', `model ${model.key} is not selectable: ${reason}`)
}

/**
 * The reason the production model directory refuses this model, or null. It reuses the catalog's
 * own selection pass (allow list, deprecation, level) and only adds the availability gate that
 * selection performs through provider status.
 */
function rejectionReason(model, selection) {
  if (model.allowed !== true) return 'not_allowed'
  const refused = selection.rejected.find((item) => item.key === model.key)
  if (refused) return refused.reason
  if (model.availability.state !== 'callable') return `availability:${model.availability.state}`
  return null
}

export async function run({ argv, ctx, config }) {
  const { flags, values } = parseModelOptions(argv, {
    flags: ['--readonly'],
    valued: ['--model', '--cwd', '--platform'],
  })
  const key = values['--model']
  if (key === undefined) throw codedError('E_REQUEST_INVALID', 'cli resolve requires --model <key>')
  if (isLegacy(config)) {
    throw codedError('E_CONFIG', 'cli resolve requires a cliworker.config/v2 model directory')
  }

  const platform = parsePlatform(values['--platform'], ctx.platform)
  const cwd = values['--cwd'] === undefined ? process.cwd() : values['--cwd']

  const directory = listModels(config, { models: [], ctx })
  const model = resolveModel(directory, key)
  if (!model) throw codedError('E_REQUEST_INVALID', `unknown model: ${key}`)

  const reason = rejectionReason(model, selectModels(directory))
  if (reason !== null) refuse(model, reason)

  const built = buildDirectCall({
    model,
    config,
    cwd,
    platform,
    readonly: flags.has('--readonly'),
  })
  if (built.call === null) refuse(model, built.reason)

  return {
    model: { key: model.key, provider: model.provider, id: model.id, cli: model.cli },
    direct_call: built.call,
    display: { posix: renderPosix(built.call), pwsh: renderPwsh(built.call) },
  }
}
