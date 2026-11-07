#!/usr/bin/env node
// Defect ledger check: every defect that must already be fixed needs a plain [fixed] test.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
const CANARY_DIR = ['test', 'characterization', 'canary']
const COPY_DIR = ['test', 'fixtures', 'characterization', 'v0.1']

const RUN_TIMEOUT_MS = 60_000
const REPRO_OPEN_RE = /^test\(['"`]\[repro\]/
const TAP_REPRO_OK_RE = /^\s*ok \d+ - \[repro\]/m
const TAP_REPRO_NOT_OK_RE = /^\s*not ok \d+ - \[repro\]/m
const RELATIVE_IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.[^'"]*)\2/g

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

function toPosix(value) {
  return value.split(path.sep).join('/')
}

/** Blocks are delimited by a column-0 `test('[repro] ...', ... => {` line and the next column-0 `})`. */
export function extractReproSection(source) {
  const text = String(source ?? '').replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const blocks = []
  const errors = []

  for (let i = 0; i < lines.length; i += 1) {
    if (!REPRO_OPEN_RE.test(lines[i])) continue
    if (!/\{\s*$/.test(lines[i])) {
      errors.push(`repro block at line ${i + 1} does not end with {`)
      continue
    }
    let end = -1
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j] === '})') {
        end = j
        break
      }
    }
    if (end < 0) {
      errors.push(`repro block at line ${i + 1} has no closing })`)
      continue
    }
    blocks.push(lines.slice(i, end + 1).join('\n'))
    i = end
  }

  return { blocks, errors }
}

export function reproSha256(source) {
  const { blocks, errors } = extractReproSection(source)
  if (errors.length > 0 || blocks.length === 0) return null
  return crypto.createHash('sha256').update(blocks.join('\n'), 'utf8').digest('hex')
}

function reproError(id, defectId, message) {
  return { id, detail: `${defectId} ${message}` }
}

function walkRelative(dir, prefix, found) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) walkRelative(path.join(dir, entry.name), rel, found)
    else if (entry.isFile()) found.push(rel)
  }
}

function copyTree(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

/** Overlay paths are relative to the v0.1 copy root and must stay inside it. */
function safeOverlayPath(rel) {
  if (rel.includes('\\')) return null
  if (/^[A-Za-z]:/.test(rel) || path.posix.isAbsolute(rel)) return null
  if (rel.split('/').includes('..')) return null
  const normalized = path.posix.normalize(rel)
  if (normalized === '.' || normalized === '' || normalized.startsWith('../')) return null
  return normalized
}

function readCanary({ root, id }) {
  const dir = path.join(root, ...CANARY_DIR, id)
  let data = null
  try {
    data = JSON.parse(fs.readFileSync(path.join(dir, 'canary.json'), 'utf8'))
  } catch {
    data = null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'defects.canary_missing', detail: 'canary.json is missing or not a JSON object' }
  }
  if (data.defect !== id) {
    return { error: 'defects.canary_missing', detail: `canary.json declares defect ${String(data.defect)}, expected ${id}` }
  }

  const overlayDir = path.join(dir, 'overlay')
  const overlayFiles = []
  walkRelative(overlayDir, '', overlayFiles)
  const overlays = []
  for (const rel of overlayFiles.sort()) {
    const safe = safeOverlayPath(rel)
    if (safe === null) {
      return { error: 'defects.canary_error', detail: `overlay path escapes the copy: ${rel}` }
    }
    overlays.push({ rel: safe, file: path.join(overlayDir, ...safe.split('/')) })
  }

  const edits = []
  if (data.repro_edits !== undefined) {
    if (!Array.isArray(data.repro_edits)) {
      return { error: 'defects.canary_error', detail: 'repro_edits must be an array' }
    }
    for (const edit of data.repro_edits) {
      if (
        !edit ||
        typeof edit !== 'object' ||
        typeof edit.find !== 'string' ||
        edit.find === '' ||
        typeof edit.replace !== 'string'
      ) {
        return { error: 'defects.canary_error', detail: 'repro_edits entries need find and replace strings' }
      }
      edits.push({ find: edit.find, replace: edit.replace })
    }
  }

  if (overlays.length === 0 && edits.length === 0) {
    return { error: 'defects.canary_missing', detail: 'canary has neither overlay files nor repro_edits' }
  }

  return { overlays, edits }
}

function runRepro({ root, reproFile, source, overlays, edits, nodePath }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-canary-'))
  try {
    const copyRoot = path.join(tmp, 'v0.1')
    copyTree(path.join(root, ...COPY_DIR), copyRoot)
    fs.writeFileSync(path.join(copyRoot, 'package.json'), '{"type":"module"}\n')

    for (const overlay of overlays) {
      const target = path.join(copyRoot, ...overlay.rel.split('/'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(overlay.file, target)
    }

    let text = source
    for (const edit of edits) text = text.split(edit.find).join(edit.replace)

    const baseDir = path.dirname(reproFile)
    text = text.replace(
      RELATIVE_IMPORT_RE,
      (match, lead, quote, spec) => `${lead}${quote}${pathToFileURL(path.resolve(baseDir, spec)).href}${quote}`
    )

    const reproCopy = path.join(tmp, 'repro.test.mjs')
    fs.writeFileSync(reproCopy, text)

    const env = { ...process.env, CLIWORKER_V01_ROOT: copyRoot }
    delete env.NODE_TEST_CONTEXT

    const result = spawnSync(
      nodePath,
      ['--test', '--test-reporter=tap', '--test-name-pattern=\\[repro\\]', reproCopy],
      { cwd: tmp, env, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }
    )

    return {
      status: result.status,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
      error: result.error ?? null,
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

export function checkRepros({ root, defects, nodePath = process.execPath }) {
  const errors = []
  const list = Array.isArray(defects) ? defects : []
  const base = path.resolve(root)

  for (const defect of list) {
    const id = defect && typeof defect.id === 'string' ? defect.id : '-'
    const registeredSha = defect && typeof defect.repro_sha256 === 'string' ? defect.repro_sha256 : ''

    if (!/^[0-9a-f]{64}$/.test(registeredSha)) {
      errors.push(reproError('defects.repro_sha_missing', id, 'repro_sha256 is missing or not 64 lowercase hex characters'))
      continue
    }

    const reproFile = path.join(base, ...DEFECTS_DIR, `${id}.test.mjs`)
    let source = null
    try {
      source = fs.readFileSync(reproFile, 'utf8')
    } catch {
      source = null
    }
    if (source === null) {
      errors.push(reproError('defects.repro_missing', id, `missing ${toPosix(path.relative(base, reproFile))}`))
      continue
    }

    const section = extractReproSection(source)
    if (section.errors.length > 0) {
      errors.push(reproError('defects.repro_format', id, section.errors.join('; ')))
      continue
    }
    if (section.blocks.length === 0) {
      errors.push(reproError('defects.repro_missing', id, 'no [repro] block'))
      continue
    }

    const actualSha = crypto.createHash('sha256').update(section.blocks.join('\n'), 'utf8').digest('hex')
    if (actualSha !== registeredSha) {
      errors.push(reproError('defects.repro_changed', id, `sha256 ${actualSha} does not match the registered value`))
      continue
    }

    const canary = readCanary({ root: base, id })
    if (canary.error) {
      errors.push(reproError(canary.error, id, canary.detail))
      continue
    }

    let editProblem = null
    for (const edit of canary.edits) {
      const occurrences = source.split(edit.find).length - 1
      if (occurrences !== 1) {
        editProblem = `repro_edits find "${edit.find}" occurs ${occurrences} times instead of once`
        break
      }
    }
    if (editProblem !== null) {
      errors.push(reproError('defects.canary_error', id, editProblem))
      continue
    }

    const baseline = runRepro({
      root: base,
      reproFile,
      source,
      overlays: [],
      edits: [],
      nodePath,
    })
    const baselineOk =
      baseline.status === 0 && TAP_REPRO_OK_RE.test(baseline.output) && !TAP_REPRO_NOT_OK_RE.test(baseline.output)
    if (!baselineOk) {
      const reason = baseline.error ? String(baseline.error.message ?? baseline.error) : `exit ${baseline.status}`
      errors.push(reproError('defects.repro_baseline_failed', id, `the repro does not pass on the v0.1 copy (${reason})`))
      continue
    }

    const canaryRun = runRepro({
      root: base,
      reproFile,
      source,
      overlays: canary.overlays,
      edits: canary.edits,
      nodePath,
    })
    if (!TAP_REPRO_NOT_OK_RE.test(canaryRun.output)) {
      const reason = canaryRun.error ? String(canaryRun.error.message ?? canaryRun.error) : `exit ${canaryRun.status}`
      errors.push(reproError('defects.canary_survived', id, `the repro still passes on the fixed variant (${reason})`))
    }
  }

  return { errors }
}

function readLedger(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, ...LEDGER), 'utf8'))
  } catch {
    return null
  }
}

function main() {
  const args = process.argv.slice(2)
  let root = REPO_ROOT
  let indexPath = null
  let milestone = null
  let strict = false
  let rootGiven = false

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
      rootGiven = true
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
    } else if (flag === '--strict') {
      strict = true
    } else {
      process.stderr.write(
        `unknown argument: ${flag}\nusage: node scripts/check-defects.mjs [--milestone Mx] [--root <dir>] [--index <file>] [--strict]\n`
      )
      process.exitCode = 2
      return
    }
  }

  // Checking the real repo (no --root) is always strict. Fixture roots stay lenient unless asked.
  const strictMode = strict || !rootGiven

  const indexFile = indexPath ?? path.join(root, 'contracts', 'spec', 'ac-index.json')
  let index = { acs: [] }
  try {
    index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
  } catch {
    index = { acs: [] }
  }

  const checked = checkDefects({ root, index, milestone })
  const absent = checked.absent
  const errors = [...checked.errors]

  // Strict mode must never skip silently: a missing ledger is a failure, not "nothing to check".
  if (strictMode && absent && !errors.some((error) => error.id === 'defects.file_missing')) {
    errors.push({ id: 'defects.file_missing', detail: 'test/characterization/defects.json' })
  }

  if (strictMode && !absent) {
    const ledger = readLedger(root)
    const list = ledger && Array.isArray(ledger.defects) ? ledger.defects : null
    if (list) {
      if (!errors.some((error) => error.id === 'defects.set_mismatch')) {
        const actual = list.map((item) => (item && typeof item.id === 'string' ? item.id : '')).sort()
        const expected = [...EXPECTED_IDS].sort()
        if (actual.length !== expected.length || actual.some((id, i) => id !== expected[i])) {
          errors.push({ id: 'defects.set_mismatch', detail: `ledger ids ${actual.join(',')} != ${expected.join(',')}` })
        }
      }
      errors.push(...checkRepros({ root, defects: list, nodePath: process.execPath }).errors)
    }
  }

  if (absent && errors.length === 0 && !milestone) {
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
