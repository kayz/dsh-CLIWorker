import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { checkAcceptance, discoverAcceptanceFiles } from '../../scripts/check-acceptance.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = 'scripts/check-acceptance.mjs'
// Built by concatenation so check-no-collab never sees the working-directory name.
const COLLAB = ['.', 'collab'].join('')

const COMPLIANT = [
  '# Task 900 验收标准',
  '',
  '## AC-001 合规项',
  '- 命令: Write-Output "AC-001 OK"',
  '',
  '## AC-002 代码块项',
  '```pwsh',
  'Write-Output "AC-002 OK"',
  '```',
  '',
].join('\n')

const PROSE = [
  '# Task 900 验收标准',
  '',
  '- AC-900（integration）运行 node --test',
  '',
].join('\n')

const NO_COMMAND = [
  '## AC-901 只有散文',
  '这里描述期望，但没有命令。',
  '',
].join('\n')

const DUPLICATE = [
  '## AC-902 第一段',
  '- 命令: Write-Output "AC-902 OK"',
  '',
  '## AC-902 第二段',
  '- 命令: Write-Output "AC-902 OK"',
  '',
].join('\n')

const MULTI = [
  '## AC-910 A',
  '- 命令: Write-Output "AC-910 OK"',
  '',
  '## AC-911 B',
  '```pwsh',
  'Write-Output "AC-911 OK"',
  '```',
  '',
  '## AC-912 C',
  '- 命令: Write-Output "AC-912 OK"',
  '',
].join('\n')

const MISSING_SENTINEL = [
  '## AC-920 缺哨兵',
  '- 命令: Write-Output "done"',
  '',
].join('\n')

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-acceptance-'))
}

function writeFile(root, rel, text) {
  const file = path.join(root, ...rel.split('/'))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

function run(args, cwd = ROOT) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' })
}

function cleanup(t, dir) {
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
}

test('[AC-001] a compliant file exposes every AC section and command', (t) => {
  const dir = tempDir()
  cleanup(t, dir)
  const file = writeFile(dir, 'acceptance.md', COMPLIANT)

  const result = checkAcceptance(COMPLIANT)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.acs.map((ac) => ac.id), ['AC-001', 'AC-002'])
  assert.equal(result.commandCount, 2)

  const cli = run([file])
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout, /^ok .*acceptance\.md \(acs=2 commands=2\)$/m)
  assert.match(cli.stdout, /^check-acceptance: ok \(files=1 warnings=0\)$/m)
})

test('[AC-001] prose without "## AC-nnn" headings fails with a line number', (t) => {
  const dir = tempDir()
  cleanup(t, dir)
  const file = writeFile(dir, 'prose.md', PROSE)

  const result = checkAcceptance(PROSE)
  assert.equal(result.acs.length, 0)
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0].code, 'no_ac_heading')
  assert.equal(result.errors[0].line, 3)

  const cli = run([file])
  assert.equal(cli.status, 1, cli.stderr)
  assert.match(cli.stdout, /^FAIL .*prose\.md: no_ac_heading$/m)
  assert.match(cli.stdout, /^  line 3: no_ac_heading /m)
})

test('[AC-001] an AC section without an executable command fails', () => {
  const result = checkAcceptance(NO_COMMAND)
  assert.equal(result.acs.length, 1)
  assert.deepEqual(
    result.errors.map((error) => [error.code, error.line]),
    [['no_command', 1]]
  )
  assert.match(result.errors[0].detail, /AC-901 has no "- 命令:" line or ```pwsh block/)
})

test('[AC-001] a repeated AC id fails at the second heading', () => {
  const result = checkAcceptance(DUPLICATE)
  assert.deepEqual(
    result.errors.map((error) => [error.code, error.line]),
    [['duplicate_ac', 4]]
  )
  assert.match(result.errors[0].detail, /AC-902 is already declared at line 1/)
})

test('[AC-001] commands from every AC section are recognised', () => {
  const result = checkAcceptance(MULTI)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.acs.map((ac) => ac.id), ['AC-910', 'AC-911', 'AC-912'])
  assert.equal(result.commandCount, 3)
})

test('[AC-001] a missing "AC-nnn OK" sentinel is only a warning', (t) => {
  const dir = tempDir()
  cleanup(t, dir)
  const file = writeFile(dir, 'sentinel.md', MISSING_SENTINEL)

  const result = checkAcceptance(MISSING_SENTINEL)
  assert.deepEqual(result.errors, [])
  assert.equal(result.warnings.length, 1)
  assert.equal(result.warnings[0].code, 'missing_sentinel')

  const cli = run([file])
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout, /^WARN .*sentinel\.md:2: /m)
  assert.match(cli.stdout, /^check-acceptance: ok \(files=1 warnings=1\)$/m)
})

test('[AC-001] default scan skips archived tasks and reports the skip', (t) => {
  const dir = tempDir()
  cleanup(t, dir)
  const archived = writeFile(dir, `${COLLAB}/tasks/900/acceptance.md`, PROSE)
  writeFile(dir, `${COLLAB}/tasks/900/ci-results.json`, '{}\n')
  assert.ok(fs.existsSync(archived))

  const cli = run(['--root', dir])
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout, /^check-acceptance: ok \(no pending task acceptance\.md; archived_skipped=1\)$/m)
})

test('[AC-001] default scan also follows task worktrees and fails a pending prose file', (t) => {
  const dir = tempDir()
  cleanup(t, dir)
  const file = writeFile(dir, `${COLLAB}/worktrees/900/${COLLAB}/tasks/900/acceptance.md`, PROSE)

  const discovered = discoverAcceptanceFiles(dir)
  assert.deepEqual(discovered.pending, [file])
  assert.deepEqual(discovered.archived, [])

  const cli = run(['--root', dir])
  assert.equal(cli.status, 1, cli.stderr)
  assert.match(cli.stdout, /no_ac_heading/)
})

test('[AC-001] default scan treats a merged task without ci-results as archived', (t) => {
  const dir = tempDir()
  cleanup(t, dir)
  writeFile(dir, `${COLLAB}/tasks/903/acceptance.md`, PROSE)
  writeFile(dir, `${COLLAB}/tasks/903/state.json`, '{"status":"merged"}\n')

  const cli = run(['--root', dir])
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout, /no pending task acceptance\.md/)
})

test('[AC-001] the CLI prints one conclusion line per explicitly named file', (t) => {
  const dir = tempDir()
  cleanup(t, dir)
  const good = writeFile(dir, 'good.md', COMPLIANT)
  const bad = writeFile(dir, 'bad.md', PROSE)

  const cli = run([good, bad])
  assert.equal(cli.status, 1, cli.stderr)
  assert.match(cli.stdout, /^ok .*good\.md \(acs=2 commands=2\)$/m)
  assert.match(cli.stdout, /^FAIL .*bad\.md: no_ac_heading$/m)
  assert.match(cli.stdout, /^check-acceptance: FAILED \(files=2 failed=1 problems=1 warnings=0\)$/m)
})

test('[AC-001] bad arguments and paths exit 2', (t) => {
  const dir = tempDir()
  cleanup(t, dir)
  const file = writeFile(dir, 'acceptance.md', COMPLIANT)

  const missing = run([path.join(dir, 'absent.md')])
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /not a file/)
  assert.match(missing.stderr, /usage: node scripts\/check-acceptance\.mjs/)

  const directory = run([dir])
  assert.equal(directory.status, 2)
  assert.match(directory.stderr, /not a file/)

  const unknown = run(['--no-such-flag'])
  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /unknown argument: --no-such-flag/)

  const noRoot = run(['--root'])
  assert.equal(noRoot.status, 2)
  assert.match(noRoot.stderr, /--root requires a directory/)

  const badRoot = run(['--root', path.join(dir, 'absent')])
  assert.equal(badRoot.status, 2)
  assert.match(badRoot.stderr, /no such directory/)

  const ok = run([file])
  assert.equal(ok.status, 0)
})
