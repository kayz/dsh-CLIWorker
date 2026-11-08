// File lock over ctx.fs and ctx.clock only: the wait loop sleeps through ctx.clock.sleep, so a
// fake clock can drive it without touching real timers.

import path from 'node:path'
import { codedError } from './output.mjs'

export const LOCK_DEFAULTS = { lock_stale_ms: 30000, lock_wait_ms: 5000, lock_poll_ms: 50 }

const NAME_RE = /^[A-Za-z0-9._-]+$/

// A lock file that is being created or renamed is briefly unreadable on Windows; that is a
// transient "someone holds it" signal, not a reason to fail.
const TRANSIENT_READ_CODES = ['EPERM', 'EACCES', 'EBUSY']

const GONE = Symbol('gone')
const BUSY = Symbol('busy')

/** The lock file next to the state it guards. */
export function lockFilePath(stateDir, name = 'state') {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new TypeError(`lock name must match ${NAME_RE}: ${String(name)}`)
  }
  return path.join(stateDir, `${name}.lock`)
}

/** Best-effort process liveness: EPERM means the process exists but is not ours. */
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error && error.code === 'ESRCH')
  }
}

function policyValue(policy, key) {
  const source = policy || {}
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : LOCK_DEFAULTS[key]
}

function randomSuffix(ctx) {
  const value = Number(ctx.random())
  const text = Number.isFinite(value) ? value.toString(36) : '0'
  const dot = text.indexOf('.')
  const fraction = dot < 0 ? text : text.slice(dot + 1)
  return fraction === '' ? '0' : fraction
}

function makeToken(ctx, pid, at) {
  return `${pid}-${at}-${randomSuffix(ctx)}`
}

function readLockState(ctx, lockPath) {
  let raw
  try {
    raw = ctx.fs.readFileSync(lockPath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }

  let parsed = null
  try {
    const value = JSON.parse(String(raw))
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value
  } catch {
    parsed = null
  }

  let mtimeMs = null
  try {
    const stat = ctx.fs.statSync(lockPath)
    if (stat && typeof stat.mtimeMs === 'number' && Number.isFinite(stat.mtimeMs)) mtimeMs = stat.mtimeMs
  } catch {
    mtimeMs = null
  }

  return { parsed, mtimeMs }
}

/**
 * Reads the holder state, mapping a missing file to GONE and a momentarily unreadable file to
 * BUSY, which is handled like a live lock.
 */
function readLockStateOrNull(ctx, lockPath) {
  try {
    const state = readLockState(ctx, lockPath)
    return state === null ? GONE : state
  } catch (error) {
    if (isTransientReadError(error)) return BUSY
    throw error
  }
}

function tryCreate(ctx, lockPath, payload) {
  try {
    ctx.fs.writeFileSync(lockPath, JSON.stringify(payload), { encoding: 'utf8', flag: 'wx' })
    return true
  } catch (error) {
    if (error && error.code === 'EEXIST') return false
    // On Windows an exclusive create can lose to a lock file that another process just deleted:
    // while the name is still delete-pending the open fails with EPERM (or EBUSY) instead of
    // EEXIST. That means "the lock is busy", so it joins the normal wait/retry path.
    if (ctx.platform === 'win32' && error && (error.code === 'EPERM' || error.code === 'EBUSY')) return false
    throw error
  }
}

/** When the current holder took the lock, or null when nothing usable is known. */
function holderSince(state) {
  const holder = state.parsed
  if (holder && typeof holder.at === 'number' && Number.isFinite(holder.at)) return holder.at
  if (state.mtimeMs !== null) return state.mtimeMs
  return null
}

function isReclaimable(state, alive, staleMs, now) {
  const holder = state.parsed
  if (holder && holder.pid !== undefined && holder.pid !== null && !alive(holder.pid)) return true
  const since = holderSince(state)
  return since !== null && now - since > staleMs
}

function isTransientReadError(error) {
  return Boolean(error) && TRANSIENT_READ_CODES.includes(error.code)
}

function removeQuietly(ctx, target) {
  try {
    ctx.fs.rmSync(target, { force: true })
  } catch {
    // best effort
  }
}

/**
 * Whether two reads describe the same lock file. The token is the identity; for an unparsable
 * lock, which a writer may leave behind when it dies mid-create, the mtime identifies it.
 */
function sameLock(seen, latest) {
  if (!seen || !latest) return false
  const seenToken = seen.parsed && typeof seen.parsed.token === 'string' ? seen.parsed.token : null
  const latestToken = latest.parsed && typeof latest.parsed.token === 'string' ? latest.parsed.token : null
  if (seenToken !== null || latestToken !== null) return seenToken === latestToken
  return seen.mtimeMs !== null && seen.mtimeMs === latest.mtimeMs
}

/**
 * Reclaims the stale lock this caller inspected. The lock is re-read immediately before it is
 * moved: between the first read and this call its holder may have released it and a waiter may
 * have taken a fresh lock, and moving that fresh lock out of the way would let two holders run
 * at once. Returns true when the inspected lock was really reclaimed (retry immediately) and
 * false when the lock is now live or unknown (leave it alone and wait).
 */
function reclaimLock(ctx, lockPath, state) {
  const current = readLockStateOrNull(ctx, lockPath)
  if (current === GONE) return true
  if (!sameLock(state, current)) return false

  const tomb = `${lockPath}.stale-${randomSuffix(ctx)}`
  try {
    ctx.fs.renameSync(lockPath, tomb)
  } catch (error) {
    if (error && error.code === 'ENOENT') return true
    if (isTransientReadError(error)) return true
    throw error
  }

  const moved = readLockState(ctx, tomb)
  if (!sameLock(state, moved)) {
    // A release/replace slipped in after the check above: put the moved lock back atomically so
    // the path never stays without a lock, and treat it as live.
    try {
      ctx.fs.renameSync(tomb, lockPath)
    } catch {
      removeQuietly(ctx, tomb)
    }
    return false
  }

  removeQuietly(ctx, tomb)
  return true
}

function lockHandle(ctx, lockPath, token) {
  let released = false
  return {
    path: lockPath,
    token,
    async release() {
      if (released) return
      released = true
      let state = null
      try {
        state = readLockState(ctx, lockPath)
      } catch {
        return
      }
      if (state === null || !state.parsed) return
      if (state.parsed.token !== token) return
      removeQuietly(ctx, lockPath)
    },
  }
}

/**
 * Acquires the lock, waiting at most lock_wait_ms in lock_poll_ms steps. A lock whose holder is
 * dead, or whose age passed lock_stale_ms, is reclaimed without sleeping.
 */
export async function acquireLock(ctx, lockPath, options = {}) {
  const opts = options || {}
  const waitMs = policyValue(opts.policy, 'lock_wait_ms')
  const pollMs = policyValue(opts.policy, 'lock_poll_ms')
  const staleMs = policyValue(opts.policy, 'lock_stale_ms')
  const pid = opts.pid === undefined ? process.pid : opts.pid
  const alive = typeof opts.isPidAlive === 'function' ? opts.isPidAlive : isPidAlive

  ctx.fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  const start = ctx.clock.now()

  for (;;) {
    const at = ctx.clock.now()
    const token = makeToken(ctx, pid, at)
    if (tryCreate(ctx, lockPath, { pid, at, token })) return lockHandle(ctx, lockPath, token)

    const state = readLockStateOrNull(ctx, lockPath)
    if (state === GONE) continue

    if (state !== BUSY && isReclaimable(state, alive, staleMs, ctx.clock.now()) && reclaimLock(ctx, lockPath, state)) {
      continue
    }

    if (ctx.clock.now() - start >= waitMs) {
      throw codedError('E_STATE_LOCKED', `state lock ${lockPath} was not acquired within ${waitMs}ms`)
    }
    await ctx.clock.sleep(pollMs)
  }
}

/** Runs `fn` while holding the lock and always releases it. */
export async function withLock(ctx, lockPath, fn, options = {}) {
  const handle = await acquireLock(ctx, lockPath, options)
  try {
    return await fn()
  } finally {
    await handle.release()
  }
}
