#!/usr/bin/env node
// Traceability: validates contracts/spec/ac-index.json and merges test/traceability/*.json.
// Exported helpers are reused by milestone-gate.mjs and check-defects.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')

const SCHEMA = 'cliworker.ac-index/v1'
const INDEX_KEYS = ['ac', 'owner', 'milestone', 'levels', 'baseline']
const LEVELS = ['unit', 'integration', 'contract', 'e2e', 'smoke']
const BASELINES = ['linux', 'win32', 'darwin', 'real-smoke']
const MILESTONES = ['M1', 'M2', 'M3', 'M4', 'M5']
const NON_SMOKE_LEVELS = ['unit', 'contract', 'integration', 'e2e']

const TITLE_RE = /(?<![\w.])(test|it|describe|platformTest)(\.(skip|todo|only))?\s*\(\s*(['"`])((?:\\.|(?!\4).)*)\4/g

export function extractTitles(source) {
  const titles = []
  const text = String(source ?? '')
  for (const match of text.matchAll(TITLE_RE)) {
    titles.push({ kind: match[3] ? match[3] : 'plain', title: match[5] })
  }
  return titles
}

function expectedAcs() {
  const list = []
  for (let i = 1; i <= 74; i += 1) list.push(`AC-${String(i).padStart(3, '0')}`)
  return list
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function validateIndex(index) {
  const errors = []
  const push = (id, ac, detail) => errors.push({ id, ac, detail })

  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    push('index.schema', undefined, 'index must be a JSON object')
    return errors
  }
  if (index.schema !== SCHEMA) push('index.schema', undefined, `schema must be ${SCHEMA}`)

  if (!Array.isArray(index.acs)) {
    push('index.schema', undefined, 'acs must be an array')
    return errors
  }

  for (const entry of index.acs) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      push('index.schema', undefined, 'every entry must be a JSON object')
      continue
    }
    const keys = Object.keys(entry)
    const missing = INDEX_KEYS.filter((key) => !keys.includes(key))
    const extra = keys.filter((key) => !INDEX_KEYS.includes(key))
    if (missing.length > 0 || extra.length > 0) {
      push(
        'index.schema',
        typeof entry.ac === 'string' ? entry.ac : undefined,
        `entry keys must be exactly ${INDEX_KEYS.join(',')} (missing=${missing.join('|') || '-'} extra=${extra.join('|') || '-'})`
      )
    }

    if (typeof entry.owner !== 'string' || !/^T-\d{3}$/.test(entry.owner)) {
      push('index.owner', entry.ac, 'owner must match ^T-\\d{3}$')
    }
    if (!MILESTONES.includes(entry.milestone)) {
      push('index.milestone', entry.ac, `milestone must be one of ${MILESTONES.join(',')}`)
    }

    if (!isStringArray(entry.levels) || entry.levels.length === 0) {
      push('index.levels', entry.ac, 'levels must be a non-empty array of strings')
    } else {
      const unknown = entry.levels.filter((level) => !LEVELS.includes(level))
      const duplicates = entry.levels.filter((level, i) => entry.levels.indexOf(level) !== i)
      if (unknown.length > 0) push('index.levels', entry.ac, `unknown level(s): ${unknown.join(',')}`)
      if (duplicates.length > 0) push('index.levels', entry.ac, `duplicate level(s): ${duplicates.join(',')}`)
    }

    if (!isStringArray(entry.baseline) || entry.baseline.length === 0) {
      push('index.baseline', entry.ac, 'baseline must be a non-empty array of strings')
    } else {
      const unknown = entry.baseline.filter((base) => !BASELINES.includes(base))
      const duplicates = entry.baseline.filter((base, i) => entry.baseline.indexOf(base) !== i)
      if (unknown.length > 0) push('index.baseline', entry.ac, `unknown baseline(s): ${unknown.join(',')}`)
      if (duplicates.length > 0) push('index.baseline', entry.ac, `duplicate baseline(s): ${duplicates.join(',')}`)
    }

    if (isStringArray(entry.levels) && isStringArray(entry.baseline)) {
      const hasCodeLevel = entry.levels.some((level) => NON_SMOKE_LEVELS.includes(level))
      const hasSmoke = entry.levels.includes('smoke')
      const hasRealSmoke = entry.baseline.includes('real-smoke')
      const hasNativeOnly = entry.baseline.includes('win32') || entry.baseline.includes('darwin')
      if (hasCodeLevel && hasRealSmoke) {
        push('index.baseline_incompatible', entry.ac, 'real-smoke baseline cannot back code levels')
      }
      if (hasSmoke && hasNativeOnly) {
        push('index.baseline_incompatible', entry.ac, 'smoke levels only allow linux or real-smoke baselines')
      }
    }
  }

  const expected = expectedAcs()
  const got = index.acs.map((entry) => (entry && typeof entry === 'object' ? entry.ac : undefined))
  const extended = [...expected, 'AC-079', 'AC-080', 'AC-081', 'AC-082', 'AC-083', 'AC-084', 'AC-085', 'AC-086', 'AC-087', 'AC-088', 'AC-089']
  const inOrder = [expected, extended].some((list) => got.length === list.length && got.every((ac, i) => ac === list[i]))
  if (!inOrder) {
    const seen = new Set()
    const duplicates = new Set()
    for (const ac of got) {
      if (seen.has(ac)) duplicates.add(ac)
      seen.add(ac)
    }
    const parts = [`expected exactly ${expected[0]}..${expected[expected.length - 1]} in order`]
    parts.push(`got ${got.length} entries`)
    if (duplicates.size > 0) parts.push(`duplicates: ${[...duplicates].join(',')}`)
    push('index.count', undefined, parts.join(', '))
  }

  return errors
}

export function mergeShards({ root, index }) {
  const errors = []
  const shardDir = path.join(root, 'test', 'traceability')
  const owners = new Map()
  const indexAcs = []
  for (const entry of index?.acs ?? []) {
    if (!entry || typeof entry !== 'object') continue
    owners.set(entry.ac, entry.owner)
    indexAcs.push(entry.ac)
  }

  let names = []
  try {
    names = fs.readdirSync(shardDir).filter((name) => name.endsWith('.json')).sort()
  } catch {
    names = []
  }

  const declared = new Map()

  for (const name of names) {
    const rel = `test/traceability/${name}`
    let shard
    try {
      shard = JSON.parse(fs.readFileSync(path.join(shardDir, name), 'utf8'))
    } catch {
      errors.push({ id: 'shard.schema', file: rel, detail: 'shard is not valid JSON' })
      continue
    }
    if (!shard || typeof shard !== 'object' || Array.isArray(shard)) {
      errors.push({ id: 'shard.schema', file: rel, detail: 'shard must be a JSON object' })
      continue
    }

    const task = name.replace(/\.json$/, '')
    if (typeof shard.task !== 'string' || shard.task !== task) {
      errors.push({ id: 'shard.schema', file: rel, detail: `task must be "${task}"` })
    }
    if (Object.prototype.hasOwnProperty.call(shard, 'baseline')) {
      errors.push({ id: 'shard.baseline_forbidden', file: rel, detail: 'shard must not declare baseline' })
    }
    if (!Array.isArray(shard.entries)) {
      errors.push({ id: 'shard.schema', file: rel, detail: 'entries must be an array' })
      continue
    }

    for (const entry of shard.entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push({ id: 'shard.schema', file: rel, detail: 'every entry must be a JSON object' })
        continue
      }
      if (Object.prototype.hasOwnProperty.call(entry, 'baseline')) {
        errors.push({
          id: 'shard.baseline_forbidden',
          ac: typeof entry.ac === 'string' ? entry.ac : undefined,
          file: rel,
          detail: 'entry must not declare baseline',
        })
      }

      const ac = entry.ac
      const status = entry.status
      const files = entry.files
      if (
        typeof ac !== 'string' ||
        ac === '' ||
        (status !== 'covered' && status !== 'planned') ||
        !Array.isArray(files)
      ) {
        errors.push({
          id: 'shard.schema',
          ac: typeof ac === 'string' ? ac : undefined,
          file: rel,
          detail: 'entry needs ac, status (covered|planned) and files',
        })
        continue
      }

      if (!owners.has(ac)) {
        errors.push({ id: 'shard.unknown_ac', ac, file: rel, detail: 'AC is not declared in the index' })
        continue
      }

      if (declared.has(ac)) {
        const previous = declared.get(ac)
        errors.push({
          id: 'shard.duplicate',
          ac,
          file: rel,
          detail: previous.shard === rel ? 'duplicate within shard' : `already declared in ${previous.shard}`,
        })
      } else {
        declared.set(ac, { status, shard: rel })
      }

      if (shard.task !== owners.get(ac)) {
        errors.push({
          id: 'shard.not_owner',
          ac,
          file: rel,
          detail: `owner is ${owners.get(ac)}`,
        })
      }

      if (status !== 'covered') continue

      let broken = false
      if (files.length === 0) {
        errors.push({ id: 'shard.missing_file', ac, file: rel, detail: 'covered entry needs at least one file' })
        broken = true
      }
      for (const file of files) {
        const unsafe =
          typeof file !== 'string' ||
          file === '' ||
          path.isAbsolute(file) ||
          file.split('/').includes('..') ||
          file.split('\\').includes('..')
        if (unsafe) {
          errors.push({ id: 'shard.missing_file', ac, file: rel, detail: `unsafe or empty path: ${String(file)}` })
          broken = true
          continue
        }
        if (!fs.existsSync(path.join(root, file))) {
          errors.push({ id: 'shard.missing_file', ac, file: rel, detail: `missing file: ${file}` })
          broken = true
        }
      }
      if (broken) continue

      let tagged = false
      for (const file of files) {
        let source = ''
        try {
          source = fs.readFileSync(path.join(root, file), 'utf8')
        } catch {
          continue
        }
        if (extractTitles(source).some((item) => item.kind === 'plain' && item.title.includes(`[${ac}]`))) {
          tagged = true
          break
        }
      }
      if (!tagged) {
        errors.push({
          id: 'shard.missing_title',
          ac,
          file: rel,
          detail: `no plain test title contains [${ac}]`,
        })
      }
    }
  }

  const acs = {}
  for (const ac of indexAcs) {
    const entry = declared.get(ac)
    acs[ac] = entry ? entry.status : 'planned'
  }

  return { errors, acs }
}

function checkTaskGraph(taskGraphPath, index) {
  const errors = []
  let graph
  try {
    graph = JSON.parse(fs.readFileSync(taskGraphPath, 'utf8'))
  } catch {
    errors.push({ id: 'graph.mismatch', detail: `cannot read task graph: ${taskGraphPath}` })
    return errors
  }

  const owners = new Map()
  const milestones = new Map()
  for (const task of Array.isArray(graph.tasks) ? graph.tasks : []) {
    for (const ac of Array.isArray(task.acceptance) ? task.acceptance : []) {
      owners.set(ac, task.id)
      milestones.set(ac, task.milestone)
    }
  }
  const levels = new Map()
  for (const item of Array.isArray(graph.acceptance) ? graph.acceptance : []) {
    if (item && typeof item.id === 'string') levels.set(item.id, item.levels)
  }

  const sameSet = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    const left = [...a].sort()
    const right = [...b].sort()
    return left.every((value, i) => value === right[i])
  }

  for (const entry of index?.acs ?? []) {
    if (!entry || typeof entry !== 'object') continue
    if (owners.get(entry.ac) !== entry.owner) {
      errors.push({
        id: 'graph.mismatch',
        ac: entry.ac,
        detail: `owner ${entry.owner} != task graph ${owners.get(entry.ac) ?? 'none'}`,
      })
    }
    if (milestones.get(entry.ac) !== entry.milestone) {
      errors.push({
        id: 'graph.mismatch',
        ac: entry.ac,
        detail: `milestone ${entry.milestone} != task graph ${milestones.get(entry.ac) ?? 'none'}`,
      })
    }
    if (levels.has(entry.ac) && !sameSet(levels.get(entry.ac), entry.levels)) {
      errors.push({
        id: 'graph.mismatch',
        ac: entry.ac,
        detail: `levels ${JSON.stringify(entry.levels)} != task graph ${JSON.stringify(levels.get(entry.ac))}`,
      })
    }
  }

  return errors
}

function fail(message) {
  console.error(message)
  process.exitCode = 2
}

function takeValue(args, index, flag) {
  const value = args[index + 1]
  if (typeof value !== 'string' || value === '') {
    fail(`${flag} requires a value`)
    return null
  }
  return value
}

function main() {
  const args = process.argv.slice(2)
  let root = REPO_ROOT
  let indexPath = null
  let taskGraphPath = null
  let json = false

  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i]
    if (flag === '--root') {
      const value = takeValue(args, i, flag)
      if (value === null) return
      root = path.resolve(value)
      i += 1
    } else if (flag === '--index') {
      const value = takeValue(args, i, flag)
      if (value === null) return
      indexPath = path.resolve(value)
      i += 1
    } else if (flag === '--task-graph') {
      const value = takeValue(args, i, flag)
      if (value === null) return
      taskGraphPath = path.resolve(value)
      i += 1
    } else if (flag === '--json') {
      json = true
    } else {
      fail(`unknown argument: ${flag}\nusage: node scripts/check-traceability.mjs [--root <dir>] [--index <file>] [--task-graph <file>] [--json]`)
      return
    }
  }

  const indexFile = indexPath ?? path.join(root, 'contracts', 'spec', 'ac-index.json')
  const errors = []

  let index = null
  try {
    index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
  } catch {
    errors.push({ id: 'index.schema', detail: `cannot read index: ${indexFile}` })
  }

  let acs = {}
  if (index) {
    errors.push(...validateIndex(index))
    const merged = mergeShards({ root, index })
    errors.push(...merged.errors)
    acs = merged.acs
  }
  if (taskGraphPath && index) errors.push(...checkTaskGraph(taskGraphPath, index))

  const entries = Object.keys(acs)
    .sort()
    .map((ac) => ({ ac, status: acs[ac] }))
  const covered = entries.filter((item) => item.status === 'covered').length
  const planned = entries.filter((item) => item.status === 'planned').length

  if (json) {
    const payload = {
      ok: errors.length === 0,
      errors: errors.map((error) => {
        const out = { id: error.id }
        if (error.ac !== undefined) out.ac = error.ac
        if (error.file !== undefined) out.file = error.file
        out.detail = error.detail ?? ''
        return out
      }),
      covered,
      planned,
      acs: entries,
    }
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  } else {
    for (const error of errors) {
      const where = error.ac ?? error.file ?? '-'
      process.stdout.write(`FAIL ${error.id} ${where} ${error.detail ?? ''}`.trimEnd() + '\n')
    }
    if (errors.length > 0) {
      process.stdout.write(`check-traceability: FAILED (${errors.length} errors)\n`)
    } else {
      process.stdout.write(`check-traceability: ok (covered=${covered} planned=${planned})\n`)
    }
  }

  process.exitCode = errors.length > 0 ? 1 : 0
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main()
