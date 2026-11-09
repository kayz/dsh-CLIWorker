import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createContext } from '../../lib/context.mjs'
import { loadConfig } from '../../lib/config.mjs'
import { readSnapshot } from '../../lib/http/snapshot.mjs'
import { createFakeClock } from '../helpers/clock.mjs'

// 回归：v1 旧配置（providers/models/quotas）曾被迁移成 legacy 形状的 manual 记录，
// catalog 的 model/v1 校验拒绝它，导致 /cliworker/api/snapshot 500 E_INTERNAL。
// 现在迁移必须产出可直接校验的 model/v1 记录，快照也绝不能因为旧配置而抛错。
test('[AC-077] legacy v1 config migrates into model/v1 records the snapshot can render', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-legacy-'))
  try {
    const configPath = path.join(root, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({
      providers: { claude: { cli: 'claude', adapter: 'claude', version_args: ['--version'], readonly: true } },
      models: {
        'claude-sonnet-5-5': { provider: 'claude', vendor: 'anthropic', identity: 'verified', level: 'High', prices: { input_per_mtok: 3, output_per_mtok: 15 } },
        'gpt-6.1-terra': { provider: 'claude', vendor: 'openai', identity: 'unverified', tier: 'high', prices: {} },
      },
      quotas: {},
    }), 'utf8')

    const ctx = createContext({ env: { CLIWORKER_HOME: root }, clock: createFakeClock() })
    const config = loadConfig({ file: configPath, ctx })
    assert.ok(config.warnings.some(w => w.code === 'W_CONFIG_V1'), 'legacy config must be flagged')

    const manual = config.catalog.manual
    assert.equal(manual.length, 2)
    for (const record of manual) {
      assert.equal(record.schema, 'cliworker.model/v1')
      assert.deepEqual(Object.keys(record).sort(), ['aliases', 'allowed', 'availability', 'capabilities', 'cli', 'deprecated', 'id', 'identity', 'key', 'level', 'level_source', 'prices', 'provider', 'schema', 'source', 'vendor'])
      assert.equal(typeof record.cli, 'string')
      assert.equal(typeof record.allowed, 'boolean')
      assert.ok(['verified', 'unverified', 'mismatch'].includes(record.identity))
      assert.equal(typeof record.prices.input_per_mtok, 'number')
      assert.equal(typeof record.capabilities.context_tokens, 'number')
    }

    const snapshot = readSnapshot({ ctx, config })
    assert.equal(snapshot.models.length, 2, 'both migrated models must appear')
    assert.deepEqual(snapshot.issues.filter(issue => issue.id === 'config-invalid'), [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})