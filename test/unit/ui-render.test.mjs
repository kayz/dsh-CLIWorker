import test from 'node:test'
import assert from 'node:assert/strict'
import { renderModels, renderModelsHtml, renderIssuesHtml } from '../../ui/render.mjs'
import { projectIssues } from '../../lib/http/issues-api.mjs'

test('model presentation preserves unknown values and escapes text', () => {
  const input = { at: '2026-01-01T00:00:00Z', models: [{ key: '<model>', provider: 'provider', availability: {} }], forecast: [] }
  const before = structuredClone(input)
  const result = renderModels(input, Date.parse('2026-01-01T00:00:00Z'))
  assert.deepEqual(result.columns, ['白名单', '等级', '可用性', '余量', '刷新时间', '实测证据'])
  assert.equal(result.rows[0].cells[0], 'unknown')
  assert.match(result.rows[0].cells[2], /^stale/)
  assert.equal(result.rows[0].cells[3], 'unknown')
  assert.match(renderModelsHtml(input, 0), /&lt;model&gt;/)
  assert.deepEqual(input, before)
})

test('issue views combine distinct events and preserve unclosed records', () => {
  const base = { task_id: 'task-a', role: 'dev', model: 'm', provider: 'p', severity: 'blocking', category: 'tool', at: '2026-01-01T00:00:00Z', summary: '<failure>', raw_output: 'failed', action: 'retry', evidence: ['sessions/log.txt', 'file:///private', 'https://example.test/evidence'], unclosed: true }
  const newer = { ...base, at: '2026-01-02T00:00:00Z' }
  const other = { ...base, task_id: 'task-b', severity: 'minor', unclosed: false }
  const first = projectIssues([], [base, newer, other])
  assert.equal(first.length, 2)
  assert.equal(first[0].count, 2)
  const again = projectIssues(first, [base, newer, other])
  assert.equal(again[0].count, 2)
  assert.equal(projectIssues(first, [other], { task_id: 'task-a', role: 'dev', severity: 'blocking' })[0].unclosed, true)
  const html = renderIssuesHtml(first, 'https://example.test')
  assert.match(html, /&lt;failure&gt;/)
  assert.match(html, /未闭环/)
  assert.match(html, /证据链接未接入/)
  assert.doesNotMatch(html, /href="file:/)
  assert.match(html, /href="https:\/\/example.test\/evidence"/)
})

test('fresh measured and assumed remaining capacity are distinct', () => {
  const model = { key: 'p/m', provider: 'p', allowed: true, level: 'High', availability: { state: 'callable', at: '2026-01-01T00:00:00Z', ttl_s: 60 } }
  const snapshot = { models: [model], forecast: [{ model: 'p/m', tasks_left: null, tasks_left_assumed: 4 }] }
  assert.equal(renderModels(snapshot, Date.parse(model.availability.at)).rows[0].cells[3], 'unknown（估计 4，assumed）')
  snapshot.forecast[0].tasks_left = 0
  assert.equal(renderModels(snapshot, Date.parse(model.availability.at)).rows[0].cells[3], '0')
  assert.equal(renderModels(snapshot, Date.parse(model.availability.at) + 61000).rows[0].cells[3], 'stale（0）')
})
