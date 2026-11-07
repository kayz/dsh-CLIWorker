#!/usr/bin/env node
// Zero-dependency scanner: reports unused imports and unused top-level functions. The lexer is a
// hand-written masking pass. Comments, string bodies, template text and regex literals are
// blanked in place (newlines survive so line numbers stay exact) while template `${...}`
// expressions stay visible, so a binding used only inside an interpolation still counts.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const USAGE = 'usage: node scripts/check-unused.mjs [--root <dir>] [--json] [path...]'
const SOURCE_EXT = /\.(mjs|js|cjs)$/
const WORD_START = /[A-Za-z_$]/
const WORD_PART = /[\w$]/
// A `/` after one of these tokens starts a regular expression, otherwise it is division.
const REGEX_AFTER_CHARS = '(,=:[!&|?{};+-*%<>~^'
const REGEX_AFTER_WORDS = new Set([
  'return',
  'typeof',
  'case',
  'in',
  'of',
  'delete',
  'void',
  'throw',
  'new',
  'else',
  'do',
])

function isLineEnd(ch) {
  return ch === '\n' || ch === '\r'
}

function beginsRegex(previous) {
  if (!previous) return true
  if (previous.type === 'char') return REGEX_AFTER_CHARS.includes(previous.value)
  return REGEX_AFTER_WORDS.has(previous.value)
}

/**
 * Same-length copy of `source` where comments, string bodies, template text and regex literals
 * are replaced by spaces. Template `${...}` expressions are copied through untouched.
 */
function maskSource(source) {
  const text = String(source ?? '')
  const size = text.length
  const out = text.split('')
  const stack = [{ kind: 'code', expr: false, depth: 0 }]
  let previous = null
  let i = 0

  const hide = (index) => {
    if (!isLineEnd(out[index])) out[index] = ' '
  }

  while (i < size) {
    const frame = stack[stack.length - 1]
    const ch = text[i]

    if (frame.kind === 'template') {
      if (ch === '\\') {
        hide(i)
        if (i + 1 < size) hide(i + 1)
        i += 2
        continue
      }
      if (ch === '`') {
        hide(i)
        stack.pop()
        previous = { type: 'char', value: '`' }
        i += 1
        continue
      }
      if (ch === '$' && text[i + 1] === '{') {
        stack.push({ kind: 'code', expr: true, depth: 0 })
        previous = { type: 'char', value: '{' }
        i += 2
        continue
      }
      hide(i)
      i += 1
      continue
    }

    if (ch === '/' && text[i + 1] === '/') {
      while (i < size && text[i] !== '\n') {
        hide(i)
        i += 1
      }
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      hide(i)
      hide(i + 1)
      i += 2
      while (i < size && !(text[i] === '*' && text[i + 1] === '/')) {
        hide(i)
        i += 1
      }
      if (i < size) {
        hide(i)
        hide(i + 1)
        i += 2
      }
      continue
    }
    if (ch === '/' && beginsRegex(previous)) {
      hide(i)
      i += 1
      let inClass = false
      while (i < size) {
        const inner = text[i]
        if (inner === '\\') {
          hide(i)
          if (i + 1 < size) hide(i + 1)
          i += 2
          continue
        }
        if (inner === '\n') break
        if (inner === '[') inClass = true
        else if (inner === ']') inClass = false
        else if (inner === '/' && !inClass) {
          hide(i)
          i += 1
          break
        }
        hide(i)
        i += 1
      }
      while (i < size && /[a-z]/i.test(text[i])) {
        hide(i)
        i += 1
      }
      previous = { type: 'word', value: 'regex' }
      continue
    }
    if (ch === "'" || ch === '"') {
      const quote = ch
      hide(i)
      i += 1
      while (i < size) {
        const inner = text[i]
        if (inner === '\\') {
          hide(i)
          if (i + 1 < size) hide(i + 1)
          i += 2
          continue
        }
        if (inner === quote) {
          hide(i)
          i += 1
          break
        }
        if (inner === '\n') break
        hide(i)
        i += 1
      }
      previous = { type: 'word', value: 'string' }
      continue
    }
    if (ch === '`') {
      hide(i)
      stack.push({ kind: 'template' })
      i += 1
      continue
    }
    if (frame.expr) {
      if (ch === '{') {
        frame.depth += 1
        previous = { type: 'char', value: '{' }
        i += 1
        continue
      }
      if (ch === '}') {
        if (frame.depth === 0) stack.pop()
        else frame.depth -= 1
        previous = { type: 'char', value: '}' }
        i += 1
        continue
      }
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }
    if (WORD_START.test(ch)) {
      let j = i + 1
      while (j < size && WORD_PART.test(text[j])) j += 1
      previous = { type: 'word', value: text.slice(i, j) }
      i = j
      continue
    }
    if (ch >= '0' && ch <= '9') {
      previous = { type: 'word', value: '0' }
      i += 1
      continue
    }
    previous = { type: 'char', value: ch }
    i += 1
  }

  return out.join('')
}

/** Identifier and punctuation tokens of the masked source, with the brace depth they start at. */
function tokenize(code) {
  const tokens = []
  let depth = 0
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (ch === '{') {
      tokens.push({ type: 'char', value: '{', index: i, depth })
      depth += 1
      i += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      tokens.push({ type: 'char', value: '}', index: i, depth })
      i += 1
      continue
    }
    if (WORD_START.test(ch)) {
      let j = i + 1
      while (j < code.length && WORD_PART.test(code[j])) j += 1
      tokens.push({ type: 'word', value: code.slice(i, j), index: i, depth })
      i = j
      continue
    }
    if (!/\s/.test(ch)) tokens.push({ type: 'char', value: ch, index: i, depth })
    i += 1
  }
  return tokens
}

/** Index of the token closing the pair opened at `start`, or -1. */
function matchPair(tokens, start, open, close) {
  let level = 1
  for (let k = start + 1; k < tokens.length; k += 1) {
    const token = tokens[k]
    if (token.type !== 'char') continue
    if (token.value === open) level += 1
    else if (token.value === close) {
      level -= 1
      if (level === 0) return k
    }
  }
  return -1
}

function collectImports(tokens, text) {
  const bindings = []
  const scope = new Set()

  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k]
    if (token.type !== 'word' || token.value !== 'import' || token.depth !== 0) continue
    const next = tokens[k + 1]
    if (next && next.type === 'char' && (next.value === '(' || next.value === '.')) continue

    let cursor = token.index + 'import'.length
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1
    if (text[cursor] === "'" || text[cursor] === '"') {
      scope.add(k)
      continue
    }

    let fromIndex = -1
    for (let j = k + 1; j < tokens.length; j += 1) {
      const inner = tokens[j]
      if (inner.type === 'word' && inner.value === 'from' && inner.depth === 0) {
        fromIndex = j
        break
      }
      if (inner.type === 'char' && inner.value === ';' && inner.depth === 0) break
      if (inner.type === 'word' && inner.value === 'import' && inner.depth === 0) break
    }
    if (fromIndex < 0) continue
    for (let j = k; j <= fromIndex; j += 1) scope.add(j)

    let j = k + 1
    while (j < fromIndex) {
      const inner = tokens[j]
      if (inner.type !== 'word' || inner.value === 'as') {
        j += 1
        continue
      }
      const after = tokens[j + 1]
      if (after && after.type === 'word' && after.value === 'as') {
        const local = tokens[j + 2]
        if (local && local.type === 'word' && j + 2 < fromIndex) bindings.push(local)
        j += 3
        continue
      }
      bindings.push(inner)
      j += 1
    }
  }

  return { bindings, scope }
}

function collectFunctions(tokens) {
  const found = []
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k]
    if (token.type !== 'word' || token.value !== 'function' || token.depth !== 0) continue

    let before = k - 1
    while (before >= 0 && tokens[before].type === 'word' && (tokens[before].value === 'async' || tokens[before].value === 'default')) {
      before -= 1
    }
    const leading = tokens[before]
    if (leading && leading.type === 'word' && leading.value === 'export') continue
    if (leading && leading.type === 'char' && leading.value === '.') continue

    let nameIndex = k + 1
    if (tokens[nameIndex] && tokens[nameIndex].type === 'char' && tokens[nameIndex].value === '*') nameIndex += 1
    const name = tokens[nameIndex]
    if (!name || name.type !== 'word') continue

    let open = nameIndex + 1
    while (open < tokens.length && !(tokens[open].type === 'char' && tokens[open].value === '(')) open += 1
    if (open >= tokens.length) continue
    const closeParen = matchPair(tokens, open, '(', ')')
    if (closeParen < 0) continue

    let bodyOpen = closeParen + 1
    while (bodyOpen < tokens.length && !(tokens[bodyOpen].type === 'char' && tokens[bodyOpen].value === '{')) bodyOpen += 1
    if (bodyOpen >= tokens.length) continue
    const bodyClose = matchPair(tokens, bodyOpen, '{', '}')
    if (bodyClose < 0) continue

    found.push({ name: name.value, nameIndex, bodyOpen, bodyClose })
  }
  return found
}

function lineAt(source, index) {
  let line = 1
  for (let i = 0; i < index && i < source.length; i += 1) if (source[i] === '\n') line += 1
  return line
}

/**
 * Unused imports and unused top-level functions of one source text, sorted by line then name.
 * Only plain `function` declarations and static `import` declarations are analysed.
 */
export function scanSource(source) {
  const text = String(source ?? '')
  const bare = maskSource(text)
  const tokens = tokenize(bare)

  const occurrences = new Map()
  tokens.forEach((token, index) => {
    if (token.type !== 'word') return
    // `obj.name` and `obj?.name` are property access, but `...name` is a spread of the binding.
    if (text[token.index - 1] === '.' && text[token.index - 2] !== '.') return
    if (!occurrences.has(token.value)) occurrences.set(token.value, [])
    occurrences.get(token.value).push(index)
  })

  const items = []
  const imported = collectImports(tokens, text)
  for (const binding of imported.bindings) {
    const hits = (occurrences.get(binding.value) ?? []).filter((index) => !imported.scope.has(index))
    if (hits.length === 0) items.push({ line: lineAt(bare, binding.index), kind: 'import', name: binding.value })
  }

  for (const fn of collectFunctions(tokens)) {
    const hits = (occurrences.get(fn.name) ?? []).filter(
      (index) => index !== fn.nameIndex && !(index > fn.bodyOpen && index < fn.bodyClose)
    )
    if (hits.length === 0) items.push({ line: lineAt(bare, tokens[fn.nameIndex].index), kind: 'function', name: fn.name })
  }

  items.sort((a, b) => a.line - b.line || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return items
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function byCodePoint(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function collectFiles(full, anchor, found, seen) {
  let stat
  try {
    stat = fs.statSync(full)
  } catch {
    return false
  }
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(full, { withFileTypes: true }).sort((a, b) => byCodePoint(a.name, b.name))
    for (const entry of entries) {
      const child = path.join(full, entry.name)
      if (entry.isDirectory()) collectFiles(child, anchor, found, seen)
      else if (entry.isFile() && SOURCE_EXT.test(entry.name)) collectFiles(child, anchor, found, seen)
    }
    return true
  }
  if (!stat.isFile()) return true
  const absolute = path.resolve(full)
  if (seen.has(absolute)) return true
  seen.add(absolute)
  found.push({ rel: toPosix(path.relative(anchor, absolute)), full: absolute })
  return true
}

/** Scans the given paths (relative to `root`, defaulting to `lib`) and returns `{ files, items }`. */
export function scanPaths(paths, { root = REPO_ROOT } = {}) {
  const base = path.resolve(root)
  const list = Array.isArray(paths) && paths.length > 0 ? paths : ['lib']
  const found = []
  const seen = new Set()

  for (const rel of list) {
    const full = path.resolve(base, rel)
    let stat
    try {
      stat = fs.statSync(full)
    } catch {
      const error = new Error(`no such file or directory: ${rel}`)
      error.code = 'ENOENT'
      throw error
    }
    const anchor = stat.isDirectory() ? full : path.dirname(full)
    collectFiles(full, anchor, found, seen)
  }

  found.sort((a, b) => byCodePoint(a.rel, b.rel))
  const items = []
  for (const file of found) {
    let source = ''
    try {
      source = fs.readFileSync(file.full, 'utf8')
    } catch {
      continue
    }
    for (const item of scanSource(source)) {
      items.push({ file: file.rel, line: item.line, kind: item.kind, name: item.name })
    }
  }
  items.sort((a, b) => byCodePoint(a.file, b.file) || a.line - b.line || byCodePoint(a.name, b.name))

  return { files: found.length, items }
}

function usageError(message) {
  process.stderr.write(`${message}\n${USAGE}\n`)
  process.exitCode = 2
}

function main(argv) {
  let root = REPO_ROOT
  let json = false
  const paths = []

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--root') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value === '') {
        usageError('--root requires a directory')
        return
      }
      root = path.resolve(value)
      i += 1
    } else if (flag === '--json') {
      json = true
    } else if (flag.startsWith('-')) {
      usageError(`unknown argument: ${flag}`)
      return
    } else {
      paths.push(flag)
    }
  }

  let report
  try {
    report = scanPaths(paths, { root })
  } catch (error) {
    usageError(`check-unused: ${error.message}`)
    return
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ files: report.files, items: report.items })}\n`)
    process.exitCode = report.items.length === 0 ? 0 : 1
    return
  }

  for (const item of report.items) {
    process.stdout.write(`${item.file}:${item.line} unused-${item.kind} ${item.name}\n`)
  }
  process.stdout.write(
    report.items.length === 0
      ? `check-unused: ok (files=${report.files})\n`
      : `check-unused: FAIL (${report.items.length} unused)\n`
  )
  process.exitCode = report.items.length === 0 ? 0 : 1
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main(process.argv.slice(2))
