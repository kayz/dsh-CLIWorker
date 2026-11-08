import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { AT, TTL, TIMEOUT, INPUT, fixture, cleanup, rows, ledger, run, select, success, failure, invocation } from './select-run.test.mjs'

for (const entry of ['http', 'cli']) {
  test(`[AC-064] ${entry} staggered leases remain valid in their own windows`, async () => {
    const box = fixture()
    try {
      const selected = await select(box, entry, 3, `${entry}-sequence`)
      assert.equal(new Set(selected.models.map(m => m.lease_id)).size, 3)
      const initial = Date.parse(AT)
      for (const [i, model] of selected.models.entries()) assert.equal(model.expires_at, new Date(initial + TTL * 1000 + i * TIMEOUT).toISOString())
      for (const [i, model] of selected.models.entries()) {
        const time = initial + TTL * 1000 + i * TIMEOUT - 1000
        if (i > 0) assert.ok(time > Date.parse(selected.models[0].expires_at))
        const at = new Date(time).toISOString(), input = `${INPUT}${i}`
        fs.writeFileSync(box.clock, at, 'utf8')
        assert.equal(selected.calls[i].cwd, box.cwd)
        success(run(box, selected.calls[i], input), model.lease_id, at)
        const records = rows(box.record); assert.equal(records.length, i + 1); invocation(box, records[i], model, input)
        assert.equal(ledger(box).filter(r => r.idempotency_key === `${model.lease_id}:post`).length, 1)
      }
      for (const model of selected.models) assert.equal(ledger(box).filter(r => r.idempotency_key === `${model.lease_id}:post`).length, 1)
    } finally { cleanup(box) }
  })
  test(`[AC-064] ${entry} rejects an unconsumed lease after its final window`, async () => {
    const box = fixture()
    try {
      const selected = await select(box, entry, 3, `${entry}-expired`)
      assert.equal(new Set(selected.models.map(m => m.lease_id)).size, 3)
      for (const [i, model] of selected.models.entries()) assert.equal(model.expires_at, new Date(Date.parse(AT) + TTL * 1000 + i * TIMEOUT).toISOString())
      const model = selected.models[2], at = new Date(Date.parse(model.expires_at) + 1000).toISOString()
      fs.writeFileSync(box.clock, at, 'utf8')
      failure(run(box, selected.calls[2]), model.lease_id, at, 'E_LEASE_EXPIRED', true)
      assert.equal(rows(box.record).length, 0)
      assert.equal(ledger(box).filter(r => [`${model.lease_id}:pre`, `${model.lease_id}:post`].includes(r.idempotency_key)).length, 0)
    } finally { cleanup(box) }
  })
}
