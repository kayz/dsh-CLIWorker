// End-to-end harness tests: step discovery, the full flow over the real CLI, and self-tests that
// prove leaks in stdout, the state dir and argv are caught (and that failures do not short-circuit).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { STEP_ORDER, createFlow, discoverSteps, runFlow } from '../helpers/flow.mjs'

const expectedNames = fs.readdirSync(new URL('./steps/', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs'))
  .map((entry) => entry.name.slice(0, -4)).sort()

function makeStepsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-steps-'))
}

function writeStep(dir, name, body, options = {}) {
  const exportName = options.exportName ?? name
  const imports = Array.isArray(options.imports) ? [...options.imports, ''] : []
  const source = [
    ...imports,
    `export const name = '${exportName}'`,
    "export const introduced_by = 'T-012'",
    "export const ac = ['AC-031']",
    '',
    'export async function run(flow) {',
    body,
    '}',
    '',
  ].join('\n')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.mjs`), source, 'utf8')
}

test('[AC-031] flows discover steps in STEP_ORDER', async () => {
  const steps = await discoverSteps()

  assert.ok(steps.length >= 2)
  const names = steps.map((step) => step.name)
  assert.deepEqual([...names].sort(), expectedNames)
  assert.ok(names.includes('doctor'))
  assert.ok(names.includes('select'))
  assert.ok(names.every((name) => STEP_ORDER.includes(name)))

  const ranks = names.map((name) => STEP_ORDER.indexOf(name))
  for (let index = 1; index < ranks.length; index += 1) assert.ok(ranks[index - 1] < ranks[index])

  for (const step of steps) {
    assert.equal(step.name, path.basename(step.file, '.mjs'))
    assert.match(step.mod.introduced_by, /^T-\d{3}$/)
    assert.ok(Array.isArray(step.mod.ac) && step.mod.ac.length > 0)
    assert.ok(step.mod.ac.every((ac) => /^AC-\d{3}$/.test(ac)))
    assert.equal(typeof step.mod.run, 'function')
  }
})

test('[AC-031] full flow runs all discovered steps in one state_dir', async () => {
  const flow = createFlow()
  try {
    const steps = await discoverSteps()
    const report = await runFlow({ flow })

    assert.deepEqual(report.results.map((result) => result.name), steps.map((step) => step.name))
    assert.deepEqual(report.results.map((result) => result.name).sort(), expectedNames)
    for (const result of report.results) assert.equal(result.ok, true, `${result.name}: ${result.error}`)
    assert.equal(report.leak.ok, true, report.leak.hits.map((hit) => hit.location).join(','))
    assert.deepEqual(report.leak.hits, [])
    assert.ok(report.leak.scanned.argv > 0)
    assert.ok(report.leak.scanned.stdout > 0)
    assert.equal(report.ok, true)
    assert.ok(flow.state_dir.startsWith(flow.root))
    assert.ok(flow.config_path.startsWith(flow.root))
  } finally {
    flow.cleanup()
  }
  assert.equal(fs.existsSync(flow.root), false)
})

test('[AC-082] full flow executes discover with its own configuration and inventory', async () => {
  const flow = createFlow()
  const original = fs.readFileSync(flow.config_path, 'utf8')
  try {
    const steps = await discoverSteps()
    assert.deepEqual(steps.map((step) => step.name).sort(), expectedNames)
    assert.ok(steps.some((step) => step.name === 'discover'))
    const report = await runFlow({ flow })
    assert.deepEqual(report.results.map((result) => result.name).sort(), expectedNames)
    assert.equal(report.results.find((result) => result.name === 'discover')?.ok, true, JSON.stringify(report.results))
    assert.equal(report.ok, true, JSON.stringify(report.results))
    const bin = path.resolve('bin/cliworker.mjs')
    const calls = flow.captured.argv.map((argv, index) => ({ argv, stdout: flow.captured.stdout[index] }))
      .filter(({ argv }) => argv[0] === process.execPath && argv[1] === bin && argv[2] === 'discover')
    assert.ok(calls.length > 0)
    const call = calls.at(-1)
    const flag = call.argv.indexOf('--config')
    assert.ok(flag >= 0)
    const configFile = path.resolve(call.argv[flag + 1])
    const relative = path.relative(flow.root, configFile)
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    assert.notEqual(configFile, flow.config_path)
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    assert.equal(config.schema, 'cliworker.config/v2')
    assert.equal(path.resolve(path.dirname(configFile), config.state_dir), flow.state_dir)
    const output = JSON.parse(call.stdout)
    const inventory = JSON.parse(fs.readFileSync(path.join(flow.state_dir, 'inventory.json'), 'utf8'))
    assert.equal(output.schema, 'cliworker.inventory/v1')
    assert.ok(Array.isArray(output.entries))
    assert.equal(typeof output.generated_at, 'string')
    assert.ok(output.generated_at.length > 0 && Number.isFinite(Date.parse(output.generated_at)))
    assert.equal(inventory.schema, 'cliworker.inventory/v1')
    assert.ok(Array.isArray(inventory.entries))
    assert.equal(inventory.generated_at, output.generated_at)
    assert.deepEqual(inventory, output)
    assert.equal(fs.readFileSync(flow.config_path, 'utf8'), original)
  } finally {
    flow.cleanup()
  }
  assert.equal(fs.existsSync(flow.root), false)
})

test('[AC-031] env delivers the sentinel to child processes', () => {
  const flow = createFlow()
  try {
    const script =
      "process.stdout.write(process.env.CW_FLOW_SENTINEL ? 'present:' + process.env.CW_FLOW_SENTINEL.length : 'absent')"
    const result = flow.spawn(process.execPath, ['-e', script])

    assert.equal(result.code, 0)
    assert.equal(result.stdout, `present:${flow.sentinel.length}`)
    for (const call of flow.captured.argv) {
      for (const arg of call) assert.equal(arg.includes(flow.sentinel), false)
    }
  } finally {
    flow.cleanup()
  }
})

test('[AC-031] self-test detects a stdout leak', async () => {
  const dir = makeStepsDir()
  const flow = createFlow()
  try {
    writeStep(dir, 'leak-stdout', "  flow.spawn(process.execPath, ['-e', 'console.log(process.env.CW_FLOW_SENTINEL)'])")
    const report = await runFlow({ flow, stepsDir: dir })

    assert.equal(report.results.length, 1)
    assert.equal(report.results[0].ok, true)
    assert.equal(report.ok, false)
    assert.equal(report.leak.ok, false)
    assert.ok(report.leak.hits.some((hit) => hit.surface === 'stdout'))
  } finally {
    flow.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-031] self-test detects a state_dir leak', async () => {
  const dir = makeStepsDir()
  const flow = createFlow()
  try {
    writeStep(dir, 'leak-state', [
      "  const deep = path.join(flow.state_dir, 'a', 'b', 'c')",
      '  fs.mkdirSync(deep, { recursive: true })',
      "  fs.writeFileSync(path.join(deep, 'leak.txt'), flow.sentinel)",
    ].join('\n'), { imports: ["import fs from 'node:fs'", "import path from 'node:path'"] })
    const report = await runFlow({ flow, stepsDir: dir })

    assert.equal(report.results[0].ok, true)
    assert.equal(report.leak.ok, false)
    assert.ok(report.leak.hits.some((hit) => hit.surface === 'state_dir'))
    assert.ok(report.leak.scanned.files >= 1)
  } finally {
    flow.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-031] self-test detects an argv leak', async () => {
  const dir = makeStepsDir()
  const flow = createFlow()
  try {
    writeStep(dir, 'leak-argv', "  flow.spawn(process.execPath, ['-e', '0', flow.sentinel])")
    const report = await runFlow({ flow, stepsDir: dir })

    assert.equal(report.results[0].ok, true)
    assert.equal(report.leak.ok, false)
    assert.ok(report.leak.hits.some((hit) => hit.surface === 'argv'))
  } finally {
    flow.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-031] self-test continues after a failing step and redacts its error', async () => {
  const dir = makeStepsDir()
  const flow = createFlow()
  try {
    writeStep(dir, 'a-fail', "  throw new Error('boom ' + flow.sentinel)")
    writeStep(dir, 'b-after', "  flow.spawn(process.execPath, ['-e', '0'])")
    const report = await runFlow({ flow, stepsDir: dir })

    assert.equal(report.results.length, 2)
    const failed = report.results.find((result) => result.name === 'a-fail')
    const after = report.results.find((result) => result.name === 'b-after')
    assert.equal(failed.ok, false)
    assert.equal(after.ok, true)
    assert.equal(failed.error.includes(flow.sentinel), false)
    assert.ok(failed.error.includes('<FLOW>'))
    assert.equal(report.ok, false)
  } finally {
    flow.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[AC-031] self-test rejects a step whose name does not match its file', async () => {
  const dir = makeStepsDir()
  try {
    writeStep(dir, 'bad-name', '  return undefined', { exportName: 'other' })
    await assert.rejects(
      () => discoverSteps(dir),
      (error) => error instanceof Error && error.message.includes('bad-name.mjs')
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
