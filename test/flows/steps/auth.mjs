import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { leakScan } from '../../helpers/leak-scan.mjs'

export const name = 'auth'
export const introduced_by = 'T-013'
export const ac = ['AC-032']

const REPO = fileURLToPath(new URL('../../..', import.meta.url))
const hash = value => crypto.createHash('sha256').update(value).digest('hex')

// This fixture is generated inside flow.root only. It intercepts backend spawnSync calls,
// leaving the real bin, config, auth, exec and credential consumer in the execution path.
const PRELOAD = String.raw`import cp from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
const original = cp.spawnSync
const key = Buffer.from(process.env.CW_TEST_SECRET_KEY, 'hex')
const store = process.env.CW_TEST_SECRET_STORE
const failure = process.env.CW_TEST_SECRET_FAIL
const encrypt = value => {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
}
const decrypt = value => {
  const data = Buffer.from(value, 'base64')
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
  cipher.setAuthTag(data.subarray(12, 28))
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')
}
const result = (status = 0, stdout = '', stderr = '') => ({ status, stdout, stderr })
cp.spawnSync = (command, args, options) => {
  const tool = path.basename(command).toLowerCase().replace(/\.exe$/, '')
  const dpapi = tool === 'pwsh' && args.includes('-Command') && /::(?:Unprotect|Protect)\(/.test(args.at(-1))
  const security = tool === 'security' && ['-i', 'find-generic-password', 'delete-generic-password'].includes(args[0])
  const linux = tool === 'secret-tool' && ['store', 'lookup', 'clear'].includes(args[0])
  if (!dpapi && !security && !linux) return original(command, args, options)
  if (failure === 'ENOENT') return { ...result(null), error: Object.assign(new Error('backend unavailable'), { code: 'ENOENT' }) }
  if (failure) return result(2, '', 'backend denied access')
  try {
    if (options.shell !== false) throw new Error('backend must not use a shell')
    const record = value => {
      // The authorized stdin value is checked only in memory, before recording argv.
      const bytes = Buffer.from(value, 'utf8')
      const forms = [value, bytes.toString('base64'), bytes.toString('hex')]
      if (args.some(arg => forms.some(form => form && arg.includes(form)))) throw new Error('credential in backend argv')
      fs.appendFileSync(path.join(store, 'backend-calls.jsonl'), JSON.stringify({ command, args }) + '\n', 'utf8')
    }
    if (dpapi) {
      const protecting = args.at(-1).includes('::Protect(')
      const value = protecting ? options.input : decrypt(options.input)
      record(value)
      return result(0, protecting ? encrypt(value) : value)
    }
    let action, service, entry, value
    if (linux) {
      action = args[0]
      service = args[args.indexOf('service') + 1]
      entry = args[args.indexOf('entry') + 1]
      value = options.input
    } else if (args[0] === '-i') {
      // Parse only the production command grammar, including escaped quotes/backslashes.
      const match = /^add-generic-password -U -s ("(?:\\.|[^"\\])*") -a ("(?:\\.|[^"\\])*") -w ("(?:\\.|[^"\\])*")\n$/.exec(options.input)
      if (!match) throw new Error('invalid interactive command')
      const unquote = text => text.slice(1, -1).replace(/\\([\\"])/g, '$1')
      ;[service, entry, value] = match.slice(1).map(unquote)
      action = 'store'
    } else {
      action = args[0] === 'find-generic-password' ? 'lookup' : 'clear'
      service = args[args.indexOf('-s') + 1]
      entry = args[args.indexOf('-a') + 1]
    }
    const file = path.join(store, crypto.createHash('sha256').update(service + '\0' + entry).digest('hex'))
    if (action === 'store') { record(value); fs.writeFileSync(file, encrypt(value), 'utf8'); return result() }
    if (!fs.existsSync(file)) return result(security ? 44 : 1)
    const stored = decrypt(fs.readFileSync(file, 'utf8'))
    record(stored)
    if (action === 'clear') { fs.unlinkSync(file); return result() }
    return result(0, stored + '\n')
  } catch { return result(2, '', 'isolated backend failure') }
}
syncBuiltinESMExports()
`

const FAKE = String.raw`import fs from 'node:fs'
import crypto from 'node:crypto'
const record = {
  argv: process.argv.slice(2),
  names: Object.keys(process.env),
  hashes: Object.fromEntries(Object.entries(process.env).map(([name, value]) => [name, crypto.createHash('sha256').update(value).digest('hex')])),
}
fs.writeFileSync(process.argv[2], JSON.stringify(record), 'utf8')
process.stdout.write(JSON.stringify(record))
`

export function scanAuth(flow) {
  for (const state_dir of [flow.state_dir, flow.root]) {
    const scan = leakScan({
      sentinels: flow.sentinels, ...flow.captured, state_dir,
      auditFile: path.join(flow.state_dir, 'audit.jsonl'),
    })
    assert.equal(scan.ok, true, 'auth leaked a sentinel')
    assert.deepEqual(scan.hits, [])
    assert.deepEqual(scan.errors, [])
  }
}

export function snapshotAuth(directory) {
  if (!fs.existsSync(directory)) return null
  const rows = []
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix + entry.name
      rows.push([rel, entry.isDirectory() ? null : fs.readFileSync(path.join(dir, entry.name)).toString('hex')])
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + '/')
    }
  }
  walk(directory, '')
  return rows
}

export function createAuthFixture(flow) {
  const savedEnv = { ...flow.env }
  const savedConfig = fs.readFileSync(flow.config_path)
  const dir = path.join(flow.root, 'auth-fixture')
  fs.mkdirSync(path.join(dir, 'store'), { recursive: true })
  const preload = path.join(dir, 'preload.mjs')
  const consumer = path.join(dir, 'consume.mjs')
  const fake = path.join(dir, 'fake-cli.mjs')
  const record = path.join(dir, 'provider.json')
  fs.writeFileSync(preload, PRELOAD, 'utf8')
  fs.writeFileSync(fake, FAKE, 'utf8')
  const moduleUrl = file => JSON.stringify(pathToFileURL(path.join(REPO, 'lib', file)).href)
  fs.writeFileSync(consumer, `import { createContext } from ${moduleUrl('context.mjs')}
import { loadConfig } from ${moduleUrl('config.mjs')}
import { runWithSecrets } from ${moduleUrl('secrets/index.mjs')}
import { errorBodyFrom, exitCodeFor } from ${moduleUrl('output.mjs')}
// The preload already captured its private configuration. Providers never receive it.
const env = { ...process.env }
for (const key of Object.keys(env)) if (key.startsWith('CW_TEST_SECRET_') || key === 'NODE_OPTIONS') delete env[key]
const ctx = createContext({ env })
try {
  const config = loadConfig({ file: process.argv[2], ctx })
  const result = runWithSecrets(ctx, config, 'kimi', { command: process.execPath, args: [process.argv[3], process.argv[4]], env_names: ['KIMI_API_KEY'] })
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.ok ? 0 : 1
} catch (error) {
  process.stdout.write(JSON.stringify(errorBodyFrom(error)))
  process.exitCode = exitCodeFor(error.code)
}
`, 'utf8')
  for (const key of Object.keys(flow.env)) {
    if (flow.sentinels.some(s => String(flow.env[key]).includes(s.value))) delete flow.env[key]
  }
  Object.assign(flow.env, {
    CW_TEST_SECRET_KEY: crypto.randomBytes(32).toString('hex'),
    CW_TEST_SECRET_STORE: path.join(dir, 'store'),
    NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
  })
  delete flow.env.CW_TEST_SECRET_FAIL
  const config = (reference, state = flow.state_dir, file = flow.config_path) => {
    const value = { providers: {}, models: {}, state_dir: state }
    if (reference !== undefined) value.secrets = { kimi: { ref: reference } }
    fs.writeFileSync(file, JSON.stringify(value), 'utf8')
    return file
  }
  const cli = (action, options = {}) => flow.run([
    'auth', action, 'kimi', ...(options.source ? ['--from-env', 'SENTINEL'] : []),
    '--config', options.config ?? flow.config_path,
  ], { env: options.source ? { SENTINEL: options.value } : {}, input: options.input })
  const consume = (file = flow.config_path) => {
    fs.rmSync(record, { force: true })
    return flow.spawn(process.execPath, [consumer, file, fake, record])
  }
  const checkConsumed = (result, value) => {
    assert.equal(result.code, 0, 'credential consumption failed')
    assert.ok(fs.existsSync(record), 'provider did not execute')
    const observed = JSON.parse(fs.readFileSync(record, 'utf8'))
    const expected = hash(value)
    assert.equal(observed.hashes.KIMI_API_KEY === expected, true, 'provider received the wrong credential')
    assert.deepEqual(Object.keys(observed.hashes).filter(key => observed.hashes[key] === expected), ['KIMI_API_KEY'])
    assert.deepEqual([...observed.names].sort(), Object.keys(observed.hashes).sort())
    assert.equal(observed.names.some(key => key.startsWith('CW_TEST_SECRET_') || key === 'NODE_OPTIONS'), false)
    for (const arg of observed.argv) assert.equal(arg.includes(value), false, 'provider argv contains credential')
    assert.deepEqual(result.json, observed)
  }
  return {
    dir, record, config, cli, consume, checkConsumed,
    cleanup() {
      fs.writeFileSync(flow.config_path, savedConfig)
      for (const key of Object.keys(flow.env)) delete flow.env[key]
      Object.assign(flow.env, savedEnv)
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

export async function run(flow) {
  const fixture = createAuthFixture(flow)
  try {
    fixture.config()
    for (const source of ['from-env', 'stdin']) {
      const value = flow.sentinels[0].value
      const set = fixture.cli('set', source === 'from-env' ? { source: true, value } : { input: value + '\r\n' })
      assert.equal(set.code, 0, 'auth set failed')
      assert.deepEqual(set.json, { ok: true, state: 'set' })
      scanAuth(flow)
      const status = fixture.cli('status')
      assert.equal(status.code, 0, 'auth status failed')
      assert.deepEqual(status.json, { ok: true, state: 'set' })
      fixture.checkConsumed(fixture.consume(), value)
      scanAuth(flow)
      const clear = fixture.cli('clear')
      assert.equal(clear.code, 0, 'auth clear failed')
      assert.deepEqual(clear.json, { ok: true, state: 'unset' })
      assert.deepEqual(fixture.cli('status').json, { ok: true, state: 'unset' })
      scanAuth(flow)
    }
  } finally { fixture.cleanup() }
}
