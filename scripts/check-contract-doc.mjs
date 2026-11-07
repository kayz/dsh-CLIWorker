#!/usr/bin/env node
// Fails when docs/contract.md differs from the freshly rendered document.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderContractDoc } from './gen-contract-doc.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const DOC_REL = 'docs/contract.md'
const USAGE = 'usage: node scripts/check-contract-doc.mjs [--root <dir>]'

function normalize(text) {
  return text.replace(/\r\n/g, '\n')
}

function main(argv) {
  let root = REPO_ROOT
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--root') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value === '') {
        process.stderr.write(`check-contract-doc: --root requires a directory\n${USAGE}\n`)
        process.exitCode = 2
        return
      }
      root = path.resolve(value)
      i += 1
    } else {
      process.stderr.write(`check-contract-doc: unknown argument: ${flag}\n${USAGE}\n`)
      process.exitCode = 2
      return
    }
  }

  const file = path.join(root, DOC_REL)
  let actual = null
  try {
    actual = fs.readFileSync(file, 'utf8')
  } catch {
    actual = null
  }

  if (actual === null) {
    process.stdout.write(`FAIL contract_doc.missing ${DOC_REL}\n`)
    process.stdout.write('check-contract-doc: FAILED (1 errors)\n')
    process.exitCode = 1
    return
  }

  const rendered = renderContractDoc(root)
  if (normalize(actual) !== rendered) {
    process.stdout.write(`FAIL contract_doc.stale ${DOC_REL}\n`)
    process.stdout.write('check-contract-doc: FAILED (1 errors)\n')
    process.exitCode = 1
    return
  }

  process.stdout.write('check-contract-doc: ok\n')
  process.exitCode = 0
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main(process.argv.slice(2))
