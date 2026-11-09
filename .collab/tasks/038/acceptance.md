# Task 038 验收标准

所有命令在仓库根使用 PowerShell 7 独立执行。每块成功时退出 0 并输出所属 AC 的 OK 哨兵，任一断言失败均失败。brief 未给基准 commit SHA 或既有验收报告路径。AC-081 的夹具通过只证明实现行为；AC-038 真机门禁仍需真实前置条件，不能用夹具报告替代。

## AC-081 WSL 前置探测的离线集成验证

新增测试必须覆盖 design.md 中的成功、无 Node、无 WSL 三种主场景及边界情况，断言实际 inventories、报告状态、脱敏原因与子进程退出码。测试不能访问真实 WSL，不能以 skip/todo 通过。以下命令检查进程结果和 TAP 汇总，不依赖测试标题、函数名或行号。

```pwsh
$result = & node --test --test-reporter=tap test/integration/wsl-smoke-preflight.test.mjs 2>&1
$code = $LASTEXITCODE
$result | Write-Output
if ($code -ne 0) { throw 'WSL preflight integration failed' }
$tap = $result -join "`n"
if ($tap -notmatch '(?m)^# tests [1-9][0-9]*\s*$' -or $tap -notmatch '(?m)^# fail 0\s*$' -or $tap -notmatch '(?m)^# skipped 0\s*$' -or $tap -notmatch '(?m)^# todo 0\s*$') { throw 'Missing, failing or skipped integration coverage' }
Write-Output 'AC-081 OK'
```

- 期望输出：退出码 0；TAP 的 tests 大于 0，fail/skipped/todo 均为 0；最后一行 `AC-081 OK`。三种主场景的完整入口分别验证退出 0/非 0/非 0，且后两者的 wsl-discover 为 fail 并指明缺少 Node/WSL。

既有夹具 WSL 与 dry-run smoke 回归，在子进程中移除真实执行开关，避免因维护者环境启用真机测试：

```pwsh
$savedSmoke = $env:CLIWORKER_SMOKE
try {
  Remove-Item Env:CLIWORKER_SMOKE -ErrorAction SilentlyContinue
  & node --test test/smoke/wsl-discover.test.mjs test/smoke/smoke-dry-run.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Existing WSL or dry-run smoke regression' }
} finally {
  if ($null -eq $savedSmoke) { Remove-Item Env:CLIWORKER_SMOKE -ErrorAction SilentlyContinue }
  else { $env:CLIWORKER_SMOKE = $savedSmoke }
}
Write-Output 'AC-081 OK'
```

- 期望输出：退出码 0；既有报告契约、WSL 解码、dry-run、失败映射、泄漏扫描与清理测试全部通过；最后一行 `AC-081 OK`。

额外保留全量 unit 回归门禁：

```pwsh
& node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'Unit regression failed' }
Write-Output 'AC-081 OK'
```

- 期望输出：退出码 0，全部单元测试通过；最后一行 `AC-081 OK`。

验收文档格式自检：

```pwsh
& node scripts/check-acceptance.mjs .collab/tasks/038/acceptance.md
if ($LASTEXITCODE -ne 0) { throw 'Acceptance format failed' }
Write-Output 'AC-081 OK'
```

- 期望输出：退出码 0，含 `check-acceptance: ok`；最后一行 `AC-081 OK`。

实现/CI 阶段还须运行仓库完整检查。该命令会调用 git 并生成测试产物，当前仅允许写两份文档的 design 轮不执行：

```pwsh
& pwsh -NoProfile -File scripts/check-fast.ps1
if ($LASTEXITCODE -ne 0) { throw 'Repository fast checks failed' }
Write-Output 'AC-081 OK'
```

- 期望输出：退出码 0，含 `check-fast: ok`；最后一行 `AC-081 OK`。既有失败同样阻断，不允许为通过门禁修改本任务写域外文件。

## AC-038 真实 WSL 发现与名称无损

本命令只在 Windows 真机运行。每个已枚举发行版均需 Linux Node 20+、可发现 CLI 以及仓库/临时目录访问条件。由真实脚本断言每个发行版的非空 entries、present 状态、精确 wsl:<distro>、名称无 BOM/NUL/CR/LF 及前后发行版集合一致；外层检查真实退出码和原报告契约。缺少前置条件时该命令必须失败，stdout 应含 wsl-discover 的 fail 与具体 reason，不输出 `AC-038 OK`。若此前 discover 本身已失败，应先处理该错误再观察 WSL 前置结果。

```pwsh
$savedSmoke = $env:CLIWORKER_SMOKE
try {
  $env:CLIWORKER_SMOKE = '1'
  $output = & node scripts/smoke-real.mjs
  $code = $LASTEXITCODE
  $output | Write-Output
  if ($code -ne 0) { throw 'Real smoke failed; inspect fail reason above' }
  $report = ($output -join "`n") | ConvertFrom-Json -Depth 100
  $version = (Get-Content -LiteralPath package.json -Raw -Encoding utf8 | ConvertFrom-Json).version
  if ($report.schema -cne 'cliworker.smoke/v1' -or $report.mode -cne 'real' -or $report.platform -cne 'win32' -or $report.version -cne $version -or $report.redacted -ne $true) { throw 'Invalid real smoke report' }
  $ids = @('discover', 'wsl-discover', 'enumerate', 'probe', 'select', 'run', 'http-select')
  if (@($report.steps).Count -ne $ids.Count) { throw 'Wrong step count' }
  for ($i = 0; $i -lt $ids.Count; $i++) {
    $step = $report.steps[$i]
    $ac = if ($ids[$i] -ceq 'wsl-discover') { 'AC-038' } else { 'AC-069' }
    if ($step.id -cne $ids[$i] -or $step.status -cne 'pass' -or $step.mandatory -ne $true -or $null -ne $step.reason -or @($step.ac).Count -ne 1 -or $step.ac[0] -cne $ac) { throw 'Real smoke step failed validation' }
  }
} finally {
  if ($null -eq $savedSmoke) { Remove-Item Env:CLIWORKER_SMOKE -ErrorAction SilentlyContinue }
  else { $env:CLIWORKER_SMOKE = $savedSmoke }
}
Write-Output 'AC-038 OK'
```

- 期望输出：退出码 0，stdout 中有 mode=real、platform=win32 的七步全 pass 脱敏报告，最后一行 `AC-038 OK`。无 Node/无 WSL/无 CLI 时门禁退出非 0；这是环境失败，不算真实 AC-038 已通过。报告中无新增前置字段或步骤。
