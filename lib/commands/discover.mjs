import { createHash } from 'node:crypto'
import path from 'node:path'
import { canReuse, markGone } from '../discovery/inventory.mjs'
import { detectHost } from '../discovery/platform.mjs'
import { scanLocal } from '../discovery/scan.mjs'
import { parseDistros } from '../discovery/wsl.mjs'
import { createFsx } from '../fsx.mjs'
import { codedError } from '../output.mjs'
import { resolvePaths } from '../paths.mjs'
import { atomicWriteJson, readJson } from '../store.mjs'
import { arg, flag } from './_util.mjs'

export const route = { cmd: 'discover', sub: null }

const INVENTORY_SCHEMA = 'cliworker.inventory/v1'
const DEFAULT_PROBE_TTL_S = 21_600
const PROBE_TIMEOUT_MS = 20_000
const VERSION_RE = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/
const EXECUTABLE_EXT_RE = /\.(?:exe|com|cmd|bat)$/i

function discoveryOptions(config) {
  const value = config && typeof config === 'object' ? config.discovery : undefined
  if (value === undefined) {
    return { extra_dirs: [], unknown_patterns: [], cli_overrides: {}, probe_unknown: false, wsl: true }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('E_CONFIG', 'discovery must be a JSON object')
  }
  const strings = (name) => {
    const item = value[name]
    if (item === undefined) return []
    if (!Array.isArray(item) || item.some((entry) => typeof entry !== 'string')) {
      throw codedError('E_CONFIG', `discovery.${name} must be an array of strings`)
    }
    return item
  }
  const overrides = value.cli_overrides === undefined ? {} : value.cli_overrides
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw codedError('E_CONFIG', 'discovery.cli_overrides must be a JSON object')
  }
  return {
    extra_dirs: strings('extra_dirs'),
    unknown_patterns: strings('unknown_patterns'),
    cli_overrides: overrides,
    probe_unknown: value.probe_unknown === true,
    wsl: value.wsl !== false,
  }
}

function execOptions(ctx) {
  return {
    timeout: PROBE_TIMEOUT_MS,
    lookup: { fs: ctx.fs, env: ctx.env, platform: ctx.platform },
  }
}

function inventoryFile(config, argv, ctx) {
  const home = config && typeof config._home === 'string' && config._home !== ''
    ? config._home
    : resolvePaths({ configPath: arg(argv, '--config'), env: ctx.env, platform: ctx.platform }).state_dir
  return path.join(home, 'inventory.json')
}

function readPrevious(ctx, file) {
  let value
  try {
    value = readJson(ctx, file, null)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.schema !== INVENTORY_SCHEMA || !Array.isArray(value.entries)) return null
  return value
}

function entryKey(realpath, platform) {
  return platform === 'win32' ? realpath.toLowerCase() : realpath
}

function candidateId(candidate) {
  if (candidate.rule) return candidate.rule.name
  return path.basename(candidate.realpath).replace(EXECUTABLE_EXT_RE, '').toLowerCase()
}

function probeArgs(candidate, discovery) {
  if (candidate.rule && Array.isArray(candidate.rule.versionArgs) && candidate.rule.versionArgs.length > 0) {
    return [...candidate.rule.versionArgs]
  }
  return discovery.probe_unknown ? ['--version'] : null
}

function probeCandidate(candidate, args, ctx, at) {
  let result
  try {
    result = ctx.exec(candidate.path, args, execOptions(ctx))
  } catch (error) {
    throw codedError(
      'E_INTERNAL',
      `discovery probe failed for ${candidate.path}: ${error && error.message ? error.message : String(error)}`,
    )
  }
  const stdout = result && typeof result.stdout === 'string' ? result.stdout : ''
  const version = result && result.ok === true ? (VERSION_RE.exec(stdout)?.[0] ?? null) : null
  return {
    version,
    evidence: [{
      kind: 'probe',
      cmd_redacted: `${candidateId(candidate)} ${args.join(' ')}`,
      exit: result && Number.isInteger(result.code) ? result.code : null,
      at,
      digest: createHash('sha256').update(stdout, 'utf8').digest('hex'),
    }],
  }
}

function listWslDistros(ctx) {
  let result
  try {
    result = ctx.exec('wsl', ['-l', '-q'], execOptions(ctx))
  } catch {
    return []
  }
  if (!result || result.ok !== true) return []
  return parseDistros(result.stdout)
}

function entryFrom(candidate, host, previous, probe, at) {
  return {
    id: candidateId(candidate),
    recognized: candidate.rule !== null && candidate.rule !== undefined,
    platform: host.platform,
    path: candidate.path,
    realpath: candidate.realpath,
    version: probe ? probe.version : null,
    fingerprint: candidate.fingerprint,
    auth: { state: 'unknown', source: 'none' },
    evidence: probe ? probe.evidence : [],
    first_seen: previous && typeof previous.first_seen === 'string' ? previous.first_seen : at,
    last_seen: at,
    status: 'present',
  }
}

function reuseEntry(previous, candidate, host, at) {
  return {
    ...previous,
    platform: host.platform,
    path: candidate.path,
    realpath: candidate.realpath,
    last_seen: at,
    status: 'present',
  }
}

function probeTtl(config) {
  const value = config && config.policy ? config.policy.probe_ttl_s : undefined
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_PROBE_TTL_S
}

export async function run({ argv, ctx, config }) {
  const discovery = discoveryOptions(config)
  if (flag(argv, '--probe-unknown')) discovery.probe_unknown = true
  const full = flag(argv, '--full')
  const fsx = createFsx(ctx.fs, { platform: ctx.platform, deny: [] })
  const detected = detectHost(ctx, fsx)
  const host = {
    platform: detected.platform,
    arch: typeof ctx.arch === 'string' && ctx.arch !== '' ? ctx.arch : process.arch,
    wsl_distros: detected.platform === 'win32' && discovery.wsl ? listWslDistros(ctx) : [],
  }
  const scan = scanLocal(fsx, { platform: detected.platform, env: ctx.env || {}, discovery })
  const nowMs = ctx.clock.now()
  const at = ctx.clock.nowIso()
  const file = inventoryFile(config, argv, ctx)
  const previous = readPrevious(ctx, file)
  const previousByKey = new Map()
  if (previous) {
    for (const entry of previous.entries) {
      if (entry && typeof entry.realpath === 'string') {
        previousByKey.set(entryKey(entry.realpath, detected.platform), entry)
      }
    }
  }

  const ttl = probeTtl(config)
  const used = new Set()
  const entries = []
  for (const candidate of scan.candidates) {
    const key = entryKey(candidate.realpath, detected.platform)
    const old = previousByKey.get(key)
    if (old !== undefined) used.add(key)
    if (old !== undefined && canReuse(old, candidate.fingerprint, nowMs, ttl, full)) {
      entries.push(reuseEntry(old, candidate, host, at))
      continue
    }
    const args = probeArgs(candidate, discovery)
    const probe = args === null ? null : probeCandidate(candidate, args, ctx, at)
    entries.push(entryFrom(candidate, host, old, probe, at))
  }

  // A failed directory read is not evidence that its entries disappeared.
  if (previous) {
    for (const entry of previous.entries) {
      if (!entry || typeof entry.realpath !== 'string') continue
      if (used.has(entryKey(entry.realpath, detected.platform))) continue
      entries.push(scan.failed.length === 0 ? markGone(entry) : entry)
    }
  }

  const inventory = { schema: INVENTORY_SCHEMA, generated_at: at, host, entries }
  try {
    await atomicWriteJson(ctx, file, inventory)
  } catch (error) {
    throw codedError(
      'E_INTERNAL',
      `cannot write discovery inventory ${file}: ${error && error.message ? error.message : String(error)}`,
    )
  }
  return inventory
}
