import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { normalizeRequest, requestFromArgv } from '../../../lib/request.mjs'

const V01 = process.env.CLIWORKER_V01_ROOT
  ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))

test('[repro] [AC-005] role and importance are silently ignored', async () => {
  const { selectModels } = await import(pathToFileURL(path.join(V01, 'lib', 'select.mjs')).href)
  const config = {
    providers: { claude: { cli: 'claude', readonly: true } },
    models: { quick: { provider: 'claude', id: 'q', level: 'Quick', identity: 'verified' } },
  }
  const status = { claude: { state: 'callable' } }

  const result = selectModels(config, { level: 'Quick', role: 'dev', importance: 'high' }, { status })
  assert.equal(result.ok, true)
  assert.equal('warnings' in result, false)
})

test('[fixed] [AC-024] role and importance now surface instead of being ignored silently', () => {
  const raw = { level: 'Quick', role: 'dev', importance: 'high' }
  const expected = [{ code: 'W_FIELD_IGNORED', field: 'role' }]

  assert.deepEqual(normalizeRequest(raw).warnings, expected)
  assert.deepEqual(requestFromArgv(['--request', JSON.stringify(raw)], {}).warnings, expected)
})
