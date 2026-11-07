#!/usr/bin/env node
// Runs every scripts/check-*.mjs in code point order (never itself) and then the full test run.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STEP_PATTERN = /^check-.*\.mjs$/
const SELF = 'check-fast.mjs'

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
    .filter((name) => STEP_PATTERN.test(name) && name !== SELF)
    .filter((name) => {
      try {
        return fs.statSync(path.join(dir, name)).isFile()
      } catch {
        return false
      }
    })
    .sort(byCodePoint)

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
