import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { realWsl, executeSmoke, main } from '../../scripts/smoke-real.mjs'
import { validateReport } from '../smoke/report.mjs'

const names = ['Ubuntu', '中文 Distro']
function fixture(scenario = 'ok') {
  const calls = []
  let lists = 0
  const context = {
    platform: 'win32', env: { SystemRoot: os.tmpdir() },
    fs: new Proxy(fs, { get(target, key) { return key === 'existsSync' ? (p => String(p).endsWith('wsl.exe') ? scenario !== 'no-wsl' : target.existsSync(p)) : target[key] } }),
    exec(command, args) {
      calls.push([command, ...args])
      const result = (stdout = '', ok = true) => ({ ok, code: ok ? 0 : 1, stdout, stderr: ok ? '' : 'sensitive-secret /private/path 中文 Distro' })
      if (args[0] === '-l') {
        lists++
        if (scenario === 'list-fail') return result('', false)
        const list = scenario === 'empty' ? '' : scenario === 'changed' && lists === 3 ? 'Ubuntu\r\n' : 'Ubuntu\0\r\n中文 Distro\r\nUbuntu\r\n'
        return result(Buffer.from((lists % 2 ? '\uFEFF' : '') + list, 'utf16le'))
      }
      if (args[0] !== '-d') return result('', false)
      const distro = args[1]
      const cmd = args.slice(3)
      if (cmd[0] === 'sh') return scenario === 'missing' || (scenario === 'mixed' && distro === names[1]) ? result('', false) : result(scenario === 'windows-node' ? '/mnt/c/node.exe' : '/usr/bin/node')
      if (cmd[1] === '--version') return scenario === 'exec-fail' ? result('', false) : result(scenario === 'old' ? 'v19.9.0' : scenario === 'bad-version' ? 'v20.bad' : 'v20.0.0')
      if (cmd[1] === '-p') return result('linux')
      if (cmd[0] === 'wslpath') return result('/tmp/fixture')
      if (cmd[0] === 'printenv') return result(cmd[1] === 'PATH' ? '/usr/bin' : scenario === 'environment' ? 'wrong' : distro)
      if (cmd[0] === 'env') {
        if (scenario === 'json') return result('{')
        const platform = `wsl:${distro}`
        const entries = scenario === 'no-cli' ? [] : [{ platform: scenario === 'platform' ? 'win32' : platform, status: scenario === 'absent' ? 'gone' : 'present' }]
        return result(JSON.stringify({ schema: 'cliworker.inventory/v1', host: { platform }, entries }))
      }
      throw new Error('unexpected command')
    },
  }
  return { context, calls }
}

async function run(scenario, root) {
  const f = fixture(scenario)
  const captured = { argv: [], stdout: [], stderr: [], http: [] }
  const inventories = await realWsl(root, {}, captured, '', f.context)
  return { ...f, inventories }
}

if (process.argv[2] === '--fixture-child') {
  const scenario = process.argv[3]
  process.env.CLIWORKER_SMOKE = '1'
  process.exitCode = await main([], options => executeSmoke(options, (root, env, captured, originalPath) => realWsl(root, env, captured, originalPath, fixture(scenario).context)))
} else {
  test('[AC-081] inventories and argument boundaries', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-preflight-'))
    try {
      const { inventories, calls } = await run('ok', root)
      assert.deepEqual(inventories.map(i => i.host.platform), names.map(n => `wsl:${n}`))
      assert.ok(inventories.every(i => i.entries.length && i.entries.every(e => e.status === 'present' && e.platform === i.host.platform)))
      for (const name of names) {
        const commands = calls.filter(c => c[1] === '-d' && c[2] === name).map(c => c.slice(4))
        assert.ok(commands.some(c => c[0] === 'sh'))
        assert.ok(commands.some(c => c[0] === '/usr/bin/node' && c[1] === '--version'))
        assert.ok(commands.some(c => c[0] === 'env' && c.includes('/usr/bin/node')))
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
  for (const [scenario, reason] of Object.entries({ missing: /Node not found/, 'no-wsl': /executable unavailable/, old: /Node.*20/, empty: /no distributions/, 'list-fail': /list failed/, 'bad-version': /version parsing/, 'exec-fail': /execution/, 'windows-node': /execution/, 'no-cli': /CLI not found/, environment: /environment mismatch/, json: /discovery failed/, platform: /discovery failed/, absent: /discovery failed/, changed: /set changed/, mixed: /Node not found/ })) {
    test(`[AC-081] ${scenario}`, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-preflight-'))
      const f = fixture(scenario)
      try {
        await assert.rejects(realWsl(root, {}, { argv: [], stdout: [], stderr: [] }, '', f.context), reason)
        if (['missing', 'mixed', 'old', 'bad-version', 'exec-fail', 'windows-node'].includes(scenario)) assert.ok(!f.calls.some(c => c.includes('discover')))
      } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })
  }
  for (const scenario of ['ok', 'missing', 'no-wsl']) {
    test(`[AC-081] complete report ${scenario}`, () => {
      const env = { ...process.env, PATH: path.dirname(process.execPath) }
      const child = spawnSync(process.execPath, [import.meta.filename, '--fixture-child', scenario], { env, encoding: 'utf8', timeout: 120000, windowsHide: true })
      assert.equal(child.status === 0, scenario === 'ok', child.stderr)
      const report = JSON.parse(child.stdout)
      assert.equal(validateReport(report, report.version).ok, true)
      assert.equal(report.steps.length, 7)
      if (scenario === 'ok') assert.ok(report.steps.every(s => s.status === 'pass'))
      else {
        assert.equal(report.steps[0].status, 'pass')
        assert.equal(report.steps[1].status, 'fail')
        assert.match(report.steps[1].reason, scenario === 'missing' ? /WSL Node not found/ : /WSL executable unavailable/)
        assert.ok(report.steps.slice(2).every(s => s.status === 'skip' && s.reason === 'dependency failed'))
        assert.doesNotMatch(child.stdout, /sensitive-secret|\/private\/path|中文 Distro/)
      }
    })
  }
}
