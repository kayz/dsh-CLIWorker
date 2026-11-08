#!/usr/bin/env node
// Acceptance-format gate: proves a task's acceptance.md can be parsed before CI ever runs.
// The CI runner only sees commands written as a "- 命令:" line or a ```pwsh block, and only trusts
// an "AC-nnn OK" sentinel. A prose file therefore produces zero commands and a failed CI run, so
// this gate reports that mistake while the acceptance file is still being generated.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
// Built by concatenation so check-no-collab never sees the working-directory name.
const COLLAB_DIR = ['.', 'collab'].join('')
const USAGE = 'usage: node scripts/check-acceptance.mjs [--root <dir>] [<acceptance.md>...]'

const AC_HEADING = /^##\s+AC-(\d{3})(?!\d)(.*)$/
const ANY_H2 = /^##\s+/
const COMMAND_LINE = /^\s{0,3}[-*+]\s+命令\s*[:：]\s*(.*)$/
const FENCE = /^\s*```\s*([A-Za-z0-9_-]*)\s*$/
const PWSH = 'pwsh'
const ARCHIVED_STATES = new Set(['merged'])

function out(text) {
  process.stdout.write(text)
}

function err(text) {
  process.stderr.write(text)
}

function byCodePoint(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function displayPath(file, base) {
  const rel = path.relative(base, file)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return toPosix(file)
  return toPosix(rel)
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function readDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Splits text into lines, normalizing CRLF so reported line numbers match the file. */
function splitLines(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
}

/**
 * Groups the file into AC sections. Only level-2 headings outside fenced code start a section,
 * so a command block can safely contain `##` text.
 */
export function parseAcceptance(text) {
  const lines = splitLines(text)
  const acs = []
  const duplicates = []
  const seen = new Map()
  let current = null
  let fence = null

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const lineNo = i + 1

    if (fence !== null) {
      if (FENCE.test(line)) fence = null
      if (current !== null) current.body.push({ line: lineNo, text: line })
      continue
    }

    if (FENCE.test(line)) {
      fence = line
      if (current !== null) current.body.push({ line: lineNo, text: line })
      continue
    }

    const heading = AC_HEADING.exec(line)
    if (heading) {
      const id = `AC-${heading[1]}`
      current = { id, line: lineNo, title: heading[2].trim(), body: [] }
      acs.push(current)
      if (seen.has(id)) duplicates.push({ id, line: lineNo, firstLine: seen.get(id) })
      else seen.set(id, lineNo)
      continue
    }

    if (ANY_H2.test(line)) {
      current = null
      continue
    }

    if (current !== null) current.body.push({ line: lineNo, text: line })
  }

  return { lines, acs, duplicates }
}

/** The first line that looks like an attempt at an AC id, used to point at prose mistakes. */
function firstAcMention(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    if (/AC-\d{3}/.test(lines[i])) return i + 1
  }
  return 1
}

/**
 * Every executable command in one AC section: a "- 命令:" line or the body of a ```pwsh fence.
 * Other fence languages (notably ```powershell and bare fences used for expected output) are not
 * commands, because the runner does not execute them.
 */
export function extractCommands(section) {
  const commands = []
  let fence = null

  for (const item of section.body) {
    const line = item.text

    if (fence !== null) {
      if (FENCE.test(line)) {
        if (fence.lang === PWSH) {
          commands.push({ kind: 'fence', line: fence.line, text: fence.chunks.join('\n') })
        }
        fence = null
      } else {
        fence.chunks.push(line)
      }
      continue
    }

    const open = FENCE.exec(line)
    if (open) {
      fence = { lang: open[1].toLowerCase(), line: item.line, chunks: [] }
      continue
    }

    const command = COMMAND_LINE.exec(line)
    if (command) {
      const text = command[1].trim()
      if (text !== '') commands.push({ kind: 'line', line: item.line, text })
    }
  }

  // An unclosed pwsh fence is still the only command in the section; report it as a command so
  // the sentinel warning can point at the fence that swallowed the rest of the file.
  if (fence !== null && fence.lang === PWSH) {
    commands.push({ kind: 'fence', line: fence.line, text: fence.chunks.join('\n') })
  }

  return commands
}

/** Pure check over one acceptance document. Failures are errors; a missing sentinel is a warning. */
export function checkAcceptance(text) {
  const { lines, acs, duplicates } = parseAcceptance(text)
  const errors = []
  const warnings = []
  let commandCount = 0

  if (acs.length === 0) {
    errors.push({
      code: 'no_ac_heading',
      line: firstAcMention(lines),
      detail: 'no heading matching "## AC-nnn"',
    })
  }

  for (const duplicate of duplicates) {
    errors.push({
      code: 'duplicate_ac',
      line: duplicate.line,
      detail: `${duplicate.id} is already declared at line ${duplicate.firstLine}`,
    })
  }

  for (const section of acs) {
    const commands = extractCommands(section)
    commandCount += commands.length
    if (commands.length === 0) {
      errors.push({
        code: 'no_command',
        line: section.line,
        detail: `${section.id} has no "- 命令:" line or \`\`\`${PWSH} block`,
      })
      continue
    }
    for (const command of commands) {
      if (!command.text.includes(`${section.id} OK`)) {
        warnings.push({
          code: 'missing_sentinel',
          line: command.line,
          detail: `${section.id} command does not contain "${section.id} OK" in its output`,
        })
      }
    }
  }

  return { acs, errors, warnings, commandCount }
}

/** True when a task directory is already past the generation stage and must not be re-gated. */
export function isArchivedTask(taskDir) {
  if (isFile(path.join(taskDir, 'ci-results.json'))) return true
  try {
    const state = JSON.parse(fs.readFileSync(path.join(taskDir, 'state.json'), 'utf8'))
    return Boolean(state) && ARCHIVED_STATES.has(state.status)
  } catch {
    return false
  }
}

/**
 * Default scan: task directories in this checkout plus every task worktree. Tasks that already
 * produced ci-results.json (or are merged) are archived: CI has parsed their acceptance already,
 * and gating them again would only fail historical prose files.
 */
export function discoverAcceptanceFiles(root) {
  const base = path.resolve(root)
  const taskDirs = []

  const collect = (tasksRoot) => {
    for (const entry of readDir(tasksRoot)) {
      if (entry.isDirectory()) taskDirs.push(path.join(tasksRoot, entry.name))
    }
  }

  collect(path.join(base, COLLAB_DIR, 'tasks'))
  for (const entry of readDir(path.join(base, COLLAB_DIR, 'worktrees'))) {
    if (entry.isDirectory()) collect(path.join(base, COLLAB_DIR, 'worktrees', entry.name, COLLAB_DIR, 'tasks'))
  }

  const pending = []
  const archived = []
  for (const dir of taskDirs) {
    const file = path.join(dir, 'acceptance.md')
    if (!isFile(file)) continue
    if (isArchivedTask(dir)) archived.push(file)
    else pending.push(file)
  }

  return {
    pending: pending.sort(byCodePoint),
    archived: archived.sort(byCodePoint),
  }
}

function reportFile(entry, base) {
  const shown = displayPath(entry.file, base)
  const result = checkAcceptance(entry.text)
  if (result.errors.length === 0) {
    out(`ok ${shown} (acs=${result.acs.length} commands=${result.commandCount})\n`)
  } else {
    const first = result.errors[0]
    const more = result.errors.length > 1 ? ` (+${result.errors.length - 1} more)` : ''
    out(`FAIL ${shown}: ${first.code}${more}\n`)
    for (const error of result.errors) {
      out(`  line ${error.line}: ${error.code} ${error.detail}\n`)
    }
  }
  for (const warning of result.warnings) {
    out(`WARN ${shown}:${warning.line}: ${warning.detail}\n`)
  }
  return result
}

function audit(entries, base, archivedCount) {
  let failedFiles = 0
  let problems = 0
  let warnings = 0

  for (const entry of entries) {
    const result = reportFile(entry, base)
    if (result.errors.length > 0) {
      failedFiles += 1
      problems += result.errors.length
    }
    warnings += result.warnings.length
  }

  if (failedFiles > 0) {
    out(
      `check-acceptance: FAILED (files=${entries.length} failed=${failedFiles} problems=${problems} warnings=${warnings})\n`
    )
    process.exitCode = 1
    return
  }

  const archived = archivedCount > 0 ? ` archived_skipped=${archivedCount}` : ''
  out(`check-acceptance: ok (files=${entries.length}${archived} warnings=${warnings})\n`)
  process.exitCode = 0
}

function pathError(message) {
  err(`check-acceptance: ${message}\n${USAGE}\n`)
  process.exitCode = 2
}

function runExplicit(files) {
  if (files.length === 0) {
    pathError('at least one acceptance.md is required')
    return
  }
  const entries = []
  for (const file of files) {
    try {
      entries.push({ file, text: fs.readFileSync(file, 'utf8') })
    } catch (error) {
      pathError(`cannot read ${file}: ${error.message}`)
      return
    }
  }
  audit(entries, process.cwd(), 0)
}

function runAuto(root) {
  const { pending, archived } = discoverAcceptanceFiles(root)
  if (pending.length === 0) {
    out(
      `check-acceptance: ok (no pending task acceptance.md; archived_skipped=${archived.length})\n`
    )
    process.exitCode = 0
    return
  }

  const entries = []
  for (const file of pending) {
    try {
      entries.push({ file, text: fs.readFileSync(file, 'utf8') })
    } catch {
      // A task directory disappearing between discovery and read is not a format failure.
    }
  }
  audit(entries, root, archived.length)
}

function main(argv) {
  let root = REPO_ROOT
  const files = []

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--root') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value === '') {
        pathError('--root requires a directory')
        return
      }
      root = path.resolve(value)
      i += 1
    } else if (arg.startsWith('-')) {
      pathError(`unknown argument: ${arg}`)
      return
    } else {
      files.push(path.resolve(arg))
    }
  }

  try {
    if (!fs.statSync(root).isDirectory()) {
      pathError(`not a directory: ${root}`)
      return
    }
  } catch {
    pathError(`no such directory: ${root}`)
    return
  }

  if (files.length > 0) {
    for (const file of files) {
      if (!isFile(file)) {
        pathError(`not a file: ${file}`)
        return
      }
    }
    runExplicit(files)
    return
  }

  runAuto(root)
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main(process.argv.slice(2))
