#!/usr/bin/env node
// Milestone gate: every AC owned by a task up to the requested milestone must be covered,
// its defects fixed, and its files must actually run in a full test run.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { mergeShards } from './check-traceability.mjs'
import { checkDefects, milestoneRank } from './check-defects.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const RUN_TESTS = path.join(HERE, 'run-tests.mjs')

function collectCoveredFiles(root) {
  const map = new Map()
  const dir = path.join(root, 'test', 'traceability')
  let names = []
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch {
    return map
  }
  for (const name of names) {
    let shard = null
    try {
      shard = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
    } catch {
      continue
    }
    for (const entry of Array.isArray(shard?.entries) ? shard.entries : []) {
      if (!entry || entry.status !== 'covered' || typeof entry.ac !== 'string') continue
      const files = Array.isArray(entry.files) ? entry.files.filter((file) => typeof file === 'string') : []
      map.set(entry.ac, files)
    }
  }
  return map
}

export function runGate({ root, index, milestone }) {
  const errors = []
  const limit = milestoneRank(milestone)
  const entries = Array.isArray(index?.acs) ? index.acs : []

  const merged = mergeShards({ root, index })
  for (const error of merged.errors) {
    const where = error.ac ?? error.file ?? '-'
    errors.push({ id: 'gate.trace_error', detail: `${where} ${error.detail ?? error.id}`.trim() })
  }

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    if (!(milestoneRank(entry.milestone) <= limit)) continue
    if (merged.acs[entry.ac] !== 'covered') {
      errors.push({ id: 'gate.ac_not_covered', detail: `${entry.ac} is ${merged.acs[entry.ac] ?? 'planned'}` })
    }
  }

  errors.push(...checkDefects({ root, index, milestone }).errors)

  if (errors.length > 0) return errors

  const coveredFiles = collectCoveredFiles(root)
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-gate-'))
  try {
    const result = spawnSync(process.execPath, [RUN_TESTS, '--root', root, '--out-dir', outDir], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    if (result.status !== 0) {
      const tail = (result.stderr || result.stdout || '').trim().split('\n').slice(-3).join(' | ')
      errors.push({ id: 'gate.run_failed', detail: `full run exited ${result.status}${tail ? `: ${tail}` : ''}` })
      return errors
    }

    let manifest = null
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'files-executed.json'), 'utf8'))
    } catch {
      manifest = null
    }
    if (!manifest || manifest.mode !== 'full') {
      errors.push({ id: 'gate.manifest_not_full', detail: `mode is ${manifest?.mode ?? 'missing'}` })
    }

    const executed = new Set(Array.isArray(manifest?.files) ? manifest.files : [])
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue
      if (!(milestoneRank(entry.milestone) <= limit)) continue
      if (merged.acs[entry.ac] !== 'covered') continue
      for (const file of coveredFiles.get(entry.ac) ?? []) {
        if (!executed.has(file)) {
          errors.push({ id: 'gate.file_not_executed', detail: `${file} (${entry.ac})` })
        }
      }
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }

  return errors
}

function main() {
  const args = process.argv.slice(2)
  let root = REPO_ROOT
  let indexPath = null
  let milestone = null

  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i]
    if (flag === '--root') {
      const value = args[i + 1]
      if (typeof value !== 'string' || value === '') {
        process.stderr.write('--root requires a directory\n')
        process.exitCode = 2
        return
      }
      root = path.resolve(value)
      i += 1
    } else if (flag === '--index') {
      const value = args[i + 1]
      if (typeof value !== 'string' || value === '') {
        process.stderr.write('--index requires a file\n')
        process.exitCode = 2
        return
      }
      indexPath = path.resolve(value)
      i += 1
    } else if (flag === '--milestone') {
      const value = args[i + 1]
      if (typeof value !== 'string' || !/^M[1-5]$/.test(value)) {
        process.stderr.write('--milestone requires one of M1, M2, M3, M4, M5\n')
        process.exitCode = 2
        return
      }
      milestone = value
      i += 1
    } else {
      process.stderr.write(
        `unknown argument: ${flag}\nusage: node scripts/milestone-gate.mjs --milestone Mx [--root <dir>] [--index <file>]\n`
      )
      process.exitCode = 2
      return
    }
  }

  if (!milestone) {
    process.stderr.write('usage: node scripts/milestone-gate.mjs --milestone Mx [--root <dir>] [--index <file>]\n')
    process.exitCode = 2
    return
  }

  const indexFile = indexPath ?? path.join(root, 'contracts', 'spec', 'ac-index.json')
  const errors = []
  let index = null
  try {
    index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
  } catch {
    errors.push({ id: 'gate.trace_error', detail: `cannot read index: ${indexFile}` })
    index = { acs: [] }
  }

  if (errors.length === 0) errors.push(...runGate({ root, index, milestone }))

  if (errors.length === 0) {
    process.stdout.write(`milestone-gate ${milestone}: PASS\n`)
    process.exitCode = 0
    return
  }
  for (const error of errors) process.stdout.write(`FAIL ${error.id} ${error.detail}\n`)
  process.stdout.write(`milestone-gate ${milestone}: BLOCKED (${errors.length} errors)\n`)
  process.exitCode = 1
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main()
