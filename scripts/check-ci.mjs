#!/usr/bin/env node
// Verifies that .github/workflows/ci.yml is the current output of gen-ci.mjs for ci-matrix.json.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderCi } from './gen-ci.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')

const EXPECTED_OS = ['macos', 'ubuntu', 'windows']
const EXPECTED_NODE = [20, 22]
const EXPECTED_ARTIFACTS = ['files-executed.json', 'skips.jsonl']
const CHECK_COMMAND = 'npm run check'

function sortedCopy(value) {
  return Array.isArray(value) ? [...value].sort() : null
}

function sameArray(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false
  return actual.every((item, i) => item === expected[i])
}

function validateMatrix(matrix) {
  const problems = []
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    problems.push('matrix must be a JSON object')
    return problems
  }

  const names = sortedCopy((Array.isArray(matrix.os) ? matrix.os : []).map((item) => item && item.name))
  if (!names || !sameArray(names, EXPECTED_OS)) {
    problems.push(`os names must be ${EXPECTED_OS.join('|')}`)
  }
  if (!sameArray(matrix.node, EXPECTED_NODE)) {
    problems.push(`node must be ${EXPECTED_NODE.join(',')}`)
  }
  if (matrix.check_command !== CHECK_COMMAND) {
    problems.push(`check_command must be "${CHECK_COMMAND}"`)
  }
  if (!sameArray(matrix.artifacts, EXPECTED_ARTIFACTS)) {
    problems.push(`artifacts must be ${EXPECTED_ARTIFACTS.join(',')}`)
  }
  if (!matrix.perf || matrix.perf.blocking !== false) {
    problems.push('perf.blocking must be false')
  }
  return problems
}

export function checkCi(root = REPO_ROOT) {
  const errors = []
  const matrixFile = path.join(root, 'scripts', 'ci-matrix.json')
  const workflowFile = path.join(root, '.github', 'workflows', 'ci.yml')

  let matrix = null
  try {
    matrix = JSON.parse(fs.readFileSync(matrixFile, 'utf8'))
  } catch {
    errors.push({ id: 'ci.matrix_invalid', detail: `cannot read ${matrixFile}` })
    return errors
  }

  const problems = validateMatrix(matrix)
  if (problems.length > 0) {
    for (const problem of problems) errors.push({ id: 'ci.matrix_invalid', detail: problem })
    return errors
  }

  let actual = null
  try {
    actual = fs.readFileSync(workflowFile, 'utf8')
  } catch {
    errors.push({ id: 'ci.missing', detail: '.github/workflows/ci.yml is missing' })
    return errors
  }

  const expected = renderCi(matrix)
  if (actual.replace(/\r\n/g, '\n') !== expected.replace(/\r\n/g, '\n')) {
    errors.push({ id: 'ci.stale', detail: '.github/workflows/ci.yml is not the current generated output' })
  }

  if (!expected.includes('continue-on-error: true')) {
    errors.push({ id: 'ci.perf_blocking', detail: 'perf job is missing continue-on-error: true' })
  }
  if (expected.includes('needs: perf')) {
    errors.push({ id: 'ci.perf_blocking', detail: 'a job depends on perf' })
  }

  return errors
}

function main() {
  const args = process.argv.slice(2)
  let root = REPO_ROOT

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
    } else {
      process.stderr.write(`unknown argument: ${flag}\nusage: node scripts/check-ci.mjs [--root <dir>]\n`)
      process.exitCode = 2
      return
    }
  }

  const errors = checkCi(root)
  if (errors.length === 0) {
    process.stdout.write('check-ci: ok\n')
    process.exitCode = 0
    return
  }
  for (const error of errors) process.stdout.write(`FAIL ${error.id} ${error.detail}\n`)
  process.stdout.write(`check-ci: FAILED (${errors.length} errors)\n`)
  process.exitCode = 1
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main()
