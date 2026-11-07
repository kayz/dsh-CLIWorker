#!/usr/bin/env node
// Publish-shape check: the npm pack list must carry the runtime files and nothing from spec,
// golden, tests, scripts, local config or state.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const USAGE = 'usage: node scripts/check-pack.mjs [--root <dir>]'

// Built by concatenation so this file does not match the no-collab needle itself.
const COLLAB_PREFIX = `${['.', 'coll', 'ab'].join('')}/`

const REQUIRED_FILES = [
  'bin/cliworker.mjs',
  'config/cliworker.example.json',
  'contracts/registry.snapshot.json',
  'contracts/agentline-forbidden.json',
  'dsh.plugin.json',
  'package.json',
  'cordis.patch.yml',
]
const REQUIRED_PREFIXES = ['contracts/schemas/', 'contracts/host/', 'contracts/context/']
const CONTRACTS_WHITELIST = new Set(['contracts/registry.snapshot.json', 'contracts/agentline-forbidden.json'])
const FORBIDDEN_PREFIXES = ['test/', 'scripts/', 'state/', 'contracts/golden/', 'contracts/spec/']

function byCodePoint(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Every file under `<root>/lib`, as sorted posix paths relative to the root. */
export function collectLibFiles(root) {
  const found = []
  const walk = (dir, prefix) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel)
      else if (entry.isFile()) found.push(`lib/${rel}`)
    }
  }
  walk(path.join(path.resolve(root), 'lib'), '')
  return found.sort(byCodePoint)
}

/**
 * Runs `npm pack --dry-run --json --ignore-scripts` in `root`.
 * Returns `{ files, error }`; `error` is null on success. Raw npm output never leaks out.
 */
export function runNpmPack(root) {
  const args = ['pack', '--dry-run', '--json', '--ignore-scripts']
  let result
  try {
    result = spawnSync('npm', args, {
      cwd: root,
      shell: process.platform === 'win32',
      encoding: 'utf8',
    })
  } catch {
    return { files: [], error: 'npm pack could not be started' }
  }
  if (result.error) return { files: [], error: 'npm pack could not be started' }
  if (result.status !== 0) {
    const code = result.status === null ? 'no exit code' : `exit ${result.status}`
    return { files: [], error: `npm pack failed (${code})` }
  }

  let parsed
  try {
    parsed = JSON.parse(String(result.stdout ?? ''))
  } catch {
    return { files: [], error: 'npm pack did not print JSON' }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { files: [], error: 'npm pack JSON is not a non-empty array' }
  }
  const entries = parsed[0] && parsed[0].files
  if (!Array.isArray(entries)) return { files: [], error: 'npm pack JSON has no files array' }

  const files = []
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.path !== 'string') {
      return { files: [], error: 'npm pack JSON has a file without a path' }
    }
    files.push(entry.path.split('\\').join('/'))
  }
  return { files, error: null }
}

function isForbidden(file) {
  if (FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix))) return true
  if (file.startsWith(COLLAB_PREFIX)) return true
  if (file.startsWith('config/') && file.endsWith('.local.json')) return true
  return file.endsWith('.jsonl')
}

function isOutsideContractsWhitelist(file) {
  if (!file.startsWith('contracts/')) return false
  if (CONTRACTS_WHITELIST.has(file)) return false
  return !REQUIRED_PREFIXES.some((prefix) => file.startsWith(prefix))
}

/** Pure rule engine over an already-collected pack list and already-parsed manifests. */
export function evaluatePack({ packFiles, pkg, plugin, libFiles }) {
  const errors = []
  const files = Array.isArray(packFiles) ? packFiles : []
  const present = new Set(files)
  const libs = Array.isArray(libFiles) ? libFiles : []

  const pkgOk = isObject(pkg)
  const pluginOk = isObject(plugin)
  if (!pkgOk) errors.push({ id: 'pack.manifest_unreadable', detail: 'package.json' })
  if (!pluginOk) errors.push({ id: 'pack.manifest_unreadable', detail: 'dsh.plugin.json' })

  if (pkgOk && (!isObject(pkg.bin) || pkg.bin.cliworker !== 'bin/cliworker.mjs')) {
    errors.push({ id: 'pack.bin_mismatch', detail: 'bin.cliworker must be bin/cliworker.mjs' })
  }

  if (pkgOk && pluginOk) {
    const versionOk =
      typeof pkg.version === 'string' &&
      pkg.version !== '' &&
      typeof plugin.version === 'string' &&
      plugin.version !== ''
    if (!versionOk || plugin.version !== pkg.version) {
      errors.push({
        id: 'pack.version_mismatch',
        detail: `dsh.plugin.json version ${String(plugin.version)} != package.json version ${String(pkg.version)}`,
      })
    }
  }

  for (const required of REQUIRED_FILES) {
    if (!present.has(required)) errors.push({ id: 'pack.missing_required', detail: required })
  }
  for (const prefix of REQUIRED_PREFIXES) {
    if (!files.some((file) => file.startsWith(prefix))) {
      errors.push({ id: 'pack.missing_required', detail: prefix })
    }
  }
  if (libs.length === 0) {
    errors.push({ id: 'pack.missing_required', detail: 'lib/' })
  } else {
    for (const lib of libs) {
      if (!present.has(lib)) errors.push({ id: 'pack.missing_required', detail: lib })
    }
  }

  for (const file of files) {
    if (isForbidden(file)) errors.push({ id: 'pack.forbidden_present', detail: file })
    if (isOutsideContractsWhitelist(file)) errors.push({ id: 'pack.not_whitelisted', detail: file })
  }

  errors.sort((a, b) => byCodePoint(a.id, b.id) || byCodePoint(a.detail, b.detail))
  return { errors }
}

function readManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function main(argv) {
  let root = REPO_ROOT

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--root') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value === '') {
        process.stderr.write(`--root requires a directory\n${USAGE}\n`)
        process.exitCode = 2
        return
      }
      root = path.resolve(value)
      i += 1
    } else {
      process.stderr.write(`unknown argument: ${flag}\n${USAGE}\n`)
      process.exitCode = 2
      return
    }
  }

  const pack = runNpmPack(root)
  let errors = []
  if (pack.error !== null) {
    errors.push({ id: 'pack.npm_failed', detail: pack.error })
  } else {
    errors = evaluatePack({
      packFiles: pack.files,
      pkg: readManifest(path.join(root, 'package.json')),
      plugin: readManifest(path.join(root, 'dsh.plugin.json')),
      libFiles: collectLibFiles(root),
    }).errors
  }

  if (errors.length === 0) {
    process.stdout.write('check-pack: ok\n')
    process.exitCode = 0
    return
  }
  for (const error of errors) process.stdout.write(`FAIL ${error.id} ${error.detail}\n`)
  process.stdout.write(`check-pack: FAILED (${errors.length} errors)\n`)
  process.exitCode = 1
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main(process.argv.slice(2))
