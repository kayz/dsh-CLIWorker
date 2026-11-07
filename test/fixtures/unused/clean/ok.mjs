// clean/ok.mjs — every import and every top-level function below is used, so the scanner must
// report nothing. The comment mentions join and helper only as words.
import { join } from 'node:path'
import { sep } from 'node:path'
import 'node:process'

const LABEL = `${join('clean', 'ok')}`
const NOTE = 'import fs from "node:fs" only lives inside this string'

function helper() {
  return LABEL
}

const shorthand = { helper }

function later() {
  return shorthand.href
}

const early = later()

function usesRegex(quoted) {
  return /["']/.test(quoted) ? NOTE : early
}

function viaExportList() {
  return usesRegex(NOTE)
}

export { viaExportList }

export function exported() {
  return `${helper()}${sep}`
}
