#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function declaredNames(base) {
  const names = new Set()
  const add = (value) => { if (typeof value === 'string' && value.length) names.add(value) }
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
  const config = read(path.join(base, 'config/cliworker.example.json'))
  for (const [key, value] of Object.entries(config.providers)) {
    add(key); add(value.cli); add(value.adapter)
  }
  for (const [key, value] of Object.entries(config.models)) { add(key); add(value.id) }
  const dir = path.join(base, 'contracts/examples/model.v1/valid')
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const record = read(path.join(dir, file))
    add(record.id); add(record.cli); add(record.provider)
  }
  return names
}

// Tokenize without evaluating source. Templates and regular expressions are opaque.
function tokenize(source) {
  const tokens = []
  let i = 0
  const push = (type, start, value = source.slice(start, i)) => tokens.push({ type, start, end: i, value })
  while (i < source.length) {
    const start = i, c = source[i], next = source[i + 1]
    if (/\s/.test(c)) { i++; continue }
    if (c === '/' && next === '/') { i += 2; while (i < source.length && source[i] !== '\n') i++; continue }
    if (c === '/' && next === '*') { i += 2; const end = source.indexOf('*/', i); if (end < 0) throw new Error('unterminated comment'); i = end + 2; continue }
    if (c === "'" || c === '"' || c === '`') {
      i++
      let value = ''
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') {
          i++
          if (i >= source.length) throw new Error('unterminated string')
          const esc = source[i++]
          if (esc === 'u' || esc === 'x') {
            const length = esc === 'u' ? 4 : 2
            const hex = source.slice(i, i + length)
            if (/^[0-9a-f]+$/i.test(hex) && hex.length === length) { value += String.fromCharCode(parseInt(hex, 16)); i += length } else value += esc
          } else value += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '\n': '' })[esc] ?? esc
        } else value += source[i++]
      }
      if (i >= source.length) throw new Error('unterminated string')
      i++
      push(c === '`' ? 'template' : 'string', start, value)
      continue
    }
    const previous = tokens.at(-1)
    if (c === '/' && (!previous || (previous.type === 'punct' && ![')', ']', '}'].includes(previous.value)) || ['return', 'case', 'throw'].includes(previous.value))) {
      i++; let bracket = false, closed = false
      while (i < source.length && source[i] !== '\n') {
        if (source[i] === '\\') { i += 2; continue }
        if (source[i] === '[') bracket = true
        if (source[i] === ']') bracket = false
        if (source[i++] === '/' && !bracket) { closed = true; break }
      }
      if (closed) { while (/[a-z]/i.test(source[i] ?? '') && i < source.length) i++; push('regex', start); continue }
      i = start
    }
    if (/[\w$]/.test(c)) { i++; while (i < source.length && /[\w$]/.test(source[i])) i++; push('word', start); continue }
    i++
    if (c === '=' && next === '>') i++
    push('punct', start)
  }
  return tokens
}

export function scanSource(source, names) {
  const tokens = tokenize(source), stack = [], hits = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], prev = tokens[i - 1], next = tokens[i + 1]
    if (t.type === 'punct' && (t.value === '[' || t.value === '{' || t.value === '(')) {
      const expressionEnd = prev && (['word', 'string', 'template'].includes(prev.type) || [')', ']', '}'].includes(prev.value)) && !['return', 'yield', 'case'].includes(prev.value)
      const literal = t.value === '[' ? !expressionEnd : t.value === '{' && !!prev && (['=', '(', '[', ',', ':', 'return', 'yield'].includes(prev.value))
      stack.push({ open: t.value, literal, start: t.start, names: new Set() })
    } else if (t.type === 'punct' && (t.value === ']' || t.value === '}' || t.value === ')')) {
      const frame = stack.pop()
      if (!frame || { ']': '[', '}': '{', ')': '(' }[t.value] !== frame.open) throw new Error(`unbalanced delimiter at offset ${t.start}`)
      if (frame.literal && frame.names.size >= 3) hits.push({ line: source.slice(0, frame.start).split('\n').length, snippet: source.slice(frame.start, t.end) })
    } else if (t.type === 'string' || (t.type === 'word' && next?.value === ':')) {
      if (!names.has(t.value)) continue
      for (let j = stack.length - 1; j >= 0; j--) {
        const frame = stack[j]
        if (frame.open === '{' && !frame.literal) break
        if (frame.literal) frame.names.add(t.value)
      }
    }
  }
  if (stack.length) throw new Error('unbalanced delimiter at end of file')
  return hits
}

function main() {
  try {
    const names = declaredNames(root), hits = []
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(file)
        else if (entry.isFile() && /\.(?:mjs|js|cjs)$/.test(entry.name)) {
          const rel = path.relative(root, file).split(path.sep).join('/')
          if (rel === 'lib/commands/_util.mjs') continue
          try { for (const hit of scanSource(fs.readFileSync(file, 'utf8'), names)) hits.push({ rel, ...hit }) }
          catch (error) { throw new Error(`${rel}: ${error.message}`) }
        }
      }
    }
    walk(path.join(root, 'lib'))
    if (hits.length) {
      for (const hit of hits) console.error(`${hit.rel}:${hit.line}: ${hit.snippet}`)
      process.exitCode = 1
    } else console.log('AC-079 OK')
  } catch (error) { console.error(`check-no-model-table: ${error.message}`); process.exitCode = 1 }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) main()
