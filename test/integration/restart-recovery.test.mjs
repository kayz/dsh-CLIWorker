import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

test('[AC-066] restart recovers state and a dead process lock', { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-restart-')), state = path.join(root, 'state')
  fs.mkdirSync(state)
  let child
  try {
    const live = { lease_id: 'live', handle_id: 'h', model_key: 'm', expires_at: '2030-01-01T00:00:00.000Z', pools: [{ id: 'p', fraction: 0.5 }], call: {} }
    const expired = { ...live, lease_id: 'expired', expires_at: '2020-01-01T00:00:00.000Z' }
    fs.writeFileSync(path.join(state, 'probes.json'), '[]\n')
    fs.writeFileSync(path.join(state, 'leftover.tmp'), 'incomplete')
    const worker = `import {createContext} from './lib/context.mjs'; import {acquireLock,lockFilePath} from './lib/lock.mjs'; import {atomicWriteJson,appendJsonl} from './lib/store.mjs'; import path from 'node:path'; const dir=process.argv[1], data=JSON.parse(process.argv[2]), ctx=createContext(); await acquireLock(ctx,lockFilePath(dir)); for(let n=0;;n++){ await atomicWriteJson(ctx,path.join(dir,'leases.json'),data); appendJsonl(ctx,path.join(dir,'usage.jsonl'),{n}); console.log('ack '+n); await new Promise(r=>setTimeout(r,10)); }`
    child = spawn(process.execPath, ['--input-type=module', '-e', worker, state, JSON.stringify({ leases: [live, expired], requests: [] })], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', errors = '', ack = -1
    child.stderr.on('data', b => { errors += b })
    await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', () => { if (ack < 2) reject(new Error(`worker exited early: ${errors}`)); else resolve() })
      child.stdout.on('data', b => { output += b; const matches = [...output.matchAll(/^ack (\d+)$/gm)]; if (matches.length >= 3 && ack < 0) { ack = Number(matches.at(-1)[1]); child.kill() } })
    })
    const restart = `import {createContext} from './lib/context.mjs'; import {acquireLock,lockFilePath} from './lib/lock.mjs'; import {readJsonl} from './lib/store.mjs'; import {readLeaseState,effectiveReservations,commitSelection} from './lib/leases.mjs'; import {readProbeModels} from './lib/availability.mjs'; import path from 'node:path'; const ctx=createContext(), config={_home:process.argv[1],policy:{lock_wait_ms:5000}}, now=Date.parse('2025-01-01T00:00:00Z'); const start=performance.now(), lock=await acquireLock(ctx,lockFilePath(config._home),{policy:config.policy}); const elapsed=performance.now()-start; const state=readLeaseState(ctx,config), rows=readJsonl(ctx,path.join(config._home,'usage.jsonl'),{skipInvalid:true}), probes=readProbeModels(config,{ctx}), reserved=[...effectiveReservations(state,now)]; const next=await commitSelection({ctx,config,state,request:{},now,leases:[]}); await lock.release(); console.log(JSON.stringify({elapsed,state,rows,probes,reserved,next}));`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', restart, state], { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, result.stderr)
    const data = JSON.parse(result.stdout)
    assert.deepEqual(data.state.leases[0], live); assert.deepEqual(data.reserved, [['p', 0.5]])
    assert.deepEqual(data.next.leases, [live]); assert(data.elapsed < 2000)
    assert.deepEqual(data.rows.slice(0, ack + 1), Array.from({ length: ack + 1 }, (_, n) => ({ n })))
    assert.deepEqual(data.probes, []); assert.equal(fs.readFileSync(path.join(state, 'probes.json'), 'utf8'), '[]\n'); assert(!fs.existsSync(path.join(state, 'state.lock')))
    const cfg = path.join(root, 'config.json')
    fs.writeFileSync(cfg, JSON.stringify({ schema: 'cliworker.config/v2', state_dir: 'state', discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: {}, secrets: {} }))
    const env = { ...process.env, HOME: root, USERPROFILE: root, CLIWORKER_HOME: path.join(root, 'home') }; delete env.CLIWORKER_CONFIG; delete env.CLIWORKER_TEST_CLOCK_FILE
    const cli = (...args) => spawnSync(process.execPath, ['bin/cliworker.mjs', ...args, '--config', cfg], { env, encoding: 'utf8' })
    assert.equal(cli('doctor').status, 0)
    const backup = cli('state', 'backup'); assert.equal(backup.status, 0, backup.stdout)
    assert(!fs.existsSync(path.join(state, 'backups', JSON.parse(backup.stdout).backup, 'data', 'leftover.tmp')))
  } finally { if (child && child.exitCode === null && child.signalCode === null) child.kill(); fs.rmSync(root, { recursive: true, force: true }) }
})
