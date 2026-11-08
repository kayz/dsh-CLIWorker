import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { run as modelsSelect } from '../../../lib/commands/models/select.mjs'
import { createContext } from '../../../lib/context.mjs'
import { loadConfig } from '../../../lib/config.mjs'
import { createFakeClock } from '../../helpers/clock.mjs'

const V01 = process.env.CLIWORKER_V01_ROOT
  ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))

const PROBE = [
  "import fs from 'node:fs'",
  "fs.appendFileSync(process.env.CLIWORKER_TEST_PROBE_FILE, 'x')",
  "process.stdout.write('node 1.0.0\\n')",
  '',
].join('\n')

test('[repro] [AC-005] provider status is probed again on every call', async () => {
  const { providerStatus } = await import(pathToFileURL(path.join(V01, 'lib', 'availability.mjs')).href)
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-v01-nocache-'))
  const probeFile = path.join(base, 'probe-count.txt')
  const previousCwd = process.cwd()
  const previousProbe = process.env.CLIWORKER_TEST_PROBE_FILE
  try {
    fs.writeFileSync(path.join(base, 'probe.mjs'), PROBE, 'utf8')
    fs.writeFileSync(probeFile, '', 'utf8')
    process.env.CLIWORKER_TEST_PROBE_FILE = probeFile
    process.chdir(base)

    const config = { providers: { local: { cli: 'node', version_args: ['probe.mjs'] } } }
    assert.equal(providerStatus(config).local.state, 'callable')
    assert.equal(providerStatus(config).local.state, 'callable')

    assert.equal(fs.readFileSync(probeFile, 'utf8').length, 2)
  } finally {
    process.chdir(previousCwd)
    if (previousProbe === undefined) delete process.env.CLIWORKER_TEST_PROBE_FILE
    else process.env.CLIWORKER_TEST_PROBE_FILE = previousProbe
    fs.rmSync(base, { recursive: true, force: true })
  }
})

const LIVE_START = Date.parse('2026-11-07T00:00:00.000Z')

function liveFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-live-nocache-'))
  const stateDir = path.join(root, 'state')
  fs.mkdirSync(stateDir, { recursive: true })
  const at = new Date(LIVE_START).toISOString()
  const model = {
    schema: 'cliworker.model/v1',
    key: 'live:one',
    id: 'live-one',
    cli: process.execPath,
    provider: 'claude',
    vendor: 'anthropic',
    aliases: [],
    allowed: false,
    level: 'Top',
    level_source: { kind: 'config', ref: 'live#catalog.levels', at },
    availability: { state: 'callable', reason: null, at, ttl_s: 86400, evidence: null },
    identity: 'verified',
    capabilities: { context_tokens: 100000, readonly: true, stdin: true },
    prices: { input_per_mtok: 1, output_per_mtok: 1, source: 'config' },
    source: { kind: 'manual', ref: 'live#catalog.manual', at },
    deprecated: false,
  }
  const config = {
    schema: 'cliworker.config/v2',
    state_dir: 'state',
    secrets: {},
    discovery: {
      extra_dirs: [],
      wsl: false,
      probe_unknown: false,
      unknown_patterns: [],
      cli_overrides: { claude: { cli: process.execPath, args_prefix: [], readonly: true, env_names: [] } },
    },
    catalog: { allow: [model.key], levels: { [model.key]: 'Top' }, aliases: {}, deprecated: {}, manual: [model] },
    pools: [{
      id: 'claude:plan-live',
      cli: 'claude',
      kind: 'plan_window',
      funding: 'plan',
      window: {
        length_s: 18000,
        anchor: 'rolling',
        start_at: new Date(LIVE_START - 3600_000).toISOString(),
        reset_at: new Date(LIVE_START + 3600_000).toISOString(),
        reset_source: 'config',
      },
      capacity_mtok: { [model.key]: { value: 100, source: 'config' } },
      used_fraction: { value: 0, source: 'config', at },
      credits_per_mtok: null,
    }],
    policy: {
      lease_ttl_s: 7200,
      reading_ttl_s: 600,
      lock_stale_ms: 30000,
      lock_wait_ms: 5000,
      lock_poll_ms: 10,
      reserve_fraction_for_high: 0.15,
      unknown_policy: 'after_known',
      usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 },
      cache_read_weight: 0,
    },
  }
  const file = path.join(root, 'config.json')
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
  const execCalls = []
  const fetchCalls = []
  const ctx = createContext({
    clock: createFakeClock({ start: LIVE_START }),
    env: {},
    platform: process.platform,
    exec: (...args) => {
      execCalls.push(args)
      throw new Error('live selection must not execute a provider')
    },
    fetch: (...args) => {
      fetchCalls.push(args)
      throw new Error('live selection must not touch the network')
    },
  })
  const loaded = loadConfig({ file, ctx })
  return { root, stateDir, ctx, config: loaded, execCalls, fetchCalls }
}

test('[fixed] [AC-055] live selection is served from the cache on every call', async () => {
  const fixture = liveFixture()
  try {
    const probesFile = path.join(fixture.stateDir, 'probes.json')
    for (const requestId of ['live-one', 'live-two']) {
      const result = await modelsSelect({
        argv: ['models', 'select', '--request', JSON.stringify({
          schema: 'cliworker.request/v1',
          request_id: requestId,
          level: 'Top',
          count: 1,
          usage: 'Normal',
          importance: 'high',
          cwd: fixture.root,
        })],
        ctx: fixture.ctx,
        config: fixture.config,
      })
      assert.equal(result.ok, true)
      assert.equal(result.count_returned, 1)
    }
    assert.deepStrictEqual(fixture.execCalls, [])
    assert.deepStrictEqual(fixture.fetchCalls, [])
    assert.equal(fs.existsSync(probesFile), false, 'selection must not create a probe cache')
    assert.equal(fs.existsSync(path.join(fixture.stateDir, 'usage.jsonl')), false, 'selection must not record usage')
    assert.equal(fs.existsSync(path.join(fixture.stateDir, 'pools.json')), false, 'selection must not write pool state')
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})
