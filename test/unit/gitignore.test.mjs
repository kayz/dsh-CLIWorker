import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function checkIgnore(target) {
  return spawnSync('git', ['check-ignore', '-v', '--', target], { cwd: ROOT, encoding: 'utf8' })
}

test('[AC-013] git check-ignore -v matches config/a.local.json, state/x, a.jsonl and .collab/worktrees/x', () => {
  const rules = {
    'config/a.local.json': 'config/*.local.json',
    'state/x': 'state/',
    'a.jsonl': '*.jsonl',
    '\.collab/worktrees/x': '.collab/worktrees/',
  }

  for (const [target, rule] of Object.entries(rules)) {
    const result = checkIgnore(target)
    const output = `${result.stdout || ''}${result.stderr || ''}`
    assert.equal(result.status, 0, `${target}: ${output}`)
    assert.ok((result.stdout || '').includes('.gitignore:'), `${target} ${result.stdout}`)
    assert.ok((result.stdout || '').includes(rule), `${target} ${result.stdout}`)
  }
})

test('[AC-013] git check-ignore does not match config/cliworker.example.json', () => {
  const result = checkIgnore('config/cliworker.example.json')
  assert.equal(result.status, 1, `${result.stdout || ''}${result.stderr || ''}`)
  assert.equal(result.stdout || '', '')
})
