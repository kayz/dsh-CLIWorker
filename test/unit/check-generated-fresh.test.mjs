import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { check } from '../../scripts/check-generated-fresh.mjs'

const gate = fileURLToPath(new URL('../../scripts/check-generated-fresh.mjs', import.meta.url))
const gen = 'test/fixtures/release-gate/generate.mjs'
const docGen = 'scripts/gen-contract-doc.mjs'
const base = 'test/fixtures/release-gate/good'
const index = `${base}/contracts/spec/ac-index.json`
const tap = `${base}/ci/linux/reporter.tap`
const smoke = `${base}/smoke.json`
const doc = 'docs/contract.md'
const tapText = 'TAP version 13\n# Subtest: [AC-001]\nok 1 - [AC-001] # SKIP reason\n  ---\n  duration_ms: 1.2\n  failureType: testCodeFailure\n  error: broken\n  code: ERR_TEST\n  type: test\n  location: x\n  stack: |\n    at x\n  ...\n1..1\n# tests 1\n# pass 1\n# duration_ms 4.2\n'

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-test-'))
  const write = (rel, value) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, value) }
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
  const fixtureSource = `import fs from 'node:fs';
const put=(p,s)=>{fs.mkdirSync(p.slice(0,p.lastIndexOf('/')),{recursive:true});fs.writeFileSync(p,s)};
put('${index}',fs.readFileSync('contracts/spec/ac-index.json'));
put('${tap}',${JSON.stringify(tapText)});
put('${smoke}', JSON.stringify({node:'v20.1.0',value:'same'}));`
  const docSource = `import fs from 'node:fs';fs.mkdirSync('docs',{recursive:true});fs.copyFileSync('contracts/registry.snapshot.json','${doc}');`
  write(gen, fixtureSource); write(docGen, docSource)
  write('package.json', '{}'); write('contracts/spec/ac-index.json', '{"acs":[1]}\n')
  write('contracts/registry.snapshot.json', 'registry\n'); write('contracts/golden/manifest.json', '{}')
  write('contracts/schemas/schema.json', '{}'); write(index, read('contracts/spec/ac-index.json'))
  write(tap, tapText); write(smoke, '{"node":"v20.1.0","value":"same"}'); write(doc, 'registry\n')
  function snapshot(dir = root, prefix = '') {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => {
      const rel = prefix + e.name, full = path.join(dir, e.name)
      return e.isDirectory() ? [[rel + '/', null], ...snapshot(full, rel + '/')] : [[rel, fs.readFileSync(full).toString('base64')]]
    })
  }
  function run(ok, expected = []) {
    const before = snapshot()
    const r = spawnSync(process.execPath, [gate, '--root', root], { encoding: 'utf8', timeout: 30000, windowsHide: true })
    assert.ifError(r.error); assert.equal(r.signal, null); assert.deepEqual(snapshot(), before)
    assert.equal(r.status === 0, ok, r.stdout + r.stderr)
    assert.equal(r.stdout.includes('AC-084 OK'), ok)
    for (const item of expected) assert.ok((r.stdout + r.stderr).replaceAll('\\', '/').includes(item), item + ': ' + r.stdout + r.stderr)
  }
  return { root, write, read, run, fixtureSource, docSource }
}
function withRoot(fn) { const x = setup(); try { fn(x) } finally { fs.rmSync(x.root, { recursive: true, force: true }) } }

test('[AC-084] compares both isolated generators and inputs', () => withRoot(x => {
  const { write, read, run, root } = x
  run(true, [gen, docGen])
  write(index, 'bad'); run(false, [gen, index]); write(index, read('contracts/spec/ac-index.json'))
  write('contracts/spec/ac-index.json', '{"acs":[2]}\n'); run(false, [gen, index]); write(index, read('contracts/spec/ac-index.json')); run(true)
  fs.unlinkSync(path.join(root, index)); run(false, [gen, index]); write(index, read('contracts/spec/ac-index.json'))
  write(`${base}/extra`, 'extra'); run(false, [gen, `${base}/extra`]); fs.unlinkSync(path.join(root, base, 'extra'))
  write(doc, 'bad'); write(index, 'bad'); run(false, [gen, docGen, index, doc])
  write(index, read('contracts/spec/ac-index.json')); write(doc, 'registry\n')
  write(gen, x.fixtureSource + '\nprocess.exitCode=1'); run(false, [gen, docGen])
  write(gen, 'throw new Error("failure")'); run(false, [gen, docGen])
  fs.unlinkSync(path.join(root, gen)); run(false, [gen, docGen]); write(gen, x.fixtureSource)
  fs.unlinkSync(path.join(root, 'contracts/spec/ac-index.json')); run(false, [gen, docGen])
}))

test('[AC-084] normalizes only permitted reporter and environment metadata', () => withRoot(({ write, run }) => {
  const allowed = tapText.replace('duration_ms: 1.2', 'duration_ms: 99').replace('# duration_ms 4.2', '# duration_ms 3').replace('type: test', 'type: different').replace('location: x', 'location: y').replace('    at x', '    at y').replaceAll('\n', '\r\n')
  write(tap, allowed); write(smoke, '{"node":"v22.0.0","value":"same"}'); run(true)
  for (const [from, to] of [['[AC-001]', '[AC-002]'], ['ok 1', 'not ok 1'], ['SKIP', 'TODO'], ['1..1', '1..2'], ['# pass 1', '# pass 0'], ['ERR_TEST', 'ERR_OTHER'], ['# tests 1', '# extra\n# tests 1'], ['# duration_ms 4.2\n', '']]) {
    write(tap, tapText.replace(from, to)); run(false, [gen, tap])
  }
  write(tap, tapText); write(smoke, '{"node":"v22.0.0","value":"changed"}'); run(false, [gen, smoke])
  write(smoke, '{"node":"invalid","value":"same"}'); run(false, [gen, smoke])
}))

test('[AC-084] handles process start and timeout errors and continues both jobs', () => withRoot(({ root }) => {
  for (const error of [Object.assign(new Error('start failed'), { code: 'ENOENT' }), Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })]) {
    let calls = 0
    assert.equal(check(root, { spawnSync: () => { calls++; return { error, status: null, signal: null } } }), false)
    assert.equal(calls, 2)
  }
}))
