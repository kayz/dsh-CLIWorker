import { createHash } from 'node:crypto'
import path from 'node:path'
import { findRule } from './rules.mjs'

export function ruleForTarget(target, platform) {
  return findRule((platform === 'win32' ? path.win32 : path.posix).basename(target), platform)
}

export function parseVersion(stdout) {
  const token = /[0-9A-Za-z_.+-]+/g
  const semver = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
  for (const match of stdout.matchAll(token)) {
    if (semver.test(match[0])) return match[0].replace(/^v/, '')
  }
  return null
}

export function observeVersion(ctx, target, args, label, at) {
  // Legacy programmatic contexts (notably the characterization harness) call checkProvider with a
  // hand-built ctx that has no clock. Version observation still works there; only evidence timing
  // degrades to a neutral value, which no production caller uses.
  const clock = ctx.clock && typeof ctx.clock === 'object' ? ctx.clock : {}
  const readNow = typeof clock.now === 'function' ? () => clock.now() : () => 0
  const readIso = typeof clock.nowIso === 'function' ? () => clock.nowIso() : () => null
  const start = readNow()
  const observedAt = at === undefined ? readIso() : at
  const platformPath = ctx.platform === 'win32' ? path.win32 : path.posix
  let missing = false
  if (platformPath.isAbsolute(target) && (ctx.platform !== 'win32' || platformPath.extname(target)) && typeof ctx.fs?.statSync === 'function') {
    try { ctx.fs.statSync(target) } catch (error) { missing = error?.code === 'ENOENT' }
  }
  const result = missing ? { code: null, stdout: '', error: 'ENOENT' } : ctx.exec(target, args, { timeout: 20_000, lookup: { fs: ctx.fs, env: ctx.env, platform: ctx.platform } })
  const stdout = typeof result?.stdout === 'string' ? result.stdout : ''
  const exit = Number.isInteger(result?.code) ? result.code : null
  let reason = null
  if (exit === null) reason = /\bENOENT\b/.test(String(result?.error || '')) ? 'command missing' : result?.error_code === 'E_TIMEOUT' ? 'timeout' : 'unavailable'
  else if (exit !== 0) reason = 'non-zero exit'
  const version = reason === null ? parseVersion(stdout) : null
  if (reason === null && version === null) reason = 'unparsable output'
  return { version, reason, exit, duration: Math.max(0, readNow() - start), evidence: [{
    kind: 'probe', cmd_redacted: `${label} ${args.join(' ')}`, exit, at: observedAt,
    digest: createHash('sha256').update(stdout, 'utf8').digest('hex'),
  }] }
}
