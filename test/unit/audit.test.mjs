import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createFakeClock } from '../helpers/clock.mjs'
import { createMemFs } from '../fixtures/store/memfs.mjs'
import {
  AUDIT_ACTIONS,
  AUDIT_ENTRIES,
  AUDIT_FILE,
  AUDIT_RESULTS,
  auditPath,
  readAudit,
  writeAudit,
} from '../../lib/audit.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const STATE = '/state'

function makeCtx() {
  const clock = createFakeClock()
  const memfs = createMemFs({ clock })
  return { ctx: { fs: memfs, clock }, clock, memfs }
}

test('[AC-030] audit-fields: every row carries at, entry, action and result', () => {
  const { ctx, memfs } = makeCtx()
  const row = writeAudit(ctx, STATE, { entry: 'cli', action: 'select', result: 'ok' })

  assert.deepEqual(Object.keys(row), ['at', 'entry', 'action', 'result'])
  assert.equal(row.at, ctx.clock.nowIso())

  const rows = readAudit(ctx, STATE)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], row)

  writeAudit(ctx, STATE, { entry: 'http', action: 'run', result: 'error', code: 'E_TIMEOUT' })
  const both = readAudit(ctx, STATE)
  assert.equal(both.length, 2)
  assert.equal(both[1].entry, 'http')
  assert.equal(both[1].code, 'E_TIMEOUT')

  assert.equal(AUDIT_FILE, 'audit.jsonl')
  assert.equal(auditPath(STATE), path.join(STATE, 'audit.jsonl'))
  assert.deepEqual(AUDIT_ENTRIES, ['cli', 'http'])
  assert.deepEqual(AUDIT_RESULTS, ['ok', 'error'])
  assert.notEqual(memfs.text(auditPath(STATE)), null)
})

test('[AC-030] audit-actions: all eight auditable actions write exactly one row each', () => {
  const { ctx } = makeCtx()

  for (const action of AUDIT_ACTIONS) writeAudit(ctx, STATE, { entry: 'cli', action, result: 'ok' })

  const rows = readAudit(ctx, STATE)
  assert.equal(rows.length, 8)
  assert.deepEqual([...new Set(rows.map((row) => row.action))], AUDIT_ACTIONS)
  for (const action of ['select', 'lease', 'run', 'probe', 'allow', 'deny', 'level', 'secret_set']) {
    assert.ok(AUDIT_ACTIONS.includes(action), `missing action ${action}`)
  }
})

test('[AC-030] audit-invalid: bad entry, action or result throws and writes nothing', () => {
  const { ctx, memfs } = makeCtx()
  const file = auditPath(STATE)

  assert.throws(() => writeAudit(ctx, STATE, { entry: 'daemon', action: 'select', result: 'ok' }), TypeError)
  assert.equal(memfs.exists(file), false)

  writeAudit(ctx, STATE, { entry: 'cli', action: 'select', result: 'ok' })
  assert.throws(() => writeAudit(ctx, STATE, { entry: 'cli', action: 'status', result: 'ok' }), TypeError)
  assert.throws(() => writeAudit(ctx, STATE, { entry: 'cli', action: 'select', result: 'partial' }), TypeError)
  assert.equal(readAudit(ctx, STATE).length, 1)
})

test('[AC-030] audit-redacts: detail and Error messages are redacted before they hit the file', () => {
  const { ctx, memfs } = makeCtx()
  const registered = 'sk-audit-1a2b3c4d5e6f7g8h'
  const inline = 'sk-live-ABCDEFGH12345678'
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4eXoifQ.c2lnbmF0dXJlLXZhbHVl'
  const bearer = 'Bearer abc.DEF-123'

  writeAudit(
    ctx,
    STATE,
    {
      entry: 'cli',
      action: 'secret_set',
      result: 'ok',
      detail: {
        nested: { key: inline },
        list: [jwt, bearer],
        registered,
        failure: new Error(`boom ${registered}`),
      },
    },
    { secrets: [registered] }
  )

  const text = memfs.text(auditPath(STATE))
  for (const needle of [registered, inline, jwt, 'abc.DEF-123']) {
    assert.equal(text.includes(needle), false, `audit file still holds ${needle}`)
  }
  assert.equal(text.includes('[REDACTED]'), true)

  const [row] = readAudit(ctx, STATE)
  assert.deepEqual(row.detail.failure, { name: 'Error', message: 'boom [REDACTED]' })
  assert.equal(row.detail.list[1], 'Bearer [REDACTED]')
})

test('[AC-030] audit-leak-scan: seven audited events leave no registered secret behind', () => {
  const { ctx, memfs } = makeCtx()
  const events = [
    ['select', 'sk-scan-select-0000000001'],
    ['lease', 'sk-scan-lease-00000000002'],
    ['run', 'sk-scan-run-000000000003'],
    ['probe', 'sk-scan-probe-00000000004'],
    ['allow', 'sk-scan-allow-00000000005'],
    ['level', 'sk-scan-level-00000000006'],
    ['secret_set', 'sk-scan-secret-0000000007'],
  ]
  const secrets = events.map(([, secret]) => secret)

  for (const [action, secret] of events) {
    writeAudit(ctx, STATE, { entry: 'cli', action, result: 'ok', detail: { note: `token ${secret}` } }, { secrets })
  }

  const text = memfs.text(auditPath(STATE))
  assert.ok(text.length > 0)
  assert.equal(text.split('\n').filter(Boolean).length, 7)
  for (const secret of secrets) assert.equal(text.split(secret).length - 1, 0)
})

test('[AC-030] audit-seams: the module has no fs import and no time primitive', () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib/audit.mjs'), 'utf8')

  for (const needle of ['node:fs', 'Date.now', 'new Date']) {
    assert.equal(source.includes(needle), false, `lib/audit.mjs must not contain ${needle}`)
  }
})
