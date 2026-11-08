import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { loadConfig } from './config.mjs'
import { resolvePaths } from './paths.mjs'
import { acquireLock, lockFilePath } from './lock.mjs'
import { readJson } from './store.mjs'
import { readProbeModels } from './availability.mjs'
import { resolveSecret } from './secrets/index.mjs'

export async function collectHealth({ ctx, configPath, registration = 'failed' }) {
  const checks = []
  const check = async (id, fn) => {
    try { checks.push({ id, ok: true, detail: await fn() }) }
    catch (error) { checks.push({ id, ok: false, detail: typeof error?.count === 'number' ? error.count : 'unavailable' }) }
  }
  let now, config
  try { now = ctx.clock.now() } catch { now = null }
  await check('config', () => { config = loadConfig({ file: configPath, ctx }); return 'valid' })
  const dir = config?._home ?? resolvePaths({ configPath, env: ctx.env, platform: ctx.platform }).state_dir
  await check('state_dir', () => {
    if (!config) throw new Error()
    ctx.fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `.health-${randomBytes(16).toString('hex')}`)
    let created = false
    try { ctx.fs.writeFileSync(file, '', { flag: 'wx', encoding: 'utf8' }); created = true }
    finally { if (created) ctx.fs.rmSync(file) }
    return 'writable'
  })
  await check('lock', async () => {
    if (!config || now === null) throw new Error()
    const lock = await acquireLock(ctx, lockFilePath(dir), { policy: config.policy })
    try { return 'available' } finally { await lock.release() }
  })
  await check('secrets', () => {
    if (!config) throw new Error()
    for (const name of Object.keys(config.secrets || {})) {
      if (!resolveSecret(ctx, config, name)) throw new Error()
    }
    return 'available'
  })
  await check('inventory', () => {
    if (!config || now === null) throw new Error()
    const data = readJson(ctx, path.join(dir, 'inventory.json'), null)
    if (data === null) return 'not generated'
    const at = Date.parse(data.generated_at)
    if (data.schema !== 'cliworker.inventory/v1' || !Array.isArray(data.entries) || !Number.isFinite(at)) throw new Error()
    return now - at
  })
  await check('probes', () => {
    if (!config || now === null) throw new Error()
    const records = readProbeModels(config, { ctx })
    let expired = 0
    for (const { availability } of records) {
      if (availability.at === null) continue
      const at = Date.parse(availability.at)
      const ttl = availability.ttl_s ?? config.policy?.probe_ttl_s ?? 21600
      if (!Number.isFinite(at) || !Number.isFinite(ttl) || ttl < 0) throw new Error()
      if (now > at + ttl * 1000) expired++
    }
    if (expired) { const error = new Error(); error.count = expired; throw error }
    return expired
  })
  checks.push({ id: 'registration', ok: registration === 'ok', detail: registration === 'ok' ? 'ok' : 'failed' })
  const testClock = typeof ctx.env?.CLIWORKER_TEST_CLOCK_FILE === 'string' && ctx.env.CLIWORKER_TEST_CLOCK_FILE !== ''
  checks.push({ id: 'test_clock', ok: !testClock && now !== null, detail: testClock ? 'enabled' : now === null ? 'unavailable' : 'disabled' })
  return { status: checks.every(item => item.ok) ? 'ok' : 'degraded', checks, registration: registration === 'ok' ? 'ok' : 'failed', test_clock: testClock }
}
