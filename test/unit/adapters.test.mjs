import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { main } from '../../lib/cli.mjs'
import * as resolveCommand from '../../lib/commands/cli/resolve.mjs'
import { getCode } from '../../lib/contract/registry.mjs'
import { createFakeContext } from '../helpers/ctx.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FIXTURE = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'adapters', 'resolve.json'), 'utf8')
const ALT_FIXTURE = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'adapters', 'resolve-alt.json'), 'utf8')
const CONFIG = '/cw/resolve.json'
const ALT_CONFIG = '/cw/resolve-alt.json'
const CWD = 'C:/work/repo'
const QUOTED_CWD = "C:/work/it's repo"
const BIN = path.join(ROOT, 'bin', 'cliworker.mjs')

const CLAUDE_ARGS = ['-p', '--model', 'demo', '--output-format', 'stream-json', '--verbose']

function context() {
  return createFakeContext({
    files: { [CONFIG]: FIXTURE, [ALT_CONFIG]: ALT_FIXTURE },
    env: { CLIWORKER_HOME: '/cw', CLIWORKER_TEST_CLOCK_FILE: '' },
    platform: 'linux',
  })
}

async function resolve(argv) {
  const ctx = context()
  const result = await main(['cli', 'resolve', ...argv], ctx)
  return { exitCode: result.exitCode, stderr: ctx.stderr.text(), body: JSON.parse(ctx.stdout.text()) }
}

test('[AC-043] the registered command resolves an allowed callable model to an executable call', async () => {
  assert.deepEqual(resolveCommand.route, { cmd: 'cli', sub: 'resolve' })

  const first = await resolve(['--model', 'claude:demo', '--cwd', CWD, '--platform', 'linux', '--config', CONFIG])
  assert.equal(first.exitCode, 0)
  assert.equal(first.stderr, '')
  assert.deepEqual(Object.keys(first.body), ['model', 'direct_call', 'display'])
  assert.deepEqual(first.body.model, {
    key: 'claude:demo',
    provider: 'claude',
    id: 'demo',
    cli: 'claude-fixture',
  })
  assert.deepEqual(first.body.direct_call, {
    command: 'claude-fixture',
    args: CLAUDE_ARGS,
    cwd: CWD,
    input: 'stdin',
    env_names: [],
  })
  assert.equal(first.body.display.posix, "'claude-fixture' '-p' '--model' 'demo' '--output-format' 'stream-json' '--verbose'")
  assert.equal(first.body.display.pwsh, "& 'claude-fixture' '-p' '--model' 'demo' '--output-format' 'stream-json' '--verbose'")

  const second = await resolve(['--model', 'claude:demo', '--cwd', CWD, '--platform', 'linux', '--config', CONFIG])
  assert.deepEqual(second.body, first.body)
})

test('[AC-043] --config picks the configuration that is resolved', async () => {
  const fixture = await resolve(['--model', 'claude:demo', '--config', CONFIG])
  const alternative = await resolve(['--model', 'claude:demo', '--config', ALT_CONFIG])

  assert.equal(fixture.exitCode, 0)
  assert.equal(alternative.exitCode, 0)
  assert.equal(fixture.body.direct_call.command, 'claude-fixture')
  assert.equal(alternative.body.direct_call.command, 'claude-alt-fixture')
  assert.equal(alternative.body.model.cli, 'claude-alt-fixture')
  assert.deepEqual(fixture.body.direct_call.args, alternative.body.direct_call.args)
})

test('[AC-043] every provider with a declared argument vector resolves without a shell', async () => {
  const cases = [
    ['claude:demo', 'claude-fixture', CLAUDE_ARGS],
    ['codex:demo', 'codex-fixture', ['exec', '--model', 'codex-demo', '-s', 'read-only', '--skip-git-repo-check', '--json']],
    ['codebuddy:demo', 'codebuddy-fixture', ['-p', '--model', 'codebuddy-demo', '--output-format', 'stream-json', '--verbose']],
    ['gemini:demo', 'gemini-fixture', ['-m', 'gemini-demo', '-p']],
  ]
  for (const [key, command, args] of cases) {
    const result = await resolve(['--model', key, '--cwd', CWD, '--platform', 'linux', '--config', CONFIG])
    assert.equal(result.exitCode, 0, key)
    assert.equal(result.body.direct_call.command, command, key)
    assert.deepEqual(result.body.direct_call.args, args, key)
    assert.equal(result.body.direct_call.cwd, CWD, key)
  }
})

test('[AC-043] the platform decides native versus wsl.exe wrapping and keeps the cwd verbatim', async () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const native = await resolve(['--model', 'claude:demo', '--cwd', QUOTED_CWD, '--platform', platform, '--config', CONFIG])
    assert.equal(native.exitCode, 0, platform)
    assert.equal(native.body.direct_call.command, 'claude-fixture', platform)
    assert.deepEqual(native.body.direct_call.args, CLAUDE_ARGS, platform)
    assert.equal(native.body.direct_call.cwd, QUOTED_CWD, platform)
  }

  const wsl = await resolve(['--model', 'claude:demo', '--cwd', QUOTED_CWD, '--platform', 'wsl:Ubuntu', '--config', CONFIG])
  assert.equal(wsl.exitCode, 0)
  assert.equal(wsl.body.direct_call.command, 'wsl.exe')
  assert.deepEqual(wsl.body.direct_call.args, [
    '-d',
    'Ubuntu',
    '--cd',
    QUOTED_CWD,
    '--exec',
    'claude-fixture',
    ...CLAUDE_ARGS,
  ])
  assert.equal(wsl.body.direct_call.cwd, null)
  for (const arg of wsl.body.direct_call.args) {
    assert.equal(arg.includes('&&'), false, arg)
    assert.equal(arg.includes('-lc'), false, arg)
    assert.equal(arg.includes('bash'), false, arg)
  }
  assert.ok(wsl.body.display.posix.includes(`'C:/work/it'\\''s repo'`))
  assert.ok(wsl.body.display.pwsh.includes(`'C:/work/it''s repo'`))
  assert.ok(wsl.body.display.posix.startsWith(`'wsl.exe' `))
})

test('[AC-043] --readonly only adds a switch the provider already declares', async () => {
  const claude = await resolve(['--model', 'claude:demo', '--readonly', '--cwd', CWD, '--platform', 'linux', '--config', CONFIG])
  assert.equal(claude.exitCode, 0)
  assert.deepEqual(claude.body.direct_call.args, [...CLAUDE_ARGS, '--permission-mode', 'plan'])

  const codex = await resolve(['--model', 'codex:demo', '--readonly', '--cwd', CWD, '--platform', 'linux', '--config', CONFIG])
  assert.equal(codex.exitCode, 0)
  assert.deepEqual(codex.body.direct_call.args, ['exec', '--model', 'codex-demo', '-s', 'read-only', '--skip-git-repo-check', '--json'])
})

test('[AC-043] resolve reports bad requests with the shared error envelope', async () => {
  const cases = [
    { label: 'missing --model', argv: ['--config', CONFIG], code: 'E_REQUEST_INVALID' },
    { label: 'unknown model', argv: ['--model', 'claude:ghost', '--config', CONFIG], code: 'E_REQUEST_INVALID' },
    { label: 'unsupported platform', argv: ['--model', 'claude:demo', '--platform', 'solaris', '--config', CONFIG], code: 'E_REQUEST_INVALID' },
    { label: 'unknown option', argv: ['--model', 'claude:demo', '--bogus', '--config', CONFIG], code: 'E_REQUEST_INVALID' },
    { label: 'missing config', argv: ['--model', 'claude:demo', '--config', '/cw/missing.json'], code: 'E_CONFIG' },
  ]
  for (const item of cases) {
    const result = await resolve(item.argv)
    assert.equal(result.exitCode, getCode(item.code).exit, item.label)
    assert.equal(result.stderr, '', item.label)
    assert.deepEqual(Object.keys(result.body), ['ok', 'error'], item.label)
    assert.equal(result.body.error.code, item.code, item.label)
    assert.equal(typeof result.body.error.message, 'string', item.label)
    assert.ok(result.body.error.message.length > 0, item.label)
  }
})

test('[AC-043] the documented cli resolve command works through bin/cliworker.mjs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-resolve-'))
  try {
    const file = path.join(dir, 'config.json')
    fs.writeFileSync(file, FIXTURE)
    const result = spawnSync(
      process.execPath,
      [BIN, 'cli', 'resolve', '--model', 'claude:demo', '--cwd', '.', '--platform', 'linux', '--config', file],
      {
        encoding: 'utf8',
        env: { ...process.env, CLIWORKER_HOME: dir, CLIWORKER_TEST_CLOCK_FILE: '' },
      }
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const body = JSON.parse(result.stdout)
    assert.equal(body.direct_call.command, 'claude-fixture')
    assert.deepEqual(body.direct_call.args, CLAUDE_ARGS)
    assert.ok(body.display.pwsh.startsWith('& '))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
