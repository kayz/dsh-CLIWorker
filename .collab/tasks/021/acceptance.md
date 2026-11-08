# Task 021 验收标准

仅覆盖 brief 的 AC-049、AC-050，层级 unit，属主 T-021 / M4。依据本任务 design.md、蓝图既有接口、contracts/spec/ac-index.json；容量预期直接引用 contracts/golden/capacity.json。brief 没有指定基准 commit SHA 或既有验收报告，不以其他任务结果替代本任务命令。

每个 pwsh 代码块是一条独立验收命令，无前置命令产物依赖。调度器将代码块保存到仓库外 UTF-8 无 BOM 的 .ps1，并以 pwsh -NoProfile -File 执行。命令固定在本工作树运行，检查每次原生命令的 $LASTEXITCODE，仅实际测试成功才打印对应 AC OK。测试必须断言下列行为，不得 skip、todo、取消、零测试、吞错或硬编码 expected；失败时非零退出且不出现成功哨兵。报告由既有 runner 写系统临时目录，不读个人配置，不依赖真实账号、供应商 CLI 或网络。

## AC-049

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\021'
$testOutput = @(& node --test --test-reporter=tap test/unit/usage-ledger.test.mjs test/unit/usage-readers.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-049 unit tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-049 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-049 has nonzero or missing $counter counter" }
}
node scripts/run-tests.mjs --ac AC-049
if ($LASTEXITCODE -ne 0) { throw 'AC-049 filtered run failed' }
Write-Output 'AC-049 OK'
```

- 期望输出：退出码 0；两个直接指定的测试文件实际执行成功；runner 输出 `run-tests: filtered`，发现并执行含 [AC-049] 的两个测试文件；失败、取消、跳过和 todo 均为 0；最后一行 `AC-049 OK`。任何一步失败均不可打印该行。
- 必须由 usage-ledger.test.mjs 的实际断言证明：同 idempotency_key 串行两次、并发两次及重启后重放均返回首次 id，物理账本一行、去重读取一行、额度只计一次；历史重复同键取首次，不同键保留。完整 usage/v1 字段、类型、token/cost 非负规则与时间来源正确；无键旧行不被误合并。文件缺失为空，损坏 JSONL、权限或追加失败不伪装成功，重放不修改原内容和 at。
- 必须由 usage-readers.test.mjs 的实际断言证明：codex 会话文件与 claude 事件夹具经真实解析器得到完整 `{used_fraction, reset_at, source:'cli', at}`，手写预期与供应商原字段独立维护；百分比和时间单位转换正确。读取按观察时间选择最新有效数据，短/周窗口与不同池不串用；未知/缺失/坏数据不伪造 0 用量，不从 token 累计量推断官方百分比，不读取 auth 文件或调用推理。
- 必须通过生产 models forecast 命令验证：容量 10 Mtok、读数占比 0.5、读数前 1 Mtok、读数后 0.5 Mtok 时，TTL 内与恰好 reading_ttl_s=600 秒都返回 remaining_mtok=4.5；同一伪时钟 advance 超过阈值后返回 remaining_mtok=8.5 且 warnings 含 W_STALE_DATA。读数 at 不变，未跨 reset；无关池数据不影响该值。共享池不同模型行按各自容量消耗，未知容量得到 ledger_capacity_unknown；估算 reset 不清零，CLI 确认 reset 按既有规则处理。
- 必须实际调用 main 或 bin 路由证明 usage record/summary/import、pools list/set、models forecast 可达，import 重复提交不重复记账，导入读数写入运行状态并被后续命令复读；pools set 按 id 保存既有 pool 结构。非法参数、JSON、未知池与配置/状态错误输出既有错误码，且不回显原始输入。stdout/stderr、JSON、错误、账本和池状态均不含假的密钥哨兵。测试禁止仅断言 helper、标题或 schema 存在。
- 追踪断言：T-021 分片只登记本任务两条 AC，AC-049 的 files 精确包含两个 usage 测试；字段遵循既有格式，baseline 不在分片重复声明，运行代码与测试不引用 .collab。

## AC-050

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\021'
$testOutput = @(& node --test --test-reporter=tap test/unit/capacity.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-050 capacity unit tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-050 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-050 has nonzero or missing $counter counter" }
}
node scripts/run-tests.mjs --ac AC-050
if ($LASTEXITCODE -ne 0) { throw 'AC-050 filtered run failed' }
Write-Output 'AC-050 OK'
```

- 期望输出：退出码 0；capacity.test.mjs 实际执行成功；runner 输出 `run-tests: filtered` 并执行含 [AC-050] 的容量测试文件；失败、取消、跳过和 todo 均为 0；最后一行 `AC-050 OK`。任何一步失败均不可打印该行。
- 金标断言：测试直接读取只读 contracts/golden/capacity.json，遍历全部五例，调用真实容量学习并对完整返回值 deepStrictEqual expected，不复制计算到测试中替代生产实现。cap-k2-low 为 `{capacity_mtok:4,k:2,confidence:'low',source:'measured'}`；cap-k3-medium 为 `{capacity_mtok:8,k:3,confidence:'medium',source:'measured'}`；cap-k10-high 为 `{capacity_mtok:8,k:10,confidence:'high',source:'measured'}`；cap-discard-small-delta、cap-reset-pair-ignored 均为 `{capacity_mtok:8,k:1,confidence:'low',source:'measured'}`。
- 边界断言：Δfraction<0.01 的相邻对及对应 token 一同丢弃，Δfraction=0.01 保留；负增量重置对丢弃，不跨坏对拼接。区间 (前时刻,后时刻]，边界行只计一次；使用保留对 sum(tokens)/sum(Δfraction)/1e6，不对逐对容量求算术平均；k 取有效对数，不取行数。不同模型、池、窗口不能混算；无有效对不产生 NaN/Infinity、零容量或覆盖已有结果。
- 接线断言：通过真实读数导入和池读取流程产生 measured 容量，其 value/source/confidence 映射到已有 pool.capacity_mtok[model]，再由 forecast 消费；不向 pool 增加 k 或新版本字段。配置 source=config 的容量不被覆盖，无关池/模型保持原值，多模型不能归因的区间不虚构单模型容量。生产计算不读取金标，不内置厂商容量。
- 追踪断言：test/traceability/T-021.json 的 task=T-021、milestone=M4，仅有 AC-049 与 AC-050；AC-050 指向 test/unit/capacity.test.mjs；实际覆盖后标 covered，不改 contracts/spec/ac-index.json 或金标来满足验收。

实现角色还须独立执行以下完成检查；它是补充门禁，不能替代上面的两条行为验收。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\021'
pwsh -NoProfile -File scripts/check-fast.ps1
if ($LASTEXITCODE -ne 0) { throw 'AC-050 completion checks failed' }
Write-Output 'AC-050 OK'
```

- 期望输出：退出码 0，出现 `check-fast: ok`，最后一行为 `AC-050 OK`；现有测试及静态检查全部通过。其他任务导致的失败按真实输出报告，不扩大写域修复，不冒用 filtered 报告证明完整运行。本 design 轮不执行会创建其他文件的检查链；当前文档不是实现验收通过报告。
