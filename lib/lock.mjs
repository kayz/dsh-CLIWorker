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
 * A short-lived companion file that serialises every *destructive* operation on the lock file
 * (stale reclamation and release). Checking a lock and then renaming it cannot be one atomic
 * filesystem operation, so without this gate two waiters can both decide the same stale lock is
 * reclaimable: the first moves it away, a waiter creates a fresh lock, and the second waiter's
 * rename then moves that fresh lock out of the way while its owner is already in the critical
 * section. Holding the gate means the only lock that can be moved is the one just re-read.
 */
function gateFilePath(lockPath) {
  return `${lockPath}.reclaim`
}

/**
 * Moves `targetPath` aside, but only when it is still the file the caller inspected, and puts it
 * back when it is not. The gate makes a mismatch impossible on the normal path; the branch stays
 * as a safety net for an unreadable/delete-pending file.
 *
 * Returns 'reclaimed' (the inspected file was moved and removed), 'gone' (nothing to move),
 * 'busy' (transient filesystem state; try again) or 'changed' (the file was put back).
 */
function retireFile(ctx, targetPath, expected) {
  const tomb = `${targetPath}.stale-${randomSuffix(ctx)}`
  try {
    ctx.fs.renameSync(targetPath, tomb)
  } catch (error) {
    if (error && error.code === 'ENOENT') return 'gone'
    if (isTransientReadError(error)) return 'busy'
    throw error
  }

  const moved = readLockState(ctx, tomb)
  if (!sameLock(expected, moved)) {
    try {
      ctx.fs.renameSync(tomb, targetPath)
    } catch {
      removeQuietly(ctx, tomb)
    }
    return 'changed'
  }

  removeQuietly(ctx, tomb)
  return 'reclaimed'
}

function gateHeldBy(ctx, gate) {
  const state = readLockStateOrNull(ctx, gate.path)
  if (state === GONE || state === BUSY) return false
  return Boolean(state.parsed && state.parsed.token === gate.token)
}

/**
 * One non-blocking attempt at the gate. Returns the gate handle, or null when another process
 * holds it or when it cannot be proven abandoned. An abandoned gate (crashed process) is
 * reclaimed by the same identity-checked move as a lock.
 */
function tryAcquireGate(ctx, lockPath, options) {
  const gatePath = gateFilePath(lockPath)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const at = ctx.clock.now()
    const token = makeToken(ctx, options.pid, at)
    if (tryCreate(ctx, gatePath, { pid: options.pid, at, token })) return { path: gatePath, token }

    const seen = readLockStateOrNull(ctx, gatePath)
    if (seen === GONE) continue
    if (seen === BUSY) return null
    if (!isReclaimable(seen, options.alive, options.staleMs, ctx.clock.now())) return null

    // Re-read immediately before moving the abandoned gate, exactly like a lock: only the file
    // that was just identified as stale may be removed.
    const current = readLockStateOrNull(ctx, gatePath)
    if (current === GONE) continue
    if (!sameLock(seen, current)) return null
    if (retireFile(ctx, gatePath, seen) === 'busy') return null
  }
  return null
}

function releaseGate(ctx, gate) {
  if (!gate) return
  const state = readLockStateOrNull(ctx, gate.path)
  if (state === GONE) return
  // A transient read failure of a gate this process is holding cannot be another owner's file:
  // the gate is held for a few filesystem operations, far below lock_stale_ms.
  if (state !== BUSY && (!state.parsed || state.parsed.token !== gate.token)) return
  removeQuietly(ctx, gate.path)
}

async function acquireGateForRelease(ctx, lockPath, options) {
  const start = ctx.clock.now()
  for (;;) {
    const gate = tryAcquireGate(ctx, lockPath, options)
    if (gate) return gate
    if (ctx.clock.now() - start >= options.waitMs) return null
    await ctx.clock.sleep(options.pollMs)
  }
}

/**
 * Reclaims the stale lock this caller inspected. The gate is taken first; then the lock is
 * re-read and only that exact file is moved. With release and every other reclaimer also behind
 * the gate, no fresh lock can appear between the re-read and the move.
 *
 * Returns true when the inspected lock was really retired (retry immediately) and false when the
 * lock is now live or unknown (leave it alone and wait).
 */
function reclaimLock(ctx, lockPath, state, options) {
  const gate = tryAcquireGate(ctx, lockPath, options)
  if (!gate) return false

  try {
    const current = readLockStateOrNull(ctx, lockPath)
    if (current === GONE) return true
    if (!sameLock(state, current)) return false
    // A gate abandoned by a dead reclaimer may have been reclaimed concurrently; do not act on
    // a gate this caller no longer owns.
    if (!gateHeldBy(ctx, gate)) return false

    const outcome = retireFile(ctx, lockPath, current)
    return outcome === 'reclaimed' || outcome === 'gone' || outcome === 'busy'
  } finally {
    releaseGate(ctx, gate)
  }
}

function lockHandle(ctx, lockPath, token, options) {
  let released = false
  return {
    path: lockPath,
    token,
    async release() {
      if (released) return
      released = true
      // Release is destructive too: without the gate, a reclaimer could retire this lock between
      // the token check below and the removal, and the removal could then delete a successor's
      // fresh lock. If the gate cannot be taken within lock_wait_ms, fall back to the token check.
      const gate = await acquireGateForRelease(ctx, lockPath, options)
      try {
        let state = null
        try {
          state = readLockState(ctx, lockPath)
        } catch {
          return
        }
        if (state === null || !state.parsed) return
        if (state.parsed.token !== token) return
        removeQuietly(ctx, lockPath)
      } finally {
        releaseGate(ctx, gate)
      }
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
  const gateOptions = { pid, alive, waitMs, pollMs, staleMs }

  ctx.fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  const start = ctx.clock.now()

  for (;;) {
    const at = ctx.clock.now()
    const token = makeToken(ctx, pid, at)
    if (tryCreate(ctx, lockPath, { pid, at, token })) return lockHandle(ctx, lockPath, token, gateOptions)

    const state = readLockStateOrNull(ctx, lockPath)
    if (state === GONE) continue

    if (state !== BUSY && isReclaimable(state, alive, staleMs, ctx.clock.now()) && reclaimLock(ctx, lockPath, state, gateOptions)) {
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
