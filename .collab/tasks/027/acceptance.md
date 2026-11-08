# Task 027 验收标准

本文件针对 AC-065（e2e）、AC-066（e2e、integration）。AC 层级取自 contracts/spec/ac-index.json。brief 未给基准 commit SHA 或既有验收报告，因此"未改动"类检查以 `git merge-base main HEAD` 为基准，不自行指定固定 SHA。规格见同目录 design.md。

每个 pwsh 块是一条独立验收命令，由调度器保存成 UTF-8 无 BOM 的 .ps1 后以 `pwsh -NoProfile -File` 执行；命令之间不共享产物，原生命令后立即检查退出码；失败必须非零且不打印成功哨兵。所有命令只使用 `os.tmpdir()` 下的临时目录与临时 HOME，不联网。以下命令是实现后的要求，不是当前通过报告；design 角色不执行它们。

## AC-065 安装产物可用且不含冻结目录

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\027'
$testOutput = @(& node --test --test-reporter=tap test/e2e/install.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-065 install e2e tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-065 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-065 invalid $counter counter" }
}
Write-Output 'AC-065 OK'
```

- 期望输出：退出 0，TAP 的 tests 大于 0，fail/cancelled/skipped/todo 全为 0，最后输出 AC-065 OK。install.test.mjs 必须实际 `npm pack` 并安装，逐项断言：安装后 `cliworker --version` 退出 0 且 JSON 的 version 等于 package.json 的 version（从文件读取，不写死）；`cliworker doctor --config <临时配置>` 退出 0 且 status 为 ok；`import` 包入口并用内联宿主 stub 注册后 `getRegistration().status` 为 `ok`；安装目录不存在 `contracts/golden`、`contracts/spec`、点+collab 目录，也不存在 `test/`、`scripts/`。不得以 skip/todo、吞错或固定成功响应替代。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\027'
$repo = (Get-Location).Path
$out = @(& node scripts/e2e-install.mjs 2>&1)
$code = $LASTEXITCODE
$out | ForEach-Object { Write-Output "$_" }
if ($code -ne 0) { throw 'AC-065 e2e-install script failed' }
$text = $out -join "`n"
if ($text -notmatch '(?m)^e2e-install: ok\s*$') { throw 'AC-065 missing e2e-install: ok' }
if ($text -notmatch '(?m)^cleanup: ok\s*$') { throw 'AC-065 missing cleanup: ok' }
$m = [regex]::Match($text, '(?m)^workdir: (.+?)\s*$')
if (-not $m.Success) { throw 'AC-065 missing workdir line' }
$work = $m.Groups[1].Value
if ($work.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { throw 'AC-065 workdir is inside the repository' }
if (Test-Path -LiteralPath $work) { throw 'AC-065 workdir was not cleaned up' }
$tgz = @(Get-ChildItem -LiteralPath $repo -Filter '*.tgz' -File -ErrorAction SilentlyContinue)
if ($tgz.Count -ne 0) { throw 'AC-065 stray tgz left in repository root' }
Write-Output 'AC-065 OK'
```

- 期望输出：脚本退出 0，stdout 含独立成行的 `workdir: <路径>`、`e2e-install: ok`、`cleanup: ok`；该 workdir 在脚本结束后已不存在、不在仓库内；仓库根没有遗留 .tgz；最后 AC-065 OK。脚本失败时必须非零退出并向 stderr 说明失败项。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\027'
$base = (& git merge-base main HEAD)
if ($LASTEXITCODE -ne 0 -or -not $base) { throw 'AC-065 cannot find merge base' }
$base = "$base".Trim()
$frozen = @('lib/cli.mjs', 'lib/routes.mjs', 'lib/context.mjs', 'lib/store.mjs', 'lib/leases.mjs', 'lib/lock.mjs', 'package.json', 'contracts', '.collab/blueprint', ':(exclude).collab/tasks/027')
& git diff --quiet $base -- @frozen
if ($LASTEXITCODE -ne 0) { throw 'AC-065 a frozen file or directory was modified' }
$changed = @(& git diff --name-only --no-renames $base)
if ($LASTEXITCODE -ne 0) { throw 'AC-065 git diff failed' }
$untracked = @(& git ls-files --others --exclude-standard)
if ($LASTEXITCODE -ne 0) { throw 'AC-065 git ls-files failed' }
$allowed = @(
  '^lib/migrate\.mjs$', '^lib/commands/state/.+', '^scripts/e2e-install\.mjs$',
  '^test/e2e/install\.test\.mjs$', '^test/e2e/upgrade\.test\.mjs$',
  '^test/integration/restart-recovery\.test\.mjs$', '^test/traceability/T-027\.json$',
  '^\.collab/tasks/027/'
)
$outside = @()
foreach ($p in @($changed + $untracked)) {
  if (-not $p) { continue }
  $ok = $false
  foreach ($re in $allowed) { if ($p -match $re) { $ok = $true; break } }
  if (-not $ok) { $outside += $p }
}
if ($outside.Count -ne 0) { throw ('AC-065 paths outside write_scope: ' + ($outside -join ', ')) }
Write-Output 'AC-065 OK'
```

- 期望输出：退出 0。cli/routes/context/store/leases/lock、package.json、contracts/**、`.collab/blueprint/**`、其他任务目录相对 merge-base 没有任何改动；所有改动与未跟踪文件都落在 design.md 顶部 write_scope 之内（本任务自己的目录除外）；最后 AC-065 OK。

## AC-066 升级备份、迁移、恢复与重启恢复

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\027'
$testOutput = @(& node --test --test-reporter=tap test/e2e/upgrade.test.mjs test/integration/restart-recovery.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-066 upgrade/restart tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-066 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-066 invalid $counter counter" }
}
Write-Output 'AC-066 OK'
```

- 期望输出：退出 0，tests 大于 0，fail/cancelled/skipped/todo 全为 0，最后 AC-066 OK。两个测试文件必须实际执行，并各有断言覆盖：升级自动备份与 VERSION 迁移；`state restore` 逐字节一致并移除多余文件；`secrets/` 不入备份且恢复后不变；迁移步骤失败与提交阶段 rename 失败后回到迁移前字节；遗留 `.state-op.json` 在下次命令时被回滚；备份被篡改时 restore 失败且 live state 不变；强制终止子进程（`child.kill()`，不使用信号名）后新进程看到完整的未过期租约、账本、探测状态，过期租约被释放，陈旧锁被回收，`doctor` 仍退出 0。版本号从 package.json 读取，升级夹具自行构造更小的旧版本。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\027'
$pkg = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
if ($pkg -notmatch '^(\d+)\.(\d+)\.(\d+)') { throw 'AC-066 unexpected package version' }
if ([int]$Matches[1] -eq 0 -and [int]$Matches[2] -eq 0 -and [int]$Matches[3] -le 1) { throw 'AC-066 package version too low for the fixture' }
$old = '0.0.1'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$root = Join-Path ([IO.Path]::GetTempPath()) ('ac066-' + [Guid]::NewGuid().ToString('N'))
$keys = @('HOME', 'USERPROFILE', 'CLIWORKER_HOME', 'CLIWORKER_CONFIG', 'CLIWORKER_TEST_CLOCK_FILE')
$saved = @{}
foreach ($k in $keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k) }
function Invoke-Cw {
  param([string[]]$CwArgs)
  $o = @(& node bin/cliworker.mjs @CwArgs 2>$null)
  return @{ code = $LASTEXITCODE; text = ($o -join "`n") }
}
function Get-Sha([string]$f) { (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash }
try {
  New-Item -ItemType Directory -Path $root | Out-Null
  $env:HOME = $root; $env:USERPROFILE = $root; $env:CLIWORKER_HOME = (Join-Path $root 'home')
  Remove-Item Env:CLIWORKER_CONFIG -ErrorAction SilentlyContinue
  Remove-Item Env:CLIWORKER_TEST_CLOCK_FILE -ErrorAction SilentlyContinue
  $state = Join-Path $root 'state'
  $cfg = Join-Path $root 'config.json'
  New-Item -ItemType Directory -Path (Join-Path $state 'secrets') -Force | Out-Null
  $config = '{"schema":"cliworker.config/v2","state_dir":"state","discovery":{"cli_overrides":{}},"catalog":{"manual":[],"allow":[],"levels":{},"aliases":{},"deprecated":{}},"pools":[],"policy":{},"secrets":{}}'
  [IO.File]::WriteAllText($cfg, $config, $utf8)
  $sentinel = 'SECRET-SENTINEL-' + [Guid]::NewGuid().ToString('N')
  $files = [ordered]@{
    'VERSION'     = "$old`n"
    'leases.json' = "{`"leases`":[],`"requests`":[]}`n"
    'probes.json' = "[]`n"
    'pools.json'  = "[]`n"
    'usage.jsonl' = "{`"row`":1}`n{`"row`":2}`n"
  }
  foreach ($name in $files.Keys) { [IO.File]::WriteAllText((Join-Path $state $name), $files[$name], $utf8) }
  $secretFile = Join-Path $state 'secrets\x.dpapi'
  [IO.File]::WriteAllText($secretFile, $sentinel, $utf8)
  $orig = @{}
  foreach ($name in $files.Keys) { $orig[$name] = Get-Sha (Join-Path $state $name) }
  $secretSha = Get-Sha $secretFile

  # upgrade: automatic backup + VERSION migration
  $r = Invoke-Cw @('state', 'migrate', '--config', $cfg)
  if ($r.code -ne 0) { throw "AC-066 migrate exit $($r.code): $($r.text)" }
  if ($r.text.Contains($sentinel)) { throw 'AC-066 token leaked into migrate output' }
  $j = $r.text | ConvertFrom-Json
  if ($j.ok -ne $true -or $j.migrated -ne $true -or $j.from -ne $old -or $j.to -ne $pkg) { throw "AC-066 unexpected migrate result: $($r.text)" }
  $backup = [string]$j.backup
  if ($backup -notmatch ('^backup-' + [regex]::Escape($old) + '-\d{8}T\d{9}Z(-\d+)?$')) { throw "AC-066 bad backup name: $backup" }
  $bdir = Join-Path $state (Join-Path 'backups' $backup)
  if (-not (Test-Path -LiteralPath (Join-Path $bdir 'MANIFEST.json'))) { throw 'AC-066 backup has no MANIFEST.json' }
  foreach ($name in $files.Keys) {
    $copy = Join-Path $bdir (Join-Path 'data' $name)
    if (-not (Test-Path -LiteralPath $copy)) { throw "AC-066 backup is missing $name" }
    if ((Get-Sha $copy) -ne $orig[$name]) { throw "AC-066 backup bytes differ for $name" }
  }
  if (Test-Path -LiteralPath (Join-Path $bdir 'data\secrets')) { throw 'AC-066 secrets were backed up' }
  if ((Get-Content -Raw -LiteralPath (Join-Path $state 'VERSION')).Trim() -ne $pkg) { throw 'AC-066 VERSION was not migrated' }
  if ((Get-Sha $secretFile) -ne $secretSha) { throw 'AC-066 secrets file changed during migrate' }

  # idempotent second migrate: no new backup
  $before = @(Get-ChildItem -LiteralPath (Join-Path $state 'backups') -Directory | Where-Object { $_.Name -like 'backup-*' }).Count
  $r2 = Invoke-Cw @('state', 'migrate', '--config', $cfg)
  if ($r2.code -ne 0) { throw "AC-066 second migrate exit $($r2.code)" }
  $j2 = $r2.text | ConvertFrom-Json
  if ($j2.migrated -ne $false -or $null -ne $j2.backup) { throw "AC-066 second migrate not idempotent: $($r2.text)" }
  $after = @(Get-ChildItem -LiteralPath (Join-Path $state 'backups') -Directory | Where-Object { $_.Name -like 'backup-*' }).Count
  if ($before -ne $after) { throw 'AC-066 second migrate created a backup' }

  # damage live state, then restore and compare byte for byte
  [IO.File]::WriteAllText((Join-Path $state 'leases.json'), 'not json', $utf8)
  Remove-Item -LiteralPath (Join-Path $state 'usage.jsonl')
  [IO.File]::WriteAllText((Join-Path $state 'stray.json'), '{}', $utf8)
  $rr = Invoke-Cw @('state', 'restore', '--config', $cfg, '--from', $backup)
  if ($rr.code -ne 0) { throw "AC-066 restore exit $($rr.code): $($rr.text)" }
  $jr = $rr.text | ConvertFrom-Json
  if ($jr.ok -ne $true -or $jr.restored -ne $backup) { throw "AC-066 unexpected restore result: $($rr.text)" }
  foreach ($name in $files.Keys) {
    $live = Join-Path $state $name
    if (-not (Test-Path -LiteralPath $live)) { throw "AC-066 restore lost $name" }
    if ((Get-Sha $live) -ne $orig[$name]) { throw "AC-066 restored bytes differ for $name" }
  }
  if (Test-Path -LiteralPath (Join-Path $state 'stray.json')) { throw 'AC-066 stray file survived restore' }
  if ((Get-Sha $secretFile) -ne $secretSha) { throw 'AC-066 secrets file changed during restore' }

  # unsafe or unknown backup names are rejected and leave state untouched
  foreach ($bad in @('..\..\evil', '../x', 'backup-9.9.9-20000101T000000000Z', $bdir)) {
    $rb = Invoke-Cw @('state', 'restore', '--config', $cfg, '--from', $bad)
    if ($rb.code -eq 0) { throw "AC-066 restore accepted bad name: $bad" }
    $jb = $rb.text | ConvertFrom-Json
    if ($jb.ok -ne $false -or $jb.error.code -ne 'E_REQUEST_INVALID') { throw "AC-066 wrong error for bad name $bad : $($rb.text)" }
  }
  foreach ($name in $files.Keys) {
    if ((Get-Sha (Join-Path $state $name)) -ne $orig[$name]) { throw "AC-066 rejected restore changed $name" }
  }

  # no token anywhere in backup artifacts
  $hits = @(Get-ChildItem -LiteralPath (Join-Path $state 'backups') -Recurse -File | Where-Object { (Get-Content -Raw -LiteralPath $_.FullName) -match [regex]::Escape($sentinel) })
  if ($hits.Count -ne 0) { throw 'AC-066 token found in backup artifacts' }
  Write-Output 'AC-066 OK'
}
finally {
  foreach ($k in $keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
```

- 期望输出：退出 0，最后 AC-066 OK。直接用真实 CLI 验证（不依赖测试文件）：旧版本（0.0.1）state 经 `state migrate` 得到 `backup-0.0.1-<ts>` 备份（目录含 MANIFEST.json 与 data/，字节与迁移前逐一相同），`VERSION` 变为 package.json 的版本；再次迁移幂等、不新增备份；破坏 live 后 `state restore --from <name>` 使所有文件（含旧 VERSION）与备份逐字节一致并移除多余文件；`secrets/` 不入备份、迁移与恢复前后不变；`..`、分隔符、不存在的名字、绝对路径均以 `E_REQUEST_INVALID` 拒绝且不改 live state；备份产物与输出中无注入的令牌哨兵。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\027'
node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'AC-066 unit regression failed' }
Write-Output 'AC-066 OK'
```

- 期望输出：全部既有 unit 测试通过，退出 0，最后 AC-066 OK。这是 brief 规定的独立回归门禁，不可用只跑新文件代替。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\027'
node scripts/check-acceptance.mjs .collab/tasks/027/acceptance.md
if ($LASTEXITCODE -ne 0) { throw 'AC-066 acceptance format failed' }
Write-Output 'AC-066 OK'
```

- 期望输出：退出 0，含 check-acceptance: ok、warnings=0，AC 小节为 2 个且无重复 id，最后 AC-066 OK。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\027'
node scripts/check-fast.mjs
if ($LASTEXITCODE -ne 0) { throw 'AC-066 repository regression failed' }
Write-Output 'AC-066 OK'
```

- 期望输出：退出 0，含 check-fast: ok，最后 AC-066 OK。涵盖 check-seams（lib 中无直接 fs/Date/定时器）、check-no-collab、check-pack（打包清单不变）、check-traceability（T-027.json 的 AC-065/AC-066 均 covered 且有标题含 `[AC-065]` / `[AC-066]` 的普通测试）以及全量测试。本完整门禁由实现后下游运行，design 角色仅自检文档。
