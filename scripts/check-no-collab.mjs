#!/usr/bin/env node
// Fails when any repository file refers to the blueprint working directory.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const SCAN_DIRS = ['lib', 'scripts', 'test', 'contracts', 'docs']
const SKIP_NAMES = new Set(['node_modules', '.git'])
const FIXTURE_PREFIX = 'test/fixtures/no-collab/'
const USAGE = 'usage: node scripts/check-no-collab.mjs [--root <dir>]'

// Built by concatenation so this file does not match itself.
const NEEDLE = ['.', 'coll', 'ab'].join('')

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
    if (SKIP_NAMES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, base, out)
    else if (entry.isFile()) out.push(toPosix(path.relative(base, full)))
  }
}

function listFiles(root, skipFixture) {
  const found = []
  if (fs.existsSync(path.join(root, 'package.json'))) found.push('package.json')
  for (const dir of SCAN_DIRS) walk(path.join(root, dir), root, found)
  const unique = [...new Set(found)].sort(byCodePoint)
  if (!skipFixture) return unique
  return unique.filter((rel) => !rel.startsWith(FIXTURE_PREFIX))
}

function main(argv) {
  let root = REPO_ROOT
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--root') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value === '') {
        process.stderr.write(`check-no-collab: --root requires a directory\n${USAGE}\n`)
        process.exitCode = 2
        return
      }
      root = path.resolve(value)
      i += 1
    } else {
      process.stderr.write(`check-no-collab: unknown argument: ${flag}\n${USAGE}\n`)
      process.exitCode = 2
      return
    }
  }

  const files = listFiles(root, true)
  const violations = []

  for (const rel of files) {
    let text
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].toLowerCase().includes(NEEDLE)) violations.push({ rel, line: i + 1 })
    }
  }

  if (violations.length > 0) {
    violations.sort((a, b) => byCodePoint(a.rel, b.rel) || a.line - b.line)
    for (const hit of violations) process.stdout.write(`FAIL no_collab ${hit.rel}:${hit.line}\n`)
    process.stdout.write(`check-no-collab: FAILED (${violations.length} violations)\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write(`check-no-collab: ok (scanned ${files.length} files)\n`)
  process.exitCode = 0
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main(process.argv.slice(2))
