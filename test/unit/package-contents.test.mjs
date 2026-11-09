import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { collectFiles, evaluateContents, runNpmPack } from '../../scripts/check-package-contents.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const checker = path.join(repo, 'scripts/check-package-contents.mjs')
const html = 'docs/ui/cliworker-console.html'
const dirs = ['ui', 'bin', 'lib']
const source = { ui: ['ui/a', 'ui/nested/b'], bin: ['bin/a'], lib: ['lib/a'] }
const full = [...Object.values(source).flat(), html]

test('[AC-087] list rules cover missing assets, similar prefixes and additions', () => {
  assert.deepEqual(evaluateContents([...full, 'extra/file'], source), [])
  for (const file of full) assert.ok(evaluateContents(full.filter(item => item !== file), source).includes(file))
  for (const dir of dirs) {
    const files = full.filter(file => !file.startsWith(`${dir}/`)).concat(`${dir}-old/a`, `${dir}/`)
    assert.ok(evaluateContents(files, source).includes(`${dir}/`))
    assert.ok(evaluateContents(full, { ...source, [dir]: [] }).includes(`${dir}/`))
  }
})

test('[AC-087] npm execution failures and malformed output fail closed', () => {
  const invalid = [
    () => { throw new Error('start') },
    () => ({ error: new Error('ENOENT') }),
    () => ({ error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) }),
    () => ({ status: 1 }),
    () => ({ status: 0, stdout: '{' }),
    () => ({ status: 0, stdout: '[]' }),
    () => ({ status: 0, stdout: '[{}]' }),
    () => ({ status: 0, stdout: '[{"files":[{}]}]' }),
    () => ({ status: 0, stdout: '[{"files":[{"path":""}]}]' }),
    () => ({ status: 0, stdout: '[{"files":[{"path":"ui/"}]}]' }),
    () => ({ status: 0, stdout: '[{"files":[{"path":"ui/../a"}]}]' }),
  ]
  for (const spawn of invalid) assert.ok(runNpmPack(repo, spawn).error)
  const result = runNpmPack(repo, (command, args, options) => {
    assert.equal(options.env.npm_config_offline, 'true')
    assert.ok(args.includes('--ignore-scripts'))
    assert.ok(options.timeout && options.maxBuffer && options.windowsHide)
    return { status: 0, stdout: JSON.stringify([{ files: [{ path: 'ui\\nested\\a' }] }]) }
  })
  assert.deepEqual(result.files, ['ui/nested/a'])
})

test('[AC-087] real npm pack and production checker enforce complete assets', () => {
  const before = fs.readFileSync(path.join(repo, 'package.json'))
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-package-test-'))
  function fixture(label) {
    const root = path.join(scratch, label)
    fs.mkdirSync(root)
    fs.writeFileSync(path.join(root, 'package.json'), before)
    for (const rel of [...dirs, html]) {
      const dest = path.join(root, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.cpSync(path.join(repo, rel), dest, { recursive: true })
    }
    return root
  }
  function pack(root) {
    const result = runNpmPack(root)
    assert.equal(result.error, null, result.error)
    return result.files
  }
  function check(root, success, missing) {
    const result = spawnSync(process.execPath, [checker, '--root', root], { cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true })
    assert.ifError(result.error)
    assert.equal(result.status === 0, success, result.stdout + result.stderr)
    assert.equal(result.stdout.includes('AC-087 OK'), success)
    if (missing) assert.ok((result.stdout + result.stderr).includes(missing), result.stderr)
  }
  try {
    const actual = pack(repo)
    assert.deepEqual(evaluateContents(actual, Object.fromEntries(dirs.map(dir => [dir, collectFiles(repo, dir)]))), [])
    check(repo, true)
    const good = fixture('good')
    fs.mkdirSync(path.join(good, 'ui/nested'), { recursive: true })
    fs.writeFileSync(path.join(good, 'ui/nested/additional.mjs'), 'export default true\n', 'utf8')
    assert.ok(pack(good).includes('ui/nested/additional.mjs'))
    check(good, true)
    const noUi = fixture('no-ui')
    const pkg = JSON.parse(before.toString('utf8'))
    pkg.files = pkg.files.filter(item => !['ui', 'ui/', 'ui/**', 'ui/**/*'].includes(item))
    fs.writeFileSync(path.join(noUi, 'package.json'), JSON.stringify(pkg), 'utf8')
    assert.ok(fs.existsSync(path.join(noUi, 'ui/app.mjs')))
    assert.ok(!pack(noUi).some(file => file.startsWith('ui/')))
    check(noUi, false, 'ui/')
    for (const missing of [html, 'bin', 'lib']) {
      const root = fixture(`missing-${missing.replaceAll('/', '-')}`)
      fs.rmSync(path.join(root, missing), { recursive: true, force: true })
      const files = pack(root)
      assert.ok(!files.some(file => missing === html ? file === html : file.startsWith(`${missing}/`)))
      check(root, false, missing === html ? missing : `${missing}/`)
    }
    assert.deepEqual(fs.readFileSync(path.join(repo, 'package.json')), before)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
  assert.ok(!fs.existsSync(scratch))
})
