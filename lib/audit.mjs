// Audit trail: one redacted JSONL row per auditable action, appended through lib/store.mjs.

import path from 'node:path'
import { appendJsonl, readJsonl } from './store.mjs'
import { redact } from './redact.mjs'

export const AUDIT_FILE = 'audit.jsonl'

export const AUDIT_ENTRIES = ['cli', 'http']

export const AUDIT_ACTIONS = ['select', 'lease', 'run', 'probe', 'allow', 'deny', 'level', 'secret_set']

export const AUDIT_RESULTS = ['ok', 'error']

export function auditPath(stateDir) {
  return path.join(stateDir, AUDIT_FILE)
}

/**
 * Appends one audit row and returns the redacted row that was written. Invalid `entry`, `action`
 * or `result` throws before the file is touched.
 */
export function writeAudit(ctx, stateDir, event, { secrets = [] } = {}) {
  const source = event || {}
  if (!AUDIT_ENTRIES.includes(source.entry)) {
    throw new TypeError(`audit entry must be one of ${AUDIT_ENTRIES.join(', ')}: ${String(source.entry)}`)
  }
  if (!AUDIT_ACTIONS.includes(source.action)) {
    throw new TypeError(`audit action must be one of ${AUDIT_ACTIONS.join(', ')}: ${String(source.action)}`)
  }
  if (!AUDIT_RESULTS.includes(source.result)) {
    throw new TypeError(`audit result must be one of ${AUDIT_RESULTS.join(', ')}: ${String(source.result)}`)
  }

  const row = { at: ctx.clock.nowIso(), entry: source.entry, action: source.action, result: source.result }
  if (source.code !== undefined) row.code = String(source.code)
  if (source.detail !== undefined) row.detail = source.detail

  const clean = redact(row, { secrets })
  appendJsonl(ctx, auditPath(stateDir), clean)
  return clean
}

export function readAudit(ctx, stateDir) {
  return readJsonl(ctx, auditPath(stateDir))
}
