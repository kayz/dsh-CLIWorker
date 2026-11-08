import crypto from 'node:crypto'
import path from 'node:path'
import { codedError } from '../output.mjs'

const sessions = new WeakMap()
const backendError = () => codedError('E_SECRET_BACKEND', 'secret backend unavailable', { retryable: false })
const invalid = () => codedError('E_CONFIG', 'invalid secret reference')
const digest = value => crypto.createHash('sha256').update(value).digest('hex')
const protect = "$ErrorActionPreference='Stop'; $v=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($v); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))"
const unprotect = "$ErrorActionPreference='Stop'; $v=[Console]::In.ReadToEnd(); $b=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))"

function locate(ctx, config, cli) {
  const value = Object.hasOwn(config.secrets || {}, cli) ? config.secrets[cli] : { ref: `keychain:${cli}` }
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.ref !== 'string') throw invalid()
  const match = /^(env|keychain|session):(.+)$/.exec(value.ref)
  if (!match) throw invalid()
  return { kind: match[1], name: match[2] }
}

function namespace(ctx, config) {
  const P = ctx.platform === 'win32' ? path.win32 : path.posix
  let state = P.resolve(config._home || config.state_dir)
  if (ctx.platform === 'win32') state = state.toLowerCase()
  return { state, service: `cliworker:${digest(state)}`, P }
}

function execute(ctx, command, args, input) {
  let result
  try { result = ctx.exec(command, args, { shell: false, ...(input === undefined ? {} : { input }) }) } catch { throw backendError() }
  if (!result || result.error || result.code === null) throw backendError()
  return result
}

function missing(result) {
  return result.code === 1 && !result.stderr && !result.error
}

function quoteSecurity(value) {
  if (/[\x00-\x1f\x7f]/.test(value)) throw codedError('E_REQUEST_INVALID', 'invalid secret input')
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function keychain(ctx, config, name, action, value) {
  const { state, service, P } = namespace(ctx, config)
  if (ctx.platform === 'win32') {
    const dir = P.join(state, 'secrets')
    const file = P.join(dir, `${digest(name)}.dpapi`)
    if (action === 'set') {
      const r = execute(ctx, 'pwsh', ['-NoProfile', '-NonInteractive', '-Command', protect], value)
      if (!r.ok || !r.stdout) throw backendError()
      const temp = P.join(dir, `${digest(name)}.${crypto.randomBytes(12).toString('hex')}.tmp`)
      try { ctx.fs.mkdirSync(dir, { recursive: true }); ctx.fs.writeFileSync(temp, r.stdout, 'utf8'); ctx.fs.renameSync(temp, file) } catch { try { ctx.fs.unlinkSync(temp) } catch {} throw backendError() }
      return null
    }
    if (action === 'clear') { try { ctx.fs.unlinkSync(file) } catch (e) { if (e.code !== 'ENOENT') throw backendError() } return null }
    let ciphertext
    try { ciphertext = ctx.fs.readFileSync(file, 'utf8') } catch (e) { if (e.code === 'ENOENT') return null; throw backendError() }
    const r = execute(ctx, 'pwsh', ['-NoProfile', '-NonInteractive', '-Command', unprotect], ciphertext)
    if (!r.ok) throw backendError()
    return r.stdout
  }
  if (ctx.platform === 'darwin') {
    let r
    if (action === 'set') {
      const input = `add-generic-password -U -s ${quoteSecurity(service)} -a ${quoteSecurity(name)} -w ${quoteSecurity(value)}\n`
      r = execute(ctx, 'security', ['-i'], input)
    } else {
      r = execute(ctx, 'security', [action === 'clear' ? 'delete-generic-password' : 'find-generic-password', '-s', service, '-a', name, ...(action === 'clear' ? [] : ['-w'])])
    }
    if (!r.ok) { if (action !== 'set' && r.code === 44) return null; throw backendError() }
    return action === 'get' ? r.stdout.replace(/\r?\n$/, '') : null
  }
  if (ctx.platform !== 'linux') throw backendError()
  const args = action === 'set' ? ['store', '--label=CLIWorker', 'service', service, 'entry', name] : [action === 'clear' ? 'clear' : 'lookup', 'service', service, 'entry', name]
  const r = execute(ctx, 'secret-tool', args, action === 'set' ? value : undefined)
  if (!r.ok) { if (action !== 'set' && missing(r)) return null; throw backendError() }
  return action === 'get' ? r.stdout.replace(/\r?\n$/, '') : null
}

export function secretAction(ctx, config, cli, action, value) {
  const ref = locate(ctx, config, cli)
  if (ref.kind === 'env') {
    if (action !== 'get') throw backendError()
    return typeof ctx.env[ref.name] === 'string' && ctx.env[ref.name] !== '' ? ctx.env[ref.name] : null
  }
  if (ref.kind === 'session') {
    let store = sessions.get(ctx)
    if (!store) { store = new Map(); sessions.set(ctx, store) }
    if (action === 'set') store.set(ref.name, value)
    if (action === 'clear') store.delete(ref.name)
    return action === 'get' ? (store.get(ref.name) ?? null) : null
  }
  return keychain(ctx, config, ref.name, action, value)
}

export function resolveSecret(ctx, config, cli) { return secretAction(ctx, config, cli, 'get') }

export function runWithSecrets(ctx, config, cli, call, text, timeout) {
  const names = call.env_names || []
  const env = { ...ctx.env }
  let secret
  if (names.length) {
    secret = resolveSecret(ctx, config, cli)
    if (!secret) throw backendError()
    const declared = new Set(names.map(n => ctx.platform === 'win32' ? n.toLowerCase() : n))
    for (const key of Object.keys(env)) {
      const normalized = ctx.platform === 'win32' ? key.toLowerCase() : key
      if (env[key] === secret || declared.has(normalized)) delete env[key]
    }
    for (const name of names) env[name] = secret
  }
  let result
  try { result = ctx.exec(call.command, call.args, { cwd: call.cwd, input: text, timeout, env, shell: false }) } catch { throw backendError() }
  if (!secret) return result
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, typeof value === 'string' ? value.split(secret).join('[REDACTED]') : value]))
}
