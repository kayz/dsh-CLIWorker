import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveNpm } from '../../scripts/check-alpha-package.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const checker = path.join(repo, 'scripts', 'check-alpha-package.mjs')
const npm = resolveNpm()
const assets = ['package.json', 'ui/index.html', 'ui/app.mjs', 'ui/render.mjs', 'docs/ui/cliworker-console.html']
const snapshot = () => assets.map(p => fs.readFileSync(path.join(repo, p)))
const same = before => assert.deepEqual(snapshot(), before)

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-test-'))
  const env = { SystemRoot:process.env.SystemRoot, ComSpec:process.env.ComSpec, PATHEXT:process.env.PATHEXT, PATH:[path.dirname(process.execPath), ...(process.platform === 'win32' ? [process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32')] : ['/usr/bin', '/bin'])].filter(Boolean).join(path.delimiter) }
  for (const name of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','TEMP','TMP','TMPDIR']) env[name] = root
  Object.assign(env, {npm_config_cache:path.join(root,'cache'),npm_config_userconfig:path.join(root,'userconfig'),npm_config_globalconfig:path.join(root,'globalconfig'),npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false',npm_config_update_notifier:'false'})
  const run = (cmd, args, cwd = root) => spawnSync(cmd, args, {cwd, env, encoding:'utf8', timeout:120000, maxBuffer:8*1024*1024, windowsHide:true})
  const ok = (cmd, args, cwd) => { const r = run(cmd,args,cwd); assert.equal(r.error, undefined, r.error?.message); assert.equal(r.signal,null); assert.equal(r.status,0,`${cmd}: ${r.stdout}\n${r.stderr}`); return r.stdout }
  const pack = cwd => { const data = JSON.parse(ok(process.execPath,[npm,'pack','--json','--offline','--ignore-scripts','--pack-destination',root],cwd)); return path.join(root,data[0].filename) }
  const clean = () => assert.deepEqual(fs.readdirSync(root).filter(n => n.startsWith('cliworker-alpha-')), [], 'checker temporary roots remain')
  const before = snapshot()
  try { fn({root,run,ok,pack,clean}); same(before) } finally { fs.rmSync(root,{recursive:true,force:true}); assert(!fs.existsSync(root)) }
}

test('[AC-088] installs and checks the actual tarball repeatedly', () => fixture(({pack,run,clean}) => {
  const archive = pack(repo), bytes = fs.readFileSync(archive)
  for (let i=0; i<2; i++) {
    const result = run(process.execPath,[checker,archive],repo)
    assert.equal(result.error,undefined); assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/^AC-088 OK\s*$/m)
    clean(); assert.deepEqual(fs.readFileSync(archive),bytes)
  }
}))

test('[AC-088] rejects tarball without ui', () => fixture(({root,pack,run,ok,clean}) => {
  const original = pack(repo), originalBytes = fs.readFileSync(original)
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot,'System32','tar.exe') : '/usr/bin/tar'
  const members = ok(tar,['-tzf',original]).split(/\r?\n/).filter(Boolean)
  assert(members.length > 0)
  for (const member of members) {
    assert(!path.posix.isAbsolute(member) && !member.includes('\\') && !member.split('/').includes('..'), `unsafe archive member ${member}`)
    assert(member === 'package' || member.startsWith('package/'), `unexpected archive member ${member}`)
  }
  const unpack = path.join(root,'unpack'); fs.mkdirSync(unpack)
  ok(tar,['-xzf',original,'-C',unpack])
  const pkg = path.join(unpack,'package')
  assert(fs.statSync(path.join(pkg,'ui')).isDirectory()); fs.rmSync(path.join(pkg,'ui'),{recursive:true})
  assert(!fs.existsSync(path.join(pkg,'ui'))); assert(fs.statSync(path.join(pkg,'docs/ui/cliworker-console.html')).isFile())
  // The original archive has the same npm-generated filename; preserve it separately.
  const saved = path.join(root,'original.tgz'); fs.copyFileSync(original,saved); fs.rmSync(original)
  const broken = pack(pkg), bytes = fs.readFileSync(broken)
  const brokenMembers = ok(tar,['-tzf',broken]).split(/\r?\n/).filter(Boolean)
  assert(!brokenMembers.some(name => name.startsWith('package/ui/')))
  assert(brokenMembers.includes('package/docs/ui/cliworker-console.html'))
  assert(brokenMembers.includes('package/bin/cliworker.mjs'))
  assert(brokenMembers.some(name => name.startsWith('package/lib/')))
  const result = run(process.execPath,[checker,broken],repo)
  assert.equal(result.error,undefined); assert.notEqual(result.status,0); assert(!result.stdout.includes('AC-088 OK'))
  assert.match(result.stderr,/missing or empty ui\//); assert(!result.stderr.includes('npm install:'))
  clean(); assert.deepEqual(fs.readFileSync(broken),bytes); assert.deepEqual(fs.readFileSync(saved),originalBytes)
}))
