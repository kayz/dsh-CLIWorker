const DEFAULT_START = Date.parse('2026-11-07T00:00:00Z')

/**
 * Deterministic, advances only through advance(). Never touches real timers.
 */
export function createFakeClock({ start } = {}) {
  let current = start === undefined ? DEFAULT_START : start
  let seq = 0
  const timers = new Map()

  const clock = {
    now() { return current },
    nowIso() { return new Date(current).toISOString() },
    setNow(t) { current = t },
    setTimeout(fn, ms) {
      const handle = { id: (seq += 1) }
      timers.set(handle, { fn, due: current + Math.max(0, Number(ms) || 0), seq: handle.id })
      return handle
    },
    clearTimeout(handle) { timers.delete(handle) },
    pending() { return timers.size },
    async advance(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) throw new RangeError(`advance requires a finite non-negative number, got ${String(ms)}`)
      const target = current + ms
      for (;;) {
        let next = null
        for (const [handle, timer] of timers) {
          if (timer.due > target) continue
          if (!next || timer.due < next.timer.due || (timer.due === next.timer.due && timer.seq < next.timer.seq)) next = { handle, timer }
        }
        if (!next) break
        current = Math.max(current, next.timer.due)
        timers.delete(next.handle)
        next.timer.fn()
        await Promise.resolve()
      }
      current = target
    },
    sleep(ms) {
      return new Promise((resolve) => { clock.setTimeout(resolve, ms) })
    },
  }

  return clock
}
