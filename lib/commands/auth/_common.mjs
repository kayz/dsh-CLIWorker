import { codedError } from '../../output.mjs'
import { secretAction } from '../../secrets/index.mjs'

function invalid() { return codedError('E_REQUEST_INVALID', 'invalid auth arguments') }

export function runAuth(action, { argv, ctx, config }) {
  const args = argv.slice(2)
  let cli
  let source
  for (let i = 0; i < args.length; i++) {
    const item = args[i]
    if (item === '--config') {
      if (!args[++i] || args[i].startsWith('--')) throw invalid()
    } else if (item === '--from-env' && action === 'set') {
      if (source !== undefined || !args[++i] || args[i].startsWith('--')) throw invalid()
      source = args[i]
    } else if (item.startsWith('-') || cli !== undefined) throw invalid()
    else cli = item
  }
  if (!cli) throw invalid()
  if (action === 'set') {
    let value
    if (source !== undefined) value = ctx.env[source]
    else {
      try { value = ctx.fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '') } catch { throw invalid() }
    }
    if (typeof value !== 'string' || value === '') throw invalid()
    secretAction(ctx, config, cli, 'set', value)
    return { ok: true, state: 'set' }
  }
  if (action === 'clear') { secretAction(ctx, config, cli, 'clear'); return { ok: true, state: 'unset' } }
  return { ok: true, state: secretAction(ctx, config, cli, 'get') === null ? 'unset' : 'set' }
}
