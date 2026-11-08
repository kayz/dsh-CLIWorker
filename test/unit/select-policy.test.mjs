import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { selectPolicy, selectPolicyDetailed } from '../../lib/policy.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const GOLDEN_DIR = path.join(ROOT, 'contracts', 'golden', 'policy')

function goldenCases() {
  const cases = []
  for (const file of fs.readdirSync(GOLDEN_DIR).filter((name) => name.endsWith('.json')).sort()) {
    const fixture = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, file), 'utf8'))
    for (const item of fixture.cases) cases.push({ file, ...item })
  }
  return cases
}

function pool(id, overrides = {}) {
  return {
    id,
    funding: 'plan',
    remaining_mtok: 5,
    cap_mtok: 10,
    reset_in_h: 1,
    reset_at: '2026-11-07T05:00:00.000Z',
    ...overrides,
  }
}

function candidate(key, poolIds, overrides = {}) {
  return { key, pool_ids: poolIds, price: 1, identity_group: null, ...overrides }
}

test('[AC-051] the six policy goldens match exactly', () => {
  const cases = goldenCases()
  assert.equal(cases.length, 6, 'expected the six golden cases')
  for (const item of cases) {
    assert.deepStrictEqual(
      selectPolicy(item.input),
      item.expected,
      `${item.file}#${item.id}`
    )
  }
})

test('[AC-051] an urgency denominator is floored at 0.25 hours', () => {
  const result = selectPolicy({
    est_mtok: 1,
    count: 1,
    importance: 'high',
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0.15 },
    pools: [
      pool('pa', { remaining_mtok: 3, reset_in_h: 0 }),
      pool('pb', { remaining_mtok: 3, reset_in_h: 1 }),
    ],
    candidates: [candidate('a', ['pa']), candidate('b', ['pb'])],
  })
  assert.deepStrictEqual(result.selected, [{ key: 'a', funding: 'plan' }])
})

test('[AC-051] the most urgent pool decides a multi-pool candidate', () => {
  const result = selectPolicy({
    est_mtok: 1,
    count: 1,
    importance: 'high',
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0.15 },
    pools: [
      pool('p1', { remaining_mtok: 10, reset_in_h: 1 }),
      pool('p2', { remaining_mtok: 1, reset_in_h: 1 }),
      pool('p3', { remaining_mtok: 5, reset_in_h: 1 }),
    ],
    candidates: [
      candidate('x', ['p1', 'p2']),
      candidate('y', ['p3']),
    ],
  })
  assert.deepStrictEqual(result.selected, [{ key: 'y', funding: 'plan' }])
})

test('[AC-051] equal urgency breaks ties by price then key', () => {
  const result = selectPolicy({
    est_mtok: 1,
    count: 2,
    importance: 'high',
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0.15 },
    pools: [pool('p', { remaining_mtok: 5, reset_in_h: 1 })],
    candidates: [
      candidate('b', ['p'], { price: 2 }),
      candidate('a', ['p'], { price: 2 }),
      candidate('c', ['p'], { price: 1 }),
    ],
  })
  assert.deepStrictEqual(result.selected, [
    { key: 'c', funding: 'plan' },
    { key: 'a', funding: 'plan' },
  ])
})

test('[AC-051] selections accumulate a shared pool reservation', () => {
  const result = selectPolicy({
    est_mtok: 1,
    count: 2,
    importance: 'high',
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0.15 },
    pools: [pool('p', { remaining_mtok: 1.5, cap_mtok: 10, reset_in_h: 1 })],
    candidates: [candidate('a', ['p']), candidate('b', ['p'])],
  })
  assert.deepStrictEqual(result.selected, [{ key: 'a', funding: 'plan' }])
  assert.deepStrictEqual(result.rejected, [{ key: 'b', reason: 'quota_low' }])
})

test('[AC-051] a shared pool converts reservations by each model capacity', () => {
  const result = selectPolicy({
    est_mtok: 1,
    count: 2,
    importance: 'high',
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0.15 },
    pools: [],
    candidates: [
      { ...candidate('a', []), pools: [pool('shared', { remaining_mtok: 1.5, cap_mtok: 10, reset_in_h: 1 })] },
      { ...candidate('b', []), pools: [pool('shared', { remaining_mtok: 3, cap_mtok: 20, reset_in_h: 2 })] },
    ],
  })
  // a consumes 0.1 of the pool; b sees 3 - 0.1*20 = 1 Mtok left, exactly enough.
  assert.deepStrictEqual(result.selected, [
    { key: 'a', funding: 'plan' },
    { key: 'b', funding: 'plan' },
  ])
  assert.deepStrictEqual(result.rejected, [])
})

test('[AC-053] an empty candidate list is not a quota rejection', () => {
  const detailed = selectPolicyDetailed({ est_mtok: 1, count: 2, candidates: [] })
  assert.deepStrictEqual(detailed.selected, [])
  assert.deepStrictEqual(detailed.rejected, [])
  assert.equal(detailed.retry_after, null)
})

test('[AC-053] quota rejections keep the earliest reset of the pools that refused', () => {
  const detailed = selectPolicyDetailed({
    est_mtok: 1,
    count: 1,
    importance: 'high',
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0.15 },
    pools: [
      pool('late', { remaining_mtok: 0.5, reset_at: '2026-11-07T15:00:00.000Z' }),
      pool('early', { remaining_mtok: 0.4, reset_at: '2026-11-07T14:00:00.000Z' }),
    ],
    candidates: [candidate('a', ['late']), candidate('b', ['early'])],
  })
  assert.deepStrictEqual(detailed.selected, [])
  assert.deepStrictEqual(detailed.rejected.map((item) => item.reason), ['quota_low', 'quota_low'])
  assert.equal(detailed.retry_after, '2026-11-07T14:00:00.000Z')
})

test('[AC-053] reserve protection is distinct from quota_low', () => {
  const normal = selectPolicyDetailed({
    est_mtok: 1,
    count: 1,
    importance: 'normal',
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0.15 },
    pools: [pool('p', { remaining_mtok: 1.2, cap_mtok: 10 })],
    candidates: [candidate('a', ['p'])],
  })
  assert.deepStrictEqual(normal.rejected, [{ key: 'a', reason: 'reserve_protected', pools: ['p'] }])

  const high = selectPolicyDetailed({
    est_mtok: 1,
    count: 1,
    importance: 'high',
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0.15 },
    pools: [pool('p', { remaining_mtok: 1.2, cap_mtok: 10 })],
    candidates: [candidate('a', ['p'])],
  })
  assert.deepStrictEqual(high.selected, [{ key: 'a', funding: 'plan' }])
})

test('[AC-053] an unknown plan pool follows the configured policy', () => {
  const pools = [pool('known', { remaining_mtok: 5 }), pool('unknown', { remaining_mtok: null })]
  const candidates = [candidate('a', ['known']), candidate('u', ['unknown'])]
  const afterKnown = selectPolicyDetailed({
    est_mtok: 1,
    count: 2,
    importance: 'high',
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0.15 },
    pools,
    candidates,
  })
  assert.deepStrictEqual(afterKnown.selected.map((item) => item.key), ['a', 'u'])
  assert.deepStrictEqual(afterKnown.rejected, [])

  const rejected = selectPolicyDetailed({
    est_mtok: 1,
    count: 2,
    importance: 'high',
    policy: { unknown_policy: 'reject', reserve_fraction_for_high: 0.15 },
    pools,
    candidates,
  })
  assert.deepStrictEqual(rejected.selected, [{ key: 'a', funding: 'plan' }])
  assert.deepStrictEqual(rejected.rejected, [{ key: 'u', reason: 'quota_unknown_policy', pools: ['unknown'] }])
})

test('[AC-053] a known insufficient pool is never masked by an unknown one', () => {
  const result = selectPolicy({
    est_mtok: 1,
    count: 1,
    importance: 'high',
    policy: { unknown_policy: 'after_known', reserve_fraction_for_high: 0.15 },
    pools: [pool('low', { remaining_mtok: 0.2 }), pool('unknown', { remaining_mtok: null })],
    candidates: [candidate('a', ['low', 'unknown'])],
  })
  assert.deepStrictEqual(result, { selected: [], rejected: [{ key: 'a', reason: 'quota_low' }] })
})
