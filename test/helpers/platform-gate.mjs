// Platform gating helpers shared by tests. Skip records use cliworker.skip/v1.
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

function pathExtensions() {
  if (process.platform !== 'win32') return ['']
  const raw = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD'
  return raw.split(';').filter((item) => item.length > 0)
}

function which(binary) {
  const dirs = (process.env.PATH || '').split(path.delimiter)
  const candidates = new Set([binary.toLowerCase()])
  for (const ext of pathExtensions()) candidates.add(`${binary}${ext}`.toLowerCase())

  for (const dir of dirs) {
    if (!dir) continue
    for (const name of candidates) {
      const candidate = path.join(dir, name)
      if (fs.existsSync(candidate)) return candidate
    }
    // Windows app execution aliases (for example the PowerShell store alias) are reparse
    // points that reject stat with EACCES, so existsSync cannot see them; the directory
    // listing still can. This keeps the probe child-process free.
    let entries
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (candidates.has(entry.toLowerCase())) return path.join(dir, entry)
    }
  }
  return null
}

export function satisfies(requires, opts = {}) {
  const platform = opts.platform ?? process.platform
  switch (requires) {
    case 'win32':
    case 'darwin':
    case 'linux':
      return platform === requires
    case 'pwsh':
      return which('pwsh') !== null
    case 'secret-tool':
      return which('secret-tool') !== null
    case 'security':
      return which('security') !== null
    case 'wsl': {
      if (platform === 'win32') {
        const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
        return fs.existsSync(path.join(systemRoot, 'System32', 'wsl.exe'))
      }
      return platform === 'linux' && Boolean(process.env.WSL_DISTRO_NAME)
    }
    default:
      return false
  }
}

function relativeFile(file) {
  if (typeof file !== 'string' || file === '') return ''
  let resolved = file
  if (file.startsWith('file:')) {
    try {
      resolved = fileURLToPath(file)
    } catch {
      return file
    }
  }
  const root = process.env.CLIWORKER_ROOT ? path.resolve(process.env.CLIWORKER_ROOT) : process.cwd()
  return path.relative(root, path.resolve(resolved)).split(path.sep).join('/')
}

export function recordSkip({ test: name, file, ac, requires, reason }) {
  const dir = process.env.CLIWORKER_RESULTS_DIR
  if (!dir) return false
  const record = {
    schema: 'cliworker.skip/v1',
    test: name,
    file: relativeFile(file),
    ac: ac ?? null,
    requires,
    platform: process.platform,
    node: process.version,
    reason,
    at: new Date().toISOString(),
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(path.join(dir, 'skips.jsonl'), `${JSON.stringify(record)}\n`)
  return true
}

export function platformTest(name, options, fn) {
  const { ac = null, requires, file, reason } = options ?? {}
  test(name, (t) => {
    if (satisfies(requires)) return fn(t)
    const why = reason ?? `requires ${requires} not satisfied on ${process.platform}`
    recordSkip({ test: name, file, ac, requires, reason: why })
    t.skip(why)
  })
}
