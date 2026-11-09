#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const fixture = 'test/fixtures/release-gate'
const jobs = [
  { generator: `${fixture}/generate.mjs`, inputs: ['package.json', 'contracts/spec/ac-index.json'], output: fixture },
  { generator: 'scripts/gen-contract-doc.mjs', inputs: ['contracts/registry.snapshot.json', 'contracts/golden/manifest.json', 'contracts/schemas'], output: 'docs/contract.md' },
]
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function copy(root, dest, rel) {
  const source = path.join(root, rel)
  const stat = fs.lstatSync(source)
  if (stat.isSymbolicLink()) throw new Error(`symbolic link: ${rel}`)
  if (stat.isDirectory()) {
    fs.mkdirSync(path.join(dest, rel), { recursive: true })
    for (const name of fs.readdirSync(source)) copy(root, dest, `${rel}/${name}`)
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true })
    fs.copyFileSync(source, path.join(dest, rel))
  } else throw new Error(`unsupported input: ${rel}`)
}

function files(root, rel, result = []) {
  const stat = fs.lstatSync(path.join(root, rel))
  if (stat.isSymbolicLink()) throw new Error(`symbolic link: ${rel}`)
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(path.join(root, rel))) files(root, `${rel}/${name}`, result)
  } else if (stat.isFile()) {
    if (rel !== `${fixture}/generate.mjs`) result.push(rel)
  } else throw new Error(`unsupported asset: ${rel}`)
  return result
}

function normalizeTap(text) {
  const lines = text.split('\n')
  let diagnostic = false
  let stackIndent = -1
  return lines.map((line) => {
    if (/^\s*---\s*$/.test(line)) diagnostic = true
    if (diagnostic && stackIndent >= 0) {
      const indent = line.match(/^ */)[0].length
      if (line.trim() && indent > stackIndent) return null
      stackIndent = -1
    }
    if (diagnostic && /^\s*(?:type|location):.*$/.test(line)) return null
    const stack = diagnostic && line.match(/^(\s*)stack:\s*[|>][-+]?\s*$/)
    if (stack) { stackIndent = stack[1].length; return null }
    if (/^\s*\.\.\.\s*$/.test(line)) diagnostic = false
    if (diagnostic) line = line.replace(/^(\s*duration_ms:\s*)[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(\s*)$/, '$1<DURATION>$2')
    return line.replace(/^(# duration_ms\s+)[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(\s*)$/, '$1<DURATION>$2')
  }).filter(line => line !== null).join('\n')
}

function normalizeNode(text, jsonl) {
  const normalizeLine = (line) => {
    try {
      const obj = JSON.parse(line)
      if (!obj || Array.isArray(obj) || typeof obj !== 'object' || typeof obj.node !== 'string' || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(obj.node)) return line
      // Locate only the top-level node value while preserving the original formatting.
      let depth = 0, inString = false, escaped = false, start = -1
      for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (inString) {
          if (escaped) escaped = false
          else if (c === '\\') escaped = true
          else if (c === '"') {
            inString = false
            if (depth === 1 && JSON.parse(line.slice(start, i + 1)) === 'node') {
              const match = line.slice(i + 1).match(/^(\s*:\s*)"(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)"/)
              if (match) return line.slice(0, i + 1) + match[1] + '"<NODE>"' + line.slice(i + 1 + match[0].length)
            }
          }
        } else if (c === '"') { inString = true; start = i }
        else if (c === '{' || c === '[') depth++
        else if (c === '}' || c === ']') depth--
      }
    } catch { /* Invalid reports remain unchanged. */ }
    return line
  }
  return jsonl ? text.split('\n').map(normalizeLine).join('\n') : normalizeLine(text)
}

function content(root, rel) {
  let text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(path.join(root, rel))).replaceAll('\r\n', '\n')
  const relative = rel.slice(fixture.length + 1)
  if (/^[^/]+\/ci\/[^/]+\/reporter\.tap$/.test(relative)) text = normalizeTap(text)
  if (/^[^/]+\/smoke\.json$/.test(relative) || /^[^/]+\/ci\/[^/]+\/(?:files-executed\.json|skips\.jsonl)$/.test(relative)) text = normalizeNode(text, rel.endsWith('.jsonl'))
  return text
}

export function check(root, options = {}) {
  let success = true
  for (const job of jobs) {
    let temp
    const errors = []
    try {
      temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-fresh-'))
      for (const input of [job.generator, ...job.inputs]) copy(root, temp, input)
      const args = [path.join(temp, job.generator)]
      if (job.output === 'docs/contract.md') args.push('--root', temp)
      const result = (options.spawnSync ?? spawnSync)(process.execPath, args, { cwd: temp, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 })
      if (result.error || result.signal || result.status !== 0) throw new Error(`generation failed: ${result.error?.message ?? result.signal ?? result.status}`)
      const original = files(root, job.output)
      const generated = files(temp, job.output)
      const all = [...new Set([...original, ...generated])].sort()
      const originalSet = new Set(original), generatedSet = new Set(generated)
      for (const rel of all) {
        try {
          if (!originalSet.has(rel) || !generatedSet.has(rel) || content(root, rel) !== content(temp, rel)) errors.push(`asset differs: ${rel}`)
        } catch (error) { errors.push(`asset ${rel}: ${error.message}`) }
      }
    } catch (error) { errors.push(error.message) }
    finally {
      if (temp) try { fs.rmSync(temp, { recursive: true, force: true }) } catch (error) { errors.push(`cleanup failed: ${error.message}`) }
    }
    if (errors.length) { success = false; console.error(`${job.generator}: ${errors.join('\n')}`) }
    else console.log(`${job.generator}: fresh`)
  }
  return success
}

function main(args) {
  let root = defaultRoot
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--root' || !args[1] || args[1].startsWith('--')) throw new Error('usage: node scripts/check-generated-fresh.mjs [--root <dir>]')
    root = path.resolve(args[1])
  }
  if (!fs.statSync(root).isDirectory()) throw new Error(`not a directory: ${root}`)
  if (check(root)) console.log('AC-084 OK')
  else process.exitCode = 1
}
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try { main(process.argv.slice(2)) } catch (error) { console.error(error.message); process.exitCode = 1 }
}
