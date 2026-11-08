import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { main } from '../../lib/cli.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const LIB = path.join(ROOT, 'lib')
const BIN = path.join(ROOT, 'bin', 'cliworker.mjs')

function importInChild(file) {
  const url = pathToFileURL(path.resolve(ROOT, file)).href
  return spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(process.argv[1])', url], {
    encoding: 'utf8',
  })
}

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, found)
    else if (/\.(mjs|js|cjs)$/.test(entry.name)) found.push(full)
  }
  return found
}

test('[AC-006] importing lib/cli.mjs and lib/index.js prints nothing', () => {
  for (const file of ['lib/cli.mjs', 'lib/index.js']) {
    const result = importInChild(file)
    assert.equal(result.status, 0, `${file} exited ${result.status}: ${result.stderr}`)
    assert.equal(result.stdout, '', `${file} wrote to stdout`)
    assert.equal(result.stderr, '', `${file} wrote to stderr`)
  }
})

test('[AC-006] main returns {exitCode} and writes the result to ctx.stdout', async () => {
  const config = JSON.stringify({ providers: { p1: { cli: 'p1cli' } }, models: {} })
  const ctx = createFakeContext({
    files: { '/cw/config.json': config },
    exec: () => ({ ok: true, code: 0, stdout: 'cli 1.2.3', stderr: '', error: null }),
  })

  const result = await main(['providers', '--config', '/cw/config.json'], ctx)

  assert.deepEqual(Object.keys(result), ['exitCode'])
  assert.equal(result.exitCode, 0)
  assert.equal(ctx.stderr.text(), '')
  const payload = JSON.parse(ctx.stdout.text())
  assert.equal(payload.schema, 'cliworker.providers/v1')
  assert.equal(payload.providers[0].id, 'p1')
  assert.equal(payload.providers[0].state, 'callable')
  assert.ok(ctx.exec.count >= 1)
})

test('[AC-006] failures are reported on ctx.stderr and never leave the process', async () => {
  const usage = createFakeContext()
  const usageResult = await main([], usage)
  assert.equal(usageResult.exitCode, 1)
  assert.equal(usage.stdout.text(), '')
  assert.ok(usage.stderr.text().startsWith('ERROR: usage: cliworker'))

  const missing = createFakeContext()
  const missingResult = await main(['providers', '--config', '/missing/config.json'], missing)
  assert.equal(missingResult.exitCode, 3)
  // 契约变更：配置错误改为 JSON 错误体到 stdout（T-014 起）
  const body = JSON.parse(missing.stdout.text())
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'E_CONFIG')
})

test('[AC-006] lib never contains the exit token', () => {
  const hits = walk(LIB).filter((file) => fs.readFileSync(file, 'utf8').includes('process.exit'))
  assert.deepEqual(hits, [])
})

test('[AC-006] bin/cliworker.mjs is a thin wrapper that reports usage and emits JSON', () => {
  const usage = spawnSync(process.execPath, [BIN], { encoding: 'utf8' })
  assert.equal(usage.status, 1)
  assert.equal(usage.stdout, '')
  assert.ok(usage.stderr.startsWith('ERROR: usage: cliworker providers | models list|select|forecast | usage record|summary'))

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-bin-'))
  try {
    const configFile = path.join(dir, 'config.json')
    fs.writeFileSync(configFile, JSON.stringify({ providers: {}, models: {} }))
    const ok = spawnSync(process.execPath, [BIN, 'usage', 'summary', '--config', configFile], {
      encoding: 'utf8',
      env: { ...process.env, CLIWORKER_HOME: dir, CLIWORKER_TEST_CLOCK_FILE: '' },
    })
    assert.equal(ok.status, 0, ok.stderr)
    assert.equal(ok.stderr, '')
    assert.equal(JSON.parse(ok.stdout).schema, 'cliworker.usage/v1')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
