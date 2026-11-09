# Task 037 — discover 覆盖 11 个已知 CLI 的契约清单

本目录 design.md 与 attention.json 记录了尚未裁决的输出契约、生产规则数据来源和未知 CLI 兼容冲突。以下命令入口可执行，但在裁决同步到两份规格、实现满足完整行为之前，命令通过也不能消除该阻塞。brief 未提供基准 commit SHA 或既有验收报告路径。

各 pwsh 块由 PowerShell 7 runner 作为独立 .ps1 在仓库根执行，不依赖上一命令的变量、报告或状态；原生命令之后立即检查 `$LASTEXITCODE`。本轮设计不创建或执行这些脚本，不修改测试及实现。

## AC-080 discover 对 11 个已知 CLI 的可判定识别

```pwsh
$ErrorActionPreference = 'Stop'
$ac080Tap = & node --test --test-reporter=tap 'test/integration/discovery-rules.test.mjs'
if ($LASTEXITCODE -ne 0) { throw 'AC-080 integration failed' }
$ac080Tap | Write-Output
$ac080Text = $ac080Tap -join "`n"
if ($ac080Text -notmatch '(?m)^# tests [1-9][0-9]*\r?$') { throw 'AC-080 executed no tests' }
foreach ($ac080Status in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($ac080Text -notmatch "(?m)^# $ac080Status 0\r?`$") { throw "AC-080 has $ac080Status tests" }
}
Write-Output 'AC-080 OK'
```

- 期望输出：退出码 0；stdout 有正数的 tests 汇总，fail、cancelled、skipped、todo 均为 0，最后打印独立一行 `AC-080 OK`。缺少测试文件、零用例、子进程失败或任何跳过均失败，不按测试标题断言。
- 行为判据：测试必须实际驱动生产 discover，在仅含假可执行文件的 PATH 上逐项验证 codex、claude、dsh、cursor、codebuddy、antigravity、trae、zcode、qoder、kimi、opencode 的精确 id、recognized、版本和版本证据；全量及子集结果不得有遗漏或多余条目，未知文件不能被误认。验证路径去重、稳定键、正确的证据摘要及失败时不伪造版本；不发起真实网络，不执行真实厂商 CLI，临时文件清理完毕。仅断言导出的规则数量或自行构造 inventory 不算通过。
- 待裁决判据：provider 和身份档位必须有明确的输出位置、取值和证据强度规则；未知文件是否包含显式 unknown_patterns/override 候选、历史 inventory 中的未知项及 `--probe-unknown` 行为必须明确。当前既有契约无法承载这些要求，不自行填入新字段或解释为取消要求。裁决前 AC-080 保持未验收；裁决后须将这些判据补全为测试中的确定预期。

```pwsh
$ErrorActionPreference = 'Stop'
node --test 'test/integration/discovery.test.mjs' 'test/integration/discover-command.test.mjs' 'test/integration/discovery-incremental.test.mjs' 'test/integration/discovery-deny.test.mjs'
if ($LASTEXITCODE -ne 0) { throw 'AC-080 discovery regression failed' }
Write-Output 'AC-080 OK'
```

- 期望输出：退出码 0，所列既有 discovery 集成测试全部通过，stdout 最后打印 `AC-080 OK`。当前关于未知候选的既有断言必须保留；如果最终裁决要求改变这些断言，必须先明确授权对应路径及迁移语义、同步规格，不能为通过本命令擅自删减测试。

```pwsh
$ErrorActionPreference = 'Stop'
node scripts/check-no-model-table.mjs
if ($LASTEXITCODE -ne 0) { throw 'AC-080 model table gate failed' }
Write-Output 'AC-080 OK'
```

- 期望输出：退出码 0，stdout 最后打印 `AC-080 OK`。识别来自获准的配置/契约数据；不修改检查器或扩大白名单来掩盖硬编码模型表。

## AC-006 既有单元测试不得被破坏

```pwsh
$ErrorActionPreference = 'Stop'
node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'existing unit tests broken' }
Write-Output 'AC-006 OK'
```

- 期望输出：退出码 0，既有单元测试全绿，stdout 最后打印 `AC-006 OK`；保留 brief 指定的原始单元回归命令。

```pwsh
$ErrorActionPreference = 'Stop'
pwsh -NoProfile -File 'scripts/check-fast.ps1'
if ($LASTEXITCODE -ne 0) { throw 'project check-fast failed' }
Write-Output 'AC-006 OK'
```

- 期望输出：退出码 0，项目 check-fast 全部检查及测试通过，stdout 最后打印 `AC-006 OK`。本命令用于下游实施完成后的完整门禁，本轮设计阶段不运行；不得通过跳过检查、放宽断言或改变本任务写域外的文件来制造通过。
