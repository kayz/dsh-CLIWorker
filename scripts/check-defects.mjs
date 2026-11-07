#!/usr/bin/env node
// Defect ledger check: every defect that must already be fixed needs a plain [fixed] test.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { mergeShards, extractTitles } from './check-traceability.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')

const MILESTONES = ['M1', 'M2', 'M3', 'M4', 'M5']
const EXPECTED_IDS = [
  'a1-quota',
  'a2-pack',
  'a3-runner',
  'a4-paths',
  'a4-null-config',
  'a5-dup-call',
  'a5-forecast-x3',
  'a5-unused',
  'a5-ignored-fields',
  'a5-shell',
  'a5-nocache',
]

const LEDGER = ['test', 'characterization', 'defects.json']
const DEFECTS_DIR = ['test', 'characterization', 'defects']

export function milestoneRank(value) {
  const index = MILESTONES.indexOf(value)
  return index < 0 ? Number.NaN : index + 1
}

export function hasFixedSection(source) {
  return extractTitles(source).some((item) => item.kind === 'plain' && item.title.startsWith('[fixed]'))
}

export function checkDefects({ root, index, milestone }) {
  const errors = []
  const ledgerFile = path.join(root, ...LEDGER)

  if (!fs.existsSync(ledgerFile)) {
    if (milestone) errors.push({ id: 'defects.file_missing', detail: 'test/characterization/defects.json' })
    return { errors, absent: true }
  }

  let ledger = null
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'))
  } catch {
    errors.push({ id: 'defects.schema', detail: 'defect ledger is not valid JSON' })
    return { errors, absent: false }
  }

  const list = ledger && Array.isArray(ledger.defects) ? ledger.defects : null
  if (!list) {
    errors.push({ id: 'defects.schema', detail: 'defects must be an array' })
    return { errors, absent: false }
  }

  const knownAcs = new Set()
  for (const entry of index?.acs ?? []) {
    if (entry && typeof entry.ac === 'string') knownAcs.add(entry.ac)
  }

  const seen = new Set()
  const valid = []
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push({ id: 'defects.schema', detail: 'every defect must be an object' })
      continue
    }
    const { id, owner_task: ownerTask, owner_milestone: ownerMilestone, ac } = item
    const problems = []
    if (typeof id !== 'string' || id === '') problems.push('id')
    if (typeof ownerTask !== 'string' || !/^T-\d{3}$/.test(ownerTask)) problems.push('owner_task')
    if (!MILESTONES.includes(ownerMilestone)) problems.push('owner_milestone')
    if (typeof ac !== 'string' || !knownAcs.has(ac)) problems.push('ac')

    if (problems.length > 0) {
      errors.push({
        id: 'defects.schema',
        detail: `${typeof id === 'string' && id !== '' ? id : '-'} has missing or invalid ${problems.join(',')}`,
      })
      continue
    }
    if (seen.has(id)) {
      errors.push({ id: 'defects.schema', detail: `duplicate defect id ${id}` })
      continue
    }
    seen.add(id)
    valid.push({ id, ownerTask, ownerMilestone, ac })
  }

  if (milestone === 'M5') {
    const actual = [...seen].sort()
    const expected = [...EXPECTED_IDS].sort()
    if (actual.length !== expected.length || actual.some((id, i) => id !== expected[i])) {
      errors.push({ id: 'defects.set_mismatch', detail: `ledger ids ${actual.join(',')} != ${expected.join(',')}` })
    }
  }

  let required = []
  if (milestone) {
    const limit = milestoneRank(milestone)
    required = valid.filter((item) => milestoneRank(item.ownerMilestone) <= limit)
  } else {
    const merged = mergeShards({ root, index })
    required = valid.filter((item) => merged.acs[item.ac] === 'covered')
  }

  for (const item of required) {
    const file = path.join(root, ...DEFECTS_DIR, `${item.id}.test.mjs`)
    let source = null
    try {
      source = fs.readFileSync(file, 'utf8')
    } catch {
      source = null
    }
    if (source === null || !hasFixedSection(source)) {
      errors.push({ id: 'defects.missing_fixed', detail: `${item.id} has no [fixed] section` })
    }
  }

  return { errors, absent: false }
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
        `unknown argument: ${flag}\nusage: node scripts/check-defects.mjs [--milestone Mx] [--root <dir>] [--index <file>]\n`
      )
      process.exitCode = 2
      return
    }
  }

  const indexFile = indexPath ?? path.join(root, 'contracts', 'spec', 'ac-index.json')
  let index = { acs: [] }
  try {
    index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
  } catch {
    index = { acs: [] }
  }

  const { errors, absent } = checkDefects({ root, index, milestone })

  if (absent && !milestone) {
    process.stdout.write('check-defects: defects.json absent, nothing to check\n')
    process.exitCode = 0
    return
  }

  if (errors.length === 0) {
    process.stdout.write('check-defects: ok\n')
    process.exitCode = 0
    return
  }
  for (const error of errors) process.stdout.write(`FAIL ${error.id} ${error.detail}\n`)
  process.stdout.write(`check-defects: FAILED (${errors.length} errors)\n`)
  process.exitCode = 1
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main()
