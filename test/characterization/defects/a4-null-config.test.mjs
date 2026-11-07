import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const V01 = process.env.CLIWORKER_V01_ROOT
  ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))

test('[repro] [AC-005] a null or empty config throws without an error code', async () => {
  const { loadConfig } = await import(pathToFileURL(path.join(V01, 'lib', 'config.mjs')).href)
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-v01-null-'))
  try {
    const nullFile = path.join(base, 'null.json')
    const emptyFile = path.join(base, 'empty.json')
    fs.writeFileSync(nullFile, 'null', 'utf8')
    fs.writeFileSync(emptyFile, '{}', 'utf8')

    let fromNull = null
    try {
      loadConfig({ file: nullFile })
    } catch (error) {
      fromNull = error
    }
    assert.ok(fromNull instanceof TypeError)
    assert.equal(fromNull.code, undefined)

    let fromEmpty = null
    try {
      loadConfig({ file: emptyFile })
    } catch (error) {
      fromEmpty = error
    }
    assert.ok(fromEmpty instanceof Error)
    assert.equal(fromEmpty.code, undefined)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
