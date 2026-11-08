// Codex session-file reader. Recognizes only the supplier's own token_count rate_limits events;
// token totals, messages and version lines never become an official quota fraction.

import { fractionFromLimit, parseJsonLines, readSessionTexts, toIsoTime } from './core.mjs'

const SHORT_WINDOW_MINUTES = 1440

function windowKind(limit, name) {
  const minutes = Number(limit && limit.window_minutes)
  if (Number.isFinite(minutes) && minutes > 0) {
    return minutes <= SHORT_WINDOW_MINUTES ? 'plan_window' : 'plan_weekly'
  }
  return name === 'secondary' ? 'plan_weekly' : 'plan_window'
}

function readingFrom(limit, at) {
  const used_fraction = fractionFromLimit(limit)
  if (used_fraction === null) return null
  return {
    used_fraction,
    reset_at: toIsoTime(limit.resets_at),
    source: 'cli',
    at,
  }
}

/** Pure parser for one session text. Returns readings grouped by the two configured windows. */
export function parseCodexSession(text) {
  const out = { plan_window: [], plan_weekly: [] }
  for (const event of parseJsonLines(text)) {
    const at = toIsoTime(event.timestamp)
    if (at === null) continue
    const limits = event.payload && event.payload.rate_limits
      ? event.payload.rate_limits
      : event.rate_limits
    if (limits === null || typeof limits !== 'object') continue
    for (const name of ['primary', 'secondary']) {
      const reading = readingFrom(limits[name], at)
      if (reading !== null) out[windowKind(limits[name], name)].push(reading)
    }
  }
  return out
}

/** Reads an explicitly provided session file or session directory through ctx.fs. */
export function readCodexReadings(ctx, target) {
  const out = { plan_window: [], plan_weekly: [] }
  for (const text of readSessionTexts(ctx, target)) {
    const parsed = parseCodexSession(text)
    out.plan_window.push(...parsed.plan_window)
    out.plan_weekly.push(...parsed.plan_weekly)
  }
  return out
}
