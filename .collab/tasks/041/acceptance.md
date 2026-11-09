# Task 041 — 生成资产 freshness gate：生成后必须无 diff

brief 未给基准 commit sha 或既有验收报告路径。接口和对比范围以同目录 design.md 为准。从仓库根用 PowerShell 7 执行；每个 pwsh 块独立，由 runner 保存为 UTF-8 无 BOM 的 .ps1 后以 pwsh -NoProfile -File 运行。各块失败退出非零，不打印成功哨兵；原生命令之后检查 $LASTEXITCODE。临时文件只在系统临时目录创建并清理。

## AC-084 生成资产与源输入一致且检查不污染工作区

新增单元测试必须实际执行，不能跳过或待办。

```pwsh
$ErrorActionPreference = 'Stop'
$freshTap = & node --test --test-reporter=tap 'test/unit/check-generated-fresh.test.mjs'
$freshCode = $LASTEXITCODE
$freshTap | Write-Output
if ($freshCode -ne 0) { throw 'AC-084 unit tests failed' }
$freshText = $freshTap -join "`n"
if ($freshText -notmatch '(?m)^# tests [1-9][0-9]*\r?$') { throw 'AC-084 no tests executed' }
foreach ($freshStatus in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($freshText -notmatch "(?m)^# $freshStatus 0\r?`$") { throw "AC-084 has $freshStatus tests" }
}
Write-Output 'AC-084 OK'
```

- 期望输出：退出码 0，tests 为正数，fail/cancelled/skipped/todo 均为 0，最后输出 `AC-084 OK`。用例覆盖 design.md 列明的规范化边界、进程错误与清理路径；以下独立命令另外验证主行为，不依赖测试标题。

独立构造两个就地替身生成器：验证干净树、夹具损坏、源索引变化、文件增删、文档过期和生成失败；每次均比较原树完整快照。无需真实生成器、git 或额外测试 API。

```pwsh
$ErrorActionPreference = 'Stop'
@'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const gate = path.resolve('scripts/check-generated-fresh.mjs')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ac084-contract-'))
const fixtureGenerator = 'test/fixtures/release-gate/generate.mjs'
const docGenerator = 'scripts/gen-contract-doc.mjs'
const fixture = 'test/fixtures/release-gate/good/contracts/spec/ac-index.json'
const extra = 'test/fixtures/release-gate/good/test/unit/evidence.test.mjs'
const doc = 'docs/contract.md'
const indexPath = 'contracts/spec/ac-index.json'
const write = (rel, text) => {
  const target = path.join(root, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text, 'utf8')
}
function snapshot() {
  const entries = []
  function visit(dir, prefix = '') {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const rel = prefix + e.name
      if (e.isDirectory()) { entries.push([rel + '/', null]); visit(path.join(dir, e.name), rel + '/') }
      else { assert.ok(e.isFile()); entries.push([rel, fs.readFileSync(path.join(dir, e.name)).toString('base64')]) }
    }
  }
  visit(root)
  return entries
}
function check(ok, generators = [], assets = []) {
  const before = snapshot()
  const r = spawnSync(process.execPath, [gate, '--root', root], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024,
  })
  assert.ifError(r.error)
  assert.equal(r.signal, null)
  assert.deepEqual(snapshot(), before, 'check changed the input tree')
  const output = ((r.stdout ?? '') + '\n' + (r.stderr ?? '')).replaceAll('\\', '/')
  if (ok) {
    assert.equal(r.status, 0, output)
    assert.ok(r.stdout.includes('AC-084 OK'), output)
  } else {
    assert.notEqual(r.status, 0, output)
    assert.equal(r.stdout.includes('AC-084 OK'), false)
  }
  for (const name of [...generators, ...assets]) assert.ok(output.includes(name), output + '\nmissing: ' + name)
}
try {
  write('package.json', fs.readFileSync('package.json', 'utf8'))
  for (const rel of ['contracts/spec/ac-index.json', 'contracts/registry.snapshot.json', 'contracts/golden/manifest.json']) {
    write(rel, fs.readFileSync(rel, 'utf8'))
  }
  fs.cpSync('contracts/schemas', path.join(root, 'contracts/schemas'), { recursive: true })
  const index = fs.readFileSync(path.join(root, indexPath), 'utf8')
  const registry = fs.readFileSync(path.join(root, 'contracts/registry.snapshot.json'), 'utf8')
  const fixtureSource = `import fs from 'node:fs';
    fs.mkdirSync('test/fixtures/release-gate/good/contracts/spec', {recursive:true});
    fs.mkdirSync('test/fixtures/release-gate/good/test/unit', {recursive:true});
    fs.copyFileSync('contracts/spec/ac-index.json', '${fixture}');
    fs.writeFileSync('${extra}', '// fixture\\n', 'utf8');`
  const docSource = `import fs from 'node:fs';
    fs.mkdirSync('docs', {recursive:true});
    fs.copyFileSync('contracts/registry.snapshot.json', '${doc}');`
  write(fixtureGenerator, fixtureSource)
  write(docGenerator, docSource)
  write(fixture, index)
  write(extra, '// fixture\n')
  write(doc, registry)
  check(true, [fixtureGenerator, docGenerator])
  write(fixture, 'broken\n')
  check(false, [fixtureGenerator], [fixture])
  write(fixture, index)
  check(true)
  const changed = JSON.parse(index)
  changed.acs = changed.acs.slice(0, -1)
  write(indexPath, JSON.stringify(changed, null, 2) + '\n')
  check(false, [fixtureGenerator], [fixture])
  write(fixture, fs.readFileSync(path.join(root, indexPath), 'utf8'))
  check(true)
  fs.unlinkSync(path.join(root, extra))
  check(false, [fixtureGenerator], [extra])
  write(extra, '// fixture\n')
  const surplus = 'test/fixtures/release-gate/good/surplus.txt'
  write(surplus, 'obsolete\n')
  check(false, [fixtureGenerator], [surplus])
  fs.unlinkSync(path.join(root, surplus))
  write(doc, 'broken doc\n')
  check(false, [docGenerator], [doc])
  write(fixture, 'broken fixture\n')
  check(false, [fixtureGenerator, docGenerator], [fixture, doc])
  write(fixture, fs.readFileSync(path.join(root, indexPath), 'utf8'))
  write(doc, registry)
  write(fixtureGenerator, fixtureSource + '\nprocess.exitCode = 1;\n')
  check(false, [fixtureGenerator])
  write(fixtureGenerator, fixtureSource)
  fs.unlinkSync(path.join(root, docGenerator))
  check(false, [docGenerator])
  write(docGenerator, docSource)
  fs.unlinkSync(path.join(root, indexPath))
  check(false, [fixtureGenerator])
  write(indexPath, fs.readFileSync(path.join(root, fixture), 'utf8'))
  check(true)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
assert.equal(fs.existsSync(root), false)
console.log('AC-084 OK')
'@ | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-084 isolated generator contract failed' }
```

- 期望输出：退出码 0，最后输出 `AC-084 OK`。内部每次成功均为退出 0 且 stdout 有成功哨兵；每次预置错误均退出非 0、无成功哨兵，输出指名对应生成器及差异资产；原临时树文件集合和字节每次保持相同，结束后临时根消失。索引变化场景先失败、更新资产后恢复成功。

真实工作区检查连续执行两次，验证现有 42 个场景及文档与源一致、跨临时根稳定、不改写工作区；失败保留严格判据。

```pwsh
$ErrorActionPreference = 'Stop'
@'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const root = process.cwd()
function snapshot() {
  const entries = []
  function visit(rel) {
    const full = path.join(root, rel)
    const stat = fs.lstatSync(full)
    if (stat.isDirectory()) {
      entries.push([rel + '/', null])
      for (const name of fs.readdirSync(full).sort()) visit(rel + '/' + name)
    } else {
      assert.ok(stat.isFile(), 'unsupported file: ' + rel)
      entries.push([rel, fs.readFileSync(full).toString('base64')])
    }
  }
  for (const rel of ['test/fixtures/release-gate', 'docs', 'contracts', 'scripts', 'package.json']) visit(rel)
  return entries
}
const before = snapshot()
for (let n = 0; n < 2; n += 1) {
  const result = spawnSync(process.execPath, ['scripts/check-generated-fresh.mjs'], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024,
  })
  assert.deepEqual(snapshot(), before, 'freshness check changed workspace files')
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(result.stdout.includes('AC-084 OK'))
  const output = (result.stdout + result.stderr).replaceAll('\\', '/')
  for (const generator of ['test/fixtures/release-gate/generate.mjs', 'scripts/gen-contract-doc.mjs']) {
    assert.ok(output.includes(generator), 'missing generator result: ' + generator)
  }
}
console.log('AC-084 OK')
'@ | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-084 real assets are stale or check changed workspace' }
```

- 期望输出：退出码 0，最后输出 `AC-084 OK`；两轮实际生成均成功且指名两项生成器，相关目录的文件集合和字节前后完全相同。若现有资产过期则本命令失败，不能由检查自动更新资产，不能跳过或放宽本门禁。

完整仓库门禁确认 CI 发现并运行新增脚本。该块由实现/CI 阶段执行；design 轮禁止 git 和创建其他文件，因此不在 design 轮执行。

```pwsh
$ErrorActionPreference = 'Stop'
$freshFast = & pwsh -NoProfile -File 'scripts/check-fast.ps1'
$freshFastCode = $LASTEXITCODE
$freshFast | Write-Output
if ($freshFastCode -ne 0) { throw 'AC-084 check-fast failed' }
$freshFastText = $freshFast -join "`n"
if ($freshFastText -notmatch '(?m)^==> check-generated-fresh\.mjs\r?$') { throw 'AC-084 gate not discovered' }
if ($freshFastText -notmatch '(?m)^AC-084 OK\r?$') { throw 'AC-084 gate did not pass' }
if ($freshFastText -notmatch '(?m)^check-fast: ok\r?$') { throw 'AC-084 incomplete check-fast' }
Write-Output 'AC-084 OK'
```

- 期望输出：退出码 0，stdout 含新增脚本执行标记 `==> check-generated-fresh.mjs`、`AC-084 OK` 及 `check-fast: ok`，最后输出 `AC-084 OK`。任一既有门禁失败也判失败，禁止降为警告。

## AC-006 单元回归门禁

```pwsh
$ErrorActionPreference = 'Stop'
node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'AC-006 unit regression failed' }
Write-Output 'AC-006 OK'
```

- 期望输出：退出码 0，全部单元测试通过，stdout 最后输出 `AC-006 OK`；任何测试失败均阻断，不修改既有断言。
