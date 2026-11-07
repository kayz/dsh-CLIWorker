#!/usr/bin/env node
// Test runner: enumerates test files, runs them with node:test, and verifies that the
// files the reporter saw match the files we enumerated (full runs only).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const REPORTER = pathToFileURL(path.join(HERE, 'reporters', 'files.mjs')).href
const MANIFEST_NAME = 'files-executed.json'
const SKIPS_NAME = 'skips.jsonl'
const AC_PATTERN = /^AC-\d{3}$/
const MAX_ARG_CHARS = 24000

const TEST_DIRS = ['unit', 'integration', 'contract', 'e2e', 'smoke', 'characterization', 'flows']
const EXCLUDED_TOP = new Set(['fixtures', 'helpers', 'perf'])

const USAGE =
  'usage: node scripts/run-tests.mjs [--ac AC-nnn]... [--root <dir>] [--out-dir <dir>] [--perf] [--update-snapshots]'

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function walkFiles(dir, onFile) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, onFile)
    else if (entry.isFile()) onFile(full)
  }
}

export function enumerateTestFiles(root) {
  const base = path.resolve(root)
  const found = []
  for (const name of TEST_DIRS) {
    const start = path.join(base, 'test', name)
    let stat
    try {
      stat = fs.statSync(start)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    walkFiles(start, (file) => {
      if (file.endsWith('.test.mjs')) found.push(toPosix(path.relative(base, file)))
    })
  }
  return [...new Set(found)].sort()
}

export function enumeratePerfFiles(root) {
  const base = path.resolve(root)
  const start = path.join(base, 'test', 'perf')
  try {
    if (!fs.statSync(start).isDirectory()) return []
  } catch {
    return []
  }
  const found = []
  walkFiles(start, (file) => {
    if (file.endsWith('.test.mjs')) found.push(toPosix(path.relative(base, file)))
  })
  return [...new Set(found)].sort()
}

export function findOrphans(root) {
  const base = path.resolve(root)
  const testDir = path.join(base, 'test')
  let entries
  try {
    entries = fs.readdirSync(testDir, { withFileTypes: true })
  } catch {
    return []
  }

  const all = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_TOP.has(entry.name)) continue
      walkFiles(path.join(testDir, entry.name), (file) => {
        if (file.endsWith('.test.mjs')) all.push(file)
      })
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      all.push(path.join(testDir, entry.name))
    }
  }

  const enumerated = new Set(enumerateTestFiles(base))
  return [...new Set(all.map((file) => toPosix(path.relative(base, file))))]
    .filter((file) => !enumerated.has(file))
    .sort()
}

export function verifyFullRun({ enumerated, manifest }) {
  const errors = []
  const files = Array.isArray(manifest?.files) ? manifest.files : []
  if (!manifest || manifest.mode !== 'full') {
    errors.push({ id: 'discovery.mode_not_full', path: manifest?.mode ?? 'missing' })
  }

  const reported = new Set(files)
  for (const file of enumerated) {
    if (!reported.has(file)) errors.push({ id: 'discovery.missing', path: file })
  }

  const expected = new Set(enumerated)
  for (const file of files) {
    if (!expected.has(file)) errors.push({ id: 'discovery.unexpected', path: file })
  }

  if (enumerated.length === 0) errors.push({ id: 'discovery.no_files', path: '' })

  return { ok: errors.length === 0, errors }
}

function normalizePath(value) {
  const resolved = path.resolve(value).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function defaultOutDir(root) {
  const key = process.platform === 'win32' ? root.toLowerCase() : root
  const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)
  return path.join(os.tmpdir(), 'cliworker-test-results', hash)
}

function usageError(message) {
  process.stderr.write(`${message}\n${USAGE}\n`)
  process.exitCode = 2
}

function parseArgs(argv) {
  const options = { acs: [], root: REPO_ROOT, outDir: null, perf: false, updateSnapshots: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--ac') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || !AC_PATTERN.test(value)) {
        return { error: `--ac requires a value matching ^AC-\\d{3}$ (got ${JSON.stringify(value ?? null)})` }
      }
      options.acs.push(value)
      i += 1
    } else if (flag === '--root') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value === '') return { error: '--root requires a directory' }
      options.root = path.resolve(value)
      i += 1
    } else if (flag === '--out-dir') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value === '') return { error: '--out-dir requires a directory' }
      options.outDir = path.resolve(value)
      i += 1
    } else if (flag === '--perf') {
      options.perf = true
    } else if (flag === '--update-snapshots') {
      options.updateSnapshots = true
    } else {
      return { error: `unknown argument: ${flag}` }
    }
  }
  options.acs = [...new Set(options.acs)]
  return { options }
}

function runNode(args, spawnOptions) {
  return new Promise((resolve) => {
    // A nested `node --test` refuses to run its files when it inherits NODE_TEST_CONTEXT from
    // the parent test process. Nested runs are legitimate here (self-tests and the milestone
    // gate spawn run-tests), so the child must look like a top-level run.
    const env = { ...(spawnOptions.env ?? process.env) }
    delete env.NODE_TEST_CONTEXT
    const child = spawn(process.execPath, args, { ...spawnOptions, env })
    child.on('error', () => resolve({ code: null, signal: null }))
    child.on('close', (code, signal) => resolve({ code, signal }))
  })
}

function readManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.error) {
    usageError(parsed.error)
    return
  }
  const options = parsed.options
  const root = options.root

  if (options.perf) {
    const files = enumeratePerfFiles(root)
    if (files.length === 0) {
      process.stdout.write('run-tests: no perf tests\n')
      return
    }
    const result = await runNode(['--test', ...files], { cwd: root, stdio: 'inherit' })
    process.exitCode = result.code === null ? 1 : result.code
    return
  }

  const filtered = options.acs.length > 0
  const outDir = options.outDir ?? (process.env.CLIWORKER_RESULTS_DIR
    ? path.resolve(process.env.CLIWORKER_RESULTS_DIR)
    : defaultOutDir(root))

  if (
    process.env.CLIWORKER_RUN_ACTIVE &&
    process.env.CLIWORKER_RESULTS_DIR &&
    normalizePath(outDir) === normalizePath(process.env.CLIWORKER_RESULTS_DIR)
  ) {
    process.stderr.write(
      'run-tests: refusing to run nested inside the parent run (a nested run would overwrite the parent artifacts)\n'
    )
    process.exitCode = 2
    return
  }

  const enumerated = enumerateTestFiles(root)
  let files = enumerated

  if (filtered) {
    const needles = options.acs.map((ac) => `[${ac}]`)
    files = enumerated.filter((file) => {
      let source = ''
      try {
        source = fs.readFileSync(path.join(root, file), 'utf8')
      } catch {
        return false
      }
      return needles.some((needle) => source.includes(needle))
    })
    if (files.length === 0) {
      for (const ac of options.acs) process.stdout.write(`FAIL run.no_match ${ac}\n`)
      process.exitCode = 1
      return
    }
  } else {
    const orphans = findOrphans(root)
    if (orphans.length > 0) {
      for (const file of orphans) process.stdout.write(`FAIL discovery.orphan ${file}\n`)
      process.exitCode = 1
      return
    }
  }

  if (files.length === 0) {
    process.stdout.write('FAIL discovery.no_files\n')
    process.exitCode = 1
    return
  }

  const joined = files.join(' ')
  if (joined.length > MAX_ARG_CHARS) {
    usageError(`run-tests: file list is too long for one command line (${joined.length} characters)`)
    return
  }

  fs.mkdirSync(outDir, { recursive: true })
  const manifestPath = path.join(outDir, MANIFEST_NAME)
  const skipsPath = path.join(outDir, SKIPS_NAME)
  try {
    fs.rmSync(manifestPath, { force: true })
  } catch {
    /* ignore */
  }
  fs.writeFileSync(skipsPath, '')

  const mode = filtered ? 'filtered' : 'full'
  const env = {
    ...process.env,
    CLIWORKER_RUN_MODE: mode,
    CLIWORKER_RUN_FILTER: filtered ? options.acs.join(',') : '',
    CLIWORKER_ROOT: root,
    CLIWORKER_RESULTS_DIR: outDir,
    CLIWORKER_RUN_ACTIVE: '1',
  }
  if (options.updateSnapshots) env.CLIWORKER_UPDATE_SNAPSHOT = '1'

  const args = [
    '--test',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    `--test-reporter=${REPORTER}`,
    `--test-reporter-destination=${manifestPath}`,
    ...files,
  ]

  const result = await runNode(args, { cwd: root, stdio: 'inherit', env })
  let exitCode = result.code === null ? 1 : result.code

  if (!filtered) {
    const manifest = readManifest(manifestPath)
    const verification = verifyFullRun({ enumerated: files, manifest })
    if (!verification.ok) {
      for (const error of verification.errors) {
        process.stdout.write(`FAIL ${error.id} ${error.path}\n`)
      }
      if (exitCode === 0) exitCode = 1
    }
  }

  process.stdout.write(`run-tests: ${mode} ${files.length} files, manifest ${manifestPath}\n`)
  process.exitCode = exitCode
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`run-tests: ${error && error.stack ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
}
