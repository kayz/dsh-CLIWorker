import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createExec } from '../../lib/exec.mjs'
import { generateFakeCli, readFakeCliRecords } from '../helpers/fake-cli.mjs'

const names = ['codex', 'claude', 'dsh', 'cursor', 'codebuddy', 'antigravity', 'trae', 'zcode', 'qoder', 'kimi', 'opencode', 'unknown-cli']
const modes = ['ok', 'auth', 'quota', 'timeout', 'deprecated', 'mismatch']
const argv = ['', '空 格', '"quoted"', '&|<>^%!;`']
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('[AC-035] generated CLIs execute, isolate configuration and record invocations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fake cli 中文 '))
  const cwd = path.join(root, '工作 cwd')
  fs.mkdirSync(cwd)
  const secret = randomBytes(24).toString('hex')
  const key = 'FAKE_CLI_TEST_SENTINEL'
  const env = { ...process.env, [key]: secret }
  const cleanEnv = { ...process.env }
  delete cleanEnv[key]
  const children = new Set()
  const timers = new Set()
  const clock = {
    setTimeout(fn) { const handle = { fn }; timers.add(handle); return handle },
    clearTimeout(handle) { timers.delete(handle) },
  }
  const trackedSpawn = (...args) => {
    const child = spawn(...args)
    // Restricted Windows environments can deny taskkill; terminate the same direct child
    // if the real taskkill fails. The fixture never creates descendant processes.
    if (args[0] === 'taskkill') {
      const target = [...children].find((item) => String(item.pid) === args[1][1])
      child.once('close', (code) => { if (code !== 0 && target) target.kill() })
    }
    children.add(child)
    child.once('close', () => children.delete(child))
    return child
  }
  const exec = createExec({ fs, nodePath: process.execPath, env, clock, spawn: trackedSpawn })
  const surfaces = []
  const checkResult = (result, mode) => {
    surfaces.push(result.stdout, result.stderr, result.error ?? '')
    if (mode === 'timeout') {
      assert.equal(result.error_code, 'E_TIMEOUT')
      assert.equal(result.ok, false)
      assert.equal(result.stdout, '')
      assert.equal(result.stderr, '')
    } else {
      assert.equal(result.code, mode === 'auth' || mode === 'quota' ? 1 : 0)
      assert.equal(result.ok, mode !== 'auth' && mode !== 'quota')
      assert.equal(result.stdout, ({ ok: 'ok', auth: '', quota: '', deprecated: 'deprecated', mismatch: 'reported_model=other-model' })[mode])
      assert.equal(result.stderr, mode === 'auth' || mode === 'quota' ? mode : '')
      if (mode === 'mismatch') assert.notEqual(result.stdout.split('=')[1], 'requested-model')
    }
  }
  const barrier = async (records, count) => {
    for (let i = 0; i < 500; i += 1) {
      if (readFakeCliRecords(records).length >= count) return
      await delay(20)
    }
    throw new Error('fake-cli record barrier timed out')
  }
  try {
    const empty = path.join(root, 'empty')
    fs.mkdirSync(empty)
    assert.deepEqual(readFakeCliRecords(empty), [])
    fs.writeFileSync(path.join(empty, 'bad.json'), '{bad')
    assert.throws(() => readFakeCliRecords(empty), /^Error: Unable to read fake-cli records$/)
    for (const name of names) {
      for (const mode of modes) {
        const dir = path.join(root, name, mode)
        const records = path.join(dir, 'records')
        const config = { dir, name, mode, recordDir: records, help: `帮助 ${name} ${mode}`, version: `v ${name} ${mode}`, models: `模型 ${name} ${mode}`, modelsArgv: ['list', '模型'] }
        const executable = generateFakeCli(config)
        if (process.platform !== 'win32') assert.ok(fs.statSync(executable).mode & 0o111)
        const options = { cwd, env, timeout: 30000 }
        const args = [...argv, name, mode, 'requested-model']
        if (mode === 'timeout') {
          const running = exec.runAsync(executable, args, options)
          try {
            await barrier(records, 1)
            assert.equal(timers.size, 1)
            const timer = [...timers][0]
            timers.delete(timer)
            timer.fn()
            let watchdog
            const result = await Promise.race([running, new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('timeout cleanup failed')), 10000) })]).finally(() => clearTimeout(watchdog))
            checkResult(result, mode)
            assert.equal(timers.size, 0)
          } finally {
            for (const child of children) child.kill()
          }
        } else checkResult(exec.runSync(executable, args, options), mode)
        for (const [query, expected] of [[['--help'], config.help], [['--version'], config.version], [config.modelsArgv, config.models]]) {
          const result = exec.runSync(executable, query, options)
          surfaces.push(result.stdout, result.stderr, result.error ?? '')
          assert.equal(result.code, 0)
          assert.equal(result.stdout, expected)
          assert.equal(result.stderr, '')
        }
        const all = readFakeCliRecords(records)
        assert.equal(all.length, 4)
        for (const expected of [args, ['--help'], ['--version'], config.modelsArgv]) {
          const record = all.find((item) => JSON.stringify(item.argv) === JSON.stringify(expected))
          assert.ok(record)
          assert.deepEqual(Object.keys(record).sort(), ['argv', 'cwd', 'envNames', 'sha256'])
          assert.equal(record.cwd, cwd)
          assert.deepEqual(record.envNames, Object.keys(env).sort())
          assert.equal(record.sha256[key], createHash('sha256').update(secret).digest('hex'))
          for (const name of record.envNames) assert.equal(record.sha256[name], createHash('sha256').update(env[name]).digest('hex'))
        }
        for (const file of fs.readdirSync(dir)) {
          const full = path.join(dir, file)
          if (fs.statSync(full).isFile()) surfaces.push(fs.readFileSync(full, 'utf8'))
        }
        for (const file of fs.readdirSync(records)) surfaces.push(fs.readFileSync(path.join(records, file), 'utf8'))
      }
    }
    const dir = path.join(root, 'concurrent')
    const records = path.join(dir, 'records')
    const executable = generateFakeCli({ dir, name: 'parallel', mode: 'ok', recordDir: records, help: 'h', version: 'v', models: 'm', modelsArgv: ['models'] })
    const second = generateFakeCli({ dir, name: 'parallel2', mode: 'deprecated', recordDir: records, help: 'other', version: 'other', models: 'other', modelsArgv: ['other'] })
    const calls = Array.from({ length: 12 }, (_, i) => exec.runAsync(i % 2 ? second : executable, ['', `item ${i}`], { cwd, env: cleanEnv }))
    const results = await Promise.all(calls)
    results.forEach((result, i) => checkResult(result, i % 2 ? 'deprecated' : 'ok'))
    const all = readFakeCliRecords(records)
    assert.equal(all.length, 12)
    assert.deepEqual(all.map((r) => r.argv[1]).sort(), Array.from({ length: 12 }, (_, i) => `item ${i}`).sort())
    for (const record of all) {
      assert.equal(record.envNames.includes(key), false)
      assert.equal(Object.hasOwn(record.sha256, key), false)
    }
    assert.equal(fs.readdirSync(records).some((file) => !file.endsWith('.json')), false)
    for (const file of fs.readdirSync(records)) surfaces.push(fs.readFileSync(path.join(records, file), 'utf8'))
    assert.equal(surfaces.some((value) => value.includes(secret)), false, 'secret must not appear in generated data, records or output')
    assert.equal(timers.size, 0)
  } finally {
    for (const child of children) child.kill()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
