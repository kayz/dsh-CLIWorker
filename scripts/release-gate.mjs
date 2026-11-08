#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateIndex, mergeShards } from './check-traceability.mjs'
import { validateReport } from '../test/smoke/report.mjs'

const rootDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const allowed = new Set(['--root', '--index', '--ci-artifacts', '--smoke-report', '--waivers'])
const opts = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1]
  if (!allowed.has(key) || !value || value.startsWith('--') || opts[key]) {
    console.error('invalid arguments')
    process.exit(2)
  }
  opts[key] = path.resolve(value)
}
if (!opts['--ci-artifacts'] || !opts['--smoke-report'] || !opts['--waivers']) {
  console.error('missing required arguments')
  process.exit(2)
}
const root = opts['--root'] ?? rootDefault
const general = [], issues = new Map(), notes = new Map()
const issue = (ac, msg) => issues.set(ac, [...(issues.get(ac) ?? []), msg])
const note = (ac, msg) => notes.set(ac, [...(notes.get(ac) ?? []), msg])
function json(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch { general.push(`${label} missing or invalid: ${file}`); return null }
}
const indexFile = opts['--index'] ?? path.join(root, 'contracts/spec/ac-index.json')
const index = json(indexFile, 'index')
const pkg = json(path.join(root, 'package.json'), 'package')
if (!pkg || typeof pkg.version !== 'string' || !pkg.version.trim() || typeof pkg.engines?.node !== 'string') general.push('package version or node requirement invalid')
const acs = Array.isArray(index?.acs) ? index.acs.filter(e => e && typeof e.ac === 'string' && Array.isArray(e.baseline)) : []
const byAc = new Map(acs.map(e => [e.ac, e]))
if (index) {
  for (const err of validateIndex(index)) general.push(`index ${err.id} ${err.ac ?? ''}`)
  if (Array.isArray(index.acs)) {
    const merged = mergeShards({ root, index })
    for (const err of merged.errors) general.push(`trace ${err.id} ${err.ac ?? err.file ?? ''}`)
    for (const entry of acs) if (merged.acs[entry.ac] !== 'covered') issue(entry.ac, 'trace planned or missing')
  }
} else {
  general.push('index invalid structure')
}
const files = new Map()
function safeFile(file) {
  if (typeof file !== 'string' || !file || path.win32.isAbsolute(file) || path.posix.isAbsolute(file) || file.replaceAll('\\', '/').split('/').some(part => part === '..' || part === '')) return false
  try {
    const base = fs.realpathSync(root), resolved = fs.realpathSync(path.resolve(root, file))
    const rel = path.relative(base, resolved)
    return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
  } catch { return false }
}
try {
  const dir = path.join(root, 'test/traceability')
  const names = fs.readdirSync(dir).filter(n => n.endsWith('.json'))
  if (!names.length) general.push('trace no shards')
  for (const name of names) {
    const shard = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
    for (const e of shard.entries ?? []) if (e.status === 'covered' && Array.isArray(e.files)) {
      if (e.files.some(f => !safeFile(f))) issue(e.ac, 'trace file unsafe or missing')
      else files.set(e.ac, e.files.map(f => f.replaceAll('\\', '/')))
    }
  }
} catch { general.push('trace missing or invalid shards') }
const waivers = json(opts['--waivers'], 'waivers')
const active = new Set(), seen = new Set()
if (waivers === null) general.push('waivers must be an array')
if (waivers !== null && !Array.isArray(waivers)) general.push('waivers must be an array')
for (const w of Array.isArray(waivers) ? waivers : []) {
  if (!w || typeof w !== 'object' || Array.isArray(w) || Object.keys(w).sort().join(',') !== 'ac,approved_by,reason,version' || !['ac', 'approved_by', 'reason', 'version'].every(k => typeof w[k] === 'string' && w[k].trim())) { general.push('waivers invalid fields'); continue }
  const key = `${w.ac}\0${w.version}`
  if (seen.has(key)) { general.push(`waivers duplicate ${w.ac}`); issue(w.ac, 'duplicate waiver') }
  seen.add(key)
  const entry = byAc.get(w.ac)
  if (!entry) { general.push(`waivers unknown ${w.ac}`); continue }
  if (!entry.baseline.includes('real-smoke')) { issue(w.ac, 'waiver not allowed for baseline'); continue }
  if (w.version === pkg?.version) active.add(w.ac)
  else note(w.ac, 'waiver version not applicable')
}
let smoke = null, smokeMissing = false
try { smoke = JSON.parse(fs.readFileSync(opts['--smoke-report'], 'utf8')) }
catch (e) { if (e.code === 'ENOENT') smokeMissing = true; else general.push('smoke report invalid') }
if (!smokeMissing && !smoke) {
  general.push('smoke report invalid')
  for (const e of acs.filter(e => e.baseline.includes('real-smoke'))) issue(e.ac, 'invalid smoke report')
}
if (smoke) {
  if (!validateReport(smoke, pkg?.version).ok || smoke.mode !== 'real') {
    general.push('smoke report invalid, unredacted, wrong version or not real')
    for (const e of acs.filter(e => e.baseline.includes('real-smoke'))) issue(e.ac, 'invalid smoke report')
  } else {
    for (const step of smoke.steps) if (step.status === 'fail' || (step.mandatory && step.status === 'skip')) {
      general.push('smoke report contains fail or mandatory skip')
      for (const ac of step.ac) issue(ac, `smoke ${step.id} ${step.status}`)
    }
  }
}
for (const entry of acs.filter(e => e.baseline.includes('real-smoke'))) {
  if (smokeMissing) {
    if (!active.has(entry.ac)) issue(entry.ac, 'smoke report missing')
    else note(entry.ac, 'smoke report missing; waiver applies')
  } else if (smoke && validateReport(smoke, pkg?.version).ok && smoke.mode === 'real') {
    const steps = smoke.steps.filter(s => s.ac.includes(entry.ac))
    if ((!steps.length || steps.some(s => s.status !== 'pass')) && !active.has(entry.ac)) issue(entry.ac, 'smoke matching pass missing')
    else note(entry.ac, `smoke report ${opts['--smoke-report']}`)
  }
}

// Only leaf results can prove an AC. Diagnostic blocks are never searched for titles.
function parseTap(text, manifest) {
  const lines = text.split(/\r?\n/), results = [], scopes = new Map(), counts = new Map(), children = new Set()
  let diag = false, last = null, invalid = !/^TAP version 13\s*$/.test(lines[0] ?? '')
  let rootPlan = false
  const summary = {}
  for (const line of lines.slice(1)) {
    const indent = line.match(/^ */)[0].length, body = line.slice(indent)
    if (diag) {
      if (body === '...') { diag = false; continue }
      const location = /^location:\s*['"]?(.+?):\d+:\d+['"]?\s*$/.exec(body)
      if (location && last) last.location = location[1].replaceAll('\\\\', '/').replaceAll('\\', '/')
      continue
    }
    if (body === '---') { diag = true; continue }
    let m = /^# Subtest: (.*)$/.exec(body)
    if (m) { scopes.set(indent, m[1]); continue }
    m = /^1\.\.(\d+)(?:\s*#.*)?$/.exec(body)
    if (m) {
      if (Number(m[1]) !== (counts.get(indent) ?? 0)) invalid = true
      counts.delete(indent)
      if (indent === 0) rootPlan = true
      continue
    }
    m = /^(not ok|ok) (\d+) - (.*)$/.exec(body)
    if (m) {
      const number = Number(m[2]); counts.set(indent, (counts.get(indent) ?? 0) + 1)
      if (indent === 0 && rootPlan) invalid = true
      if (number !== counts.get(indent)) invalid = true
      const title = m[3], isSuite = children.has(indent)
      if (scopes.get(indent) !== title.replace(/\s+#\s*(?:SKIP|TODO)\b.*$/i, '')) invalid = true
      children.delete(indent)
      for (const level of scopes.keys()) if (level < indent) children.add(level)
      let file = null
      for (const [level, name] of [...scopes].sort((a, b) => b[0] - a[0])) if (level < indent) {
        const normalized = name.replaceAll('\\', '/')
        file = manifest.files.find(f => normalized === f || normalized.endsWith('/' + f)) ?? file
      }
      last = { title, file, status: /\s#\s*(?:SKIP|TODO)\b/i.test(title) ? 'skip' : m[1] === 'not ok' ? 'fail' : 'pass', suite: isSuite }
      results.push(last)
      for (const level of scopes.keys()) if (level >= indent) scopes.delete(level)
      continue
    }
    m = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/.exec(body)
    if (indent === 0 && m) summary[m[1]] = Number(m[2])
    if (indent === 0 && /^# duration_ms \d+(?:\.\d+)?\s*$/.test(body)) summary.duration = true
  }
  if (diag || !rootPlan || counts.size || !summary.tests || !summary.duration || ['pass', 'fail', 'cancelled', 'skipped', 'todo'].some(k => summary[k] === undefined) || summary.cancelled !== 0 || summary.tests !== summary.pass + summary.fail + summary.cancelled + summary.skipped + summary.todo) invalid = true
  for (const r of results) if (!r.file && r.location) r.file = manifest.files.find(f => r.location === f || r.location.endsWith('/' + f)) ?? null
  return { results, invalid, failed: summary.fail !== 0 || results.some(r => r.status === 'fail') }
}
const jobs = []
try {
  const dirs = fs.readdirSync(opts['--ci-artifacts'], { withFileTypes: true }).filter(x => x.isDirectory())
  if (!dirs.length) general.push('ci artifacts empty')
  for (const dir of dirs) {
    const base = path.join(opts['--ci-artifacts'], dir.name)
    let manifest, tap, skips
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(base, 'files-executed.json'), 'utf8'))
      tap = fs.readFileSync(path.join(base, 'reporter.tap'), 'utf8')
      skips = fs.readFileSync(path.join(base, 'skips.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(s => JSON.parse(s))
    } catch { general.push(`ci job ${dir.name} missing or invalid evidence`); continue }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) { general.push(`ci job ${dir.name} invalid manifest`); continue }
    const min = /^\s*>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(pkg?.engines?.node ?? '')
    const node = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(manifest.node ?? '')
    const nodeOk = node && min && ([1, 2, 3].map(i => Number(node[i]) - Number(min[i] ?? 0)).find(n => n !== 0) ?? 0) >= 0
    if (manifest.mode !== 'full' || manifest.filter !== '' || !['win32', 'linux', 'darwin'].includes(manifest.platform) || !nodeOk || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.some(f => typeof f !== 'string' || !f || path.win32.isAbsolute(f) || path.posix.isAbsolute(f) || f.replaceAll('\\', '/').split('/').some(part => part === '..' || part === ''))) { general.push(`ci job ${dir.name} invalid manifest`); continue }
    manifest.files = manifest.files.map(f => f.replaceAll('\\', '/'))
    const parsed = parseTap(tap, manifest)
    if (parsed.invalid) general.push(`ci job ${dir.name} invalid or incomplete TAP`)
    if (parsed.failed) general.push(`ci job ${dir.name} test failure`)
    for (const s of skips) {
      if (!s || s.schema !== 'cliworker.skip/v1' || s.platform !== manifest.platform || s.node !== manifest.node || !manifest.files.includes(s.file) || typeof s.test !== 'string' || !s.test || (s.ac !== null && (!byAc.has(s.ac) || !s.test.includes(`[${s.ac}]`))) || typeof s.reason !== 'string' || !s.reason || typeof s.requires !== 'string' || !s.requires) { general.push(`ci job ${dir.name} invalid skip record`); continue }
      if (!parsed.results.some(r => !r.suite && r.file === s.file && r.status === 'skip' && r.title.includes(s.test))) general.push(`ci job ${dir.name} skip conflict`)
    }
    jobs.push({ name: dir.name, manifest, ...parsed })
  }
} catch { general.push('ci artifacts missing or unreadable') }
for (const entry of acs) {
  for (const os of entry.baseline.filter(b => b !== 'real-smoke')) {
    const candidates = jobs.filter(j => j.manifest.platform === os && !j.invalid && (files.get(entry.ac) ?? []).length && files.get(entry.ac).every(f => j.manifest.files.includes(f) && j.results.some(r => !r.suite && r.file === f)))
    const proof = candidates.find(j => j.results.some(r => !r.suite && r.status === 'pass' && (files.get(entry.ac) ?? []).includes(r.file) && r.title.includes(`[${entry.ac}]`)))
    if (!proof) issue(entry.ac, `${os} missing executed file or actual pass`)
    else note(entry.ac, `${os} job ${proof.name}`)
    if (jobs.some(j => j.manifest.platform === os && j.results.some(r => !r.suite && r.status === 'fail' && r.title.includes(`[${entry.ac}]`)))) issue(entry.ac, `${os} test failed`)
  }
}
for (const g of general) console.log(`BLOCKED ${g}`)
for (const e of acs) {
  const problems = issues.get(e.ac) ?? []
  const status = problems.length ? 'BLOCKED' : active.has(e.ac) ? 'WAIVED' : 'PASS'
  console.log(`${status} ${e.ac} baseline=${e.baseline.join(',')} version=${pkg?.version ?? 'unknown'} ${[...problems, ...(notes.get(e.ac) ?? [])].join('; ') || 'covered'}`)
}
const blocked = general.length > 0 || [...issues.values()].some(x => x.length)
console.log(`release-gate: ${blocked ? 'BLOCKED' : 'PASS'}`)
process.exitCode = blocked ? 1 : 0
