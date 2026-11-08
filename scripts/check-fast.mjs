#!/usr/bin/env node
// Runs the acceptance-format gate, then every scripts/check-*.mjs in code point order (never
// itself), then the full test run.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STEP_PATTERN = /^check-.*\.mjs$/
const SELF = 'check-fast.mjs'
const ACCEPTANCE = 'check-acceptance.mjs'

function out(text) {
  fs.writeSync(1, text)
}

function err(text) {
  fs.writeSync(2, text)
}

function byCodePoint(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function isStep(file) {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function stepFailed(label, result) {
  const code = result.status === null ? 1 : result.status
  err(`check-fast: FAILED step ${label} (exit ${code})\n`)
  process.exitCode = code
}

function main() {
  const injected = Boolean(process.env.CLIWORKER_TEST_CHECK_DIR || process.env.CLIWORKER_TEST_FINAL_SCRIPT)
  const dir = process.env.CLIWORKER_TEST_CHECK_DIR
    ? path.resolve(process.env.CLIWORKER_TEST_CHECK_DIR)
    : HERE
  const finalScript = process.env.CLIWORKER_TEST_FINAL_SCRIPT
    ? path.resolve(process.env.CLIWORKER_TEST_FINAL_SCRIPT)
    : path.join(dir, 'run-tests.mjs')
  const cwd = path.dirname(dir)

  if (injected) err('check-fast: test injection active\n')

  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    names = []
  }

  const steps = names
    .filter((name) => STEP_PATTERN.test(name) && name !== SELF && name !== ACCEPTANCE)
    .filter((name) => {
      try {
        return fs.statSync(path.join(dir, name)).isFile()
      } catch {
        return false
      }
    })
    .sort(byCodePoint)

  // The acceptance gate runs first (its name also sorts first) but is called out explicitly so
  // a checkout without the script, or an injected test directory without it, simply skips it.
  // check-acceptance itself exits 0 when there is no pending task acceptance to inspect.
  const acceptance = path.join(dir, ACCEPTANCE)
  if (isStep(acceptance)) {
    out(`==> ${ACCEPTANCE}\n`)
    const result = spawnSync(process.execPath, [acceptance], { cwd, stdio: 'inherit' })
    if (result.status !== 0) {
      stepFailed(ACCEPTANCE, result)
      return
    }
  }

  for (const name of steps) {
    out(`==> ${name}\n`)
    const result = spawnSync(process.execPath, [path.join(dir, name)], { cwd, stdio: 'inherit' })
    if (result.status !== 0) {
      stepFailed(name, result)
      return
    }
  }

  out('==> npm test\n')
  const result = spawnSync(process.execPath, [finalScript], { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    stepFailed('npm test', result)
    return
  }

  out('check-fast: ok\n')
  process.exitCode = 0
}

main()
