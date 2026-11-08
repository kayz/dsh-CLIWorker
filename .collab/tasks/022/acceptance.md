# Task 022 验收标准

范围为 T-022 / M4，AC-051..AC-056；预期以同目录 design.md、既有 contracts 和蓝图对应条目为准。策略金标直接引用 contracts/golden/policy/*.json 六例，不改 expected。brief 未指定基准 commit SHA 或既有验收报告；f75bb76 仅是冻结 [repro] 副本来源，不是本任务成功证据。

每个 pwsh 代码块是一条独立命令，由调度器在仓库外保存 UTF-8 无 BOM 的 .ps1，再用 pwsh -NoProfile -File 执行；本 design 角色不创建该脚本。命令不依赖前一条产物。所有原生命令立即检查 $LASTEXITCODE，仅测试实际通过才打印所属 AC OK。测试断言必须落实下面的行为，禁止 skip/todo/cancelled、零测试、吞错、写死生产结果或篡改金标。测试使用隔离的系统临时目录、假时钟、缓存夹具，不读个人配置、真实密钥，不调用供应商或网络。报告由既有 runner 写系统临时目录；设计文档本身不是通过报告。

## AC-051

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\022'
$testOutput = @(& node --test --test-reporter=tap test/unit/select-policy.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-051 direct tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-051 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-051 has nonzero or missing $counter counter" }
}
node scripts/run-tests.mjs --ac AC-051
if ($LASTEXITCODE -ne 0) { throw 'AC-051 filtered run failed' }
Write-Output 'AC-051 OK'
```

- 期望输出：退出码 0；直接指定的 test/unit/select-policy.test.mjs 实际执行且测试数大于 0；fail/cancelled/skipped/todo 都为 0；runner 输出 `run-tests: filtered` 并实际发现对应 AC 测试文件；最后一行 `AC-051 OK`，失败不出现该成功行。
- 必须由上述测试实际断言：unit；直接调用生产 policy，遍历 contracts/golden/policy/*.json 六例，对完整 selected/rejected 深相等 expected。P1 mA/mB/mC、paid 标记；P2 quota_low；P3 两个 unknown_policy 分支；P4 异组优先与同组补齐。另断言紧迫度 0.25 下限、多池 min、价格/key 同分、共享池逐项预留和不同容量的比例换算。测试不得复制策略代替生产实现。

## AC-052

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\022'
$testOutput = @(& node --test --test-reporter=tap test/unit/select-reserve.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-052 direct tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-052 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-052 has nonzero or missing $counter counter" }
}
node scripts/run-tests.mjs --ac AC-052
if ($LASTEXITCODE -ne 0) { throw 'AC-052 filtered run failed' }
Write-Output 'AC-052 OK'
```

- 期望输出：退出码 0；直接指定的 test/unit/select-reserve.test.mjs 实际执行且测试数大于 0；fail/cancelled/skipped/todo 都为 0；runner 输出 `run-tests: filtered` 并实际发现对应 AC 测试文件；最后一行 `AC-052 OK`，失败不出现该成功行。
- 必须由上述测试实际断言：unit；cap=10、remaining=2、est=1、reserve_fraction_for_high=0.15，normal 唯一 reserve_protected，high 被选中。将配置比例改为 0 时 normal 被选中，证明非硬编码；已有预留扣减对 high 也有效；avail=est 通过、略少拒选；多池中仅一个不足也不得生成 handle。

## AC-053

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\022'
$testOutput = @(& node --test --test-reporter=tap test/unit/select-policy.test.mjs test/contract/selection-shape.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-053 direct tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-053 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-053 has nonzero or missing $counter counter" }
}
node scripts/run-tests.mjs --ac AC-053
if ($LASTEXITCODE -ne 0) { throw 'AC-053 filtered run failed' }
Write-Output 'AC-053 OK'
```

- 期望输出：退出码 0；直接指定的 test/unit/select-policy.test.mjs、test/contract/selection-shape.test.mjs 实际执行且测试数大于 0；fail/cancelled/skipped/todo 都为 0；runner 输出 `run-tests: filtered` 并实际发现对应 AC 测试文件；最后一行 `AC-053 OK`，失败不出现该成功行。
- 必须由上述测试实际断言：unit+contract；执行真实 v1 编排并用既有 schema 校验，不能只校验 examples。count=3/可用=1 时 ok=true、count_returned=1、truncated=true、shortfall=2；满额 shortfall=0。零候选分别由两个夹具唯一断言 E_INSUFFICIENT_QUOTA 与 E_NO_CANDIDATE，models/calls 都空、truncated=false、shortfall=count；混合非额度拒选和额度拒选按 interfaces 第 2 节分类。retry_after 是实际额度拒选池最早 reset_at，无值为 null，不取非额度池时间。每个 calls[i] 与 models[i].call 深相等；空 call、不新鲜 callable、额度不通过均不能发 handle。估计验证 p90/p50/p25 和配置 assumed；unknown/after_known 是明确策略通过。至少三个 handle 用非默认 lease_ttl_s、timeout_ms、同一伪时钟独立算出 expires_at_i=selected_at+lease_ttl_s*1000+i*timeout_ms，i 从 0 起；callable TTL 与租约 expires_at 的等号边界及越过 1ms 均覆盖。

## AC-054

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\022'
$testOutput = @(& node --test --test-reporter=tap test/integration/select-concurrency.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-054 direct tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-054 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-054 has nonzero or missing $counter counter" }
}
node scripts/run-tests.mjs --ac AC-054
if ($LASTEXITCODE -ne 0) { throw 'AC-054 filtered run failed' }
Write-Output 'AC-054 OK'
```

- 期望输出：退出码 0；直接指定的 test/integration/select-concurrency.test.mjs 实际执行且测试数大于 0；fail/cancelled/skipped/todo 都为 0；runner 输出 `run-tests: filtered` 并实际发现对应 AC 测试文件；最后一行 `AC-054 OK`，失败不出现该成功行。
- 必须由上述测试实际断言：integration；必须启动 50 个独立 Node 进程，全部 ready 后才打开同一文件屏障，使用真实生产选模、跨进程锁和磁盘原子写。父进程收齐响应并独立计算每个池在所有有效租约中的预留，逐次提交快照及最终快照均 <= 剩余量；不同容量模型共享池按比例归一。所有进程退出，不能把启动 50 个但只校验一个响应当通过。相同 request_id 串行、竞争及重启重放都得到深相等 handles，持久化预留不增加；省略 request_id 不互相命中。新 request_id+exclude_handles 在专门的有充足剩余额度夹具补足 count，handle 与模型不重复，原预留仍占用；原键不用于第二次申请。推进 ctx.clock 超过到期后释放有效预留，恰好到期仍按既有严格早于 now 规则；重放不延长 expires_at。损坏状态与写失败不返回成功、不增加幽灵预留。测试协调仅用文件事件/IPC/可推进时钟，不使用 sleep 或固定真实延时。

## AC-055

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\022'
$testOutput = @(& node --test --test-reporter=tap test/unit/select-noexec.test.mjs test/characterization/defects/a5-nocache.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-055 direct tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-055 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-055 has nonzero or missing $counter counter" }
}
node scripts/run-tests.mjs --ac AC-055
if ($LASTEXITCODE -ne 0) { throw 'AC-055 filtered run failed' }
Write-Output 'AC-055 OK'
```

- 期望输出：退出码 0；直接指定的 test/unit/select-noexec.test.mjs、test/characterization/defects/a5-nocache.test.mjs 实际执行且测试数大于 0；fail/cancelled/skipped/todo 都为 0；runner 输出 `run-tests: filtered` 并实际发现对应 AC 测试文件；最后一行 `AC-055 OK`，失败不出现该成功行。
- 必须由上述测试实际断言：unit；50 个白名单模型通过真实命令与编排，注入 exec/fetch 记录调用且调用即失败，成功、拒选、缺/陈旧缓存、draft 和门控都断言 exec=0/fetch=0。只读缓存内容和 mtime 不变；可发生租约状态写入，但不刷新缓存、不记新用量。每个通过前置过滤的模型至多一次 forecast，排序与 handle 不重复计算。a5-nocache 保留原 [repro]/AC-005，新增的 [fixed]/AC-055 针对 live 连续选模均不执行探测。冻结副本复现中的探测不计入 live 的零调用断言。

以下是独立的性能报告验收；只判定测量是否真实运行并输出有效报告，不对 p95 数值设门限，也不代替上面的功能门禁。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\022'
$perfOutput = @(& npm run perf 2>&1)
$perfExit = $LASTEXITCODE
$perfOutput | ForEach-Object { Write-Output "$_" }
if ($perfExit -ne 0) { throw 'AC-055 perf runner failed' }
$perfText = $perfOutput -join "`n"
if ($perfText -match 'no perf tests') { throw 'AC-055 perf was not discovered' }
if ($perfText -notmatch '(?i)p95\s*[:=]?\s*[0-9]+(?:\.[0-9]+)?\s*ms') { throw 'AC-055 missing p95 measurement in ms' }
Write-Output 'AC-055 OK'
```

- 期望输出：退出码 0；通过 test/perf/select.test.mjs 实际运行 test/perf/select.perf.mjs，报告说明 50 模型、预热和实际测量样本数，包含有限非负的 `p95=<实测数值> ms`（允许冒号或空格分隔）；不出现 `no perf tests`；最后一行 `AC-055 OK`。测量错误和未发现均失败，耗时数值本身不影响门禁。

## AC-056

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\022'
$testOutput = @(& node --test --test-reporter=tap test/contract/selection-view.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-056 direct tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-056 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-056 has nonzero or missing $counter counter" }
}
node scripts/run-tests.mjs --ac AC-056
if ($LASTEXITCODE -ne 0) { throw 'AC-056 filtered run failed' }
Write-Output 'AC-056 OK'
```

- 期望输出：退出码 0；直接指定的 test/contract/selection-view.test.mjs 实际执行且测试数大于 0；fail/cancelled/skipped/todo 都为 0；runner 输出 `run-tests: filtered` 并实际发现对应 AC 测试文件；最后一行 `AC-056 OK`，失败不出现该成功行。
- 必须由上述测试实际断言：contract；遍历全部 contracts/examples 材料，并覆盖 AC-051..053 的全部实际夹具。合法选择请求跑真实命令，模型/池等示例按所属契约作为 fixture 材料，非法示例按现有 expected 验证拒绝；所有实际产生的 AgentLine 成功/失败输出都以真实 catalog、forbidden、wrapper 调用 scanView，ok=true/hits=[]，同时断言顶层字段与包装 call。不能把 full/config 原文当 AgentLine，也不能先删泄漏字段再扫描。main/bin 的 models select+view=full 唯一 E_VIEW_FORBIDDEN、退出码 2、无租约副作用；admin select 实际可达、退出 0、每个 handle 有完整 detail（含 paid funding），不暴露密钥值；CLI compat=draft 与无 schema 返回旧扁平字段、无 cli、W_DRAFT_DEPRECATED。CLI truncated 退出 0；两个零候选 CLI 各退出 5，错误码唯一，与编排模块完整失败 selection 区分。合并请求/陈旧数据/弃用/测试时钟 warnings，不能互相覆盖。用假密钥哨兵检查所有输出、状态、审计，0 泄漏。实际运行更新后的 select 流程步骤并验证 v1 handle/calls。追踪分片 task=T-022、milestone=M4，仅六条所属 AC，files 对应本任务真实测试且 covered，不新增 baseline 或 schema。

下游实现角色还须执行以下独立完成检查；不能用 filtered 报告冒充完整测试通过，不能扩大写域修复其他任务。此命令归入 AC-056 的补充检查。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\022'
pwsh -NoProfile -File scripts/check-fast.ps1
if ($LASTEXITCODE -ne 0) { throw 'AC-056 completion checks failed' }
Write-Output 'AC-056 OK'
```

- 期望输出：退出码 0，出现 `check-fast: ok`，最后一行 `AC-056 OK`；包含现有完整测试与静态门禁。任何失败如实记录，不能仅凭六次 filtered 成功宣称本命令通过。本 design 轮不运行会创建其他文件的检查链。

