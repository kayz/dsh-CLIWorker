#!/usr/bin/env node
// Two checks in one place: every spec and golden file is registered in the manifest, and every
// path changed against a base ref lives inside the task write scope.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const MANIFEST_REL = 'contracts/golden/manifest.json'
const REGISTERED_DIRS = ['contracts/spec', 'contracts/golden']
const USAGE =
  'usage: node scripts/check-write-scope.mjs [--root <dir>] [--base <git-ref>] [--scope <glob>]... [--scope-from <markdown>]'

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

function listRegisteredDirs(root) {
  const found = []
  for (const rel of REGISTERED_DIRS) walk(path.join(root, rel), root, found)
  return found.filter((rel) => rel !== MANIFEST_REL).sort(byCodePoint)
}

function globToRegExp(glob) {
  let source = '^'
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        source += '.*'
        i += 1
      } else {
        source += '[^/]*'
      }
    } else if ('\\^$.|?+()[]{}'.includes(char)) {
      source += `\\${char}`
    } else {
      source += char
    }
  }
  source += '$'
  return new RegExp(source)
}

function parseFrontMatterScopes(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const lines = text.split(/\r?\n/)
  if (lines[0].trim() !== '---') return null
  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) return null

  const scopes = []
  let inScope = false
  for (let i = 1; i < end; i += 1) {
    const line = lines[i]
    if (/^write_scope:\s*$/.test(line)) {
      inScope = true
      continue
    }
    if (!inScope) continue
    const item = /^\s*-\s+(.+?)\s*$/.exec(line)
    if (item) {
      scopes.push(item[1].replace(/^['"]|['"]$/g, ''))
      continue
    }
    if (line.trim() === '') continue
    inScope = false
  }
  return scopes.length > 0 ? scopes : null
}

function gitLines(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) return null
  return String(result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function main(argv) {
  let root = REPO_ROOT
  let base = null
  const scopes = []
  let scopeFrom = null

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--root') {
      if (typeof value !== 'string' || value === '') {
        process.stderr.write(`check-write-scope: --root requires a directory\n${USAGE}\n`)
        process.exitCode = 2
        return
      }
      root = path.resolve(value)
      i += 1
    } else if (flag === '--base') {
      if (typeof value !== 'string' || value === '') {
        process.stderr.write(`check-write-scope: --base requires a git ref\n${USAGE}\n`)
        process.exitCode = 2
        return
      }
      base = value
      i += 1
    } else if (flag === '--scope') {
      if (typeof value !== 'string' || value === '') {
        process.stderr.write(`check-write-scope: --scope requires a glob\n${USAGE}\n`)
        process.exitCode = 2
        return
      }
      scopes.push(value)
      i += 1
    } else if (flag === '--scope-from') {
      if (typeof value !== 'string' || value === '') {
        process.stderr.write(`check-write-scope: --scope-from requires a file\n${USAGE}\n`)
        process.exitCode = 2
        return
      }
      scopeFrom = path.resolve(value)
      i += 1
    } else {
      process.stderr.write(`check-write-scope: unknown argument: ${flag}\n${USAGE}\n`)
      process.exitCode = 2
      return
    }
  }

  if (scopeFrom !== null) {
    const parsed = parseFrontMatterScopes(scopeFrom)
    if (parsed === null) {
      process.stderr.write(`check-write-scope: no write_scope globs in ${scopeFrom}\n${USAGE}\n`)
      process.exitCode = 2
      return
    }
    scopes.push(...parsed)
  }

  if (scopes.length > 0 && base === null) {
    process.stderr.write(`check-write-scope: --scope and --scope-from require --base\n${USAGE}\n`)
    process.exitCode = 2
    return
  }

  const errors = []
  const actual = listRegisteredDirs(root)
  let manifest = null
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_REL), 'utf8'))
  } catch {
    errors.push('FAIL write_scope.manifest_missing')
  }

  if (manifest !== null) {
    const registered = new Set(
      (Array.isArray(manifest.files) ? manifest.files : []).map((entry) => entry.path)
    )
    for (const rel of actual) {
      if (!registered.has(rel)) errors.push(`FAIL write_scope.unregistered ${rel}`)
    }
  }

  if (scopes.length > 0) {
    const changed = gitLines(root, ['diff', '--name-only', '--no-renames', base])
    const untracked = gitLines(root, ['ls-files', '--others', '--exclude-standard'])
    if (changed === null || untracked === null) {
      process.stderr.write(`check-write-scope: git commands failed under ${root}\n`)
      process.exitCode = 2
      return
    }
    const globs = scopes.map(globToRegExp)
    const paths = [...new Set([...changed, ...untracked].map(toPosix))].sort(byCodePoint)
    for (const rel of paths) {
      if (!globs.some((glob) => glob.test(rel))) errors.push(`FAIL write_scope.outside ${rel}`)
    }
  }

  if (errors.length > 0) {
    for (const line of errors) process.stdout.write(`${line}\n`)
    process.stdout.write(`check-write-scope: FAILED (${errors.length} errors)\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write('check-write-scope: ok\n')
  process.exitCode = 0
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main(process.argv.slice(2))
