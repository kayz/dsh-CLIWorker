#!/usr/bin/env node
// Self-test for the test discovery rules: proves the runner notices drift, that a filtered
// manifest cannot stand in for a full one, and that decoys and orphans are handled correctly.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { enumerateTestFiles, findOrphans, verifyFullRun } from './run-tests.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const RUN_TESTS = path.join(HERE, 'run-tests.mjs')
const FIXTURES = path.join(REPO_ROOT, 'test', 'fixtures', 'discovery-selftest')
const EXCLUDED_PREFIXES = ['test/fixtures/', 'test/helpers/', 'test/perf/']

function printErrors(errors) {
  for (const error of errors) {
    process.stdout.write(`FAIL ${error.id} ${error.path ?? ''}`.trimEnd() + '\n')
  }
}

function checkRoot(root, manifestPath) {
  const errors = findOrphans(root).map((file) => ({ id: 'discovery.orphan', path: file }))
  if (manifestPath) {
    let manifest = null
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch {
      manifest = null
    }
    const verification = verifyFullRun({ enumerated: enumerateTestFiles(root), manifest })
    errors.push(...verification.errors)
  }
  printErrors(errors)
  if (errors.length > 0) {
    process.exitCode = 1
    return
  }
  process.stdout.write('check-test-discovery: ok\n')
}

function runRunner(root) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-discovery-'))
  const result = spawnSync(process.execPath, [RUN_TESTS, '--root', root, '--out-dir', outDir], {
    encoding: 'utf8',
  })
  const manifestPath = path.join(outDir, 'files-executed.json')
  let manifest = null
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    manifest = null
  }
  return { result, manifest, outDir, manifestPath }
}

function runFiltered(root, ac) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-discovery-'))
  const result = spawnSync(process.execPath, [RUN_TESTS, '--root', root, '--ac', ac, '--out-dir', outDir], {
    encoding: 'utf8',
  })
  let manifest = null
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'files-executed.json'), 'utf8'))
  } catch {
    manifest = null
  }
  return { result, manifest, outDir }
}

function selftest() {
  const problems = []
  const record = (message) => {
    problems.push(message)
    process.stdout.write(`FAIL ${message}\n`)
  }

  // 1. Live repository.
  for (const file of findOrphans(REPO_ROOT)) record(`discovery.orphan ${file}`)
  for (const file of enumerateTestFiles(REPO_ROOT)) {
    if (EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      record(`discovery.unexpected ${file}`)
    }
  }

  // 2. Full run inside the ok fixture.
  const okRoot = path.join(FIXTURES, 'ok')
  const full = runRunner(okRoot)
  const expected = ['test/flows/c.test.mjs', 'test/integration/b.test.mjs', 'test/unit/a.test.mjs']
  if (full.result.status !== 0) {
    record(`discovery.selftest full run exited ${full.result.status} ${(full.result.stderr || '').trim()}`)
  }
  if (!full.manifest || full.manifest.mode !== 'full') {
    record('discovery.mode_not_full ok fixture manifest is not a full run')
  } else if (JSON.stringify(full.manifest.files) !== JSON.stringify(expected)) {
    record(`discovery.selftest ok fixture files ${JSON.stringify(full.manifest.files)}`)
  }
  fs.rmSync(full.outDir, { recursive: true, force: true })

  // 3. Drift manifests.
  const driftRoot = path.join(FIXTURES, 'drift')
  const driftCases = [
    ['manifest-ok.json', null],
    ['manifest-missing.json', 'discovery.missing'],
    ['manifest-extra.json', 'discovery.unexpected'],
    ['manifest-filtered.json', 'discovery.mode_not_full'],
  ]
  for (const [name, expectedId] of driftCases) {
    let manifest = null
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(driftRoot, name), 'utf8'))
    } catch {
      record(`discovery.selftest ${name} is not valid JSON`)
      continue
    }
    const verification = verifyFullRun({ enumerated: enumerateTestFiles(driftRoot), manifest })
    if (expectedId === null) {
      if (!verification.ok) record(`discovery.selftest ${name} should pass but reported ${verification.errors.map((e) => e.id).join(',')}`)
    } else if (!verification.errors.some((error) => error.id === expectedId)) {
      record(`discovery.selftest ${name} did not report ${expectedId}`)
    }
  }

  // 4. Orphans.
  const orphanRoot = path.join(FIXTURES, 'orphan')
  const orphans = findOrphans(orphanRoot)
  if (!orphans.includes('test/loose.test.mjs')) {
    record(`discovery.orphan fixture missed test/loose.test.mjs (got ${JSON.stringify(orphans)})`)
  }

  // 5. Filtered run does not compare.
  const filtered = runFiltered(okRoot, 'AC-001')
  if (filtered.result.status !== 0) {
    record(`discovery.selftest filtered run exited ${filtered.result.status} ${(filtered.result.stderr || '').trim()}`)
  }
  if (!filtered.manifest || filtered.manifest.mode !== 'filtered') {
    record('discovery.mode_not_full filtered fixture manifest is not filtered')
  } else if (filtered.manifest.files.length !== 1 || filtered.manifest.files[0] !== 'test/unit/a.test.mjs') {
    record(`discovery.selftest filtered files ${JSON.stringify(filtered.manifest.files)}`)
  }
  fs.rmSync(filtered.outDir, { recursive: true, force: true })

  if (problems.length > 0) {
    process.exitCode = 1
    return
  }
  process.stdout.write('check-test-discovery: ok\n')
}

function main() {
  const args = process.argv.slice(2)
  let root = null
  let manifestPath = null

  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i]
    if (flag === '--root') {
      const value = args[i + 1]
      if (typeof value !== 'string' || value === '') {
        process.stderr.write('--root requires a directory\n')
        process.exitCode = 2
        return
      }
      root = path.resolve(value)
      i += 1
    } else if (flag === '--manifest') {
      const value = args[i + 1]
      if (typeof value !== 'string' || value === '') {
        process.stderr.write('--manifest requires a file\n')
        process.exitCode = 2
        return
      }
      manifestPath = path.resolve(value)
      i += 1
    } else {
      process.stderr.write(`unknown argument: ${flag}\nusage: node scripts/check-test-discovery.mjs [--root <dir>] [--manifest <file>]\n`)
      process.exitCode = 2
      return
    }
  }

  if (root === null) {
    selftest()
    return
  }
  checkRoot(root, manifestPath)
}

main()
