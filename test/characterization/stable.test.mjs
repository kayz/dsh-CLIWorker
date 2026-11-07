// Retained-surface tests for the frozen 0.1 copy. Everything under test is imported from
// test/fixtures/characterization/v0.1/, never from lib/ or bin/, so the assertions keep
// describing 0.1 even while the live tree moves on.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { listModels, selectModels, SCHEMA as SELECTION_SCHEMA } from '../fixtures/characterization/v0.1/lib/select.mjs'
import { SCHEMA as CONFIG_SCHEMA } from '../fixtures/characterization/v0.1/lib/config.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STATUS = { claude: { state: 'callable' } }

function config(models) {
  return {
    providers: { claude: { cli: 'claude', readonly: true } },
    models,
  }
}

function claudeModel(id, overrides = {}) {
  return { provider: 'claude', id, level: 'Quick', identity: 'verified', ...overrides }
}

test('[AC-005] stable: deprecated models are never candidates', () => {
  const cfg = config({
    live: claudeModel('live'),
    retired: claudeModel('retired', { deprecated: true, deprecated_reason: 'retired before 0.1' }),
  })

  const visible = listModels(cfg, { status: STATUS })
  assert.deepEqual(visible.map((m) => m.key), ['live'])

  const withDeprecated = listModels(cfg, { status: STATUS, includeDeprecated: true })
  const retired = withDeprecated.find((m) => m.key === 'retired')
  assert.ok(retired, 'includeDeprecated must surface the deprecated model')
  assert.equal(retired.availability, 'deprecated')

  const result = selectModels(cfg, { level: 'Quick' }, { status: STATUS })
  assert.deepEqual(result.rejected, [{ key: 'retired', reason: 'availability:deprecated' }])
  assert.deepEqual(result.models.map((m) => m.key), ['live'])
})

test('[AC-005] stable: unverified identity is rejected unless require_verified is false', () => {
  const cfg = config({ unverified: claudeModel('unverified', { identity: 'unverified' }) })

  const rejected = selectModels(cfg, { level: 'Quick' }, { status: STATUS })
  assert.equal(rejected.ok, false)
  assert.deepEqual(rejected.rejected, [{ key: 'unverified', reason: 'identity_unverified' }])

  const allowed = selectModels(cfg, { level: 'Quick', require_verified: false }, { status: STATUS })
  assert.equal(allowed.ok, true)
  assert.deepEqual(allowed.models.map((m) => m.key), ['unverified'])
})

test('[AC-005] stable: level filter rejects other levels', () => {
  const cfg = config({ quick: claudeModel('quick'), top: claudeModel('top', { level: 'Top' }) })

  const result = selectModels(cfg, { level: 'top' }, { status: STATUS })
  assert.equal(result.level, 'Top')
  assert.deepEqual(result.rejected, [{ key: 'quick', reason: 'level:Quick' }])
  assert.deepEqual(result.models.map((m) => m.key), ['top'])

  const missing = selectModels(cfg, {}, { status: STATUS })
  assert.equal(missing.ok, false)
  assert.equal(missing.reason, 'E_LEVEL_REQUIRED')
})

test('[AC-005] stable: exclude wins and reports excluded', () => {
  const cfg = config({ quick: claudeModel('quick'), top: claudeModel('top', { level: 'Top' }) })

  const result = selectModels(cfg, { level: 'Quick', exclude: ['top'] }, { status: STATUS })
  assert.deepEqual(result.rejected, [{ key: 'top', reason: 'excluded' }])
  assert.deepEqual(result.models.map((m) => m.key), ['quick'])
})

test('[AC-005] stable: the four schema names', () => {
  const cfg = config({ quick: claudeModel('quick') })

  assert.equal(CONFIG_SCHEMA, 'cliworker.config/v1')
  assert.equal(SELECTION_SCHEMA, 'cliworker.selection/v1')

  const [entry] = listModels(cfg, { status: STATUS })
  assert.equal(entry.schema, 'cliworker.model/v1')

  const result = selectModels(cfg, { level: 'Quick' }, { status: STATUS })
  assert.equal(result.models[0].schema, 'cliworker.handle/v1')
})

test('[AC-005] stable: imports only the v0.1 copy', () => {
  const source = fs.readFileSync(path.join(HERE, 'stable.test.mjs'), 'utf8')
  const specifiers = [...source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1])
  const relative = specifiers.filter((spec) => spec.startsWith('.'))

  assert.ok(relative.length >= 2, `expected at least two relative imports, saw ${relative.length}`)
  for (const spec of relative) {
    assert.ok(spec.includes('fixtures/characterization/v0.1/'), `import must point at the copy: ${spec}`)
  }
})
