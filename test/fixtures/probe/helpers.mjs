import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext } from '../../../lib/context.mjs'

const stub = fileURLToPath(new URL('./stub.mjs', import.meta.url))
export function setup(mode = 'ok') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-probe-'))
  const at = '2026-11-07T00:00:00.000Z'
  const model = id => ({ schema: 'cliworker.model/v1', key: `claude:${id}`, id, cli: 'claude', provider: 'claude', vendor: 'anthropic', aliases: [], allowed: false, level: 'Quick', level_source: { kind: 'config', ref: 'test', at }, availability: { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null }, identity: 'unverified', capabilities: { context_tokens: 0, readonly: true, stdin: true }, prices: { input_per_mtok: 0, output_per_mtok: 0, source: 'test' }, source: { kind: 'manual', ref: 'test', at }, deprecated: false })
  const count = path.join(dir, 'count')
  const config = { _home: dir, discovery: { cli_overrides: { claude: { cli: process.execPath, args_prefix: [stub] } } }, catalog: { manual: [model('one'), model('other')], allow: ['claude:one'], levels: { 'claude:one': 'Quick', 'claude:other': 'Quick' }, aliases: { alias: 'claude:one' }, deprecated: {} }, policy: { probe_ttl_s: 10 }, pools: [{ id: 'pool', capacity_mtok: { 'claude:one': 1 } }], secrets: {} }
  const ctx = createContext({ env: { ...process.env, PROBE_MODE: mode, PROBE_COUNT_FILE: count } })
  return { dir, count, config, ctx, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}
