// Shared end-to-end harness: one temporary root and one sentinel set per flow, sequentially
// running the steps auto-discovered from test/flows/steps, then scanning every captured surface.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { leakScan, makeSentinel, normalizeSentinels } from './leak-scan.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const BIN = path.join(REPO_ROOT, 'bin', 'cliworker.mjs')
const CONFIG_SCHEMA = 'cliworker.config/v1'
const FAKE_VERSION = '1.2.3'

export const SENTINEL_ENV = 'CW_FLOW_SENTINEL'
export const STEP_ORDER = [
  'auth',
  'doctor',
  'discover',
  'enumerate',
  'probe',
  'select',
  'run',
  'http-select',
  'http-admin',
]
export const STEPS_DIR = path.resolve(HERE, '..', 'flows', 'steps')

const TASK_PATTERN = /^T-\d{3}$/
const AC_PATTERN = /^AC-\d{3}$/

function stepRank(name) {
  const index = STEP_ORDER.indexOf(name)
  return index === -1 ? STEP_ORDER.length : index
}

function byCodePoint(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function stepError(directory, file, problem) {
  return new Error(`${path.basename(directory)}/${file}: ${problem}`)
}

function validateStep(directory, file, base, mod) {
  if (typeof mod.name !== 'string' || mod.name !== base) {
    throw stepError(directory, file, 'name must equal basename')
  }
  if (typeof mod.introduced_by !== 'string' || !TASK_PATTERN.test(mod.introduced_by)) {
    throw stepError(directory, file, 'introduced_by must match ^T-\\d{3}$')
  }
  if (!Array.isArray(mod.ac) || mod.ac.length === 0 || !mod.ac.every((ac) => typeof ac === 'string' && AC_PATTERN.test(ac))) {
    throw stepError(directory, file, 'ac must be a non-empty array of AC-nnn')
  }
  if (typeof mod.run !== 'function') {
    throw stepError(directory, file, 'run must be a function')
  }
}

/** Import every `*.mjs` step in `dir` (non-recursive), validate its exports and order it. */
export async function discoverSteps(dir = STEPS_DIR) {
  const directory = path.resolve(dir)
  let entries
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs'))
    .map((entry) => entry.name)
    .sort(byCodePoint)

  const steps = []
  const seen = new Set()

  for (const file of files) {
    const base = file.slice(0, -'.mjs'.length)
    const mod = await import(pathToFileURL(path.join(directory, file)).href)
    validateStep(directory, file, base, mod)
    if (seen.has(mod.name)) throw stepError(directory, file, `duplicate step name: ${mod.name}`)
    seen.add(mod.name)
    steps.push({ name: mod.name, file: path.join(directory, file), mod })
  }

  steps.sort((left, right) => stepRank(left.name) - stepRank(right.name) || byCodePoint(left.name, right.name))
  return steps
}

function buildEnv(root, sentinels) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'NODE_TEST_CONTEXT') continue
    if (key.startsWith('CLIWORKER_')) continue
    env[key] = value
  }
  env.CLIWORKER_HOME = path.join(root, 'home')
  env[SENTINEL_ENV] = sentinels[0].value
  for (let index = 2; index <= sentinels.length; index += 1) {
    env[`${SENTINEL_ENV}_${index}`] = sentinels[index - 1].value
  }
  return env
}

function writeFixture(root) {
  const home = path.join(root, 'home')
  const fakeDir = path.join(root, 'fake-cli')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(fakeDir, { recursive: true })

  const fakeCli = path.join(fakeDir, 'fake-cli.mjs')
  fs.writeFileSync(
    fakeCli,
    "process.stdout.write('fake-cli " + FAKE_VERSION + "\\n')\nprocess.exit(0)\n",
    'utf8'
  )

  const configPath = path.join(root, 'config.json')
  const config = {
    schema: CONFIG_SCHEMA,
    state_dir: 'state',
    providers: {
      fixture: { cli: process.execPath, args_prefix: [fakeCli], readonly: true },
    },
    models: {
      q: { provider: 'fixture', id: 'q', level: 'Quick', identity: 'verified' },
    },
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
  return configPath
}

/** Create the temporary root, fixture CLI and config, and return the flow handle. */
export function createFlow(options = {}) {
  const sentinels = options.sentinels === undefined
    ? normalizeSentinels([{ label: 'FLOW', value: makeSentinel('FLOW') }])
    : normalizeSentinels(options.sentinels)

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-flow-'))
  const configPath = writeFixture(root)
  const stateDir = path.join(root, 'state')
  const home = path.join(root, 'home')
  const env = buildEnv(root, sentinels)

  const captured = { stdout: [], stderr: [], argv: [], http: [] }
  let cleaned = false

  function spawn(command, args = [], spawnOptions = {}) {
    const result = spawnSync(command, args, {
      env: { ...env, ...(spawnOptions.env ?? {}) },
      input: spawnOptions.input,
      encoding: 'utf8',
      timeout: spawnOptions.timeout ?? 60000,
      windowsHide: true,
    })
    if (result.error) throw result.error

    captured.argv.push([command, ...args])
    captured.stdout.push(typeof result.stdout === 'string' ? result.stdout : '')
    captured.stderr.push(typeof result.stderr === 'string' ? result.stderr : '')

    let json = null
    try {
      json = JSON.parse(result.stdout)
    } catch {
      json = null
    }

    return {
      code: result.status,
      signal: result.signal,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      json,
    }
  }

  const flow = {
    root,
    config_path: configPath,
    state_dir: stateDir,
    home,
    sentinels,
    sentinel: sentinels[0].value,
    env,
    shared: {},
    captured,
    spawn,
    run(args, spawnOptions) {
      return spawn(process.execPath, [BIN, ...(Array.isArray(args) ? args : [])], spawnOptions)
    },
    recordHttp(entry) {
      captured.http.push({ ...entry })
    },
    scan() {
      return leakScan({
        sentinels,
        stdout: captured.stdout,
        stderr: captured.stderr,
        argv: captured.argv,
        http: captured.http,
        state_dir: stateDir,
      })
    },
    cleanup() {
      if (cleaned) return
      cleaned = true
      fs.rmSync(root, { recursive: true, force: true })
    },
  }

  return flow
}

function redact(message, sentinels) {
  let text = String(message ?? '')
  for (const sentinel of sentinels) text = text.split(sentinel.value).join(`<${sentinel.label}>`)
  return text
}

/**
 * Run every discovered step against the same flow. A failing step is recorded but does not stop
 * the remaining steps; the final leak scan covers everything the steps did.
 */
export async function runFlow({ flow, stepsDir = STEPS_DIR }) {
  const steps = await discoverSteps(stepsDir)
  const results = []

  for (const step of steps) {
    try {
      await step.mod.run(flow)
      results.push({ name: step.name, introduced_by: step.mod.introduced_by, ac: step.mod.ac, ok: true, error: null })
    } catch (error) {
      results.push({
        name: step.name,
        introduced_by: step.mod.introduced_by,
        ac: step.mod.ac,
        ok: false,
        error: redact(error && error.message ? error.message : error, flow.sentinels),
      })
    }
  }

  const leak = flow.scan()
  const ok = results.every((result) => result.ok) && leak.ok
  return { results, leak, ok }
}
