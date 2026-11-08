# Task 031 — 身份证据契约：四档身份、identity_source、calls[] 证据与 unverified 不阻断

判据来自本任务 brief 和 design.md 11.1～11.4；唯一验收项 AC-075，层级 contract、unit。brief 未指定基准 commit SHA 或既有验收报告，不引用其他任务基线。命令在仓库根目录使用 PowerShell 7 执行，无须真实 CLI、登录态、网络或前置命令，不执行 git，不生成验收报告文件。

## AC-075 四档身份 + identity_source；codex rollout 只记 observed；unverified 不阻断；failed 才降级；calls[] 证据字段齐全

命令覆盖本任务两个测试文件，包括完整身份、来源分档、provider 实际调用生成证据、脱敏、失败记录、空值语义及 Session 精简投影兼容。判定只用退出码和 TAP 摘要，不依赖测试标题、函数名、行号或其他任务产物。

```pwsh
$ErrorActionPreference = 'Stop'
$identityOutput = & node --test --test-reporter=tap test/contract/identity.test.mjs test/unit/identity-levels.test.mjs 2>&1
$identityExit = $LASTEXITCODE
$identityOutput | Write-Output
if ($identityExit -ne 0) { exit $identityExit }
$identityTap = $identityOutput -join "`n"
$identityTests = [regex]::Match($identityTap, '(?m)^# tests ([1-9][0-9]*)\s*$')
if (-not $identityTests.Success) { throw 'AC-075: no executed tests' }
foreach ($identityCounter in @('fail', 'cancelled', 'skipped', 'todo')) {
    if ($identityTap -notmatch "(?m)^# $identityCounter 0\s*$") {
        throw "AC-075: nonzero or missing $identityCounter counter"
    }
}
Write-Output 'AC-075 OK'
```

- 期望输出：Node TAP 摘要含正整数 `# tests N`，并分别包含 `# fail 0`、`# cancelled 0`、`# skipped 0`、`# todo 0`；最后打印 `AC-075 OK`，命令退出码 0。缺文件、导入失败、断言失败、零测试或非零 skip/todo/cancelled 均不得打印成功哨兵，退出非零。
- 期望行为：stdout.modelUsage、stdout.event.model、stats.models 为 verified；rollout-file 恒 observed；cli_flag/无证据为 unverified 且继续调用；真实失败为 failed；模型不一致不伪造报告、不触发失败。每次调用保留一条字段完整的 calls，未知报告模型/退出码/token 用量显式 null；evidence 经 redact 且不含令牌、用户目录中的用户名。输入边界按 design.md 的两个测试文件覆盖清单实现。


以下独立命令验证本次身份模块抽取对既有 Session API 的兼容性，不扩展 AC-075 的写域；不依赖上一条命令的变量或执行结果。

```pwsh
$ErrorActionPreference = 'Stop'
$sessionOutput = & node --test --test-reporter=tap test/contract/session.test.mjs test/unit/session-invalidation.test.mjs 2>&1
$sessionExit = $LASTEXITCODE
$sessionOutput | Write-Output
if ($sessionExit -ne 0) { exit $sessionExit }
$sessionTap = $sessionOutput -join "`n"
if ($sessionTap -notmatch '(?m)^# tests ([1-9][0-9]*)\s*$') {
    throw 'AC-075: no executed session regression tests'
}
foreach ($sessionCounter in @('fail', 'cancelled', 'skipped', 'todo')) {
    if ($sessionTap -notmatch "(?m)^# $sessionCounter 0\s*$") {
        throw "AC-075: nonzero or missing $sessionCounter counter"
    }
}
Write-Output 'AC-075 OK'
```

- 期望输出：TAP 摘要中 tests 为正整数，fail、cancelled、skipped、todo 均为 0，最后打印 `AC-075 OK`，退出码 0。任何缺文件、断言失败、零测试或跳过都以非零退出码失败。
- 期望行为：原有 Session 成功/失败结构、session id 提取、start/resume 参数与调用次数、精简身份四字段及 consistent 的语义保持兼容；完整 identity 和 calls 证据不泄漏进旧 Session 返回。
