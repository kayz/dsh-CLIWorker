import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createContext } from '../../lib/context.mjs'
import { migrateState, backupState } from '../../lib/migrate.mjs'

test('[AC-066] upgrade, restore and recovery preserve state bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-upgrade-'))
  try {
    const state = path.join(root, 'state'), configFile = path.join(root, 'config.json')
    fs.mkdirSync(path.join(state, 'secrets'), { recursive: true })
    fs.writeFileSync(configFile, JSON.stringify({ schema: 'cliworker.config/v2', state_dir: 'state', discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: {}, secrets: {} }))
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
    assert(version.split('.').map(Number).some((n, i) => i < 2 && n > 0) || Number(version.split('.')[2]) > 1)
    const originals = { VERSION: '0.0.1\n', 'leases.json': '{"leases":[],"requests":[]}\n', 'probes.json': '[]\n', 'pools.json': '[]\n', 'usage.jsonl': '{"row":1}\n' }
    for (const [name, data] of Object.entries(originals)) fs.writeFileSync(path.join(state, name), data)
    const sentinel = 'SECRET-SENTINEL'; fs.writeFileSync(path.join(state, 'secrets', 'x.dpapi'), sentinel)
    const env = { ...process.env, HOME: root, USERPROFILE: root, CLIWORKER_HOME: path.join(root, 'home') }; delete env.CLIWORKER_CONFIG; delete env.CLIWORKER_TEST_CLOCK_FILE
    const cli = (...args) => { const r = spawnSync(process.execPath, ['bin/cliworker.mjs', 'state', ...args, '--config', configFile], { env, encoding: 'utf8' }); assert(!`${r.stdout}${r.stderr}`.includes(sentinel)); return { ...r, body: JSON.parse(r.stdout) } }
    const first = cli('migrate'); assert.equal(first.status, 0); assert.equal(first.body.from, '0.0.1'); assert.equal(first.body.to, version)
    const backup = first.body.backup, dir = path.join(state, 'backups', backup)
    assert.match(backup, /^backup-0\.0\.1-\d{8}T\d{9}Z(?:-\d+)?$/)
    for (const [name, data] of Object.entries(originals)) assert.equal(fs.readFileSync(path.join(dir, 'data', name), 'utf8'), data)
    assert(!fs.existsSync(path.join(dir, 'data', 'secrets'))); assert.equal(fs.readFileSync(path.join(state, 'VERSION'), 'utf8').trim(), version)
    const count = fs.readdirSync(path.join(state, 'backups')).length
    assert.equal(cli('migrate').body.migrated, false); assert.equal(fs.readdirSync(path.join(state, 'backups')).length, count)
    fs.writeFileSync(path.join(state, 'leases.json'), 'bad'); fs.rmSync(path.join(state, 'usage.jsonl')); fs.writeFileSync(path.join(state, 'stray'), 'x')
    assert.equal(cli('restore', '--from', backup).status, 0)
    for (const [name, data] of Object.entries(originals)) assert.equal(fs.readFileSync(path.join(state, name), 'utf8'), data)
    assert(!fs.existsSync(path.join(state, 'stray'))); assert.equal(fs.readFileSync(path.join(state, 'secrets', 'x.dpapi'), 'utf8'), sentinel)
    for (const name of ['../x', '..\\x', 'backup-9.9.9-20000101T000000000Z', dir]) assert.equal(cli('restore', '--from', name).body.error.code, 'E_REQUEST_INVALID')
    const ctx = createContext(), config = { _home: state, policy: {} }
    await assert.rejects(migrateState(ctx, config, { steps: [{ run() { throw new Error('step failed') } }] }), /step failed/)
    assert.equal(fs.readFileSync(path.join(state, 'VERSION'), 'utf8'), originals.VERSION)
    let fail = true
    const io = { ...fs, renameSync(a, b) { if (fail && String(b).endsWith('leases.json')) { fail = false; throw new Error('injected rename') } return fs.renameSync(a, b) } }
    await assert.rejects(migrateState(createContext({ fs: io }), config), /injected rename/)
    for (const [name, data] of Object.entries(originals)) assert.equal(fs.readFileSync(path.join(state, name), 'utf8'), data)
    const safe = await backupState(ctx, config)
    fs.writeFileSync(path.join(state, '.state-op.json'), JSON.stringify({ op: 'migrate', rollback: safe.name, started_at: '2020-01-01T00:00:00.000Z' }))
    fs.writeFileSync(path.join(state, 'leases.json'), 'damaged')
    const recovered = cli('migrate'); assert.equal(recovered.body.recovered, safe.name); assert.equal(fs.readFileSync(path.join(state, 'leases.json'), 'utf8'), originals['leases.json'])
    fs.writeFileSync(path.join(dir, 'data', 'leases.json'), 'tampered')
    const before = fs.readFileSync(path.join(state, 'VERSION'), 'utf8')
    assert.equal(cli('restore', '--from', backup).body.error.code, 'E_INTERNAL'); assert.equal(fs.readFileSync(path.join(state, 'VERSION'), 'utf8'), before)
    for (const entry of fs.readdirSync(path.join(state, 'backups'), { recursive: true, withFileTypes: true })) if (entry.isFile()) assert(!fs.readFileSync(path.join(entry.parentPath || entry.path, entry.name)).includes(sentinel))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
