import { randomBytes } from 'node:crypto'

export function createJobs({ ctx, register, run, before, settled }) {
  const jobs = new Map()
  return {
    accept(operation, body, config) {
      const id = randomBytes(24).toString('base64url')
      const path = `/cliworker/api/jobs/${id}`
      if (!register(path)) throw new Error('registration failed')
      const job = { job_id: id, status: 'queued', at: new Date(ctx.clock.now()).toISOString(), last_error: null }
      const previous = before(config)
      jobs.set(id, job)
      ctx.clock.setTimeout(async () => {
        job.status = 'running'
        try {
          const result = await run(operation, body, config)
          if (result?.ok === false) throw new Error('job failed')
          job.status = 'succeeded'
        } catch { job.status = 'failed'; job.last_error = 'E_INTERNAL' }
        job.at = new Date(ctx.clock.now()).toISOString()
        settled(job, previous, config)
      }, 0)
      return { job_id: id }
    },
    get(pathname) {
      const match = /^\/cliworker\/api\/jobs\/([A-Za-z0-9_-]+)$/.exec(pathname)
      return match ? jobs.get(match[1]) : undefined
    },
  }
}
