import { spawnSync } from 'node:child_process'

const STATUS_CACHE = new WeakMap()

function run(command, args, timeout = 20_000) {
  try {
    const r = spawnSync(command, args, { encoding: 'utf8', timeout, windowsHide: true, shell: process.platform === 'win32' })
    return { ok: r.status === 0, code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error?.message || null }
  } catch (e) {
    return { ok: false, code: -1, stdout: '', stderr: '', error: e.message }
  }
}

function probeProvider(provider) {
  const cli = provider.cli
  const prefix = Array.isArray(provider.args_prefix) ? provider.args_prefix : []
  const versionArgs = [...prefix, ...(provider.version_args || ['--version'])]
  const v = run(cli, versionArgs)
  if (v.error) return { state: 'unavailable', version: null, detail: v.error }
  if (!v.ok) return { state: 'unavailable', version: null, detail: (v.stderr || v.stdout || `exit ${v.code}`).trim().slice(0, 200) }
  const version = (v.stdout.match(/\d+\.\d+\.\d+(?:[-+][\w.]+)?/) || [''])[0] || null
  if (!provider.auth_args || !provider.auth_args.length) return { state: 'callable', version, detail: 'auth not configured' }
  const auth = run(cli, [...prefix, ...provider.auth_args])
  const text = (auth.stdout + '\n' + auth.stderr).toLowerCase()
  const ok = auth.ok && (
    !provider.auth_ok ||
    text.includes(String(provider.auth_ok).toLowerCase()) ||
    /"loggedin"\s*:\s*true/.test(text) ||
    /\blogged in\b/.test(text)
  )
  return { state: ok ? 'callable' : 'blocked', version, detail: ok ? 'auth ok' : (auth.stderr || auth.stdout || 'auth failed').trim().slice(0, 200) }
}

export function checkProvider(provider, { probe = true } = {}) {
  if (!probe) return { state: 'unverified', version: null, detail: 'probe disabled' }
  const cached = STATUS_CACHE.get(provider)
  if (cached) return cached
  const status = probeProvider(provider)
  STATUS_CACHE.set(provider, status)
  return status
}

export function providerStatus(config, opts = {}) {
  const out = {}
  for (const [name, p] of Object.entries(config.providers)) out[name] = checkProvider(p, opts)
  return out
}
