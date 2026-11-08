import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../../lib/config.mjs'
import { createContext } from '../../lib/context.mjs'

const fixtures = fileURLToPath(new URL('../fixtures/config/', import.meta.url))

for (const name of ['v1.json', 'v1-no-schema.json']) {
  test(`[AC-034] ${name} loads as v2 without changing its source`, () => {
    const file = path.join(fixtures, name)
    const before = fs.readFileSync(file)
    const config = loadConfig({ file, ctx: createContext() })
    assert.equal(config.schema, 'cliworker.config/v2')
    assert.ok(config.warnings.some((warning) => warning.code === 'W_CONFIG_V1'))
    assert.deepEqual(fs.readFileSync(file), before)
  })
}
