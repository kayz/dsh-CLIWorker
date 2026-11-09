# Task 045 — alpha 包黑盒验收：以用户视角安装并验证

以下命令各自独立从仓库根在 PowerShell 7 执行。每个 pwsh 块是一条完整命令，多步骤块由验收执行器保存为其临时 ps1 执行，不在仓库新增文件。原生命令后必须检查退出码，断言失败立即失败，只有通过才打印 AC-088 OK。

brief 未提供基准 commit SHA 或既有验收报告路径，不编造基准或引用其他任务的验收结论。实现必须遵循同目录 design.md；格式自检仅验证本文可解析。

## AC-088 alpha tarball 仓库外离线安装与黑盒验收

默认实际打包、安装检查命令：

```pwsh
$ErrorActionPreference = 'Stop'
$output = @(node scripts/check-alpha-package.mjs)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not ($output -contains 'AC-088 OK')) { throw 'Missing alpha package success sentinel' }
$output | Write-Output
```

期望输出：退出码 0，stdout 包含独立行 AC-088 OK。该命令实际 npm pack 到仓库外临时目录并离线 npm install 本地 tarball，安装后实际执行 cliworker shim；--version 的 JSON ok 为 true，version 与安装包、打包输入和 npm pack 版本一致；doctor status 为 ok 且所有 checks 健康；discover 输出 cliworker.inventory/v1，临时 state/inventory.json 与输出一致；models enumerate 输出 cliworker.models/v1 且包含夹具模型；已安装 CLI 的 models probe → models select → 返回的 run call 成功，输出符合已有事件契约且临时状态含探测与用量记录，state backup/restore 恢复 marker；已安装包内 ui/index.html、ui/app.mjs、ui/render.mjs 与 docs/ui/cliworker-console.html 可读且非空。全部临时内容已清理，任何一步失败均非零退出且不打印成功哨兵。不能用源码执行、dry-run 清单、手写探测成功状态或 npm install 成功替代这些结果。

正反真实 tarball integration 与重复运行命令：

```pwsh
$ErrorActionPreference = 'Stop'
for ($round = 0; $round -lt 2; $round++) {
  $output = @(node --test --test-reporter=tap test/integration/alpha-tarball.test.mjs)
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $tap = $output -join "`n"
  if ($tap -notmatch '(?m)^# tests ([2-9]|[1-9][0-9]+)\s*$') { throw 'Expected at least two executed integration tests' }
  foreach ($summary in @('# fail 0', '# skipped 0', '# todo 0')) {
    if (-not ($output -contains $summary)) { throw "Missing TAP summary: $summary" }
  }
  if ($tap -notmatch '(?m)^ok [0-9]+ - .*rejects tarball without ui') { throw 'Missing successful missing-ui counterexample test' }
  $output | Write-Output
}
Write-Output 'AC-088 OK'
```

期望输出：两轮均退出 0，TAP 每轮至少两个实际用例，fail/skipped/todo 均为 0，包含通过的 rejects tarball without ui 用例，最终 stdout 含 AC-088 OK。每轮正常包在仓库外真实离线安装并通过六项检查；反例由真实包解包、只移除 ui/ 后重新 npm pack 得到，HTML 与 CLI 仍保留且安装成功，同一个生产检查器非零退出、无成功哨兵、诊断包含 ui/。测试必须断言这一失败来自资产缺失，不能把反例构造失败或安装失败当成预期结果。正反路径临时目录均清理、传入 tarball 保留，真实 package.json 与 UI 字节未变；第二轮无前轮状态依赖。不允许跳过、占位或仅 mock npm 的用例替代这些检查。

完整既有门禁命令（供下游实施/验收阶段运行）：

```pwsh
$ErrorActionPreference = 'Stop'
$output = @(pwsh -NoProfile -File scripts/check-fast.ps1)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not ($output -contains '==> check-alpha-package.mjs')) { throw 'Alpha package gate was not executed' }
if (-not ($output -contains 'check-fast: ok')) { throw 'Missing check-fast success output' }
if (-not ($output -contains 'AC-088 OK')) { throw 'Missing alpha package success sentinel' }
$output | Write-Output
Write-Output 'AC-088 OK'
```

期望输出：退出码 0，stdout 包含 ==> check-alpha-package.mjs、check-fast: ok 与 AC-088 OK。新检查器自动进入门禁，原有包资产、生成资产及完整测试继续通过；不得改变既有断言、修改写域外文件或跳过测试来换取通过。发布清单包含新增检查命令、离线安装与清理要求、包内 CLI 替代 smoke-real 的覆盖差异，保留现有 real-smoke 要求；不新增产品字段或报告格式。

验收格式自检命令：

```pwsh
$ErrorActionPreference = 'Stop'
$output = @(node scripts/check-acceptance.mjs .collab/tasks/045/acceptance.md)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (($output -join "`n") -match 'check-acceptance: ok .*warnings=0')) { throw 'Acceptance format failed or has warnings' }
$output | Write-Output
Write-Output 'AC-088 OK'
```

期望输出：退出码 0，stdout 含 check-acceptance: ok、warnings=0 和 AC-088 OK，解析到一个 AC、四条命令。只证明验收文档格式正确，不代表 tarball 或实现验收通过。
