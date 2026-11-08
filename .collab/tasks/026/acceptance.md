# Task 026 验收标准

本文件验收 AC-064（e2e），实现规格见同目录 design.md；baseline 沿用 contracts/spec/ac-index.json 的 darwin、linux、win32。brief 未指定基准 commit SHA 或既有验收报告路径，不自行指定。以下是实现后的门禁要求，不是设计阶段的通过报告。

每个 pwsh 块是一条独立命令，由调度器在仓库外保存为 UTF-8 无 BOM 的 .ps1，用 pwsh -NoProfile -File 执行；设计角色不创建脚本或报告。每条命令从指定仓库根执行，不依赖其他命令的临时产物；失败必须非零且不打印成功哨兵。不得将 PowerShell 5.1 当 pwsh 使用。

## AC-064 跨进程选模到执行的端到端

命令：验证两个入口、call 原样执行、路径一致和租约重放拒绝。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\026'
$testOutput = @(& node --test --test-reporter=tap test/e2e/select-run.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-064 select/run e2e failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-064 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-064 invalid $counter counter" }
}
Write-Output 'AC-064 OK'
```

- 期望输出：退出 0，TAP tests 大于 0，fail/cancelled/skipped/todo 全为 0，最后输出 AC-064 OK。
- 测试必须以真实宿主 stub 的 HTTP 路由和独立 CLI 选模进程分别取得成功响应；两入口用不同 request_id，在同一配置下返回的 --config、--state-dir 各出现一次，等于预先确定的绝对路径且相互一致。
- 两入口均直接执行各自 calls[0] 的 command、args、cwd，按 input:'stdin' 输入中文、多行、尾随空格文本；fake-cli 记录证明输入和 cwd 原样到达，argv 与固定适配器模板相符。执行进程与选模所在进程分离，调用记录只有预期次数。
- 每条 stdout JSONL 事件均通过只读 event.v1.schema.json 校验，seq 连续、lease_id 正确、at 为共享文件时钟；终事件唯一且 result.ok=true、exit_code=0、text/usage 等于固定夹具值，子进程退出 0、stderr 为空。
- 不推进到过期时刻，再开进程执行同一 call，流以 E_LEASE_CONSUMED 结束、retryable=false、退出码等于现有注册表；无成功 result，fake-cli 未再次执行，账本字节未改变且该 lease 的 :post 仍只有一条。临时根在测试结束时不存在。

命令：验证三位置递延租约及最后窗口外过期，HTTP 与 CLI 两入口均覆盖。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\026'
$testOutput = @(& node --test --test-reporter=tap test/e2e/select-run-sequence.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-064 sequence e2e failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-064 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-064 invalid $counter counter" }
}
Write-Output 'AC-064 OK'
```

- 期望输出：退出 0，TAP tests 大于 0，fail/cancelled/skipped/todo 全为 0，最后输出 AC-064 OK。
- 两入口各自的 count=3 选择返回三个不同租约，calls[i] 与 models[i].call 对齐；models[i].expires_at 精确等于 ISO(selected_at + lease_ttl_s*1000 + i*timeout_ms)。
- i=0、1、2 依次写文件时间 selected_at + lease_ttl_s*1000 + i*timeout_ms - 1000，再原样运行 calls[i]，三个均成功；每条 event.at 为该步文件时间，且所有事件经 schema 校验，最终 result 与固定夹具预期一致。i=1、2 的运行时间超过第一个截止时间；三次 provider 调用和各 lease 的唯一 :post 记录都能观察到。
- 两入口另用全新的未消费批次，把时间写为 Date.parse(models[2].expires_at)+1000 后原样执行 calls[2]：经校验的终事件 E_LEASE_EXPIRED、retryable=true，退出码符合注册表，无成功 result、无 provider 调用、无该 lease 的 :pre/:post 行；不得修改配置或租约来制造失败。
- 测试不以墙钟等待推动租约，子进程有上限，最后删除临时 state_dir、时钟与整个夹具根。

命令：核对追踪分片及现有追踪门禁。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\026'
$trace = Get-Content -LiteralPath 'test/traceability/T-026.json' -Raw -Encoding utf8 | ConvertFrom-Json
if ((@($trace.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'entries,milestone,task') { throw 'AC-064 unexpected shard fields' }
if ($trace.task -cne 'T-026' -or $trace.milestone -cne 'M5') { throw 'AC-064 wrong shard owner or milestone' }
if (@($trace.entries).Count -ne 1) { throw 'AC-064 expected one entry' }
$entry = $trace.entries[0]
if ((@($entry.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'ac,files,status') { throw 'AC-064 unexpected entry fields' }
if ($entry.ac -cne 'AC-064' -or $entry.status -cne 'covered') { throw 'AC-064 not covered by its owner' }
$expectedFiles = @('test/e2e/select-run-sequence.test.mjs', 'test/e2e/select-run.test.mjs')
if ((@($entry.files | Sort-Object) -join ',') -cne ($expectedFiles -join ',')) { throw 'AC-064 wrong coverage files' }
& node scripts/check-traceability.mjs
if ($LASTEXITCODE -ne 0) { throw 'AC-064 traceability gate failed' }
Write-Output 'AC-064 OK'
```

- 期望输出：退出 0，分片恰有既有格式的 T-026/M5/AC-064 covered 映射且映射上述两个文件；输出 check-traceability: ok，最后输出 AC-064 OK。不在分片添加 baseline 或新字段。

命令：保留全 unit 回归门禁。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\026'
$testOutput = @(& node --test "test/unit/*.test.mjs" 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-064 unit regression failed' }
Write-Output 'AC-064 OK'
```

- 期望输出：退出 0，全部已执行 unit 测试通过，无失败或取消，最后输出 AC-064 OK。既有平台门控的附加用例可以记录跳过，不作为 AC-064 的 e2e 覆盖；不得为本任务删除、放宽或跳过测试。

命令：校验本验收文档可被现有 runner 解析。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\026'
& node scripts/check-acceptance.mjs .collab/tasks/026/acceptance.md
if ($LASTEXITCODE -ne 0) { throw 'AC-064 acceptance format failed' }
Write-Output 'AC-064 OK'
```

- 期望输出：退出 0，输出 check-acceptance: ok、warnings=0，本文件只有一个 AC 小节且包含六条命令，最后输出 AC-064 OK。

命令：按仓库要求运行 check-fast。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\026'
& pwsh -NoProfile -File scripts/check-fast.ps1
if ($LASTEXITCODE -ne 0) { throw 'AC-064 check-fast failed' }
Write-Output 'AC-064 OK'
```

- 期望输出：退出 0，现有检查与完整测试运行均通过，输出 check-fast: ok，最后输出 AC-064 OK。若范围外既有实现或门禁失败，必须报告具体命令、退出码和输出，不通过改范围外文件、屏蔽检查或把失败解释成成功完成验收。

