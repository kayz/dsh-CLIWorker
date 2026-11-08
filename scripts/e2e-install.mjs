import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('..', import.meta.url))
export function runInstall() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-install-'))
  console.log(`workdir: ${work}`)
  try {
    const pack = path.join(work, 'pack'), app = path.join(work, 'app')
    fs.mkdirSync(pack, { recursive: true })
    fs.mkdirSync(app, { recursive: true })
    const env = { ...process.env, HOME: work, USERPROFILE: work, CLIWORKER_HOME: path.join(work, 'home'), npm_config_cache: path.join(work, 'cache'), PATH: `${path.join(app, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH}` }
    delete env.CLIWORKER_CONFIG; delete env.CLIWORKER_TEST_CLOCK_FILE
    const candidate = process.env.npm_execpath || path.resolve(path.dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js')
    function run(label, cmd, args, cwd, shell = false) {
      const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', shell })
      if (r.error || r.status !== 0) throw new Error(`${label} failed: ${r.error?.message || r.stderr || r.stdout}`)
      return r.stdout
    }
    const npm = (label, args) => fs.existsSync(candidate) ? run(label, process.execPath, [candidate, ...args], root) : run(label, 'npm', args, root, true)
    const packed = JSON.parse(npm('npm pack', ['pack', '--pack-destination', pack, '--json', '--ignore-scripts']))[0]
    const forbidden = ['contracts/golden', 'contracts/spec', ['.', 'coll', 'ab'].join(''), 'test', 'scripts']
    for (const f of packed.files) assert(!forbidden.some(p => f.path === p || f.path.startsWith(`${p}/`)), `pack includes ${f.path}`)
    npm('npm install', ['install', path.join(pack, packed.filename), '--prefix', app, '--offline', '--ignore-scripts', '--no-audit', '--no-fund'])
    const installed = path.join(app, 'node_modules', 'dsh-cliworker')
    for (const p of forbidden) assert(!fs.existsSync(path.join(installed, ...p.split('/'))), `installed ${p}`)
    const shim = path.join(app, 'node_modules', '.bin', process.platform === 'win32' ? 'cliworker.cmd' : 'cliworker')
    assert(fs.existsSync(shim), 'missing cliworker shim')
    const cli = args => JSON.parse(run('cliworker', 'cliworker', args, app, process.platform === 'win32'))
    assert.equal(cli(['--version']).version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version)
    const config = path.join(work, 'config.json')
    fs.writeFileSync(config, JSON.stringify({ schema: 'cliworker.config/v2', state_dir: 'state', discovery: { cli_overrides: {} }, catalog: { manual: [], allow: [], levels: {}, aliases: {}, deprecated: {} }, pools: [], policy: {}, secrets: {} }))
    assert.equal(cli(['doctor', '--config', config]).status, 'ok')
    const code = "const m=await import('dsh-cliworker'); const host={inject(s,cb){cb({effect(fn){return fn()},webServer:{register(){}}})}}; m.apply(host,{configPath:process.argv[1]}); console.log(JSON.stringify(m.getRegistration()))"
    const registration = JSON.parse(run('registration', process.execPath, ['--input-type=module', '-e', code, config], app))
    assert.equal(registration.status, 'ok'); assert.deepEqual(registration.errors, [])
    console.log('e2e-install: ok')
  } finally { fs.rmSync(work, { recursive: true, force: true }); console.log('cleanup: ok') }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { runInstall() } catch (e) { console.error(`e2e-install: ${e.message}`); process.exitCode = 1 }
}
