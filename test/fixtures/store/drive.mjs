// Drives a fake clock forward until a promise settles. Each step advances virtual time once and
// then yields several microtask turns, because an await-based loop registers its next timer only
// after a few continuations.

const MICROTASK_TURNS = 8

export async function drive(clock, promise, { step, maxIterations = 100000 } = {}) {
  if (typeof step !== 'number' || !Number.isFinite(step) || step <= 0) {
    throw new RangeError(`drive requires a positive step, got ${String(step)}`)
  }

  let done = false
  let failed = false
  let outcome
  const tracked = Promise.resolve(promise).then(
    (value) => {
      done = true
      outcome = value
    },
    (error) => {
      done = true
      failed = true
      outcome = error
    }
  )

  let iterations = 0
  while (!done) {
    if (iterations >= maxIterations) throw new Error(`drive: promise did not settle within ${maxIterations} iterations`)
    iterations += 1
    await clock.advance(step)
    for (let i = 0; i < MICROTASK_TURNS; i += 1) await Promise.resolve()
  }

  await tracked
  if (failed) throw outcome
  return outcome
}
