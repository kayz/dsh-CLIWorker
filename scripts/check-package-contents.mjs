#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directories = ['ui', 'bin', 'lib']
const html = 'docs/ui/cliworker-console.html'

export function runNpmPack(root, spawn = spawnSync) {
  let result
  let cache
  try {
    cache = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-pack-cache-'))
    result = spawn('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root, shell: process.platform === 'win32', encoding: 'utf8',
      env: { ...process.env, npm_config_offline: 'true', npm_config_cache: cache },
      timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    })
  } catch (error) {
    return { error: `npm pack could not start: ${error.message}` }
  } finally {
    if (cache) fs.rmSync(cache, { recursive: true, force: true })
  }
  if (!result || result.error) return { error: `npm pack failed to start or timed out: ${result?.error?.message ?? 'no result'}` }
  if (result.status !== 0) return { error: `npm pack failed (exit ${result.status})` }
  let parsed
  try { parsed = JSON.parse(result.stdout) } catch { return { error: 'npm pack returned invalid JSON' } }
  if (!Array.isArray(parsed) || !parsed.length || !Array.isArray(parsed[0]?.files)) {
    return { error: 'npm pack returned invalid files' }
  }
  const files = []
  for (const entry of parsed[0].files) {
    if (!entry || typeof entry.path !== 'string' || !entry.path) {
      return { error: 'npm pack returned invalid file path' }
    }
    const file = entry.path.replaceAll('\\', '/')
    if (file.startsWith('/') || /^[a-z]:/i.test(file) || file.split('/').some(part => !part || part === '.' || part === '..')) {
      return { error: 'npm pack returned invalid file path' }
    }
    files.push(file)
  }
  return { files, error: null }
}

export function collectFiles(root, directory) {
  const files = []
  function walk(rel) {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const name = `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(name)
      else if (entry.isFile()) files.push(name)
    }
  }
  walk(directory)
  return files
}

export function evaluateContents(files, sourceFiles) {
  const errors = []
  const present = new Set(files)
  for (const directory of directories) {
    const prefix = `${directory}/`
    if (!files.some(file => file.startsWith(prefix) && file.length > prefix.length)) errors.push(prefix)
    const source = sourceFiles[directory] ?? []
    if (!source.length && !errors.includes(prefix)) errors.push(prefix)
    for (const file of source) if (!present.has(file)) errors.push(file)
  }
  if (!present.has(html)) errors.push(html)
  return errors
}

function main(args) {
  let root = rootDefault
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--root' || !args[i + 1] || args[i + 1].startsWith('--')) {
      process.stderr.write('usage: node scripts/check-package-contents.mjs [--root <dir>]\n')
      process.exitCode = 1
      return
    }
    root = path.resolve(args[++i])
  }
  const pack = runNpmPack(root)
  if (pack.error) {
    process.stderr.write(`${pack.error}\n`)
    process.exitCode = 1
    return
  }
  const sources = {}
  for (const directory of directories) {
    try { sources[directory] = collectFiles(root, directory) } catch { sources[directory] = [] }
  }
  const errors = evaluateContents(pack.files, sources)
  if (errors.length) {
    for (const error of errors) process.stderr.write(`missing package content: ${error}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write('AC-087 OK\n')
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main(process.argv.slice(2))
}
