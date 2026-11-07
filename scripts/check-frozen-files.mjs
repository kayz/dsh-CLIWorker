#!/usr/bin/env node
// Frozen-file check: the registered characterization/golden files must keep their exact bytes.
// Hashing normalizes CRLF to LF so an autocrlf checkout and a Linux CI checkout agree.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')

const MANIFEST = ['test', 'characterization', 'frozen-files.json']
const COPY_DIR = 'test/fixtures/characterization/v0.1/'
const STABLE = 'test/characterization/stable.test.mjs'
const SOURCE_COMMIT = 'f75bb76'
const FORBIDDEN_PREFIXES = ['lib/', 'bin/', 'config/']
const ALLOWED_PREFIXES = [COPY_DIR, 'contracts/spec/', 'contracts/golden/']

const USAGE = 'usage: node scripts/check-frozen-files.mjs [--root <dir>]'

/** Bytes as text with every CRLF folded to LF, so the digest is line-ending agnostic. */
export function normalizeContent(buffer) {
  return buffer.toString('latin1').replace(/\r\n/g, '\n')
}

export function contentHash(buffer) {
  return crypto.createHash('sha256').update(normalizeContent(buffer), 'latin1').digest('hex')
}

function isAllowed(rel) {
  if (rel === STABLE) return true
  return ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix) && rel.length > prefix.length)
}

/** Reject anything that is not a plain repository-relative posix path inside the allowed set. */
export function classifyPath(rel) {
  if (rel.includes('\\')) return { id: 'frozen.outside_allowed', detail: rel }
  if (/^[A-Za-z]:/.test(rel)) return { id: 'frozen.outside_allowed', detail: rel }
  if (path.posix.isAbsolute(rel)) return { id: 'frozen.outside_allowed', detail: rel }
  if (rel.split('/').includes('..')) return { id: 'frozen.outside_allowed', detail: rel }

  const normalized = path.posix.normalize(rel)
  if (normalized === '.' || normalized === '' || normalized.startsWith('../')) {
    return { id: 'frozen.outside_allowed', detail: rel }
  }

  const lowered = normalized.toLowerCase()
  for (const prefix of FORBIDDEN_PREFIXES) {
    if (lowered === prefix.slice(0, -1) || lowered.startsWith(prefix)) {
      return { id: 'frozen.forbidden_path', detail: normalized }
    }
  }
  if (!isAllowed(normalized)) return { id: 'frozen.outside_allowed', detail: normalized }
  return { path: normalized }
}

function walkFiles(dir, prefix, found) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) walkFiles(path.join(dir, entry.name), rel, found)
    else if (entry.isFile()) found.push(rel)
  }
}

export function checkFrozenFiles({ root }) {
  const errors = []
  const base = path.resolve(root)
  const manifestFile = path.join(base, ...MANIFEST)

  let manifest = null
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  } catch {
    errors.push({ id: 'frozen.manifest_missing', detail: 'test/characterization/frozen-files.json' })
    return { errors, count: 0 }
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errors.push({ id: 'frozen.manifest_schema', detail: 'manifest must be a JSON object' })
    return { errors, count: 0 }
  }
  if (manifest.source_commit !== SOURCE_COMMIT) {
    errors.push({ id: 'frozen.manifest_schema', detail: `source_commit must be ${SOURCE_COMMIT}` })
  }
  if (!Array.isArray(manifest.files)) {
    errors.push({ id: 'frozen.manifest_schema', detail: 'files must be an array' })
    return { errors, count: 0 }
  }

  const seen = new Set()
  const registered = new Set()
  let count = 0

  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({ id: 'frozen.manifest_schema', detail: 'every registered file must be an object' })
      continue
    }
    const rel = entry.path
    if (typeof rel !== 'string' || rel === '') {
      errors.push({ id: 'frozen.manifest_schema', detail: 'registered file needs a non-empty path' })
      continue
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      errors.push({ id: 'frozen.manifest_schema', detail: `${rel} has an invalid sha256` })
      continue
    }
    if (seen.has(rel)) {
      errors.push({ id: 'frozen.manifest_schema', detail: `duplicate path ${rel}` })
      continue
    }
    seen.add(rel)

    const verdict = classifyPath(rel)
    if (verdict.id) {
      errors.push({ id: verdict.id, detail: verdict.detail })
      continue
    }
    registered.add(verdict.path)
    count += 1

    let buffer = null
    try {
      buffer = fs.readFileSync(path.join(base, ...verdict.path.split('/')))
    } catch {
      buffer = null
    }
    if (buffer === null) {
      errors.push({ id: 'frozen.file_missing', detail: verdict.path })
      continue
    }
    if (contentHash(buffer) !== entry.sha256) {
      errors.push({ id: 'frozen.hash_mismatch', detail: verdict.path })
    }
  }

  const copyFiles = []
  walkFiles(path.join(base, ...COPY_DIR.split('/').filter(Boolean)), '', copyFiles)
  for (const rel of copyFiles.sort()) {
    if (!registered.has(`${COPY_DIR}${rel}`)) {
      errors.push({ id: 'frozen.unregistered', detail: `${COPY_DIR}${rel}` })
    }
  }
  if (!registered.has(STABLE)) {
    errors.push({ id: 'frozen.unregistered', detail: STABLE })
  }

  return { errors, count }
}

function main() {
  const args = process.argv.slice(2)
  let root = REPO_ROOT

  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i]
    if (flag === '--root') {
      const value = args[i + 1]
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

  const { errors, count } = checkFrozenFiles({ root })
  if (errors.length === 0) {
    process.stdout.write(`check-frozen-files: ok (${count} files)\n`)
    process.exitCode = 0
    return
  }
  for (const error of errors) process.stdout.write(`FAIL ${error.id} ${error.detail}\n`)
  process.stdout.write(`check-frozen-files: FAILED (${errors.length} errors)\n`)
  process.exitCode = 1
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main()
