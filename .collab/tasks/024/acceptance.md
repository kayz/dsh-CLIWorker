# Task 024 验收标准

本文件针对 AC-059（integration）、AC-060（integration）、AC-061（integration、unit）。baseline 沿用 contracts/spec/ac-index.json。brief 未给基准 commit SHA 或既有验收报告，不自行指定。registration.test.mjs 已获本轮用户授权，必须更新后执行，不能删除或跳过。

每个 pwsh 块是一条独立验收命令，由调度器在仓库外保存成 UTF-8 无 BOM 的 .ps1，再以 pwsh -NoProfile -File 执行；design 阶段不创建脚本。命令不依赖另一条命令产物，原生命令后立即检查退出码；失败必须非零且不打印成功哨兵。下游测试用隔离系统临时目录与既有 ctx/clock，不访问个人配置、真实密钥、网络或供应商；禁止零测试、skip/todo/cancelled、吞错、固定成功响应替代被测实现。以下命令是实现后的要求，不是当前通过报告。

## AC-059

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\024'
$testOutput = @(& node --test --test-reporter=tap test/integration/registration.test.mjs test/integration/plugin-routes.test.mjs test/integration/plugin-session.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-059 route/session tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-059 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-059 invalid $counter counter" }
}
Write-Output 'AC-059 OK'
```

- 期望输出：命令退出 0，TAP 的 tests 大于 0，fail/cancelled/skipped/todo 全为 0，最后输出 AC-059 OK。以下每项必须有实际断言，不能仅靠成功哨兵判断覆盖。
- 注册集合等于生产声明集，独立核对 design 路由表全部静态端点含 session/ui/health；方法与级别匹配，无固定“4 条”假设。真实 createPlugin 返回值、getRegistration 拷贝、inject/effect/register 调用结果正确；单路径注册失败仅该路径缺失，其他注册继续；inject 失败、strict 抛错、非 strict 行为及未 apply 占位结果保留；消息不含植入秘密。
- POST select：使用显式 v1 schema、不带 view、无 session 时 200，实际候选产生有效包装 call，response 通过既有 selection validator 和 scanView（真实目录、forbidden、wrapper），hits=[]；等价 CLI v1 输出通过同一个 scanView。full、compat:draft、缺 schema 三组请求分别在缺失、伪造、过期 session 下唯一 403 E_VIEW_FORBIDDEN；有效 session 时 full/draft 各 200 且符合各自视图及已有 warning，不通过改 CLI 视图规则实现。包装 request 与直接 request 不形成绕过。
- GET session 与 ui 分别独立改变 socket 远端、Host、Origin 为非 loopback，保持其他两项合法，全部唯一 403 E_LOOPBACK_ONLY；全部合法时 200。覆盖 IPv4/IPv6/mapped socket、合法端口、Origin 缺省、Host 后缀欺骗、空/畸形 Host、Origin:null 和伪造 X-Forwarded-*；缺 socket/Host 必须拒绝。ui 不含业务数据或 session。
- session 响应满足只读 session.v1.schema.json，只有 schema/session/csrf/expires_at，session 解码为 32 字节，csrf 为 HMAC-SHA256 base64url，expires_at 相对假时钟精确增加 policy TTL；不设置 cookie，no-store。两次签发不同，跨会话 csrf 不通用；query/body/cookie 不能替代请求头；重建实例后旧 session 无效。时钟推进至到期点及越过 TTL 后均拒绝，不等待真实时间，不在文件、日志或业务响应中保存签发令牌。
- providers/models/forecast/snapshot/已知 jobs id 分别覆盖无会话、未知会话、过期会话（403 E_ADMIN_REQUIRED）与有效会话（200）。不带 csrf 的管理读仍可成功，readonly 仍允许读。snapshot/jobs 的成功由测试内部受控数据处理器提供，并断言仅在鉴权通过后调用且响应透传；既有 providers/models/forecast 使用生产业务链。jobs 必须用具体 id 的 exact 注册验证，不能把 <id> 当字面量或把 handler 直调冒充真实动态匹配；完整 jobs 数据和未知 id 生命周期仍是 design 已列 T-025 接入缺口。
- 所有 403 错误逐个验证 error.code 唯一、http_status/retryable 与 registry.snapshot 一致，并通过严格 error envelope 校验；拒绝路径无业务处理器调用/状态写入。session 自举只允许其 schema 规定的令牌输出，其余响应、stderr、注册消息与临时状态均无原令牌或业务秘密。

## AC-060

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\024'
$testOutput = @(& node --test --test-reporter=tap test/integration/plugin-guard.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-060 guard/flow tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-060 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-060 invalid $counter counter" }
}
Write-Output 'AC-060 OK'
```

- 期望输出：退出 0，tests 大于 0，fail/cancelled/skipped/todo 全 0，最后 AC-060 OK。plugin-guard.test.mjs 必须实际执行 http-select/http-admin 的 run(flow)，不可仅检查导出。
- 对 design 列出的每一个管理写端点逐条请求：无/无效/过期会话 + readonly + 缺 csrf + 非法 JSON，唯一 403 E_ADMIN_REQUIRED；有效会话 + readonly + 缺 csrf + 非法 JSON，唯一 403 E_READONLY；有效会话 + 可写 + 缺 csrf 或不匹配 csrf + 非法 JSON，唯一 403 E_CSRF；前三项通过 + 非法 JSON/超限体，400 E_REQUEST_INVALID。对照合法请求进入业务层，不因复用错误处理顺序得到其他 403。
- 前三层拒绝时 body 未解析、业务处理器未调用、秘密后端未访问、业务状态未改变；有效头部但非法 body 时业务处理器仍未调用。超限请求必须完成响应，测试有有界失败机制，不能挂起或用断言超时替代预期错误。
- 使用同一次 GET api/session 返回的 session/csrf 发出首个合法写请求，成功且实际目录状态发生预期变化；不允许第二次签发、预热写请求或手工填充会话绕过。另一会话的 csrf 被拒绝，cookie 或 body 中的 csrf 不替代头。方法变换不得形成绕过。
- http-select 用真实生产选择链并用 scanView 得到 hits=[]；http-admin 完成自举、管理读、首写及拒绝矩阵。两步骤全部 HTTP 响应经 flow.recordHttp 纳入 flow.scan，HTTP 扫描数量大于 0、秘密哨兵 hits=[]；stdout/stderr/argv/state 也为零泄露。full/draft 只作秘密扫描，不要求移除契约允许的管理细节。

## AC-061

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\024'
$testOutput = @(& node --test --test-reporter=tap test/unit/health.test.mjs test/integration/health.test.mjs 2>&1)
$testExit = $LASTEXITCODE
$testOutput | ForEach-Object { Write-Output "$_" }
if ($testExit -ne 0) { throw 'AC-061 health/doctor tests failed' }
$testText = $testOutput -join "`n"
if ($testText -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-061 ran no tests' }
foreach ($counter in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($testText -notmatch "(?m)^# $counter 0\s*`$") { throw "AC-061 invalid $counter counter" }
}
Write-Output 'AC-061 OK'
```

- 期望输出：退出 0，tests 大于 0，fail/cancelled/skipped/todo 全 0，最后 AC-061 OK。health.test.mjs 的 integration 覆盖真实 CLI 分发/输出与退出码；必须实际执行替换后的 flows doctor 步骤。
- 健康夹具：有效非示例配置、可写 state_dir、可取得锁、可用的已配置密钥后端、新鲜清单、无过期探测、成功注册、无文件时钟。doctor 单个 JSON、退出 0；health 无需会话、HTTP 200、status=ok，checks 覆盖八类事实且各自成功、registration=ok、test_clock=false。全新合法目录无 inventory/probes 的对照组同样成功，详情明确尚未生成/0，不使用任意伪年龄。
- 分别单独注入：缺失/损坏/示例/内联秘密配置；目录不可写；活跃锁超时；所需密钥后端不可访问；清单不可读/损坏/无效时间；过期探测或探测缓存损坏；部分 register 失败/inject 失败；CLIWORKER_TEST_CLOCK_FILE 指向合法文件、不可读文件、非法内容。每组其余事实保持健康，doctor 退出 9 且唯一 E_HEALTH_DEGRADED，health HTTP 503、status=degraded，对应检查 ok=false；不能提前输出 E_CONFIG/E_SECRET_BACKEND/E_INTERNAL 或遗漏其余检查。多故障组须同时报告全部故障。
- 对同一受控时刻与等价环境，HTTP 报告与 doctor 正常报告或 JSON.parse(doctor.error.message) 在八项 facts/数值/结论上相等；包括精确清单年龄、过期数量、锁结果、注册失败以及 test_clock。doctor 故障输出通过只读 error-envelope.schema.json，无新顶层字段；HTTP 保持 {status,checks,registration,test_clock} 形状，公共响应无 provider 数据。CLI streamed 钩子只输出一次 JSON，内部返回值不进入 stdout，非 doctor 命令行为不变。
- 过期判断按现有 availability TTL 规则测试边界前后；通过 fakeClock.advance 而非墙钟等待推进会话/锁/探测过期。清单年龄随同一时钟精确变化，无新 TTL 字段；密钥检查从不打印原值或写试验秘密；探针和本次取得的锁均 finally 清理，不删除其他进程锁。测试所有输出与状态的秘密哨兵 0 命中。
- doctor 独立 CLI 的注册检查使用无监听诊断宿主执行真实注册链；HTTP 使用实际插件实例的结果。分别注入等价注册失败比较，不能用全局最近成功实例覆盖失败，不声称诊断宿主能验证实际远端 DSH。已有 W_LEGACY_USAGE 保留；文件时钟启用时报告 test_clock=true，W_TEST_CLOCK 在故障 error.message 中的报告 warnings 内可见，不为此突破严格错误 envelope；此项不要求修改其他命令 warning。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\024'
node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'AC-061 unit regression failed' }
Write-Output 'AC-061 OK'
```

- 期望输出：全部既有 unit 测试与新增 health unit 测试通过，退出 0，最后 AC-061 OK。本条是 brief 规定的独立回归门禁，不可用只跑新文件代替。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\024'
node scripts/check-acceptance.mjs .collab/tasks/024/acceptance.md
if ($LASTEXITCODE -ne 0) { throw 'AC-061 acceptance format failed' }
Write-Output 'AC-061 OK'
```

- 期望输出：退出 0，含 check-acceptance: ok、warnings=0，AC 小节为 3 个且无重复 id，最后 AC-061 OK。

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\024'
node scripts/check-fast.mjs
if ($LASTEXITCODE -ne 0) { throw 'AC-061 repository regression failed' }
Write-Output 'AC-061 OK'
```

- 期望输出：退出 0，含 check-fast: ok，最后 AC-061 OK；注册契约更新后的 registration.test.mjs 与所有既有回归均通过，T-024 traceability 通过。范围外缺口按 design 如实披露，不将真实失败改成 skip 或伪造通过。本完整门禁由实现后下游运行，design 角色仅自检文档，不执行其隐含写报告或 git 操作。
