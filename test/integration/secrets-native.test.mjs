import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import crypto from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

for (const source of ['from-env', 'stdin']) test(`[AC-032] ${source} persists across processes and injects declared env only`, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-secret-persist-'))
  const token = crypto.randomBytes(32).toString('hex')
  const key = crypto.randomBytes(32).toString('hex')
  try {
    const config = path.join(temp, 'config.json')
    fs.writeFileSync(config, JSON.stringify({ providers: {}, models: {}, state_dir: path.join(temp, 'state') }))
    const preload = path.join(temp, 'preload.mjs')
    fs.writeFileSync(preload, `import cp from 'node:child_process'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
const original = cp.spawnSync
const key = Buffer.from(process.env.CW_TEST_KEY, 'hex')
const encrypt = text => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([c.update(text, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64') }
const decrypt = text => { const b = Buffer.from(text, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8') }
cp.spawnSync = (command, args, options) => {
  if (command === 'pwsh') return { status: 0, stdout: args.at(-1).includes('::Protect(') ? encrypt(options.input) : decrypt(options.input), stderr: '' }
  if (command === 'secret-tool' || command === 'security') {
    let action, service, entry, value
    if (command === 'secret-tool') { action = args[0]; service = args[args.indexOf('service') + 1]; entry = args[args.indexOf('entry') + 1]; value = options.input }
    else if (args[0] === '-i') { const fields = [...options.input.matchAll(/"((?:\\\\.|[^"\\\\])*)"/g)].map(m => m[1].replace(/\\\\([\\\\"])/g, '$1')); [service, entry, value] = fields; action = 'store' }
    else { action = args[0] === 'find-generic-password' ? 'lookup' : 'clear'; service = args[args.indexOf('-s') + 1]; entry = args[args.indexOf('-a') + 1] }
    const file = path.join(process.env.CW_TEST_STORE, crypto.createHash('sha256').update(service + '\\0' + entry).digest('hex'))
    if (action === 'store') { fs.writeFileSync(file, encrypt(value)); return { status: 0, stdout: '', stderr: '' } }
    if (!fs.existsSync(file)) return { status: command === 'security' ? 44 : 1, stdout: '', stderr: '' }
    if (action === 'clear') { fs.unlinkSync(file); return { status: 0, stdout: '', stderr: '' } }
    return { status: 0, stdout: decrypt(fs.readFileSync(file, 'utf8')), stderr: '' }
  }
  return original(command, args, options)
}
syncBuiltinESMExports()
`)
    const consumer = path.join(temp, 'consume.mjs')
    fs.writeFileSync(consumer, `import { createContext } from ${JSON.stringify(pathToFileURL(path.join(root, 'lib/context.mjs')).href)}
import { loadConfig } from ${JSON.stringify(pathToFileURL(path.join(root, 'lib/config.mjs')).href)}
import { runWithSecrets } from ${JSON.stringify(pathToFileURL(path.join(root, 'lib/secrets/index.mjs')).href)}
const env = { ...process.env }; delete env.CW_TEST_KEY; delete env.CW_TEST_STORE; delete env.NODE_OPTIONS
const ctx = createContext({ env }); const config = loadConfig({ file: process.argv[2], ctx })
const result = runWithSecrets(ctx, config, 'kimi', { command: process.execPath, args: [process.argv[3]], env_names: ['KIMI_API_KEY'] })
if (!result.ok) process.exit(1); process.stdout.write(result.stdout)
`)
    const fake = path.join(temp, 'fake.mjs')
    fs.writeFileSync(fake, `import crypto from 'node:crypto'
const hashes = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, crypto.createHash('sha256').update(v).digest('hex')]))
process.stdout.write(JSON.stringify({ hashes, argv: process.argv }))
`)
    const env = { ...process.env, CLIWORKER_HOME: path.join(temp, 'home'), CW_TEST_KEY: key, CW_TEST_STORE: temp, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` }
    delete env.SENTINEL
    delete env.CW_FLOW_SENTINEL
    const run = (args, childEnv, input) => {
      const r = spawnSync(process.execPath, args, { env: childEnv, input, encoding: 'utf8', windowsHide: true })
      assert.equal(r.status, 0, 'child failed')
      return JSON.parse(r.stdout)
    }
    const cli = path.join(root, 'bin/cliworker.mjs')
    const setArgs = [cli, 'auth', 'set', 'kimi', ...(source === 'from-env' ? ['--from-env', 'SENTINEL'] : []), '--config', config]
    assert.equal(run(setArgs, source === 'from-env' ? { ...env, SENTINEL: token } : env, source === 'stdin' ? `${token}\n` : undefined).state, 'set')
    assert.equal(run([cli, 'auth', 'status', 'kimi', '--config', config], env).state, 'set')
    const result = run([consumer, config, fake], env)
    const hash = crypto.createHash('sha256').update(token).digest('hex')
    assert.deepEqual(Object.keys(result.hashes).filter(k => result.hashes[k] === hash), ['KIMI_API_KEY'])
    assert.ok(result.argv.every(arg => !arg.includes(token)))
    assert.equal(run([cli, 'auth', 'clear', 'kimi', '--config', config], env).state, 'unset')
    assert.equal(run([cli, 'auth', 'status', 'kimi', '--config', config], env).state, 'unset')
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})

test('[AC-032] real CLI reports an absent default credential as unset', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-secret-status-'))
  try {
    const config = path.join(temp, 'config.json')
    fs.writeFileSync(config, JSON.stringify({ providers: {}, models: {}, state_dir: path.join(temp, 'state') }), 'utf8')
    const preload = path.join(temp, 'preload.mjs')
    fs.writeFileSync(preload, `import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
const original = cp.spawnSync
cp.spawnSync = (command, args, options) => {
  if (command === 'secret-tool') return { status: 1, stdout: '', stderr: '' }
  if (command === 'security') return { status: 44, stdout: '', stderr: '' }
  return original(command, args, options)
}
syncBuiltinESMExports()
`, 'utf8')
    const result = spawnSync(process.execPath, [path.join(root, 'bin/cliworker.mjs'), 'auth', 'status', 'kimi', '--config', config], {
      encoding: 'utf8', windowsHide: true, env: { ...process.env, CLIWORKER_HOME: path.join(temp, 'home'), NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` },
    })
    assert.equal(result.status, 0, `child command failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, state: 'unset' })
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
