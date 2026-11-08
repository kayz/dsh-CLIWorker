# Task 029 — 验收

命令均从仓库根执行，使用 Node 20+、PowerShell 7。每个 pwsh 块是一条独立命令，由执行端写成仓库外 UTF-8 无 BOM 临时 ps1，以 `pwsh -NoProfile -File` 执行。异常、非预期退出码或缺失哨兵均失败。临时测试输出放仓库外；brief 无基准 commit sha 或既有验收报告，本验收引用当前 interfaces.md、ac-index.json、registry.snapshot.json 和 package.json。

## AC-038 原生 WSL 枚举与报告条目（smoke，baseline real-smoke）

命令：CI 默认运行的夹具检查，显式移除 real 开关。此命令的哨兵只表示夹具检查成功，不构成 real-smoke 证据。

```pwsh
$ErrorActionPreference = 'Stop'
$savedSmoke = $env:CLIWORKER_SMOKE
try {
  Remove-Item Env:CLIWORKER_SMOKE -ErrorAction SilentlyContinue
  & node --test test/smoke/wsl-discover.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'WSL fixture checks failed' }
  Write-Output 'AC-038 OK'
} finally {
  if ($null -eq $savedSmoke) { Remove-Item Env:CLIWORKER_SMOKE -ErrorAction SilentlyContinue }
  else { $env:CLIWORKER_SMOKE = $savedSmoke }
}
```

期望输出：退出码 0、失败测试数 0、`AC-038 OK`。实际验证 UTF-16LE/BOM/CRLF/NUL/去重/空格名夹具、既有 discover 输出与报告映射；mode 仍为 dry-run，未调用真实 WSL。不得把这条命令的成功登记为 AC-038 真机基线通过。

命令：仅由维护者在已准备好的 Windows/WSL 真机手动运行，不加入 CI 自动命令集合。以下 text 块内是完整 PowerShell 7 脚本，维护者将其存为仓库外 UTF-8 无 BOM 的 ps1 后用 `pwsh -NoProfile -File` 执行；特意不标 pwsh，防止现有验收解析器自动在 CI 触发 real。先检查真实 WSL，再运行 real 脚本和真实 WSL 测试；报告保留在系统临时目录供发布门禁归档，路径只由本地验收命令显示，不写入报告。

```text
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Real smoke requires Windows and WSL' }
$savedSmoke = $env:CLIWORKER_SMOKE
$realReport = Join-Path ([System.IO.Path]::GetTempPath()) ('cliworker-real-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  $env:CLIWORKER_SMOKE = '1'
  & wsl.exe -l -q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Real WSL enumeration failed' }
  & node scripts/smoke-real.mjs --out $realReport
  if ($LASTEXITCODE -ne 0) { throw 'Real smoke failed' }
  $report = Get-Content -LiteralPath $realReport -Raw -Encoding utf8 | ConvertFrom-Json
  $pkg = Get-Content -LiteralPath package.json -Raw -Encoding utf8 | ConvertFrom-Json
  if ($report.schema -cne 'cliworker.smoke/v1' -or $report.mode -cne 'real' -or $report.platform -cne 'win32' -or $report.redacted -ne $true -or $report.version -cne $pkg.version) { throw 'Invalid real report identity' }
  $expected = @('discover', 'wsl-discover', 'enumerate', 'probe', 'select', 'run', 'http-select')
  if (($report.steps.id -join ',') -cne ($expected -join ',')) { throw 'Invalid real step order' }
  foreach ($step in $report.steps) {
    if ($step.status -cne 'pass' -or $step.mandatory -ne $true) { throw 'Real step failed or skipped' }
  }
  $wslStep = @($report.steps | Where-Object { $_.id -ceq 'wsl-discover' })
  if ($wslStep.Count -ne 1 -or @($wslStep[0].ac).Count -ne 1 -or $wslStep[0].ac[0] -cne 'AC-038') { throw 'Missing AC-038 mapping' }
  & node --test test/smoke/wsl-discover.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Independent real WSL checks failed' }
  Write-Output ('Real report: ' + $realReport)
  Write-Output 'AC-038 OK'
} finally {
  if ($null -eq $savedSmoke) { Remove-Item Env:CLIWORKER_SMOKE -ErrorAction SilentlyContinue }
  else { $env:CLIWORKER_SMOKE = $savedSmoke }
}
```

期望输出：退出码 0、`AC-038 OK`；真实测试未跳过，真实发行版集合非空，独立 wsl.exe 结果与既有 discover.host.wsl_distros 集合相等，每个发行版内实际 discover 生成至少一个 platform 为 `wsl:<d>` 的 entry。七步均 pass，WSL mandatory 且 ac 为 ['AC-038']，报告 mode real、当前 package 版本、redacted true。无真机、无发行版、缺 Node/CLI、超时、集合不一致、仅有 dry-run 报告均失败且不输出哨兵；豁免须由 T-030 单独处理，不能将豁免说成此命令通过。

## AC-069 dry-run 全链路、报告校验、零泄漏与开关（smoke）

命令：执行真实 dry-run 脚本并独立验证报告字段、步骤与映射；无需 --out，防止留下验收产物。

```pwsh
$ErrorActionPreference = 'Stop'
$checkSource = @'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const env = { ...process.env };
delete env.CLIWORKER_SMOKE;
const r = spawnSync(process.execPath, ['scripts/smoke-real.mjs', '--dry-run'], { env, encoding: 'utf8', timeout: 240000, windowsHide: true });
assert.ifError(r.error);
assert.equal(r.status, 0, 'dry-run failed');
const report = JSON.parse(r.stdout);
assert.deepEqual(Object.keys(report).sort(), ['schema','mode','version','platform','node','steps','redacted'].sort());
assert.equal(report.schema, 'cliworker.smoke/v1');
assert.equal(report.mode, 'dry-run');
assert.equal(report.version, JSON.parse(fs.readFileSync('package.json', 'utf8')).version);
assert.equal(report.platform, process.platform);
assert.equal(report.node, process.version);
assert.equal(report.redacted, true);
assert.deepEqual(report.steps.map(s => s.id), ['discover','wsl-discover','enumerate','probe','select','run','http-select']);
for (const s of report.steps) {
  assert.deepEqual(Object.keys(s).sort(), ['id','ac','mandatory','status','reason','duration_ms'].sort());
  assert.deepEqual(s.ac, [s.id === 'wsl-discover' ? 'AC-038' : 'AC-069']);
  assert.equal(s.mandatory, true);
  assert.equal(s.status, 'pass');
  assert.equal(s.reason, null);
  assert.equal(typeof s.duration_ms, 'number');
  assert.ok(Number.isFinite(s.duration_ms) && s.duration_ms >= 0);
}
console.log('AC-069 OK');
'@
& node --input-type=module -e $checkSource
if ($LASTEXITCODE -ne 0) { throw 'Dry-run report checks failed' }
```

期望输出：退出码 0、`AC-069 OK`；报告恰有既定字段、七步顺序正确且全 pass，各带规定 ac，mode dry-run、当前版本、真实宿主 platform/node、redacted true，不冒充 real。

命令：独立检查无 real 开关时的拒绝行为。

```pwsh
$ErrorActionPreference = 'Stop'
$checkSource = @'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const registry = JSON.parse(fs.readFileSync('contracts/registry.snapshot.json', 'utf8'));
const expected = registry.codes.find(e => e.code === 'E_SMOKE_DISABLED');
assert.ok(expected);
for (const value of [undefined, '0', 'true']) {
  const env = { ...process.env };
  if (value === undefined) delete env.CLIWORKER_SMOKE; else env.CLIWORKER_SMOKE = value;
  const r = spawnSync(process.execPath, ['scripts/smoke-real.mjs'], { env, encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.ifError(r.error);
  assert.equal(r.status, expected.exit);
  assert.equal(JSON.parse(r.stdout).error.code, 'E_SMOKE_DISABLED');
}
console.log('AC-069 OK');
'@
& node --input-type=module -e $checkSource
if ($LASTEXITCODE -ne 0) { throw 'Real smoke switch checks failed' }
```

期望输出：退出码 0、`AC-069 OK`；每次子进程都按注册表退出且 error.code 为 E_SMOKE_DISABLED，无真实 WSL/provider 调用。

命令：运行 dry-run 端到端与 WSL 夹具测试，验证结构校验器拒绝坏报告、扫描非空表面和 canary、失败/超时/skip、重复运行及清理。

```pwsh
$ErrorActionPreference = 'Stop'
$savedSmoke = $env:CLIWORKER_SMOKE
try {
  Remove-Item Env:CLIWORKER_SMOKE -ErrorAction SilentlyContinue
  & node --test test/smoke/smoke-dry-run.test.mjs test/smoke/wsl-discover.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Smoke tests failed' }
  Write-Output 'AC-069 OK'
} finally {
  if ($null -eq $savedSmoke) { Remove-Item Env:CLIWORKER_SMOKE -ErrorAction SilentlyContinue }
  else { $env:CLIWORKER_SMOKE = $savedSmoke }
}
```

期望输出：退出码 0、失败测试数 0、`AC-069 OK`。成功运行实际 fake CLI 并使用隔离 PATH/state；schema 和语义校验通过，全程 leak-scan hits/errors 均为空，已知用户名/绝对路径不出现在报告与诊断。坏报告、步骤失败/超时、skip、泄漏及写文件失败样本均非 0；两次运行相互隔离，子进程/宿主/临时根清理完成。断言可观察结果，不以测试标题、函数名或行号为验收依据。

命令：执行必需的全量 unit 回归。

```pwsh
$ErrorActionPreference = 'Stop'
& node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'Unit regression failed' }
Write-Output 'AC-069 OK'
```

期望输出：退出码 0、失败测试数 0、`AC-069 OK`。

命令：实现完成后运行既有快速检查；强制关闭真实冒烟，输出目录按执行端的仓库外配置准备。

```pwsh
$ErrorActionPreference = 'Stop'
$savedSmoke = $env:CLIWORKER_SMOKE
try {
  Remove-Item Env:CLIWORKER_SMOKE -ErrorAction SilentlyContinue
  & pwsh -NoProfile -File scripts/check-fast.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Repository checks failed' }
  Write-Output 'AC-069 OK'
} finally {
  if ($null -eq $savedSmoke) { Remove-Item Env:CLIWORKER_SMOKE -ErrorAction SilentlyContinue }
  else { $env:CLIWORKER_SMOKE = $savedSmoke }
}
```

期望输出：退出码 0、`check-fast: ok`、`AC-069 OK`；既有格式、追溯与完整测试门禁通过。此命令供下游实现验收使用，设计阶段不执行可能产生额外文件的完整链路。
