import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const V01 = process.env.CLIWORKER_V01_ROOT
  ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))

test('[repro] [AC-005] the selected handle repeats the call object as cli', async () => {
  const { selectModels } = await import(pathToFileURL(path.join(V01, 'lib', 'select.mjs')).href)
  const config = {
    providers: { claude: { cli: 'claude', readonly: true } },
    models: { quick: { provider: 'claude', id: 'q', level: 'Quick', identity: 'verified' } },
  }
  const status = { claude: { state: 'callable' } }

  const result = selectModels(config, { level: 'Quick' }, { status })
  assert.equal(result.ok, true)

  const handle = result.models[0]
  assert.equal('cli' in handle, true)
  assert.equal('call' in handle, true)
  assert.deepEqual(handle.cli, handle.call)
})
