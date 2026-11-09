# Task 044 — UI 资产随 npm 包分发

以下命令各自独立从仓库根在 PowerShell 7 执行；每个 pwsh 块是一条完整命令。多步骤块由验收执行器保存为其临时 ps1 后执行，不在仓库新增脚本。原生命令后检查退出码，断言失败立即非零退出，成功才输出 AC-087 OK。实施测试临时文件均位于系统临时目录；设计轮仅执行末尾的格式自检。

brief 未提供基准 commit SHA 或既有验收报告路径，本轮不编造或引用其他任务的通过结论。

## AC-087 UI 资产分发的 unit 与清单契约

生产检查命令：

```pwsh
$ErrorActionPreference = 'Stop'
$result = @(node scripts/check-package-contents.mjs)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not ($result -contains 'AC-087 OK')) { throw 'Missing package check sentinel' }
$result | Write-Output
```

期望输出：退出码 0，stdout 包含独立行 AC-087 OK。此命令实际调用离线 npm dry-run，并检查 ui/、bin/、lib/ 前缀、三个目录内逐个源码文件及精确 HTML 路径；任一缺失、npm 运行失败或清单无效均非零退出且无成功哨兵。仅读取 package.json 的 files 声明不能满足该命令的实现要求。

独立清单与临时副本反例命令：

```pwsh
$ErrorActionPreference = 'Stop'
@'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { runNpmPack } from './scripts/check-pack.mjs'

const repo = process.cwd()
const checker = path.join(repo, 'scripts/check-package-contents.mjs')
const manifest = path.join(repo, 'package.json')
const before = fs.readFileSync(manifest)
const pkg = JSON.parse(before.toString('utf8'))
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-package-'))
const previousOffline = process.env.npm_config_offline
process.env.npm_config_offline = 'true'
function walk(root, rel) {
  return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap(entry => {
    const name = `${rel}/${entry.name}`
    return entry.isDirectory() ? walk(root, name) : entry.isFile() ? [name] : []
  })
}
function pack(root) {
  const result = runNpmPack(root)
  assert.equal(result.error, null, result.error ?? '')
  return result.files
}
function requireAssets(root, files) {
  for (const prefix of ['ui/', 'bin/', 'lib/']) {
    assert.ok(files.some(file => file.startsWith(prefix) && file.length > prefix.length), prefix)
    const source = walk(root, prefix.slice(0, -1))
    assert.ok(source.length > 0, prefix)
    for (const file of source) assert.ok(files.includes(file), file)
  }
  assert.ok(files.includes('docs/ui/cliworker-console.html'))
}
function fixture(label) {
  const root = path.join(scratch, label)
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(root, 'package.json'), before)
  for (const rel of ['ui', 'bin', 'lib', 'docs/ui/cliworker-console.html']) {
    const dest = path.join(root, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(path.join(repo, rel), dest, { recursive: true })
  }
  return root
}
function run(root, ok, missing = '') {
  const result = spawnSync(process.execPath, [checker, '--root', root], {
    cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true,
    env: { ...process.env, npm_config_offline: 'true' },
  })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  assert.equal(result.status === 0, ok, result.stdout + result.stderr)
  assert.equal(result.stdout.includes('AC-087 OK'), ok)
  if (missing) assert.ok((result.stdout + result.stderr).includes(missing), missing)
}
try {
  requireAssets(repo, pack(repo))
  const good = fixture('good')
  run(good, true)
  fs.mkdirSync(path.join(good, 'ui', 'nested'), { recursive: true })
  fs.writeFileSync(path.join(good, 'ui', 'nested', 'additional.mjs'), 'export default true\n', 'utf8')
  requireAssets(good, pack(good))
  run(good, true)

  const noUi = fixture('no-ui')
  const changed = structuredClone(pkg)
  changed.files = changed.files.filter(item => !['ui', 'ui/', 'ui/**', 'ui/**/*'].includes(item))
  fs.writeFileSync(path.join(noUi, 'package.json'), JSON.stringify(changed), 'utf8')
  assert.ok(fs.existsSync(path.join(noUi, 'ui', 'app.mjs')))
  assert.ok(!pack(noUi).some(file => file.startsWith('ui/')))
  run(noUi, false, 'ui/')

  for (const missing of ['docs/ui/cliworker-console.html', 'bin', 'lib']) {
    const root = fixture(`missing-${missing.split('/').join('-')}`)
    fs.rmSync(path.join(root, missing), { recursive: true, force: true })
    const files = pack(root)
    if (missing.endsWith('.html')) assert.ok(!files.includes(missing))
    else assert.ok(!files.some(file => file.startsWith(`${missing}/`)))
    run(root, false, missing.endsWith('.html') ? missing : `${missing}/`)
  }
  assert.deepEqual(fs.readFileSync(manifest), before)
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
  if (previousOffline === undefined) delete process.env.npm_config_offline
  else process.env.npm_config_offline = previousOffline
}
assert.ok(!fs.existsSync(scratch))
console.log('AC-087 OK')
'@ | node --input-type=module
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

期望输出：退出码 0，stdout 含 AC-087 OK。真实 npm 清单包含三个目录内全部普通文件与指定 HTML；增加嵌套 UI 文件仍通过。临时副本单独移除 UI 白名单、HTML、bin、lib 时，清单确实缺对应项，同一生产检查器全部非零退出且无成功哨兵、诊断含对应相对路径或前缀。真实 package.json 字节未变，临时目录已清理。命令不调用 publish、不生成 tarball、不依赖固定清单总数或字节数。

unit 与清单契约测试命令：

```pwsh
$ErrorActionPreference = 'Stop'
node --test test/unit/package-contents.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-087 OK'
```

期望输出：退出码 0，stdout 含 AC-087 OK，Node 测试报告无失败。该文件实际执行 design.md 要求的正反用例：真实 npm 清单、临时副本 UI 白名单删除、HTML/bin/lib 缺失、嵌套资产缺失、相似前缀拒绝、额外资产通过，以及 npm 启动/超时/退出失败和非法 JSON/files/path。用例不得空置、skip、todo 或 only；网络、真实清单取值与受控失败 seam 必须按设计隔离。

完整既有门禁命令：

```pwsh
$ErrorActionPreference = 'Stop'
$output = @(pwsh -NoProfile -File scripts/check-fast.ps1)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not ($output -contains '==> check-package-contents.mjs')) { throw 'Package contents gate was not executed' }
if (-not ($output -contains 'check-fast: ok')) { throw 'Missing check-fast success output' }
$output | Write-Output
Write-Output 'AC-087 OK'
```

期望输出：退出码 0，stdout 含 ==> check-package-contents.mjs、check-fast: ok 与 AC-087 OK。新增检查被自动执行，全部旧检查和完整测试通过；包括既有分发资产、contracts 白名单、禁入路径与版本一致性断言，不得通过改写范围外测试或检查器消除失败。此命令仅供下游实施/验收阶段执行。

验收格式自检命令：

```pwsh
$ErrorActionPreference = 'Stop'
node scripts/check-acceptance.mjs .collab/tasks/044/acceptance.md
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-087 OK'
```

期望输出：退出码 0，stdout 含 check-acceptance: ok、warnings=0 与 AC-087 OK。只证明验收格式可解析，不代表实现或完整门禁已通过。
