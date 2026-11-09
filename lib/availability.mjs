import path from 'node:path'
import { listModels } from './catalog.mjs'
import { readJson } from './store.mjs'
import { codedError } from './output.mjs'
import { observeVersion, ruleForTarget } from './discovery/probe.mjs'

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
        !['probe_id', 'cmd_redacted', 'exit', 'duration_ms', 'nonce_ok', 'reported_model', 'tokens'].every(k => Object.hasOwn(e, k)) ||
        typeof e.probe_id !== 'string' || !e.probe_id || typeof e.cmd_redacted !== 'string' ||
        !(e.exit === null || Number.isInteger(e.exit)) || !Number.isFinite(e.duration_ms) || e.duration_ms < 0 ||
        typeof e.nonce_ok !== 'boolean' || !(e.reported_model === null || typeof e.reported_model === 'string') ||
        !(e.tokens === null || (e.tokens && typeof e.tokens === 'object' && !Array.isArray(e.tokens) &&
          ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'].every(k => Number.isSafeInteger(e.tokens[k]) && e.tokens[k] >= 0)))) invalid()
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
  const rule = ruleForTarget(cli, ctx.platform)
  const versionArgs = [...prefix, ...(rule ? rule.versionArgs : (provider.version_args || ['--version']))]
  // The lookup block is what lets the sync exec layer do win32 path/shim resolution without
  // importing node:fs itself.
  const lookup = { fs: ctx.fs, env: ctx.env, platform: ctx.platform }
  const observation = observeVersion(ctx, cli, versionArgs, rule?.name || 'provider')
  if (observation.reason) return { state: 'unverified', version: null, detail: observation.reason }
  const version = observation.version
  // A recognized CLI is never promoted by version evidence alone: real model calls, nonce and
  // identity verification decide model availability. Providers that match no rule have no such
  // identity claim to make, so their provider-level readiness keeps its pre-existing meaning
  // (version command succeeds, optional auth check passes) for compatibility.
  const granted = rule ? 'unverified' : 'callable'
  if (!provider.auth_args || !provider.auth_args.length) return { state: granted, version, detail: 'auth not configured' }
  const auth = ctx.exec(cli, [...prefix, ...provider.auth_args], { timeout: 20_000, lookup })
  const text = (auth.stdout + '\n' + auth.stderr).toLowerCase()
  const ok = auth.ok && (
    !provider.auth_ok ||
    text.includes(String(provider.auth_ok).toLowerCase()) ||
    /"loggedin"\s*:\s*true/.test(text) ||
    /\blogged in\b/.test(text)
  )
  return { state: ok ? granted : 'blocked', version, detail: ok ? 'auth ok' : 'auth failed' }
}

export function providerStatus(config, opts = {}) {
  const out = {}
  for (const [name, p] of Object.entries(config.providers)) out[name] = checkProvider(p, opts)
  return out
}
