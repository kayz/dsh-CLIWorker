import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { codedError } from './output.mjs'
import { withLock, lockFilePath } from './lock.mjs'
import { atomicWriteJson, RENAME_RETRY_DELAYS_MS } from './store.mjs'

const packageFile = fileURLToPath(new URL('../package.json', import.meta.url))
const versionRe = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const backupRe = /^backup-[0-9A-Za-z.+-]+-\d{8}T\d{9}Z(-\d+)?$/
const digest = b => createHash('sha256').update(b).digest('hex')
const suffix = ctx => String(ctx.random()).replace(/[^0-9]/g, '')
const excluded = n => n === 'backups' || n === 'secrets' || n === '.state-op.json' || n.startsWith('.stage-') || n.startsWith('.health-') || /\.lock(?:\.stale-.*)?$/.test(n) || n.endsWith('.tmp')
const invalid = msg => codedError('E_REQUEST_INVALID', msg)
const internal = () => codedError('E_INTERNAL', 'Invalid or damaged backup')

export function currentVersion(ctx) {
  try { return JSON.parse(String(ctx.fs.readFileSync(packageFile, 'utf8'))).version } catch { throw codedError('E_INTERNAL', 'Unable to read application version') }
}
export function readStateVersion(ctx, dir) {
  let v
  try { v = String(ctx.fs.readFileSync(path.join(dir, 'VERSION'), 'utf8')).trim() } catch (e) { if (e.code === 'ENOENT') return null; throw e }
  if (!versionRe.test(v)) throw codedError('E_CONFIG', 'Invalid state version')
  return v
}
function files(ctx, dir, prefix = '') {
  if (!ctx.fs.existsSync(dir)) return []
  const out = []
  for (const e of ctx.fs.readdirSync(dir, { withFileTypes: true })) {
    if (excluded(e.name)) continue
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...files(ctx, path.join(dir, e.name), rel))
    else if (e.isFile()) out.push(rel)
  }
  return out.sort()
}
function put(ctx, file, bytes) { ctx.fs.mkdirSync(path.dirname(file), { recursive: true }); ctx.fs.writeFileSync(file, bytes) }
async function rename(ctx, a, b) {
  const delays = ctx.platform === 'win32' ? RENAME_RETRY_DELAYS_MS : []
  for (let i = 0;; i++) {
    try { ctx.fs.renameSync(a, b); return } catch (e) {
      if (i >= delays.length || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e
      await ctx.clock.sleep(delays[i])
    }
  }
}
async function writeAtomic(ctx, file, data) {
  const tmp = `${file}.${suffix(ctx)}.tmp`
  try { put(ctx, tmp, data); await rename(ctx, tmp, file) } finally { ctx.fs.rmSync(tmp, { force: true }) }
}
function backupDir(config, name) { return path.join(config._home, 'backups', name) }
function validateName(name) { if (typeof name !== 'string' || !backupRe.test(name) || name.includes('..')) throw invalid('Invalid backup name') }
function manifest(ctx, config, name) {
  validateName(name)
  const dir = backupDir(config, name)
  if (!ctx.fs.existsSync(dir)) throw invalid('Backup does not exist')
  try {
    const m = JSON.parse(String(ctx.fs.readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8')))
    if (m.backup_format !== 1 || !Array.isArray(m.files)) throw internal()
    const seen = new Set()
    for (const f of m.files) {
      if (typeof f.path !== 'string' || f.path.split('/').some(p => !p || p === '.' || p === '..' || excluded(p) || p.includes('\\') || p.includes(':')) || seen.has(f.path)) throw internal()
      seen.add(f.path)
      const b = ctx.fs.readFileSync(path.join(dir, 'data', ...f.path.split('/')))
      if (b.length !== f.size || digest(b) !== f.sha256) throw internal()
    }
    return m
  } catch { throw internal() }
}
async function backupLocked(ctx, config) {
  const root = path.join(config._home, 'backups')
  ctx.fs.mkdirSync(root, { recursive: true })
  const v = readStateVersion(ctx, config._home)
  const now = ctx.clock.nowIso()
  const base = `backup-${v || '0.0.0'}-${now.replace(/[-:.]/g, '')}`
  let name = base
  for (let i = 2; ctx.fs.existsSync(path.join(root, name)); i++) name = `${base}-${i}`
  const stage = path.join(root, `.stage-${suffix(ctx)}`)
  try {
    ctx.fs.mkdirSync(stage, { recursive: true })
    const entries = files(ctx, config._home).map(rel => {
      const b = ctx.fs.readFileSync(path.join(config._home, ...rel.split('/')))
      const dest = path.join(stage, 'data', ...rel.split('/'))
      put(ctx, dest, b)
      if (digest(ctx.fs.readFileSync(dest)) !== digest(b)) throw internal()
      return { path: rel, size: b.length, sha256: digest(b) }
    })
    put(ctx, path.join(stage, 'MANIFEST.json'), JSON.stringify({ backup_format: 1, state_version: v, app_version: currentVersion(ctx), created_at: now, files: entries }, null, 2) + '\n')
    await rename(ctx, stage, path.join(root, name))
    return { name, dir: path.join(root, name), files: entries.length }
  } finally { ctx.fs.rmSync(stage, { recursive: true, force: true }) }
}
async function apply(ctx, config, source, entries, versionLast = false) {
  const wanted = new Set(entries.map(f => f.path))
  for (const rel of files(ctx, config._home)) if (!wanted.has(rel)) ctx.fs.rmSync(path.join(config._home, ...rel.split('/')), { force: true })
  const ordered = [...entries].sort((a, b) => versionLast ? Number(a.path === 'VERSION') - Number(b.path === 'VERSION') : 0)
  for (const f of ordered) await writeAtomic(ctx, path.join(config._home, ...f.path.split('/')), ctx.fs.readFileSync(path.join(source, ...f.path.split('/'))))
}
async function recoverLocked(ctx, config) {
  const marker = path.join(config._home, '.state-op.json')
  if (!ctx.fs.existsSync(marker)) return null
  let op
  try { op = JSON.parse(String(ctx.fs.readFileSync(marker, 'utf8'))); if (!['restore', 'migrate'].includes(op.op)) throw internal() } catch { throw internal() }
  const m = manifest(ctx, config, op.rollback)
  await apply(ctx, config, path.join(backupDir(config, op.rollback), 'data'), m.files, true)
  ctx.fs.rmSync(marker, { force: true })
  return op.rollback
}
const locked = (ctx, config, fn) => withLock(ctx, lockFilePath(config._home), fn, { policy: config.policy })
export async function recoverPending(ctx, config) { return locked(ctx, config, () => recoverLocked(ctx, config)) }
export async function backupState(ctx, config) { return locked(ctx, config, async () => { const recovered = await recoverLocked(ctx, config); return { ...await backupLocked(ctx, config), ...(recovered ? { recovered } : {}) } }) }
export function listBackups(ctx, config) { const dir = path.join(config._home, 'backups'); return ctx.fs.existsSync(dir) ? ctx.fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && backupRe.test(e.name)).map(e => e.name).sort() : [] }
export async function restoreState(ctx, config, { from }) {
  return locked(ctx, config, async () => {
    const recovered = await recoverLocked(ctx, config)
    const m = manifest(ctx, config, from)
    const safe = await backupLocked(ctx, config)
    const marker = path.join(config._home, '.state-op.json')
    await atomicWriteJson(ctx, marker, { op: 'restore', rollback: safe.name, started_at: ctx.clock.nowIso() })
    try {
      await apply(ctx, config, path.join(backupDir(config, from), 'data'), m.files, true)
      for (const f of m.files) { const b = ctx.fs.readFileSync(path.join(config._home, ...f.path.split('/'))); if (b.length !== f.size || digest(b) !== f.sha256) throw internal() }
      ctx.fs.rmSync(marker, { force: true })
    } catch (e) { await recoverLocked(ctx, config); throw e }
    return { restored: from, files: m.files.length, state_version: readStateVersion(ctx, config._home), ...(recovered ? { recovered } : {}) }
  })
}
function compare(a, b) { const x = a.split('-')[0].split('.').map(Number); const y = b.split('-')[0].split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0 }
export async function migrateState(ctx, config, opts = {}) {
  return locked(ctx, config, async () => {
    const recovered = await recoverLocked(ctx, config)
    const original = readStateVersion(ctx, config._home)
    const target = opts.targetVersion || currentVersion(ctx)
    if (!versionRe.test(target)) throw codedError('E_CONFIG', 'Invalid target version')
    const from = original || (files(ctx, config._home).length ? '0.0.0' : null)
    if (from && compare(from, target) > 0) throw invalid('State is newer than this program; use state restore or upgrade the program')
    const extra = recovered ? { recovered } : {}
    if (from && compare(from, target) === 0) return { migrated: false, from, to: target, backup: null, ...extra }
    if (!from) { await writeAtomic(ctx, path.join(config._home, 'VERSION'), `${target}\n`); return { migrated: true, from: null, to: target, backup: null, ...extra } }
    const backup = await backupLocked(ctx, config)
    const stage = path.join(config._home, `.stage-${suffix(ctx)}`)
    const marker = path.join(config._home, '.state-op.json')
    try {
      await atomicWriteJson(ctx, marker, { op: 'migrate', rollback: backup.name, started_at: ctx.clock.nowIso() })
      ctx.fs.mkdirSync(stage, { recursive: true })
      const m = manifest(ctx, config, backup.name)
      for (const f of m.files) put(ctx, path.join(stage, ...f.path.split('/')), ctx.fs.readFileSync(path.join(backup.dir, 'data', ...f.path.split('/'))))
      for (const step of opts.steps || []) await step.run(ctx, stage)
      put(ctx, path.join(stage, 'VERSION'), `${target}\n`)
      await apply(ctx, config, stage, files(ctx, stage).map(p => ({ path: p })), true)
      ctx.fs.rmSync(marker, { force: true })
    } catch (e) { if (ctx.fs.existsSync(marker)) await recoverLocked(ctx, config); throw e } finally { ctx.fs.rmSync(stage, { recursive: true, force: true }) }
    return { migrated: true, from, to: target, backup: backup.name, ...extra }
  })
}
