import path from 'node:path'
import { buildDirectCall, parsePlatform } from './adapters/call.mjs'
import { filterAllowed, listModels, resolveModel } from './catalog.mjs'
import { readProbeModels } from './availability.mjs'
import { lockFilePath, withLock } from './lock.mjs'
import { runWithSecrets } from './secrets/index.mjs'
import { appendJsonl, atomicWriteJson, readJsonl } from './store.mjs'
import { usageFile } from './commands/_util.mjs'
import { estimateCost } from './forecast.mjs'
import { observeVersion, ruleForTarget } from './discovery/probe.mjs'

const fields = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']
const randomPart = ctx => Math.floor(Number(ctx.random()) * 0x100000000).toString(36).padStart(7, '0')
const unique = ctx => `${randomPart(ctx)}${randomPart(ctx)}${randomPart(ctx)}${randomPart(ctx)}`

// Only explicit JSON events are interpreted. Unrecognised or malformed output is not evidence
// of successful inference. The local test protocol is not a claim about any vendor's format.
function decode(text) {
  const events = []
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    try { const event = JSON.parse(line); if (event && typeof event === 'object' && !Array.isArray(event)) events.push(event) } catch { return null }
  }
  return events
}

function extract(events) {
  const result = { model: null, text: null, error: null, tokens: null }
  for (const event of events || []) {
    if (event.type === 'result') {
      if (typeof event.model === 'string') result.model = event.model
      if (typeof event.text === 'string') result.text = event.text
    }
    if (event.type === 'error' && typeof event.code === 'string') result.error = event.code
    if ((event.type === 'result' || event.type === 'usage') && event.usage && typeof event.usage === 'object') {
      const usage = event.usage
      if (fields.every(k => usage[k] === undefined || (Number.isSafeInteger(usage[k]) && usage[k] >= 0)) && fields.some(k => usage[k] !== undefined)) {
        result.tokens = Object.fromEntries(fields.map(k => [k, usage[k] ?? 0]))
      }
    }
  }
  return result
}

/** Commit an already executed logical probe; replays never execute a CLI. */
export async function commitProbeUsage(config, { ctx, row }) {
  return withLock(ctx, lockFilePath(config._home), async () => {
    const file = usageFile(config, ctx)
    const rows = readJsonl(ctx, file)
    const existing = rows.find(item => item?.idempotency_key === row.idempotency_key)
    if (existing) return existing.id
    appendJsonl(ctx, file, row)
    return row.id
  }, { policy: config.policy })
}

async function saveModel(config, ctx, model) {
  await withLock(ctx, lockFilePath(config._home), async () => {
    const records = readProbeModels(config, { ctx }).filter(item => item.key !== model.key)
    records.push(model)
    await atomicWriteJson(ctx, path.join(config._home, 'probes.json'), records)
  }, { policy: config.policy })
}

export async function probeModels(config, { ctx, cwd = process.cwd() } = {}) {
  const directory = listModels(config, { models: [], ctx })
  const output = []
  const versions = new Map()
  for (const original of filterAllowed(directory)) {
    const model = structuredClone(original)
    if (model.deprecated) { output.push(model); continue }
    const built = buildDirectCall({ model, config, cwd, platform: parsePlatform(undefined, ctx.platform), readonly: false })
    if (!built.call) {
      // 单个不可选模型不能中止整轮探测：标记 unverified 后继续（曾经导致 E_NO_CANDIDATE 全盘失败）。
      model.identity = 'unverified'
      model.availability = {
        state: 'unverified',
        reason: 'adapter_unverified: ' + String(built.reason),
        at: ctx.clock.nowIso(),
        ttl_s: config.policy?.probe_ttl_s ?? null,
        evidence: null,
      }
      // 不可选模型不写入 probe 缓存（缓存要求完整 evidence），仅本次输出标记 unverified
      output.push(model)
      continue
    }
    const probeId = unique(ctx), nonce = unique(ctx), start = ctx.clock.now()
    const rule = ruleForTarget(built.call.command, ctx.platform)
    if (rule) {
      const declared = config.discovery?.cli_overrides?.[model.provider]
      const prefix = Array.isArray(declared?.args_prefix) ? declared.args_prefix.filter(value => typeof value === 'string') : []
      const key = JSON.stringify([ctx.platform, built.call.command, prefix])
      if (!versions.has(key)) versions.set(key, observeVersion(ctx, built.call.command, [...prefix, ...rule.versionArgs], rule.name))
      const observation = versions.get(key)
      if (observation.reason !== null) {
        model.identity = 'unverified'
        model.availability = { state: 'unverified', reason: observation.reason, at: ctx.clock.nowIso(), ttl_s: config.policy?.probe_ttl_s ?? 21600, evidence: {
          probe_id: probeId, cmd_redacted: rule.name, exit: observation.exit, duration_ms: observation.duration,
          nonce_ok: false, reported_model: null, tokens: null,
        } }
        await saveModel(config, ctx, model)
        output.push(model)
        continue
      }
    }
    const totals = Object.fromEntries(fields.map(k => [k, 0]))
    let result, parsed, knownUsage = false, unknownUsage = false
    for (let attempt = 0; attempt < 2; attempt++) {
      const exec = ctx.exec
      try {
        ctx.exec = (command, args, options) => exec(command, args, { ...options, lookup: { fs: ctx.fs, env: ctx.env, platform: ctx.platform } })
        result = runWithSecrets(ctx, config, model.provider, built.call, `Return only this nonce: ${nonce}\n`, 20000)
      } finally { ctx.exec = exec }
      parsed = extract(decode(result.stdout))
      // Only the final attempt decides whether the logical probe's usage is fully unknown. An
      // earlier timeout that is followed by a successful attempt must not poison the booking of
      // the usage the retry actually reported.
      let attemptUnknown = false
      if (parsed.tokens) {
        knownUsage = true
        for (const k of fields) totals[k] += parsed.tokens[k]
      } else if (!(result.code === null && /\bENOENT\b/.test(result.error || ''))) attemptUnknown = true
      unknownUsage = attemptUnknown
      if (result.error_code !== 'E_TIMEOUT') break
    }
    const reported = parsed.model === null ? null : resolveModel(directory, parsed.model)
    const identity = parsed.model === null ? 'unverified' : reported?.key === model.key ? 'verified' : 'mismatch'
    const nonceOk = parsed.text === nonce
    let state = 'unverified', reason = null
    if (identity === 'mismatch') { state = 'blocked'; reason = 'identity_mismatch' }
    else if (parsed.error === 'E_PROVIDER_AUTH') { state = 'blocked'; reason = 'auth' }
    else if (parsed.error === 'E_PROVIDER_QUOTA') { state = 'blocked'; reason = 'quota' }
    else if (parsed.error === 'deprecated') { state = 'deprecated'; reason = 'deprecated' }
    else if (result.error_code === 'E_TIMEOUT' || result.code === null) { state = 'unavailable'; reason = result.error_code === 'E_TIMEOUT' ? 'timeout' : 'unavailable' }
    else if (result.ok && nonceOk && identity === 'verified') state = 'callable'
    const at = ctx.clock.nowIso()
    model.identity = identity
    model.availability = { state, reason, at, ttl_s: config.policy?.probe_ttl_s ?? 21600, evidence: {
      probe_id: probeId, cmd_redacted: model.provider, exit: result.code, duration_ms: ctx.clock.now() - start,
      nonce_ok: nonceOk, reported_model: parsed.model, tokens: knownUsage ? totals : null,
    } }
    // A timeout or a partial failure can leave the consumption unknown. cliworker.usage/v1 has no
    // value that means "unknown", so booking zeros would claim a free call. Persist the failure
    // evidence (tokens stay null) and skip the ledger row instead; confirmed usage from any
    // attempt is still booked below. This also clears an earlier callable result.
    if (unknownUsage && !knownUsage) {
      if (model.availability.state === 'callable') model.availability.state = 'unverified'
      await saveModel(config, ctx, model)
      output.push(model)
      continue
    }
    const pools = (config.pools || []).filter(pool => Object.hasOwn(pool.capacity_mtok || {}, model.key)).map(pool => pool.id)
    const row = { schema: 'cliworker.usage/v1', id: `u_${unique(ctx)}`, idempotency_key: `probe:${probeId}`, lease_id: '', model: model.key, pools, kind: 'probe', ...totals, cost_usd: estimateCost({ ...totals, prices: model.prices }), pool_fraction_before: null, pool_fraction_after: null, at }
    await commitProbeUsage(config, { ctx, row })
    await saveModel(config, ctx, model)
    output.push(model)
  }
  return output
}
