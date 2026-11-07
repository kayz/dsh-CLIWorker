#!/usr/bin/env node
// Freezes contracts/spec/** and contracts/golden/** with a sha256 manifest.
// The manifest is the only place a golden or spec file is registered; --write is the only writer.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { validate } from '../lib/contract/validate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const MANIFEST_REL = 'contracts/golden/manifest.json'
const SCHEMA_REL = 'contracts/schemas/golden-manifest.schema.json'
const PRESERVED_DIRS = ['contracts/spec', 'contracts/golden']
const USAGE = 'usage: node scripts/check-golden-frozen.mjs [--root <dir>] [--write]'

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function byCodePoint(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function walk(dir, base, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, base, out)
    else if (entry.isFile()) out.push(toPosix(path.relative(base, full)))
  }
}

function listFiles(root) {
  const found = []
  for (const rel of PRESERVED_DIRS) {
    walk(path.join(root, rel), root, found)
  }
  return found
    .filter((rel) => rel !== MANIFEST_REL)
    .sort(byCodePoint)
}

function normalizedSha256(file) {
  const text = fs.readFileSync(file).toString('utf8').replace(/\r\n/g, '\n')
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

function writeManifest(root, files) {
  const payload = {
    schema: 'cliworker.golden-manifest/v1',
    files: files.map((rel) => ({ path: rel, sha256: normalizedSha256(path.join(root, rel)) })),
  }
  const target = path.join(root, MANIFEST_REL)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload.files.length
}

function loadManifest(root) {
  const file = path.join(root, MANIFEST_REL)
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return { error: 'manifest is missing' }
  }
  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch {
    return { error: 'manifest is not valid JSON' }
  }
  try {
    const schema = JSON.parse(fs.readFileSync(path.join(root, SCHEMA_REL), 'utf8'))
    const result = validate(schema, manifest)
    if (!result.ok) {
      const first = result.errors[0]
      return { error: `manifest does not match the schema (${first.path || '/'}: ${first.keyword})` }
    }
  } catch (error) {
    return { error: `manifest schema is unreadable (${error.message})` }
  }
  if (!Array.isArray(manifest.files)) return { error: 'manifest has no files array' }
  const seen = new Set()
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string') return { error: 'manifest entry has no path' }
    const rel = entry.path
    if (rel === MANIFEST_REL) return { error: 'manifest registers itself' }
    if (!PRESERVED_DIRS.some((dir) => rel.startsWith(`${dir}/`))) {
      return { error: `manifest path is outside the preserved directories: ${rel}` }
    }
    if (seen.has(rel)) return { error: `manifest has a duplicate path: ${rel}` }
    seen.add(rel)
  }
  return { manifest }
}

function main(argv) {
  let root = REPO_ROOT
  let write = false

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--root') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value === '') {
        process.stderr.write(`check-golden-frozen: --root requires a directory\n${USAGE}\n`)
        process.exitCode = 2
        return
      }
      root = path.resolve(value)
      i += 1
    } else if (flag === '--write') {
      write = true
    } else {
      process.stderr.write(`check-golden-frozen: unknown argument: ${flag}\n${USAGE}\n`)
      process.exitCode = 2
      return
    }
  }

  const files = listFiles(root)

  if (write) {
    const count = writeManifest(root, files)
    process.stdout.write(`check-golden-frozen: wrote manifest (${count} files)\n`)
    process.exitCode = 0
    return
  }

  const loaded = loadManifest(root)
  if (loaded.error) {
    process.stdout.write(`FAIL golden.manifest_invalid ${loaded.error}\n`)
    process.stdout.write('check-golden-frozen: FAILED (1 errors)\n')
    process.exitCode = 1
    return
  }

  const registered = new Map()
  for (const entry of loaded.manifest.files) registered.set(entry.path, entry.sha256)

  const errors = []
  const actual = new Set(files)
  for (const rel of files) {
    if (!registered.has(rel)) {
      errors.push(`FAIL golden.unregistered ${rel}`)
      continue
    }
    let hash
    try {
      hash = normalizedSha256(path.join(root, rel))
    } catch {
      errors.push(`FAIL golden.missing ${rel}`)
      continue
    }
    if (hash !== registered.get(rel)) errors.push(`FAIL golden.changed ${rel}`)
  }
  for (const rel of [...registered.keys()].sort(byCodePoint)) {
    if (!actual.has(rel)) errors.push(`FAIL golden.missing ${rel}`)
  }

  if (errors.length > 0) {
    for (const line of errors) process.stdout.write(`${line}\n`)
    process.stdout.write(`check-golden-frozen: FAILED (${errors.length} errors)\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write(`check-golden-frozen: ok (${files.length} files)\n`)
  process.exitCode = 0
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main(process.argv.slice(2))
