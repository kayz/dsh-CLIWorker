import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const node = fs.realpathSync(process.execPath)
const npm = path.join(path.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const key = 'claude:alpha-fixture'
const inside = (base, target) => {
  const fold = s => process.platform === 'win32' ? s.toLowerCase() : s
  const rel = path.relative(fold(base), fold(target))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'))

export function check(tarball) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-alpha-')))
  const state = path.join(root, 'state'), install = path.join(root, 'install'), config = path.join(root, 'config.json')
  const env = { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT, PATH: [path.join(install, 'node_modules', '.bin'), path.dirname(node), process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32')].filter(Boolean).join(path.delimiter) }
  for (const name of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TEMP', 'TMP', 'TMPDIR', 'CLIWORKER_HOME']) env[name] = root
  Object.assign(env, { npm_config_cache: path.join(root, 'cache'), npm_config_userconfig: path.join(root, 'userconfig'), npm_config_globalconfig: path.join(root, 'globalconfig'), npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' })
  const run = (label, command, args, cwd = install, input, extra = {}) => {
    const r = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, ...extra })
    if (r.error || r.signal || r.status !== 0) throw new Error(`${label}: expected exit 0, actual ${r.status}, signal ${r.signal}, error ${r.error?.message || ''}; stdout: ${r.stdout}; stderr: ${r.stderr}`)
    return r.stdout
  }
  const json = (label, value) => { try { return JSON.parse(value) } catch (e) { throw new Error(`${label}: invalid JSON: ${e.message}; output: ${value.slice(0, 1000)}`) } }
  try {
    assert(!inside(fs.realpathSync(repo), root), 'temporary root is inside repository')
    fs.mkdirSync(install)
    let packed
    if (tarball === undefined) {
      packed = json('npm pack', run('npm pack', node, [npm, 'pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', root], repo))[0]
      tarball = path.resolve(root, packed.filename)
      assert(inside(root, tarball), 'npm pack filename outside temporary root')
    } else {
      assert(!tarball.startsWith('-') && tarball.endsWith('.tgz'), 'expected a local .tgz path')
      tarball = path.resolve(tarball)
    }
    assert(fs.statSync(tarball).isFile(), 'tarball must be a file')
    run('npm install', node, [npm, 'install', tarball, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'])
    const pkg = path.join(install, 'node_modules', 'dsh-cliworker')
    assert(fs.lstatSync(pkg).isDirectory() && inside(install, fs.realpathSync(pkg)), 'installed package must be a local directory')
    const manifest = read(path.join(pkg, 'package.json'))
    const entry = fs.realpathSync(path.join(pkg, manifest.bin.cliworker))
    assert(inside(pkg, entry) && fs.statSync(entry).isFile(), 'bin.cliworker must be a file inside package')
    const shim = path.join(install, 'node_modules', '.bin', process.platform === 'win32' ? 'cliworker.cmd' : 'cliworker')
    assert(fs.statSync(shim).isFile(), 'installed cliworker shim missing')
    // Use the installed shim for a real invocation; subsequent commands use its installed entry.
    const versionOutput = process.platform === 'win32' ? run('shim --version', env.ComSpec, ['/d', '/s', '/c', `""${shim}" --version"`], install, undefined, { windowsVerbatimArguments: true }) : run('shim --version', shim, ['--version'])
    const version = json('version', versionOutput)
    assert.equal(version.ok, true); assert.equal(version.version, manifest.version)
    if (packed) { assert.equal(packed.version, manifest.version); assert.equal(read(path.join(repo, 'package.json')).version, manifest.version) }
    const now = new Date(), at = now.toISOString()
    const fake = path.join(root, 'provider.mjs')
    fs.writeFileSync(fake, `let s=''; for await (const x of process.stdin) s+=x; const a=process.argv.slice(2); const id=a[a.indexOf('--model')+1]; const text=s.includes('nonce')?s.trim().split(/\\s+/).at(-1):'fixture run ok'; console.log(JSON.stringify({type:'result',model:'claude:'+id,text,usage:{input_tokens:7,output_tokens:3,cache_read_tokens:0,cache_write_tokens:0}}))\n`)
    const model = { schema:'cliworker.model/v1', key, id:'alpha-fixture', cli:node, provider:'claude', vendor:'anthropic', aliases:[], allowed:false, level:'Top', level_source:{kind:'config',ref:'fixture',at}, availability:{state:'unverified',reason:null,at:null,ttl_s:null,evidence:null}, identity:'verified', capabilities:{context_tokens:200000,readonly:true,stdin:true}, prices:{input_per_mtok:3,output_per_mtok:15,source:'manual'}, source:{kind:'manual',ref:'fixture',at}, deprecated:false }
    fs.writeFileSync(config, JSON.stringify({schema:'cliworker.config/v2',state_dir:state,secrets:{},discovery:{extra_dirs:[],wsl:false,probe_unknown:false,unknown_patterns:[],cli_overrides:{claude:{cli:node,args_prefix:[fake],adapter:'claude',readonly:true}}},catalog:{allow:[key],levels:{[key]:'Top'},aliases:{},deprecated:{},manual:[model]},pools:[{id:'claude:plan-fixture',cli:'claude',kind:'plan_window',funding:'plan',window:{length_s:18000,anchor:'rolling',start_at:new Date(+now-3600000).toISOString(),reset_at:new Date(+now+3600000).toISOString(),reset_source:'config'},capacity_mtok:{[key]:{value:10,source:'config'}},used_fraction:{value:0.5,source:'config',at},credits_per_mtok:null}],policy:{probe_ttl_s:21600,lease_ttl_s:7200,reading_ttl_s:600,lock_stale_ms:30000,lock_wait_ms:5000,lock_poll_ms:25,session_ttl_s:43200,reserve_fraction_for_high:0.15,unknown_policy:'after_known',usage_estimate_mtok:{Heavy:2,Normal:0.5,Light:0.1},cache_read_weight:0,probe_schedule:null}}))
    const command = (...args) => json(args.join(' '), run(args.join(' '), node, [entry, ...args, '--config', config]))
    const doctor = command('doctor'); assert.equal(doctor.status, 'ok'); assert(Array.isArray(doctor.checks) && doctor.checks.length && doctor.checks.every(c => c.ok === true), 'doctor checks unhealthy'); assert.equal(doctor.checks.find(c => c.id === 'inventory')?.detail, 'not generated')
    const inventory = command('discover', '--full'); assert.equal(inventory.schema, 'cliworker.inventory/v1'); assert(Array.isArray(inventory.entries)); assert(!Number.isNaN(Date.parse(inventory.generated_at))); assert.deepEqual(read(path.join(state, 'inventory.json')), inventory)
    const models = command('models', 'enumerate'); assert.equal(models.schema, 'cliworker.models/v1'); assert(models.models.some(m => m.key === key))
    const probe = command('models', 'probe'); assert(probe.models.some(m => m.key === key && m.availability.state === 'callable' && m.availability.evidence.nonce_ok === true), 'probe callable/nonce mismatch')
    assert(read(path.join(state, 'probes.json')).some(m => m.key === key && m.availability.evidence.nonce_ok)); assert(fs.readFileSync(path.join(state, 'usage.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse).some(r => r.kind === 'probe' && r.model === key))
    const request = {schema:'cliworker.request/v1',request_id:'alpha-fixture',level:'Top',count:1,usage:'Normal',importance:'high',require_readonly:true,cwd:install,timeout_ms:60000}
    const selection = command('models', 'select', '--request', JSON.stringify(request)); assert.equal(selection.schema, 'cliworker.selection/v1'); assert.equal(selection.ok, true); assert.equal(selection.count_returned, 1)
    const handle = selection.models[0], call = selection.calls[0]; assert(handle.lease_id && call.command && call.args); assert.equal(fs.realpathSync(call.command), node); assert.equal(call.args[call.args.indexOf('--lease') + 1], handle.lease_id); assert.equal(call.args[call.args.indexOf('--config') + 1], config); assert.equal(call.args[call.args.indexOf('--state-dir') + 1], state); assert(call.args.some(a => path.resolve(a) === entry), 'run call missing installed entry')
    const events = run('run call', call.command, call.args, install, 'fixture input').split(/\r?\n/).filter(Boolean).map(line => json('run event', line)); assert(events.every(e => e.schema === 'cliworker.event/v1' && e.lease_id === handle.lease_id)); assert.equal(events[0].type, 'start'); const last = events.at(-1); assert.equal(last.type, 'result'); assert.equal(last.ok, true); assert.equal(last.text, 'fixture run ok'); assert(last.usage.input_tokens === 7 && last.usage.output_tokens === 3)
    const rows = fs.readFileSync(path.join(state, 'usage.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(line => json('usage row', line)); assert(rows.some(r => r.idempotency_key === `${handle.lease_id}:post` && r.model === key && r.input_tokens === 7 && r.output_tokens === 3), 'run usage record missing')
    const marker = path.join(state, 'marker'); fs.writeFileSync(marker, 'before'); const backup = command('state', 'backup'); assert.equal(backup.ok, true); assert.equal(typeof backup.backup, 'string'); fs.writeFileSync(marker, 'after'); const restore = command('state', 'restore', '--from', backup.backup); assert.equal(restore.ok, true); assert.equal(fs.readFileSync(marker, 'utf8'), 'before')
    for (const rel of ['ui/index.html', 'ui/app.mjs', 'ui/render.mjs', 'docs/ui/cliworker-console.html']) { const file = path.join(pkg, rel); assert(fs.existsSync(file) && fs.statSync(file).isFile() && fs.readFileSync(file).length > 0, `missing or empty ${rel}`) }
  } finally {
    assert(inside(fs.realpathSync(os.tmpdir()), root) && !inside(fs.realpathSync(repo), root) && path.basename(root).startsWith('cliworker-alpha-'), 'unsafe cleanup root')
    fs.rmSync(root, { recursive:true, force:true }); assert(!fs.existsSync(root), 'temporary cleanup failed')
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assert(process.argv.length <= 3, 'expected at most one local tarball'); check(process.argv[2]); console.log('AC-088 OK') } catch (e) { console.error(`alpha package: ${e.stack || e}`); process.exitCode = 1 }
}
