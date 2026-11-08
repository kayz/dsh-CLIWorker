# Task 020 验收标准

依据本任务 brief、design.md 与 contracts/spec/ac-index.json，仅登记 T-020 的 AC-047、AC-048；brief 未提供基准 commit SHA 或既有验收报告路径。当前 attention 裁决及前置接口尚未落实，以下是恢复后必须达到的条件，不是通过报告。不得放宽断言以适配当前缺失的接线。

各 pwsh 代码块是一条独立验收命令，从任意目录运行，不依赖另一条命令的产物。调度器可将代码块写入仓库外的 UTF-8 无 BOM .ps1 后用 pwsh -NoProfile -File 执行；本 design 阶段不创建该脚本。每条仅在原生命令成功后打印自己的 OK 哨兵。运行器报告沿用其系统临时目录，测试数据独立创建并清理，不读个人配置，不要求真实账号、真实 CLI 或网络。

## AC-047

命令：执行以下完整代码块。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\020'
& node scripts/run-tests.mjs --ac AC-047
if ($LASTEXITCODE -ne 0) { throw 'AC-047 integration failed' }
$probeTap = @(& node --test --test-reporter=tap test/integration/probe.test.mjs 2>&1)
$probeExit = $LASTEXITCODE
$probeTap | ForEach-Object { Write-Output $_ }
if ($probeExit -ne 0) { throw 'AC-047 TAP run failed' }
$probeText = $probeTap -join "`n"
if ($probeText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-047 has no executed tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
    if ($probeText -notmatch "(?m)^# $counter 0\s*$") { throw "AC-047 invalid $counter count" }
}
Write-Output 'AC-047 OK'
```

- 期望输出：退出码 0，正式运行出现 run-tests: filtered；TAP 的 tests 大于 0，fail、cancelled、skipped、todo 均为 0，最后一行为 AC-047 OK。任一断言失败、没有测试、依赖缺失或导入失败必须非零且不能打印 OK。
- 行为断言：fake-cli 的 ok→callable、auth→blocked/auth、quota→blocked/quota、timeout 和 enoent→unavailable、deprecated→deprecated、mismatch→identity=mismatch 且 blocked。持续 timeout 的 exec=2，其他已执行模式各 exec=1；配置预先弃用及未允许目标 exec=0，分别验证。timeout 后成功只重试一次，auth/quota/enoent 不重试。
- 行为断言：全部 evidence 既有键齐全；nonce_ok、reported_model、exit、duration_ms 与注入执行结果及 ctx.clock 一致。错误 nonce、缺失 nonce、缺失身份、坏事件、版本成功均不产生 callable；不能沿用旧成功证据掩盖失败。
- 行为断言：使用同一探测证据，在 TTL 内及恰好边界仍可用；伪时钟越过 probe_ttl_s 后，由真实生产选模以精确原因 availability_stale 拒选，模型和 call 不再生成；新鲜对照仍可选。读取不得刷新探测时间或执行推理，不得用测试自制选择器代替生产入口。
- 行为断言：真实 bin/cliworker.mjs 可达 models probe；新增 flow 步骤被实际执行，复读同 state_dir 的证据与账本且泄漏扫描通过。所有期望均由 probe.test.mjs 的实际断言验证，不能只断言标题、schema 字符串或 helper 返回值。

## AC-048

命令：执行以下完整代码块。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\020'
& node scripts/run-tests.mjs --ac AC-048
if ($LASTEXITCODE -ne 0) { throw 'AC-048 integration failed' }
$ledgerTap = @(& node --test --test-reporter=tap test/integration/probe-ledger.test.mjs 2>&1)
$ledgerExit = $LASTEXITCODE
$ledgerTap | ForEach-Object { Write-Output $_ }
if ($ledgerExit -ne 0) { throw 'AC-048 TAP run failed' }
$ledgerText = $ledgerTap -join "`n"
if ($ledgerText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-048 has no executed tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
    if ($ledgerText -notmatch "(?m)^# $counter 0\s*$") { throw "AC-048 invalid $counter count" }
}
Write-Output 'AC-048 OK'
```

- 期望输出：退出码 0，正式运行出现 run-tests: filtered；TAP 的 tests 大于 0，fail、cancelled、skipped、todo 均为 0，最后一行为 AC-048 OK。任一断言失败、没有测试、依赖缺失或导入失败必须非零且不能打印 OK。
- 行为断言：只有白名单规范模型被执行，别名不重复探测；至少一个允许对照确实执行，未允许模型 exec=0、账本新增=0；空白名单也为零。
- 行为断言：每次实际逻辑探测仅追加一条完整 cliworker.usage/v1，kind=probe、idempotency_key=probe:<probe_id>，model 与 pools 真实对应。失败但已报告的用量仍计入；两次超时尝试归并同一行，不丢失已确认消耗。
- 行为断言：已知容量池的 used 增量等于按既有计费公式独立计算的探测用量除以模型容量，无关池不变，不直接改配置读数造成双计。覆盖读数截止时点与窗口范围。
- 行为断言：同 probe_id 的串行及并发提交重放返回原 id、只保留一行、used 不再增加，重放不执行推理；不同新 probe_id 分别计入。损坏账本与写入失败不能伪装成功。stdout/stderr、argv、模型 JSON、缓存和用量文件均不含假的密钥哨兵。
- 行为断言：T-020 追踪分片仅含本任务两条 AC，并准确指向两个实际 integration 测试文件；测试不能通过改写 contracts、吞错、skip 或伪造报告满足验收。
