import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createContext } from '../lib/context.mjs'
import { run as discover } from '../lib/commands/discover.mjs'
import { parseDistros } from '../lib/discovery/wsl.mjs'
import { errorBody, exitCodeFor } from '../lib/output.mjs'
import { createExec } from '../lib/exec.mjs'
import { createFlow } from '../test/helpers/flow.mjs'
import { generateFakeCli, readFakeCliRecords } from '../test/helpers/fake-cli.mjs'
import { leakScan } from '../test/helpers/leak-scan.mjs'
import { STEP_IDS, validateReport } from '../test/smoke/report.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = path.join(ROOT, 'bin', 'cliworker.mjs')
const VERSION_FILE = path.join(ROOT, 'package.json')
const TIMEOUT = 60000

function runWorker(args, env, timeout) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let spawnError = false
    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 8 * 1024 * 1024) child.kill() })
    child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 8 * 1024 * 1024) child.kill() })
    child.on('error', () => { spawnError = true })
    const timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        const fallback = () => { try { child.kill('SIGKILL') } catch { /* already exited */ } }
        killer.on('error', fallback)
        killer.on('close', code => { if (code !== 0) fallback() })
      } else {
        try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* already exited */ } }
      }
    }, timeout)
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0 && !timedOut && !spawnError, stdout, stderr }) })
  })
}

function safeEnvironment(root, sentinel) {
  const env = {}
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'SYSTEMDRIVE']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  env.PATH = [path.join(root, 'fake-cli'), path.dirname(process.execPath), process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32')].filter(Boolean).join(path.delimiter)
  env.HOME = path.join(root, 'home')
  env.USERPROFILE = env.HOME
  env.TEMP = root
  env.TMP = root
  env.CLIWORKER_HOME = env.HOME
  env.CW_FLOW_SENTINEL = sentinel
  return env
}

function invoke(command, args, env, captured, options = {}) {
  captured.argv.push([command, ...args])
  const result = spawnSync(command, args, { env, encoding: options.binary ? null : 'utf8', timeout: TIMEOUT, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
  captured.stdout.push(result.stdout || '')
  captured.stderr.push(result.stderr || '')
  if (result.error || result.status !== 0) throw new Error('external command failed or timed out')
  return result.stdout
}

function sameSet(a, b) {
  return a.length === b.length && a.every(value => b.includes(value))
}

// Release prerequisites that are not one of the seven report steps. They run against the same
// isolated fixture root as every other dry-run action, so no user state is read or written.
export function preflight(flow, version) {
  const pkg = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'))
  const engine = String(pkg.engines?.node ?? '')
  const minimum = /^>=\s*(\d+)/.exec(engine)
  const major = Number(process.versions.node.split('.')[0])
  if (minimum !== null && major < Number(minimum[1])) throw new Error('preflight: Node version does not satisfy engines')
  const cli = flow.run(['--version'])
  if (cli.code !== 0 || cli.json?.ok !== true || cli.json?.version !== version) throw new Error('preflight: CLI --version failed')
  const doctor = flow.run(['doctor', '--config', flow.config_path])
  if (doctor.code !== 0 || doctor.json?.status !== 'ok') throw new Error('preflight: doctor is not healthy')
  const marker = path.join(flow.state_dir, 'smoke-roundtrip.marker')
  fs.mkdirSync(flow.state_dir, { recursive: true })
  fs.writeFileSync(marker, 'before', 'utf8')
  const backup = flow.run(['state', 'backup', '--config', flow.config_path])
  if (backup.code !== 0 || typeof backup.json?.backup !== 'string') throw new Error('preflight: state backup failed')
  fs.writeFileSync(marker, 'after', 'utf8')
  const restore = flow.run(['state', 'restore', '--from', backup.json.backup, '--config', flow.config_path])
  if (restore.code !== 0 || fs.readFileSync(marker, 'utf8') !== 'before') throw new Error('preflight: state restore roundtrip mismatch')
}

// Failure reasons stay useful without echoing paths, distro names or raw command output.
function safeReason(id, error) {
  const message = String(error && error.message ? error.message : '')
  if (message.startsWith('preflight:')) return message.replace(/\s+/g, ' ').slice(0, 160)
  if (id === 'wsl-discover') {
    if (/Node 20/.test(message)) return 'WSL requires Node 20 or later'
    if (/no distributions/.test(message)) return 'WSL has no distributions'
    if (/distribution set changed/.test(message)) return 'WSL distribution set changed'
    if (/Windows and WSL/.test(message)) return 'real smoke requires Windows'
    if (/WSL executable/.test(message)) return 'WSL executable unavailable'
    if (/WSL environment mismatch/.test(message)) return 'WSL environment mismatch'
    if (/distribution discovery/.test(message)) return 'WSL distribution discovery failed'
  }
  return `${id} failed`
}

export async function fixtureWsl(root, captured) {
  const expected = ['Ubuntu', 'Space Distro']
  const input = Buffer.from('\uFEFFUbuntu\0\r\nSpace Distro\r\nUbuntu\r\n', 'utf16le')
  assert.deepEqual(parseDistros(input), expected)
  assert.deepEqual(parseDistros(input.subarray(2)), expected)
  const ctx = createContext({ platform: 'win32', env: { PATH: '' }, exec(command, args) {
    assert.equal(command, 'wsl')
    assert.deepEqual(args, ['-l', '-q'])
    return { ok: true, code: 0, stdout: input.toString('utf16le') }
  } })
  const inventory = await discover({ argv: [], ctx, config: { _home: path.join(root, 'wsl-fixture'), discovery: { wsl: true } } })
  captured.stdout.push(JSON.stringify(inventory))
  assert.deepEqual(inventory.host.wsl_distros, expected)
}

export async function realWsl(root, env, captured, originalPath) {
  if (process.platform !== 'win32') throw new Error('Windows and WSL are required')
  const systemEnv = { ...env, PATH: originalPath }
  const wslExe = path.join(process.env.SystemRoot || process.env.WINDIR || '', 'System32', 'wsl.exe')
  if (!path.isAbsolute(wslExe) || !fs.existsSync(wslExe)) throw new Error('WSL executable unavailable')
  const list = () => parseDistros(invoke(wslExe, ['-l', '-q'], systemEnv, captured, { binary: true }))
  const expected = list()
  if (!expected.length) throw new Error('WSL has no distributions')
  const executor = createExec({ env: systemEnv, fs, platform: process.platform })
  const ctx = createContext({ env: systemEnv, exec(command, args) {
    const isWsl = /^(?:wsl|wsl\.exe)$/i.test(command)
    if (isWsl) {
      const output = invoke(wslExe, args, systemEnv, captured, { binary: true })
      return { ok: true, code: 0, stdout: output.toString('utf16le') }
    }
    captured.argv.push([command, ...args])
    const result = executor.runSync(command, args, { env: systemEnv, timeout: TIMEOUT })
    captured.stdout.push(result.stdout)
    captured.stderr.push(result.stderr)
    return result
  } })
  const inventory = await discover({ argv: [], ctx, config: { _home: path.join(root, 'windows-inventory'), discovery: { wsl: true, probe_unknown: false } } })
  captured.stdout.push(JSON.stringify(inventory))
  if (!sameSet(expected, inventory.host.wsl_distros)) throw new Error('WSL distribution set changed')
  for (const [index, distro] of expected.entries()) {
    const distroRoot = path.join(root, `distro-${index}`)
    fs.mkdirSync(distroRoot, { recursive: true })
    fs.mkdirSync(path.join(distroRoot, 'home'), { recursive: true })
    const configFile = path.join(distroRoot, 'config.json')
    fs.writeFileSync(configFile, JSON.stringify({ schema: 'cliworker.config/v1', state_dir: 'state', providers: {}, models: {} }), 'utf8')
    const wsl = args => invoke(wslExe, ['-d', distro, '--exec', ...args], systemEnv, captured).trim()
    const linuxRoot = wsl(['wslpath', '-a', '-u', distroRoot])
    const linuxBin = wsl(['wslpath', '-a', '-u', BIN])
    const linuxConfig = wsl(['wslpath', '-a', '-u', configFile])
    let nodeVersion
    try { nodeVersion = wsl(['node', '--version']) } catch { throw new Error('WSL requires Node 20 or later') }
    if (!/^v(?:[2-9]\d|[1-9]\d{2,})\./.test(nodeVersion)) throw new Error('WSL requires Node 20 or later')
    const linuxPath = wsl(['printenv', 'PATH'])
    const observedDistro = wsl(['printenv', 'WSL_DISTRO_NAME'])
    if (observedDistro !== distro || !linuxPath) throw new Error('WSL environment mismatch')
    const output = wsl(['env', '-i', `HOME=${linuxRoot}/home`, `CLIWORKER_HOME=${linuxRoot}/home`, `WSL_DISTRO_NAME=${observedDistro}`, `PATH=${linuxPath}`, 'node', linuxBin, 'discover', '--config', linuxConfig, '--full'])
    const found = JSON.parse(output)
    if (found.host?.platform !== `wsl:${distro}` || !Array.isArray(found.entries) || found.entries.length === 0 || found.entries.some(entry => entry.platform !== `wsl:${distro}` || entry.status !== 'present')) throw new Error('WSL distribution discovery failed')
  }
  if (!sameSet(expected, list())) throw new Error('WSL distribution set changed; rerun smoke')
}

export async function executeSmoke({ mode = 'dry-run', out = null, hooks = {} } = {}) {
  const version = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')).version
  const report = { schema: 'cliworker.smoke/v1', mode, version, platform: process.platform, node: process.version, steps: [], redacted: true }
  const originalPath = process.env.PATH || process.env.Path || ''
  const flow = createFlow()
  const savedTemp = Object.fromEntries(['TEMP', 'TMP', 'TMPDIR'].map(key => [key, process.env[key]]))
  let failed = false
  let clean = true
  try {
    const env = safeEnvironment(flow.root, flow.sentinel)
    for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = flow.root
    Object.keys(flow.env).forEach(key => delete flow.env[key])
    Object.assign(flow.env, env)
    const records = path.join(flow.root, 'records')
    generateFakeCli({ dir: path.join(flow.root, 'fake-cli'), name: 'claude', mode: 'ok', version: '1.2.3\n', help: '', models: '', modelsArgv: ['models'], recordDir: records })
    const actions = {
      async discover() {
        preflight(flow, version)
        const discoveryEnv = mode === 'real' ? { ...env, PATH: originalPath } : env
        const executor = createExec({ env: discoveryEnv, fs, platform: process.platform })
        const ctx = createContext({ env: discoveryEnv, exec(command, args, options) {
          flow.captured.argv.push([command, ...args])
          const result = executor.runSync(command, args, { ...options, env: discoveryEnv })
          flow.captured.stdout.push(result.stdout)
          flow.captured.stderr.push(result.stderr)
          return result
        } })
        const inv = await discover({ argv: ['--full'], ctx, config: { _home: path.join(flow.root, 'discovery'), discovery: { wsl: false } } })
        flow.captured.stdout.push(JSON.stringify(inv))
        assert.equal(inv.schema, 'cliworker.inventory/v1')
        if (mode === 'dry-run') {
          assert.ok(inv.entries.some(entry => entry.id === 'claude' && entry.status === 'present' && entry.version === '1.2.3'))
          assert.ok(readFakeCliRecords(records).some(record => record.argv.includes('--version')))
        }
      },
      async 'wsl-discover'() { if (mode === 'real') await realWsl(flow.root, env, flow.captured, originalPath); else await fixtureWsl(flow.root, flow.captured) },
    }
    for (const id of STEP_IDS) {
      const start = performance.now()
      const step = { id, ac: [id === 'wsl-discover' ? 'AC-038' : 'AC-069'], mandatory: true, status: 'skip', reason: 'dependency failed', duration_ms: 0 }
      if (!failed) {
        try {
          if (hooks.beforeStep) await hooks.beforeStep(id, flow)
          if (actions[id]) await actions[id]()
          else {
            const args = hooks.workerArgs ? hooks.workerArgs(id) : [path.join(ROOT, 'test', 'smoke', 'http-worker.mjs'), id]
            flow.captured.argv.push([process.execPath, ...args])
            const result = await runWorker(args, env, hooks.workerTimeoutMs ?? 120000)
            flow.captured.stdout.push(result.stdout)
            flow.captured.stderr.push(result.stderr)
            if (!result.ok) throw new Error('flow worker failed or timed out')
            const captured = JSON.parse(result.stdout)
            for (const surface of ['stdout', 'stderr', 'argv', 'http']) flow.captured[surface].push(...captured[surface])
            if (id === 'http-select') assert.ok(captured.http.length > 0)
          }
          step.status = 'pass'; step.reason = null
        } catch (error) {
          failed = true; step.status = 'fail'; step.reason = safeReason(id, error)
        }
      }
      step.duration_ms = Math.max(0, performance.now() - start)
      report.steps.push(step)
    }
  } catch {
    failed = true
    while (report.steps.length < STEP_IDS.length) {
      const id = STEP_IDS[report.steps.length]
      report.steps.push({ id, ac: [id === 'wsl-discover' ? 'AC-038' : 'AC-069'], mandatory: true, status: 'skip', reason: 'internal failure', duration_ms: 0 })
    }
  } finally {
    try {
      if (hooks.beforeScan) await hooks.beforeScan(flow, report)
      const scan = leakScan({ sentinels: flow.sentinels, ...flow.captured, state_dir: flow.root, auditFile: path.join(flow.state_dir, 'audit.jsonl'), stdout: [...flow.captured.stdout, JSON.stringify(report)] })
      if (!scan.ok) {
        failed = true
        const reason = scan.errors.length ? 'scan error' : `sensitive data on ${scan.hits[0].surface}`
        for (const step of report.steps.filter(item => item.status === 'pass')) {
          step.status = 'fail'; step.reason = reason
        }
      }
      if (!validateReport(report, version).ok) failed = true
    } catch { failed = true }
    for (const [key, value] of Object.entries(savedTemp)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    try { flow.cleanup() } catch { clean = false; failed = true }
  }
  if (!clean) { report.steps[0].status = 'fail'; report.steps[0].reason = 'cleanup failed' }
  const json = JSON.stringify(report) + '\n'
  if (out !== null) {
    try { fs.writeFileSync(out, json, 'utf8') } catch { failed = true }
  }
  return { report, failed, json }
}

async function main(argv) {
  let dry = false
  let out = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run' && !dry) dry = true
    else if (argv[i] === '--out' && out === null && i + 1 < argv.length && !argv[i + 1].startsWith('--')) out = argv[++i]
    else { process.stdout.write(JSON.stringify(errorBody('E_REQUEST_INVALID', 'invalid arguments')) + '\n'); return exitCodeFor('E_REQUEST_INVALID') }
  }
  if (!dry && process.env.CLIWORKER_SMOKE !== '1') {
    process.stdout.write(JSON.stringify(errorBody('E_SMOKE_DISABLED', 'real smoke is disabled')) + '\n')
    return exitCodeFor('E_SMOKE_DISABLED')
  }
  try {
    const result = await executeSmoke({ mode: dry ? 'dry-run' : 'real', out })
    process.stdout.write(result.json)
    return result.failed ? exitCodeFor('E_INTERNAL') : 0
  } catch {
    process.stdout.write(JSON.stringify(errorBody('E_INTERNAL', 'smoke failed')) + '\n')
    return exitCodeFor('E_INTERNAL')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2))
