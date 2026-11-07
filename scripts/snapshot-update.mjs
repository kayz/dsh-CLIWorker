#!/usr/bin/env node
// Writes contracts/registry.snapshot.json from lib/contract/registry.mjs.
// Additions require a manual snapshot_version bump; removals, renames and value changes are refused.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { compareRegistry } from '../lib/contract/registry.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const SNAPSHOT_REL = 'contracts/registry.snapshot.json'
const USAGE = 'usage: node scripts/snapshot-update.mjs [--root <dir>]'

function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    if (!deepEqual(a[key], b[key])) return false
  }
  return true
}

function writeSnapshot(file, registry) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
}

function readSnapshot(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

async function main(argv) {
  let root = REPO_ROOT
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--root') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value === '') {
        process.stderr.write(`snapshot-update: --root requires a directory\n${USAGE}\n`)
        process.exitCode = 2
        return
      }
      root = path.resolve(value)
      i += 1
    } else {
      process.stderr.write(`snapshot-update: unknown argument: ${flag}\n${USAGE}\n`)
      process.exitCode = 2
      return
    }
  }

  const registryFile = path.join(root, 'lib', 'contract', 'registry.mjs')
  let candidate
  try {
    const module = await import(pathToFileURL(registryFile).href)
    candidate = module.REGISTRY
  } catch (error) {
    process.stderr.write(`snapshot-update: cannot load ${registryFile}: ${error.message}\n`)
    process.exitCode = 1
    return
  }
  if (!candidate || typeof candidate !== 'object') {
    process.stderr.write('snapshot-update: candidate module does not export REGISTRY\n')
    process.exitCode = 1
    return
  }

  const snapshotFile = path.join(root, SNAPSHOT_REL)
  const snapshot = readSnapshot(snapshotFile)

  if (snapshot === null) {
    if (candidate.snapshot_version !== 1) {
      process.stdout.write(
        `FAIL snapshot.version_not_bumped have=${candidate.snapshot_version} need=1\n`
      )
      process.exitCode = 1
      return
    }
    writeSnapshot(snapshotFile, candidate)
    process.stdout.write('snapshot-update: wrote snapshot_version 1\n')
    process.exitCode = 0
    return
  }

  if (deepEqual(snapshot, candidate)) {
    process.stdout.write(`snapshot-update: unchanged (snapshot_version ${snapshot.snapshot_version})\n`)
    process.exitCode = 0
    return
  }

  const diff = compareRegistry(snapshot, candidate)
  if (diff.removed.length > 0 || diff.changed.length > 0) {
    process.stdout.write(
      `FAIL snapshot.breaking removed=${diff.removed.length} changed=${diff.changed.length}\n`
    )
    process.exitCode = 1
    return
  }

  if (diff.added.length === 0) {
    process.stdout.write('FAIL snapshot.no_semantic_change\n')
    process.exitCode = 1
    return
  }

  const need = Number(snapshot.snapshot_version) + 1
  if (candidate.snapshot_version !== need) {
    process.stdout.write(
      `FAIL snapshot.version_not_bumped have=${candidate.snapshot_version} need=${need}\n`
    )
    process.exitCode = 1
    return
  }

  writeSnapshot(snapshotFile, candidate)
  process.stdout.write(`snapshot-update: wrote snapshot_version ${candidate.snapshot_version}\n`)
  process.exitCode = 0
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`snapshot-update: ${error && error.stack ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
}
