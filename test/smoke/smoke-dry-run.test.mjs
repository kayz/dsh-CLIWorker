import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { leakScan, makeSentinel } from '../helpers/leak-scan.mjs'
import { executeSmoke, preflight } from '../../scripts/smoke-real.mjs'
import { STEP_IDS, validateReport } from './report.mjs'

test('[AC-069] report structure and semantics reject malformed reports', () => {
  const report = {
    schema: 'cliworker.smoke/v1', mode: 'dry-run', version: 'fixture', platform: process.platform,
    node: process.version, redacted: true,
    steps: STEP_IDS.map(id => ({ id, ac: [id === 'wsl-discover' ? 'AC-038' : 'AC-069'], mandatory: true, status: 'pass', reason: null, duration_ms: 0 })),
  }
  assert.equal(validateReport(report, 'fixture').ok, true)
  const variants = [
    r => { delete r.node }, r => { r.extra = true }, r => { r.version = 'wrong' },
    r => { r.steps = [] }, r => { r.steps[1].id = r.steps[0].id },
    r => { [r.steps[0], r.steps[1]] = [r.steps[1], r.steps[0]] },
    r => { r.steps[0].ac = [] }, r => { r.steps[1].ac = ['AC-069'] },
    r => { r.steps[0].status = 'unknown' }, r => { r.steps[0].duration_ms = -1 },
    r => { r.steps[0].duration_ms = Infinity }, r => { r.steps[0].status = 'fail' },
    r => { r.steps[0].mandatory = false },
  ]
  for (const change of variants) {
    const candidate = structuredClone(report)
    change(candidate)
    assert.equal(validateReport(candidate, 'fixture').ok, false)
  }
})

test('[AC-069] preflight enforces node, CLI, doctor and state roundtrip checks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-preflight-'))
  try {
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
    const makeFlow = () => {
      const flow = {
        config_path: path.join(root, 'config.json'),
        state_dir: path.join(root, 'state'),
        run(args) {
          if (args[0] === '--version') return { code: 0, json: { ok: true, version } }
          if (args[0] === 'doctor') return { code: 0, json: { status: 'ok' } }
          if (args[0] === 'state' && args[1] === 'backup') return { code: 0, json: { backup: 'backup-test' } }
          if (args[0] === 'state' && args[1] === 'restore') {
            fs.writeFileSync(path.join(flow.state_dir, 'smoke-roundtrip.marker'), 'before', 'utf8')
            return { code: 0, json: { ok: true } }
          }
          throw new Error('unexpected command')
        },
      }
      return flow
    }
    preflight(makeFlow(), version)
    const cases = [
      ['CLI --version failed', flow => { flow.run = () => ({ code: 0, json: { ok: true, version: '0.0.0' } }) }],
      ['doctor is not healthy', flow => {
        const run = flow.run
        flow.run = args => (args[0] === 'doctor' ? { code: 0, json: { status: 'degraded' } } : run.call(flow, args))
      }],
      ['state backup failed', flow => {
        const run = flow.run
        flow.run = args => (args[0] === 'state' && args[1] === 'backup' ? { code: 1, json: null } : run.call(flow, args))
      }],
      ['state restore roundtrip mismatch', flow => {
        const run = flow.run
        flow.run = args => (args[0] === 'state' && args[1] === 'restore' ? { code: 0, json: {} } : run.call(flow, args))
      }],
    ]
    for (const [message, mutate] of cases) {
      const flow = makeFlow()
      mutate(flow)
      assert.throws(() => preflight(flow, version), new RegExp(`preflight: ${message}`))
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-069] dry-run executes repeatedly and writes the requested report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke test '))
  try {
    const env = { ...process.env, TEMP: root, TMP: root, TMPDIR: root }
    delete env.CLIWORKER_SMOKE
    const run = args => spawnSync(process.execPath, ['scripts/smoke-real.mjs', ...args], { env, encoding: 'utf8', timeout: 240000, windowsHide: true })
    const out = path.join(root, 'report.json')
    for (const args of [['--dry-run'], ['--dry-run', '--out', out]]) {
      const result = run(args)
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stderr)
      const report = JSON.parse(result.stdout)
      assert.equal(validateReport(report, JSON.parse(fs.readFileSync('package.json', 'utf8')).version).ok, true)
      assert.equal(report.mode, 'dry-run')
      assert.ok(report.steps.every(step => step.status === 'pass'))
      assert.equal(result.stdout.includes(root), false)
      assert.equal(result.stdout.includes(process.cwd()), false)
      assert.equal(result.stderr.includes(root), false)
      assert.equal(result.stderr.includes(process.cwd()), false)
      const username = process.env.USERNAME || process.env.USER || path.basename(os.homedir())
      if (username.length >= 3) {
        assert.equal(result.stdout.toLowerCase().includes(username.toLowerCase()), false)
        assert.equal(result.stderr.toLowerCase().includes(username.toLowerCase()), false)
      }
      if (args.includes('--out')) assert.equal(fs.readFileSync(out, 'utf8'), result.stdout)
    }
    assert.deepEqual(fs.readdirSync(root), ['report.json'])
    assert.notEqual(run(['--dry-run', '--out', root]).status, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-069] real mode requires the explicit switch', () => {
  const registry = JSON.parse(fs.readFileSync('contracts/registry.snapshot.json', 'utf8'))
  const expected = registry.codes.find(item => item.code === 'E_SMOKE_DISABLED').exit
  for (const value of [undefined, '0', 'true']) {
    const env = { ...process.env }
    if (value === undefined) delete env.CLIWORKER_SMOKE
    else env.CLIWORKER_SMOKE = value
    const result = spawnSync(process.execPath, ['scripts/smoke-real.mjs'], { env, encoding: 'utf8', timeout: 15000, windowsHide: true })
    assert.ifError(result.error)
    assert.equal(result.status, expected)
    assert.equal(JSON.parse(result.stdout).error.code, 'E_SMOKE_DISABLED')
  }
})

test('[AC-069] leak scanner detects encoded canaries on each surface', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-scan-'))
  try {
    const sentinel = makeSentinel('SMOKE')
    const sentinels = [{ label: 'SMOKE', value: sentinel }]
    const forms = [sentinel, Buffer.from(sentinel, 'utf16le'), Buffer.from(sentinel).toString('base64'), Buffer.from(sentinel).toString('hex')]
    for (const value of forms) {
      for (const surface of ['stdout', 'stderr', 'argv', 'http', 'state', 'audit', 'report']) {
        const data = { sentinels, state_dir: root }
        if (surface === 'argv') data.argv = [[value]]
        else if (surface === 'http') data.http = [{ body: value }]
        else if (surface === 'state' || surface === 'audit') fs.writeFileSync(path.join(root, surface === 'audit' ? 'audit.jsonl' : 'state.bin'), value)
        else data[surface === 'report' ? 'stdout' : surface] = [value]
        assert.equal(leakScan(data).ok, false, surface)
        fs.rmSync(path.join(root, 'state.bin'), { force: true })
        fs.rmSync(path.join(root, 'audit.jsonl'), { force: true })
      }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('[AC-069] step errors and worker timeouts fail and skip dependent steps', async () => {
  let root
  const failure = await executeSmoke({ hooks: { beforeStep(id, flow) { root = flow.root; if (id === 'enumerate') throw new Error('failure') } } })
  assert.equal(failure.failed, true)
  assert.equal(failure.report.steps[2].status, 'fail')
  assert.ok(failure.report.steps.slice(3).every(step => step.status === 'skip' && step.reason))
  assert.equal(fs.existsSync(root), false)
  const timeout = await executeSmoke({ hooks: { workerArgs: () => ['-e', 'setInterval(() => {}, 1000)'], workerTimeoutMs: 100 } })
  assert.equal(timeout.failed, true)
  assert.equal(timeout.report.steps[2].status, 'fail')
  assert.ok(timeout.report.steps.slice(3).every(step => step.status === 'skip'))
})

test('[AC-069] a captured sentinel fails the report without exposing its value', async () => {
  let sentinel
  const result = await executeSmoke({ hooks: { beforeScan(flow) { sentinel = flow.sentinel; flow.captured.stderr.push(sentinel) } } })
  assert.equal(result.failed, true)
  assert.ok(result.report.steps.some(step => step.status === 'fail'))
  assert.equal(result.json.includes(sentinel), false)
  const reportLeak = await executeSmoke({ hooks: { beforeScan(flow, report) { sentinel = flow.sentinel; report.steps[0].reason = sentinel } } })
  assert.equal(reportLeak.failed, true)
  assert.equal(reportLeak.json.includes(sentinel), false)
})
