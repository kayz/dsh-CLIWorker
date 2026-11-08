import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { checkScope, scopePaths } from '../../scripts/check-scope-visible.mjs'

function tempRepo({ gitignore }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-visible-'))
  fs.writeFileSync(path.join(root, '.gitignore'), gitignore)
  fs.mkdirSync(path.join(root, 'lib', 'commands', 'state'), { recursive: true })
  fs.writeFileSync(path.join(root, 'lib', 'commands', 'state', 'backup.mjs'), 'export {}\n')
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' })
  assert.equal(init.status, 0, init.stderr)
  return root
}

const graphWith = (scope) => ({ tasks: [{ id: 'T-999', write_scope: scope }] })

test('[AC-001] scopePaths normalizes directory globs and trailing slashes', () => {
  const graph = graphWith(['lib/commands/state/**', 'test/foo/', 'plain.mjs'])
  assert.deepEqual(scopePaths(graph), [
    ['T-999', 'lib/commands/state'],
    ['T-999', 'test/foo'],
    ['T-999', 'plain.mjs'],
  ])
})

test('[AC-001] unanchored gitignore rule hiding a scope dir is reported', () => {
  const root = tempRepo({ gitignore: 'state/\n' })
  try {
    const errors = checkScope(root, graphWith(['lib/commands/state/**']))
    assert.equal(errors.length, 1, JSON.stringify(errors))
    assert.equal(errors[0].taskId, 'T-999')
    assert.equal(errors[0].path, 'lib/commands/state')
    assert.equal(errors[0].reason, 'ignored-by-gitignore')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('[AC-001] anchored rule keeps the same scope dir visible', () => {
  const root = tempRepo({ gitignore: '/state/\n' })
  try {
    assert.deepEqual(checkScope(root, graphWith(['lib/commands/state/**'])), [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
