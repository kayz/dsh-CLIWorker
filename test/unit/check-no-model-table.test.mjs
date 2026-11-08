import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { scanSource } from '../../scripts/check-no-model-table.mjs'

const names = new Set(['alpha', 'beta', 'gamma', 'model-a', 'model-b', 'model-c'])
const checker = fileURLToPath(new URL('../../scripts/check-no-model-table.mjs', import.meta.url))

function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'model-table-'))
  try {
    for (const dir of ['scripts', 'lib/commands', 'config', 'contracts/examples/model.v1/valid']) fs.mkdirSync(path.join(root, dir), { recursive: true })
    fs.copyFileSync(checker, path.join(root, 'scripts/check-no-model-table.mjs'))
    fs.writeFileSync(path.join(root, 'config/cliworker.example.json'), JSON.stringify({ providers: { alpha: {}, beta: {}, gamma: {} }, models: {} }))
    fs.writeFileSync(path.join(root, 'contracts/examples/model.v1/valid/example.json'), JSON.stringify({ id: 'model-a', cli: 'model-b', provider: 'model-c' }))
    const write = (file, source) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source) }
    const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/check-no-model-table.mjs')], { encoding: 'utf8' })
    callback({ root, write, run })
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('[AC-079] clean, two names, duplicates and separate expressions pass', () => {
  for (const source of ["const x = ['other']", "const x = ['alpha','beta']", "const x = ['alpha','alpha','alpha']", "const x = ['alpha']; const y = ['beta']; const z = ['gamma']"]) assert.deepEqual(scanSource(source, names), [])
  fixture(({ write, run }) => { write('lib/a.mjs', "const x = ['alpha', 'beta']"); const r = run(); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), 'AC-079 OK') })
})

test('[AC-079] CLI, model, object keys, nested and mixed literals fail', () => {
  for (const source of ["['alpha','beta','gamma']", "['model-a','model-b','model-c']", "const x = {\n alpha: 1, beta: 2, gamma: 3\n}", "const x = [{id:'model-a'}, {id:'model-b'}, {id:'model-c'}]", "['alpha','beta','model-a']"]) assert.ok(scanSource(source, names).length > 0, source)
  assert.ok(scanSource("['alpha', 'be\\u0074a', 'gamma']", names).length > 0)
})

test('[AC-079] comments, strings, regex, templates and code blocks do not create tables', () => {
  const source = `// ['alpha','beta','gamma']\nconst s = "['alpha','beta','gamma']"; const r = /['alpha','beta','gamma']/; const t = \`['alpha','beta','gamma']\`; function f() { 'alpha'; 'beta'; 'gamma' }`
  assert.deepEqual(scanSource(source, names), [])
})

test('[AC-079] diagnostics report exact path, line and original literal', () => {
  fixture(({ write, run }) => {
    const literal = "[\n 'alpha', 'beta', 'gamma'\n]"
    write('lib/commands/sub/check.mjs', `const x = 1;\nconst table = ${literal};`)
    const r = run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /lib\/commands\/sub\/check\.mjs:2:/); assert.ok(r.stderr.includes(literal)); assert.ok(!r.stdout.includes('AC-079 OK'))
  })
})

test('[AC-079] only the exact whitelist path is excluded', () => {
  fixture(({ write, run }) => {
    const source = "const x = ['alpha','beta','gamma']"
    write('lib/commands/_util.mjs', source)
    let r = run(); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), 'AC-079 OK')
    write('lib/commands/sub/_util.mjs', source)
    write('lib/commands/_util-extra.mjs', source)
    r = run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /commands\/sub\/_util\.mjs/); assert.match(r.stderr, /commands\/_util-extra\.mjs/)
  })
})

test('[AC-079] declarations update vocabulary and input failures fail closed', () => {
  fixture(({ root, write, run }) => {
    write('lib/a.mjs', "const x = ['new-cli','new-id','new-provider']")
    assert.equal(run().status, 0)
    write('config/cliworker.example.json', JSON.stringify({ providers: { 'new-provider': { cli: 'new-cli' } }, models: { key: { id: 'new-id' } } }))
    let r = run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /lib\/a\.mjs:1:/)
    write('config/cliworker.example.json', '{')
    r = run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /check-no-model-table/); assert.ok(!r.stdout.includes('AC-079 OK'))
    fs.rmSync(path.join(root, 'config/cliworker.example.json'))
    r = run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /cliworker\.example\.json/)
  })
})
