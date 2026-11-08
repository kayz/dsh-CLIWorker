import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { renderModels, renderModelsHtml, renderIssuesHtml } from '../../ui/render.mjs'
import { projectIssues } from '../../lib/http/issues-api.mjs'

test('[AC-062] model presentation preserves unknown values and escapes text', () => {
  const input = { at: '2026-01-01T00:00:00Z', models: [{ key: '<model>', provider: 'provider', availability: {} }], forecast: [] }
  const before = structuredClone(input)
  const result = renderModels(input, Date.parse('2026-01-01T00:00:00Z'))
  assert.deepEqual(result.columns, ['白名单', '等级', '可用性', '余量', '刷新时间', '实测证据'])
  assert.equal(result.rows[0].cells[0], 'unknown')
  assert.match(result.rows[0].cells[2], /^stale/)
  assert.equal(result.rows[0].cells[3], 'unknown')
  assert.match(renderModelsHtml(input, 0), /&lt;model&gt;/)
  assert.match(result.rows[0].cells[4], /观测 unknown/)
  assert.match(result.rows[0].cells[5], /source unknown；at unknown/)
  assert.doesNotMatch(result.rows[0].cells.join(' '), /(?:^|\s)(?:0|100%)(?:\s|$)/)
  assert.deepEqual(input, before)
})

test('[AC-062] [AC-077] issue views combine distinct events and preserve unclosed records', () => {
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

test('[AC-062] fresh measured and assumed remaining capacity are distinct', () => {
  const model = { key: 'p/m', provider: 'p', allowed: true, level: 'High', availability: { state: 'callable', at: '2026-01-01T00:00:00Z', ttl_s: 60 } }
  const snapshot = { models: [model], forecast: [{ model: 'p/m', tasks_left: null, tasks_left_assumed: 4 }] }
  assert.equal(renderModels(snapshot, Date.parse(model.availability.at)).rows[0].cells[3], 'unknown（估计 4，assumed）')
  assert.equal(renderModels(snapshot, Date.parse(model.availability.at)).rows[0].cells[2], 'unknown')
  model.availability.evidence = { exit: 0 }
  assert.equal(renderModels(snapshot, Date.parse(model.availability.at)).rows[0].cells[2], 'callable')
  snapshot.forecast[0].tasks_left = 0
  assert.equal(renderModels(snapshot, Date.parse(model.availability.at)).rows[0].cells[3], '0')
  assert.equal(renderModels(snapshot, Date.parse(model.availability.at) + 61000).rows[0].cells[3], 'stale（0）')
  snapshot.forecast[0] = { model: 'p/m', tasks_left: null, remaining_fraction: 1 }
  model.source = { kind: 'manual' }
  const cells = renderModels(snapshot, Date.parse(model.availability.at)).rows[0].cells
  assert.equal(cells[3], '100%')
  snapshot.forecast[0] = { model: 'p/m', tasks_left: null, remaining_fraction: 0.29 }
  assert.equal(renderModels(snapshot, Date.parse(model.availability.at)).rows[0].cells[3], '29%')
  snapshot.forecast[0].remaining_fraction = 0.57
  assert.equal(renderModels(snapshot, Date.parse(model.availability.at)).rows[0].cells[3], '57%')
  assert.match(cells[5], /source manual；at 2026-01-01T00:00:00Z/)
})

test('[AC-062] [AC-077] issue fixture sorts, filters, expands evidence and retains unclosed records', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/ui/issues.json', import.meta.url), 'utf8'))
  const rows = projectIssues([], fixture)
  assert.deepEqual(rows.map(row => row.task_id), ['task-b', 'task-a', 'task-c', 'task-d'])
  assert.equal(rows[1].count, 2)
  const filtered = projectIssues([], fixture, { task_id: 'task-a', role: 'dev', severity: 'blocking' })
  assert.deepEqual(filtered.map(row => row.task_id), ['task-a'])
  assert.deepEqual(projectIssues([], fixture, { task_id: 'task-a', role: 'reviewer', severity: 'blocking' }), [])
  const retained = projectIssues(rows, [])
  assert.equal(retained.length, 1)
  assert.equal(retained[0].count, 2)
  const html = renderIssuesHtml(retained, 'https://example.test')
  for (const text of ['<details>', 'failed again', 'logs/output.txt', 'retry', '未闭环', '证据链接未接入']) assert.ok(html.includes(text))
  assert.doesNotMatch(html, /href="(?:file:|logs\/)/)
  assert.equal(projectIssues(retained, fixture)[1].count, 2)
})
