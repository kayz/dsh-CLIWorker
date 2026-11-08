# Task 023 验收标准

范围为 T-023 / M4 的 AC-057、AC-058，均为 integration，baseline 沿用 contracts/spec/ac-index.json 的 darwin/linux/win32。本轮已授权 lib/cli.mjs 的 run opt-in 和 lib/select.mjs 的租约摘要附加写入，以下为实现必须通过的门禁，不代表当前已实现或已通过。run 的逐事件 W_TEST_CLOCK 承载缺口按用户答复记在 design.md，不要求新增事件或 schema 非法字段。brief 没有指定基准 commit SHA 或既有验收报告；f75bb76 仅是冻结特征化副本来源。

每个 pwsh 代码块是一条独立验收命令，由调度器在仓库外存为 UTF-8 无 BOM 的 .ps1，再用 pwsh -NoProfile -File 执行；本 design 轮不创建脚本。每条命令自带工作目录，不依赖上一条的状态或报告。测试必须使用隔离系统临时目录、既有时钟和真实生产调用链；禁止真实供应商/网络/个人配置依赖、skip/todo、零测试通过、吞错或仅打印成功哨兵。fixture 脚本运行时生成，不新增范围外仓库文件。任何失败不得打印所属成功哨兵。

## AC-057

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\023'
$testOutput = @(& node --test --test-reporter=tap test/integration/runner.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-057 direct tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-057 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-057 has nonzero or missing $counter counter" }
}
node scripts/run-tests.mjs --ac AC-057
if ($LASTEXITCODE -ne 0) { throw 'AC-057 filtered run failed' }
Write-Output 'AC-057 OK'
```

- 期望输出：退出码 0；test/integration/runner.test.mjs 实际执行大于 0 个测试，fail/cancelled/skipped/todo 全部为 0；正式 runner 发现并执行含 [AC-057] 的文件且输出 filtered 运行信息；最后一行 AC-057 OK。
- 必须由上述测试实际断言：从真实选择器取得 handle，按 call.command、args、cwd 启动真实 bin 并向 stdin 写入包含中文、空白及换行的已知输入。stdout 每个非空物理行都能独立 JSON.parse，并经既有 event/v1 validator 校验；没有缩进 JSON、普通 envelope、裸日志或尾部额外 JSON。seq 从 1 连续递增、lease_id 一致、at 使用受控时钟；成功退出 0，首个 start，最后且仅一个 result，ok=true、exit_code=0，text 和 usage 的 input_tokens/output_tokens 精确等于 fake-cli 的预定输出，不重复累计 usage。
- 必须由上述测试实际断言：fake-cli 记录的完整 stdin 与输入一致，cwd 与 handle.call.cwd 一致，实际 argv 保留模型/只读设置及参数边界。成功账本精确新增 <lease>:pre、<lease>:post 两行，各 key 唯一，均通过 usage/v1 校验、model/pools 正确；pre token 为零，post 为实际用量，前后池读数等于 fixture 已知数值，汇总只计一次实际用量。重复写同 key 返回原 id，不增账本行。
- 必须由上述测试实际断言：实际运行 test/flows/steps/run.mjs，消费真实选择器生成的有效调用并重复上述关键检查，禁止只检查导出或只调用 runner。配置/秘密用隔离哨兵，provider 仅收到声明 env_names 的目标值；来源变量不携带哨兵，原 ctx.env/config/call 未改。stdout、stderr、JSON、argv、状态、审计及临时文件均无原值或其常见编码；若 fixture 回显秘密，公开事件和错误仍脱敏，不能将回显原文落盘后排除扫描。带文件时钟时事件仍通过原 event/v1，at 来自文件时钟，没有新增 warning 类型、warnings 字段、额外普通 JSON 或混入业务 text 的警告；本项不宣称已实现逐事件 W_TEST_CLOCK。
- 必须由上述测试实际断言：run 的 main 返回值只有 exitCode，内部 {exitCode,streamed:true} 不进入 stdout；原成功命令没有 opt-in 仍只输出一个 JSON，原业务 payload 即使 ok=false 也不被 main 自动推断退出码。合法 lease_id 配置加载错误输出 error 事件且取注册表退出码，不得先输出事件再追加 main 的普通错误 envelope；导入 runner/select/cli 不启动进程、读个人状态或打印输出。

## AC-058

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\023'
$testOutput = @(& node --test --test-reporter=tap test/integration/runner-errors.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-058 direct tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-058 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-058 has nonzero or missing $counter counter" }
}
node scripts/run-tests.mjs --ac AC-058
if ($LASTEXITCODE -ne 0) { throw 'AC-058 filtered run failed' }
Write-Output 'AC-058 OK'
```

- 期望输出：退出码 0；test/integration/runner-errors.test.mjs 实际执行大于 0 个测试，fail/cancelled/skipped/todo 全部为 0；正式 runner 发现并执行含 [AC-058] 的文件且输出 filtered 运行信息；最后一行 AC-058 OK。下列错误均是被测 CLI 的期望结果，测试命令自身仍须退出 0。
- 必跑断言：同一成功租约在新进程再次执行，唯一错误码 E_LEASE_CONSUMED、退出 6，fake-cli 调用次数及账本行数不增加；并发执行同一租约时不得启动两次供应商，不得生成重复 pre/post，不允许仅测试同进程内存缓存。
- 必跑断言：分别用新租约执行 auth 和 quota 模式，分别唯一得到 E_PROVIDER_AUTH、E_PROVIDER_QUOTA，退出 7、retryable 与 registry 一致；各自持久化 availability.state='blocked'，新进程读取仍为 blocked；随后真实选模以 availability_blocked 拒选对应模型，不能被旧 callable 缓存覆盖。保留其他模型记录及证据，失败输出仍为 schema 合法的 event JSONL，不能附加普通错误 envelope。普通 provider 失败映射 E_PROVIDER_FAILED，不能误报 auth/quota 或成功。
- 必跑断言：timeout fixture 实际创建子进程及孙进程，先等 PID 屏障，再推进 ctx.clock.advance(timeout_ms)，唯一得到 E_TIMEOUT、退出 4、retryable=true；随后在不超过 5 秒的有界轮询内 process.kill(pid,0) 对两个 PID 均抛 ESRCH。必须使用既有真实异步 exec 与进程树清理；不能仅断言 kill 被调用，也不断言墙钟耗时。finally 清理，结束后相关定时器无残留。
- 必跑断言：选择后、未开始的租约在 setNow(expires_at+1ms) 执行，唯一 E_LEASE_EXPIRED、退出 6，provider 调用数及账本行数均不增加；独立租约在恰好 expires_at 时按现有严格过期规则仍可运行。未知 ID 返回 E_LEASE_UNKNOWN、退出 6，不能返回内部错误或创建空状态掩盖损坏。
- 必跑断言：真实选择时在租约原子提交中写入唯一附加字段 config_digest，既有 lease/call/requests 字段和公开 handle/selection shape 不变。测试按 design.md 的排序 JSON、规范化 state_dir 和 SHA-256 规则独立计算预期 64 位小写 hex，不能仅比较生产函数两次输出。分别换成内容不同的 --config、以及修改原路径配置内容，均唯一 E_LEASE_CONFIG_MISMATCH、退出 6、provider 未启动、账本不增加；包括配置指向另一 state_dir 但传入原 --state-dir 的场景，不能覆写后错误放行。
- 必跑断言：仅改源 JSON 缩进或对象键顺序、以及同内容配置改名且仍解析到同 state_dir 的对照组可执行；SecretRef 或生效配置值改变则不匹配，秘密值轮换不参与摘要。旧租约无 config_digest 时 reader/选模仍接受且不迁移回填，run 返回 E_LEASE_CONFIG_MISMATCH、退出 6、无副作用；原 request_id 重放不刷新摘要或有效期。不得以路径相等、首次 run 快照或测试手填字段代替新租约真实选模写入；失败不破坏原租约及其他 request 索引。
- 必跑断言：秘密后端错误不启动 provider，IO/账本提交失败不发成功 result；失败消息和状态不泄漏秘密。test/traceability/T-023.json 的 task=T-023、milestone=M4，仅两条所属 AC，各为 covered，files 对应真实存在且含 AC 标记的 integration 文件，禁止重复或借用其他 AC。

下列第一条命令针对本轮授权的兼容性要求，实际运行原有 AC-023、AC-047、AC-006 测试。它们只作为 T-023 的回归约束，不改变 AC 属主，不允许修改对应测试文件。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\023'
$testOutput = @(& node --test --test-reporter=tap test/integration/cli-envelope.test.mjs test/integration/probe.test.mjs test/unit/import-safe.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-058 existing command regressions failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-058 regressions ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-058 regressions have nonzero or missing $counter counter" }
}
foreach ($regressionAc in @('AC-023', 'AC-047', 'AC-006')) {
  node scripts/run-tests.mjs --ac $regressionAc
  if ($LASTEXITCODE -ne 0) { throw "AC-058 regression $regressionAc failed" }
}
Write-Output 'AC-058 OK'
```

- 期望输出：退出码 0；三个指定文件实际执行、测试数大于 0，fail/cancelled/skipped/todo 全部为 0；三个正式 AC runner 均发现并执行原测试，最后一行 AC-058 OK。普通命令的单 JSON envelope、注册表退出码、导入无输出及既有 probe/select 行为保持。另须由 runner-errors.test.mjs 覆盖本轮 models/select diff 的两个失败分支：draft 返回 draft、legacy v1 返回 agentline，两者普通 envelope/退出 0；非 legacy 的 v1 AgentLine 失败仍按原错误 envelope/注册表退出码，不能因新增 run 控制对象而被统一改写。

下列命令是独立完成检查，不依赖前一条 filtered 报告；由下游在实现后执行，不授权扩大写域。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\023'
pwsh -NoProfile -File scripts/check-fast.ps1
if ($LASTEXITCODE -ne 0) { throw 'AC-058 completion checks failed' }
Write-Output 'AC-058 OK'
```

- 期望输出：退出码 0，现有静态门禁及完整测试通过，出现 check-fast: ok，最后一行 AC-058 OK。filtered 成功不替代本条；失败必须记录，不能修改范围外文件消除失败。本 design 轮不执行会生成产物及调用 git 的检查链。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\023'
node scripts/milestone-gate.mjs --milestone M4
if ($LASTEXITCODE -ne 0) { throw 'AC-058 M4 milestone gate failed' }
Write-Output 'AC-058 OK'
```

- 期望输出：退出码 0，现有 M4 门禁判定通过，最后一行 AC-058 OK。该门禁按既有规则检查 M4 及更早任务的覆盖与缺陷；其他任务尚未就绪导致非零时仍判失败并列明依赖，不能把本任务两条 AC 通过解释为整个 M4 通过，不能放宽门禁或补写其他任务分片。
