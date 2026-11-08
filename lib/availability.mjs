import path from 'node:path'
import { listModels } from './catalog.mjs'
import { readJson } from './store.mjs'
import { codedError } from './output.mjs'

/** Read the persisted probe records without treating malformed state as an empty cache. */
export function readProbeModels(config, { ctx } = {}) {
  const records = readJson(ctx, path.join(config._home, 'probes.json'), [])
  const invalid = () => { throw codedError('E_CONFIG', 'invalid probe cache') }
  if (!Array.isArray(records)) invalid()
  const keys = new Set()
  for (const model of records) {
    if (!model || keys.has(model.key)) invalid()
    keys.add(model.key)
    const e = model.availability?.evidence
    if (!e || typeof e !== 'object' || Array.isArray(e) ||
        !['probe_id', 'cmd_redacted', 'exit', 'duration_ms', 'nonce_ok', 'reported_model', 'tokens'].every(k => Object.hasOwn(e, k))) invalid()
  }
  // Reuse the directory's model/v1 validation, without using the resulting projection.
  listModels({ catalog: { manual: records, allow: [], levels: {}, aliases: {}, deprecated: {} } }, { models: [], ctx })
  return records
}

export function checkProvider(provider, { probe = true, ctx } = {}) {
  const cli = provider.cli
  if (!probe) return { state: 'unverified', version: null, detail: 'probe disabled' }
  if (!ctx || typeof ctx.exec !== 'function') throw new TypeError('checkProvider requires ctx.exec')
  const prefix = Array.isArray(provider.args_prefix) ? provider.args_prefix : []
  const versionArgs = [...prefix, ...(provider.version_args || ['--version'])]
  // The lookup block is what lets the sync exec layer do win32 path/shim resolution without
  // importing node:fs itself.
  const lookup = { fs: ctx.fs, env: ctx.env, platform: ctx.platform }
  const v = ctx.exec(cli, versionArgs, { timeout: 20_000, lookup })
  if (v.error) return { state: 'unavailable', version: null, detail: v.error }
  if (!v.ok) return { state: 'unavailable', version: null, detail: (v.stderr || v.stdout || `exit ${v.code}`).trim().slice(0, 200) }
  const version = (v.stdout.match(/\d+\.\d+\.\d+(?:[-+][\w.]+)?/) || [''])[0] || null
  if (!provider.auth_args || !provider.auth_args.length) return { state: 'callable', version, detail: 'auth not configured' }
  const auth = ctx.exec(cli, [...prefix, ...provider.auth_args], { timeout: 20_000, lookup })
  const text = (auth.stdout + '\n' + auth.stderr).toLowerCase()
  const ok = auth.ok && (
    !provider.auth_ok ||
    text.includes(String(provider.auth_ok).toLowerCase()) ||
    /"loggedin"\s*:\s*true/.test(text) ||
    /\blogged in\b/.test(text)
  )
  return { state: ok ? 'callable' : 'blocked', version, detail: ok ? 'auth ok' : (auth.stderr || auth.stdout || 'auth failed').trim().slice(0, 200) }
}

export function providerStatus(config, opts = {}) {
  const out = {}
  for (const [name, p] of Object.entries(config.providers)) out[name] = checkProvider(p, opts)
  return out
}
