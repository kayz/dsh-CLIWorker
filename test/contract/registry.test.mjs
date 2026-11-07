import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { REGISTRY, WRITE_ROUTE_ORDER, decideGate, getCode } from '../../lib/contract/registry.mjs'
import { VIEW_NAMES, resolveView } from '../../lib/contract/views.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SNAPSHOT = path.join(ROOT, 'contracts', 'registry.snapshot.json')

const FROZEN_EXITS = {
  E_INTERNAL: 1,
  E_REQUEST_INVALID: 2,
  E_LEVEL_REQUIRED: 2,
  E_LEVEL_UNKNOWN: 2,
  E_SCHEMA_UNSUPPORTED: 2,
  E_UNSAFE_ARG: 2,
  E_UNKNOWN_COMMAND: 2,
  E_VIEW_FORBIDDEN: 2,
  E_CONFIG: 3,
  E_CONFIG_EXAMPLE: 3,
  E_CONFIG_EXISTS: 3,
  E_CONFIG_SECRET_INLINE: 3,
  E_SECRET_BACKEND: 3,
  E_STATE_LOCKED: 4,
  E_TIMEOUT: 4,
  E_NO_CANDIDATE: 5,
  E_INSUFFICIENT_QUOTA: 5,
  E_LEASE_UNKNOWN: 6,
  E_LEASE_EXPIRED: 6,
  E_LEASE_CONSUMED: 6,
  E_LEASE_CONFIG_MISMATCH: 6,
  E_PROVIDER_AUTH: 7,
  E_PROVIDER_QUOTA: 7,
  E_PROVIDER_FAILED: 7,
  E_ADMIN_REQUIRED: 8,
  E_LOOPBACK_ONLY: 8,
  E_READONLY: 8,
  E_CSRF: 8,
  E_HEALTH_DEGRADED: 9,
  E_SMOKE_DISABLED: 9,
}

const RETRYABLE = ['E_INSUFFICIENT_QUOTA', 'E_LEASE_EXPIRED', 'E_TIMEOUT']

test('[AC-009] REGISTRY deep-equals contracts/registry.snapshot.json', () => {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'))
  assert.deepStrictEqual(JSON.parse(JSON.stringify(REGISTRY)), snapshot)
  assert.deepStrictEqual(snapshot.schema, 'cliworker.registry/v1')
})

test('[AC-009] every code has exit, http_status, retryable, trigger_id and trigger', () => {
  assert.equal(REGISTRY.codes.length, 30)
  for (const entry of REGISTRY.codes) {
    assert.equal(typeof entry.code, 'string')
    assert.equal(typeof entry.exit, 'number')
    assert.equal(typeof entry.http_status, 'number')
    assert.equal(typeof entry.retryable, 'boolean')
    assert.equal(typeof entry.trigger_id, 'string')
    assert.equal(typeof entry.trigger, 'string')
    assert.match(entry.trigger_id, /^[a-z][a-z0-9_]*$/)
    assert.ok(entry.trigger.length > 0)
    assert.deepStrictEqual(Object.keys(entry), [
      'code',
      'exit',
      'http_status',
      'retryable',
      'trigger_id',
      'trigger',
    ])
  }
  assert.equal(getCode('E_CSRF').code, 'E_CSRF')
  assert.equal(getCode('E_NOT_A_CODE'), null)
})

test('[AC-009] trigger_id and trigger text are unique across the table', () => {
  const ids = REGISTRY.codes.map((entry) => entry.trigger_id)
  const texts = REGISTRY.codes.map((entry) => entry.trigger)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(new Set(texts).size, texts.length)
})

test('[AC-009] codes, exits and retryable flags match the frozen exit-code table', () => {
  const got = {}
  for (const entry of REGISTRY.codes) got[entry.code] = entry.exit
  assert.deepStrictEqual(got, FROZEN_EXITS)
  assert.deepStrictEqual(
    REGISTRY.codes.filter((entry) => entry.retryable).map((entry) => entry.code).sort(),
    [...RETRYABLE].sort()
  )
})

test('[AC-009] the five 403 codes have mutually exclusive triggers', () => {
  const routes = ['public', 'select', 'bootstrap', 'admin_read', 'admin_write']
  const seen = new Set()
  const booleans = [false, true]
  for (const route of routes) {
    for (const viewFullOrDraft of booleans) {
      for (const loopbackOk of booleans) {
        for (const sessionValid of booleans) {
          for (const readonly of booleans) {
            for (const csrfValid of booleans) {
              const verdict = decideGate({
                route,
                view_full_or_draft: viewFullOrDraft,
                loopback_ok: loopbackOk,
                session_valid: sessionValid,
                readonly,
                csrf_valid: csrfValid,
              })
              assert.ok(verdict === null || typeof verdict === 'string')
              if (verdict === null) continue
              seen.add(verdict)
              if (verdict === 'E_READONLY' || verdict === 'E_CSRF') assert.equal(sessionValid, true)
              if (verdict === 'E_ADMIN_REQUIRED') assert.equal(sessionValid, false)
            }
          }
        }
      }
    }
  }
  assert.deepStrictEqual([...seen].sort(), [
    'E_ADMIN_REQUIRED',
    'E_CSRF',
    'E_LOOPBACK_ONLY',
    'E_READONLY',
    'E_VIEW_FORBIDDEN',
  ])
  const expected = {
    E_VIEW_FORBIDDEN: ['select_view_without_admin', 2],
    E_LOOPBACK_ONLY: ['bootstrap_non_loopback', 8],
    E_ADMIN_REQUIRED: ['admin_route_no_session', 8],
    E_READONLY: ['write_route_readonly', 8],
    E_CSRF: ['write_route_csrf_invalid', 8],
  }
  for (const [code, [triggerId, exit]] of Object.entries(expected)) {
    const entry = getCode(code)
    assert.equal(entry.trigger_id, triggerId)
    assert.equal(entry.exit, exit)
    assert.equal(entry.http_status, 403)
  }
})

test('[AC-009] write route order is session, readonly, csrf, body', () => {
  assert.deepStrictEqual(WRITE_ROUTE_ORDER, ['session', 'readonly', 'csrf', 'body'])
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'))
  assert.deepStrictEqual(snapshot.write_route_order, ['session', 'readonly', 'csrf', 'body'])
  assert.equal(
    decideGate({ route: 'admin_write', session_valid: false, readonly: true, csrf_valid: false }),
    'E_ADMIN_REQUIRED'
  )
  assert.equal(
    decideGate({ route: 'admin_write', session_valid: true, readonly: true, csrf_valid: false }),
    'E_READONLY'
  )
  assert.equal(
    decideGate({ route: 'admin_write', session_valid: true, readonly: false, csrf_valid: false }),
    'E_CSRF'
  )
  assert.equal(
    decideGate({ route: 'admin_write', session_valid: true, readonly: false, csrf_valid: true }),
    null
  )
})

test('[AC-009] resolveView applies the select view rules', () => {
  assert.deepStrictEqual(VIEW_NAMES, ['agentline', 'full', 'draft'])

  assert.deepStrictEqual(resolveView({ transport: 'cli', request: { view: 'full' } }), {
    view: null,
    warnings: [],
    error: 'E_VIEW_FORBIDDEN',
  })
  assert.deepStrictEqual(resolveView({ transport: 'cli', request: {} }), {
    view: 'draft',
    warnings: [{ code: 'W_DRAFT_DEPRECATED' }],
    error: null,
  })
  assert.equal(
    resolveView({ transport: 'cli', request: { schema: 'cliworker.request/v1' } }).view,
    'agentline'
  )

  assert.equal(
    resolveView({ transport: 'http', request: { schema: 'cliworker.request/v1', view: 'full' }, hasSession: false }).error,
    'E_VIEW_FORBIDDEN'
  )
  assert.equal(
    resolveView({ transport: 'http', request: { compat: 'draft' }, hasSession: false }).error,
    'E_VIEW_FORBIDDEN'
  )
  assert.equal(
    resolveView({ transport: 'http', request: { schema: 'cliworker.request/v1', view: 'full' }, hasSession: true }).view,
    'full'
  )
  const httpDraft = resolveView({ transport: 'http', request: { compat: 'draft' }, hasSession: true })
  assert.equal(httpDraft.view, 'draft')
  assert.deepStrictEqual(httpDraft.warnings, [{ code: 'W_DRAFT_DEPRECATED' }])
  assert.equal(
    resolveView({ transport: 'http', request: { schema: 'cliworker.request/v1' }, hasSession: true }).view,
    'agentline'
  )
})

test('[AC-009] lib/contract modules are pure and import nothing', () => {
  const dir = path.join(ROOT, 'lib', 'contract')
  const registrySource = fs.readFileSync(path.join(dir, 'registry.mjs'), 'utf8')
  assert.equal(/^\s*import\s/m.test(registrySource), false)
  assert.equal(/\bfrom\s+['"]/.test(registrySource), false)

  const impure = /node:|Date\.now|new Date|setTimeout|setInterval|setImmediate|process\.env/
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.mjs') || name === 'registry.mjs') continue
    const source = fs.readFileSync(path.join(dir, name), 'utf8')
    assert.equal(impure.test(source), false, `${name} must stay pure`)
  }
})
