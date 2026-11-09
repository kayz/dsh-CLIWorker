import path from 'node:path'
import { findRule } from './rules.mjs'

function matches(name, patterns, insensitive) {
  return patterns.some(pattern => {
    if (typeof pattern !== 'string') return false
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
    return new RegExp(`^${escaped}$`, insensitive ? 'i' : '').test(name)
  })
}

// Only enumerate the immediate contents of explicitly supplied directories.
export function scanLocal(io, { platform, env, discovery }) {
  const win = platform === 'win32'
  const p = win ? path.win32 : path.posix
  const normalize = value => win ? p.normalize(value).toLowerCase() : p.normalize(value)
  const paths = typeof (env.PATH ?? env.Path) === 'string' ? (env.PATH ?? env.Path).split(win ? ';' : ':') : []
  const dirs = [...new Set([...paths, ...(discovery.extra_dirs ?? [])].filter(value => typeof value === 'string' && value !== '').map(value => p.resolve(value)))]
  const candidates = []
  const failed = []
  const seen = new Set()
  const consider = (file, override = false) => {
    const name = p.basename(file)
    const rule = findRule(name, platform)
    const patterns = discovery.unknown_patterns ?? []
    const base = win ? name.replace(/\.(?:exe|com|cmd|bat)$/i, '') : name
    if (!rule && !override && !matches(name, patterns, win) && !matches(base, patterns, win)) return
    try {
      const realpath = io.realpathSync(file)
      const info = io.statSync(realpath)
      if (!info.isFile()) return
      const key = normalize(realpath)
      if (seen.has(key)) return
      seen.add(key)
      candidates.push({ path: file, realpath, rule, fingerprint: { size: info.size, mtime: info.mtime ? new Date(info.mtime).toISOString() : null, realpath } })
    } catch { /* inaccessible candidates are not probed */ }
  }
  for (const dir of dirs) {
    try {
      const names = io.readdirSync(dir)
      for (const name of names.sort()) if (typeof name === 'string' && name !== '.' && name !== '..' && p.basename(name) === name) consider(p.join(dir, name))
    } catch { failed.push(dir) }
  }
  for (const value of Object.values(discovery.cli_overrides ?? {})) if (typeof value === 'string' && value !== '') consider(p.resolve(value), true)
  candidates.sort((a, b) => normalize(a.realpath).localeCompare(normalize(b.realpath)))
  return { candidates, failed }
}
