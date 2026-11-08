import { randomBytes } from 'node:crypto'
import { getCode } from '../contract/registry.mjs'
import { errorBody } from '../output.mjs'

// The job envelope owns these names; a successful result may contribute any other field under the
// same name the command returned it with (inventory fields, models, records, ...).
const ENVELOPE = new Set(['job_id', 'status', 'at', 'last_error', 'error'])

export function createJobs({ ctx, register, run, before, settled }) {
  const jobs = new Map()
  let queue = Promise.resolve()

  /** Publish a failed attempt using the existing error envelope and the registry code, not a message. */
  function fail(job, code) {
    const known = typeof code === 'string' && getCode(code) ? code : 'E_INTERNAL'
    job.status = 'failed'
    job.last_error = known
    job.error = errorBody(known, known).error
  }

  /** Keep the command's business result fields, preserving the names the synchronous command used. */
  function succeed(job, result) {
    job.status = 'succeeded'
    job.last_error = null
    job.error = null
    if (result === null || typeof result !== 'object' || Array.isArray(result)) return
    for (const [key, value] of Object.entries(result)) {
      if (!ENVELOPE.has(key)) job[key] = value
    }
  }

  return {
    accept(operation, body, config) {
      const id = randomBytes(24).toString('base64url')
      const path = `/cliworker/api/jobs/${id}`
      if (!register(path)) throw new Error('registration failed')
      const job = { job_id: id, status: 'queued', at: new Date(ctx.clock.now()).toISOString(), last_error: null, error: null }
      jobs.set(id, job)
      ctx.clock.setTimeout(() => { queue = queue.then(async () => {
        const previous = before(config)
        job.status = 'running'
        try {
          const result = await run(operation, body, config)
          if (result !== null && typeof result === 'object' && result.ok === false) fail(job, result.error?.code)
          else succeed(job, result)
        } catch (error) { fail(job, error?.code) }
        job.at = new Date(ctx.clock.now()).toISOString()
        settled(job, previous, config)
      }) }, 0)
      return { job_id: id }
    },
    get(pathname) {
      const match = /^\/cliworker\/api\/jobs\/([A-Za-z0-9_-]+)$/.exec(pathname)
      return match ? jobs.get(match[1]) : undefined
    },
  }
}
