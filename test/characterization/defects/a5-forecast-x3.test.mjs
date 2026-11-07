import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const V01 = process.env.CLIWORKER_V01_ROOT
  ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))

test('[repro] [AC-005] the provider quota is read three times per model', async () => {
  const { selectModels } = await import(pathToFileURL(path.join(V01, 'lib', 'select.mjs')).href)

  let reads = 0
  const quotas = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'claude') reads += 1
        return target[prop]
      },
    }
  )

  const models = {}
  for (let i = 0; i < 12; i += 1) {
    models[`claude-m${i}`] = {
      provider: 'claude',
      id: `m${i}`,
      level: 'Quick',
      identity: 'verified',
      prices: { input_per_mtok: 1, output_per_mtok: 1 },
    }
  }
  const config = { providers: { claude: { cli: 'claude', readonly: true } }, models, quotas }
  const status = { claude: { state: 'callable' } }

  const result = selectModels(config, { level: 'Quick', count: 12 }, { status })
  assert.equal(result.ok, true)
  assert.ok(reads > 12, `expected more than 12 quota reads, saw ${reads}`)
})

test('[fixed] [AC-020] the live selector reads each provider quota once', async () => {
  const { selectModels } = await import('../../../lib/select.mjs')

  let reads = 0
  const quotas = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'claude') reads += 1
        return target[prop]
      },
    }
  )

  const models = {}
  for (let i = 0; i < 12; i += 1) {
    models[`claude-m${i}`] = {
      provider: 'claude',
      id: `m${i}`,
      level: 'Quick',
      identity: 'verified',
      prices: { input_per_mtok: 1, output_per_mtok: 1 },
    }
  }
  const config = { providers: { claude: { cli: 'claude', readonly: true } }, models, quotas }

  const result = selectModels(config, { level: 'Quick', count: 12 }, { status: { claude: { state: 'callable' } } })
  assert.equal(result.ok, true)
  assert.equal(result.models.length, 12)
  assert.equal(reads, 12)
})
