// Claude event reader. The fixture records supplier usage_limit events with a scope and a
// percentage; scope decides the pool window so a short window and a weekly limit never merge.

import { fractionFromLimit, readSessionTexts, toIsoTime } from './core.mjs'

const SHORT_SCOPES = new Set(['five_hour', '5h', 'session', 'primary', '5-hour'])
const WEEKLY_SCOPES = new Set(['seven_day', '7d', 'week', 'weekly', 'secondary'])

function scopeKind(scope) {
  const value = typeof scope === 'string' ? scope.trim().toLowerCase() : ''
  if (SHORT_SCOPES.has(value)) return 'plan_window'
  if (WEEKLY_SCOPES.has(value)) return 'plan_weekly'
  return null
}

function readingFrom(event, at) {
  const used_fraction = fractionFromLimit(event)
  if (used_fraction === null) return null
  return {
    used_fraction,
    reset_at: toIsoTime(event.resets_at),
    source: 'cli',
    at,
  }
}

function eventList(value) {
  if (Array.isArray(value)) return value
  if (value !== null && typeof value === 'object' && Array.isArray(value.events)) return value.events
  return []
}

/** Pure parser for one events document (array or {events:[...]}). */
export function parseClaudeEvents(text) {
  const out = { plan_window: [], plan_weekly: [] }
  let document = null
  try {
    document = JSON.parse(String(text ?? ''))
  } catch {
    return out
  }
  for (const event of eventList(document)) {
    if (event === null || typeof event !== 'object') continue
    if (event.type !== 'usage_limit') continue
    const kind = scopeKind(event.scope === undefined ? event.window : event.scope)
    if (kind === null) continue
    const at = toIsoTime(event.timestamp === undefined ? event.observed_at : event.timestamp)
    if (at === null) continue
    const reading = readingFrom(event, at)
    if (reading !== null) out[kind].push(reading)
  }
  return out
}

/** Reads an explicitly provided events file through ctx.fs. */
export function readClaudeReadings(ctx, target) {
  const out = { plan_window: [], plan_weekly: [] }
  for (const text of readSessionTexts(ctx, target)) {
    const parsed = parseClaudeEvents(text)
    out.plan_window.push(...parsed.plan_window)
    out.plan_weekly.push(...parsed.plan_weekly)
  }
  return out
}
