// No production issue source is currently defined. These helpers accept explicit
// records only and never inspect local files or infer issues from logs.
const priority = { blocking: 0, major: 1, minor: 2 }

import { createHash } from 'node:crypto'
import path from 'node:path'
import { parseVersion } from '../discovery/probe.mjs'
import { RULES } from '../discovery/rules.mjs'
import { resolveSecret } from '../secrets/index.mjs'
import { redactString } from '../redact.mjs'
import { codedError } from '../output.mjs'

const safe = value => typeof value === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/.test(value) && !/^[A-Za-z]:/.test(value) && redactString(value) === value ? value : null
const validTime = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value))
const version = value => typeof value === 'string' && parseVersion(value) === value ? value : null

export function compareVersions(a, b) {
  if (!version(a) || !version(b)) return null
  const parts = value => { const plain = value.split('+')[0], dash = plain.indexOf('-'); return [(dash < 0 ? plain : plain.slice(0, dash)).split('.').map(BigInt), dash < 0 ? undefined : plain.slice(dash + 1).split('.')] }
  const [ac, ap] = parts(a), [bc, bp] = parts(b)
  for (let i = 0; i < 3; i++) if (ac[i] !== bc[i]) return ac[i] < bc[i] ? -1 : 1
  if (!ap || !bp) return ap === bp ? 0 : ap ? -1 : 1
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === undefined || bp[i] === undefined) return ap[i] === undefined ? -1 : 1
    if (ap[i] === bp[i]) continue
    const an = /^\d+$/.test(ap[i]), bn = /^\d+$/.test(bp[i])
    if (an && bn) return BigInt(ap[i]) < BigInt(bp[i]) ? -1 : 1
    if (an !== bn) return an ? -1 : 1
    return ap[i] < bp[i] ? -1 : 1
  }
  return 0
}

export function projectProbeIssues({ probes, inventory, config, ctx, rules = RULES, at }) {
  const issues = [], seen = new Set(), secrets = new Map()
  for (const rule of rules) if (Object.hasOwn(rule, 'minVersion') && !version(rule.minVersion)) throw codedError('E_CONFIG', 'invalid minimum version')
  const add = (kind, subject, detail, ref, stamp, identity = ref) => {
    if (!subject || !validTime(stamp)) return
    const key = JSON.stringify([kind, subject, identity])
    if (seen.has(key)) return
    seen.add(key)
    issues.push({ id: createHash('sha256').update(key).digest('hex'), kind, subject, detail, evidence_ref: ref, at: stamp })
  }
  const credential = (model, subject, ref) => {
    const provider = model.provider
    if (typeof provider === 'string' && Object.hasOwn(config.secrets || {}, provider)) {
      if (!secrets.has(provider)) secrets.set(provider, resolveSecret(ctx, config, provider))
      if (!secrets.get(provider)) add('missing-credential', subject, 'configured credential missing', ref, at, provider)
    }
  }
  for (const model of probes) {
    const subject = safe(path.win32.basename(path.posix.basename(model.cli)).replace(/\.(?:exe|com|cmd|bat)$/i, ''))
    const key = safe(model.key), probeId = safe(model.availability.evidence.probe_id)
    if (!subject || !key || !probeId || !validTime(model.availability.at)) continue
    const ref = `probes.json#${encodeURIComponent(key)}/${encodeURIComponent(probeId)}`
    const { state, reason, at: observed } = model.availability
    if ((state === 'unverified' && ['command missing', 'non-zero exit', 'unparsable output'].includes(reason)) || (state === 'unavailable' && ['timeout', 'unavailable'].includes(reason)) || (state === 'blocked' && reason === 'auth')) add('unavailable', subject, reason, ref, observed)
    credential(model, subject, ref)
  }
  for (const entry of inventory?.entries || []) {
    const subject = safe(entry.id), platform = safe(entry.platform)
    for (const e of entry.evidence || []) {
      if (!subject || !platform || e.kind !== 'probe' || !validTime(e.at) || !/^[a-f0-9]{64}$/.test(e.digest)) continue
      const ref = `inventory.json#${encodeURIComponent(subject)}/${encodeURIComponent(platform)}/${e.digest}/${encodeURIComponent(e.at)}`
      for (const model of config.catalog?.manual || []) {
        const cli = typeof model.cli === 'string' ? safe(path.win32.basename(path.posix.basename(model.cli)).replace(/\.(?:exe|com|cmd|bat)$/i, '')) : null
        if (cli === subject) credential(model, subject, ref)
      }
      if (e.exit === null) add('unavailable', subject, 'unavailable', ref, e.at)
      else if (e.exit !== 0) add('unavailable', subject, 'non-zero exit', ref, e.at)
      const rule = rules.find(item => item.name === subject)
      if (e.exit === 0 && version(entry.version) && version(rule?.minVersion) && compareVersions(entry.version, rule.minVersion) < 0) add('version-mismatch', subject, `observed ${entry.version}; minVersion ${rule.minVersion}`, ref, e.at)
    }
  }
  return issues
}

export function projectIssues(previous, records, filters = {}) {
  const groups = new Map()
  const add = (record, retained = false) => {
    const key = JSON.stringify([record.task_id, record.code || record.category])
    let group = groups.get(key)
    if (!group) {
      group = { ...structuredClone(record), count: 0, events: [] }
      groups.set(key, group)
    }
    const events = retained ? record.events : [JSON.stringify(record)]
    for (const event of events || []) if (!group.events.includes(event)) group.events.push(event)
    group.count = group.events.length
    if (record.unclosed) group.unclosed = true
    if (String(record.at) > String(group.at)) {
      const { count, events, unclosed } = group
      Object.assign(group, structuredClone(record), { count, events, unclosed })
    }
  }
  for (const record of previous || []) if (record.unclosed) add(record, true)
  for (const record of records || []) add(record)
  return [...groups.values()].filter(item => ['task_id', 'role', 'severity'].every(key => !filters[key] || item[key] === filters[key]))
    .sort((a, b) => (priority[a.severity] ?? 3) - (priority[b.severity] ?? 3) || String(b.at).localeCompare(String(a.at)))
}
