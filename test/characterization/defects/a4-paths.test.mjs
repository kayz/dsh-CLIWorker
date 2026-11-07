import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const V01 = process.env.CLIWORKER_V01_ROOT
  ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))

test('[repro] [AC-005] config home ignores the directory of the config file', async () => {
  const { loadConfig } = await import(pathToFileURL(path.join(V01, 'lib', 'config.mjs')).href)
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-v01-paths-'))
  const previous = process.env.CLIWORKER_HOME
  try {
    const home = path.join(base, 'home')
    const first = path.join(base, 'first')
    const second = path.join(base, 'second')
    for (const dir of [home, first, second]) fs.mkdirSync(dir, { recursive: true })

    const firstFile = path.join(first, 'config.json')
    const secondFile = path.join(second, 'config.json')
    for (const file of [firstFile, secondFile]) {
      fs.writeFileSync(file, JSON.stringify({ providers: {}, models: {} }), 'utf8')
    }

    process.env.CLIWORKER_HOME = home

    const a = loadConfig({ file: firstFile })
    const b = loadConfig({ file: secondFile })

    assert.equal(a._home, b._home)
    assert.equal(path.resolve(a._home).startsWith(path.resolve(first) + path.sep), false)
    assert.equal(path.resolve(b._home).startsWith(path.resolve(second) + path.sep), false)
  } finally {
    if (previous === undefined) delete process.env.CLIWORKER_HOME
    else process.env.CLIWORKER_HOME = previous
    fs.rmSync(base, { recursive: true, force: true })
  }
})
