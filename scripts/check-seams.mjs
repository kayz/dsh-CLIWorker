#!/usr/bin/env node
// Seam check: the injectable edges (process spawn, file system, wall clock, timers) may only be
// touched inside the modules that own them. Everything else must go through ctx.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const USAGE = 'usage: node scripts/check-seams.mjs [--root <dir>] [--json]'
const SOURCE_EXT = /\.(mjs|js|cjs)$/

const ALLOWED = {
  'seams.child_process': ['lib/exec.mjs'],
  'seams.fs': ['lib/context.mjs', 'lib/store.mjs', 'lib/fsx.mjs'],
  'seams.date_now': ['lib/context.mjs'],
  'seams.new_date': ['lib/context.mjs'],
  'seams.set_timeout': ['lib/context.mjs'],
  'seams.set_interval': ['lib/context.mjs'],
  'seams.set_immediate': ['lib/context.mjs'],
  'seams.node_timers': ['lib/context.mjs'],
  'seams.wall_clock': ['lib/context.mjs'],
  'seams.process_exit': [],
}

const SPECIFIER_RULES = new Map([
  ['node:child_process', 'seams.child_process'],
  ['child_process', 'seams.child_process'],
  ['node:fs', 'seams.fs'],
  ['fs', 'seams.fs'],
  ['node:fs/promises', 'seams.fs'],
  ['fs/promises', 'seams.fs'],
  ['node:timers', 'seams.node_timers'],
  ['timers', 'seams.node_timers'],
  ['node:timers/promises', 'seams.node_timers'],
  ['timers/promises', 'seams.node_timers'],
])

const TIMER_RULE = new Map([
  ['setTimeout', 'seams.set_timeout'],
  ['setInterval', 'seams.set_interval'],
  ['setImmediate', 'seams.set_immediate'],
])

function blankLineEnding(ch) {
  return ch === '\n' || ch === '\r'
}

/**
 * Produces two same-length views of the source: `code` has comments blanked (string literals
 * intact), `bare` has comments and string/template contents blanked. Blanking keeps newlines so
 * line numbers stay exact.
 */
function maskSource(source) {
  const text = String(source ?? '')
  const size = text.length
  const code = text.split('')
  const bare = text.split('')
  const stringRanges = []

  const blankAll = (index) => {
    code[index] = ' '
    if (!blankLineEnding(bare[index])) bare[index] = ' '
  }

  let i = 0
  while (i < size) {
    const ch = text[i]
    const next = text[i + 1]

    if (ch === '/' && next === '/') {
      while (i < size && text[i] !== '\n') { blankAll(i); i += 1 }
      continue
    }
    if (ch === '/' && next === '*') {
      blankAll(i)
      blankAll(i + 1)
      i += 2
      while (i < size && !(text[i] === '*' && text[i + 1] === '/')) { blankAll(i); i += 1 }
      if (i < size) { blankAll(i); blankAll(i + 1); i += 2 }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      const start = i
      i += 1
      while (i < size) {
        if (text[i] === '\\') {
          if (!blankLineEnding(bare[i])) bare[i] = ' '
          if (i + 1 < size && !blankLineEnding(bare[i + 1])) bare[i + 1] = ' '
          i += 2
          continue
        }
        if (text[i] === quote) { i += 1; break }
        if (text[i] === '\n' && quote !== '`') { i += 1; break }
        if (!blankLineEnding(bare[i])) bare[i] = ' '
        i += 1
      }
      stringRanges.push([start, i])
      continue
    }
    i += 1
  }

  return { code: code.join(''), bare: bare.join(''), stringRanges }
}

function insideRanges(ranges, index) {
  for (const [start, end] of ranges) {
    if (index >= start && index < end) return true
  }
  return false
}

function lineAt(source, index) {
  let line = 1
  for (let i = 0; i < index && i < source.length; i += 1) if (source[i] === '\n') line += 1
  return line
}

function collectImportSpecifiers(masked) {
  const found = []
  const patterns = [
    /\bfrom\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g,
    /\brequire\s*\(\s*(['"])([^'"\n]+)\1/g,
    /(?:^|[\s;])import\s*(['"])([^'"\n]+)\2/g,
  ]
  for (const pattern of patterns) {
    for (const match of masked.code.matchAll(pattern)) {
      if (insideRanges(masked.stringRanges, match.index)) continue
      found.push({ index: match.index, specifier: match[2] })
    }
  }
  return found
}

function newDateHasNoArgument(bare, index, length) {
  let i = index + length
  while (i < bare.length && /\s/.test(bare[i])) i += 1
  if (bare[i] !== '(') return true
  i += 1
  while (i < bare.length && /\s/.test(bare[i])) i += 1
  return bare[i] === ')'
}

function collectViolations(relPath, source) {
  const masked = maskSource(source)
  const allowed = (rule) => (ALLOWED[rule] || []).includes(relPath)
  const found = []

  const push = (rule, index) => {
    if (allowed(rule)) return
    found.push({ rule, file: relPath, line: lineAt(source, index) })
  }

  for (const item of collectImportSpecifiers(masked)) {
    const rule = SPECIFIER_RULES.get(item.specifier)
    if (rule) push(rule, item.index)
  }

  for (const match of masked.bare.matchAll(/Date\s*\.\s*now\b/g)) push('seams.date_now', match.index)

  for (const match of masked.bare.matchAll(/\bnew\s+Date\b/g)) {
    if (newDateHasNoArgument(masked.bare, match.index, match[0].length)) push('seams.new_date', match.index)
  }

  for (const match of masked.bare.matchAll(/(^|[^\w$.])(setTimeout|setInterval|setImmediate)\b/g)) {
    push(TIMER_RULE.get(match[2]), match.index + match[1].length)
  }
  for (const match of masked.bare.matchAll(/(^|[^\w$.])(?:globalThis|global|window)\s*\.\s*(setTimeout|setInterval|setImmediate)\b/g)) {
    push(TIMER_RULE.get(match[2]), match.index + match[1].length)
  }

  for (const match of masked.bare.matchAll(/performance\s*\.\s*now\b|\bprocess\s*\.\s*hrtime\b|\bhrtime\s*\.\s*bigint\b/g)) {
    push('seams.wall_clock', match.index)
  }

  for (const match of masked.bare.matchAll(/\bprocess\s*\.\s*exit\b/g)) push('seams.process_exit', match.index)

  return found
}

function walk(dir, prefix, found) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, rel, found)
    else if (entry.isFile() && SOURCE_EXT.test(entry.name)) found.push({ rel, full })
  }
}

export function scanRoot({ root = REPO_ROOT } = {}) {
  const files = []
  walk(path.join(path.resolve(root), 'lib'), 'lib', files)

  const violations = []
  for (const file of files) {
    let source = ''
    try {
      source = fs.readFileSync(file.full, 'utf8')
    } catch {
      continue
    }
    violations.push(...collectViolations(file.rel, source))
  }

  violations.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1
    if (a.line !== b.line) return a.line - b.line
    if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1
    return 0
  })

  return { files: files.length, violations }
}

function main() {
  const args = process.argv.slice(2)
  let root = REPO_ROOT
  let json = false

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
    } else if (flag === '--json') {
      json = true
    } else {
      process.stderr.write(`unknown argument: ${flag}\n${USAGE}\n`)
      process.exitCode = 2
      return
    }
  }

  const { files, violations } = scanRoot({ root })

  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: violations.length === 0, files, violations }, null, 2)}\n`)
    process.exitCode = violations.length === 0 ? 0 : 1
    return
  }

  for (const item of violations) process.stdout.write(`FAIL ${item.rule} ${item.file}:${item.line}\n`)
  process.stdout.write(
    violations.length === 0
      ? `check-seams: ok (files=${files})\n`
      : `check-seams: FAILED (${violations.length} violations)\n`
  )
  process.exitCode = violations.length === 0 ? 0 : 1
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main()
