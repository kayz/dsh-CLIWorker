# Task 030 验收标准

从仓库根执行，使用 PowerShell 7、Node 20+。每个 pwsh 块是一条独立命令；原生命令失败立即抛错，只有所有断言通过才输出对应 AC 哨兵。设计阶段仅校验本文格式，下列行为命令在实现交付后执行。brief 未提供基准 commit 或既有验收报告路径。

## AC-070 发布门禁与基线判定

命令：运行发布门禁夹具单测，禁止失败、跳过、TODO 或零测试冒充通过。

```pwsh
$taskOutput = @(& node --test --test-reporter=tap test/unit/release-gate.test.mjs 2>&1)
$taskCode = $LASTEXITCODE
$taskOutput | Write-Output
if ($taskCode -ne 0) { throw 'AC-070 unit failed' }
$taskText = $taskOutput -join "`n"
if ($taskText -notmatch '(?m)^# tests [1-9][0-9]*\s*$' -or $taskText -notmatch '(?m)^# fail 0\s*$' -or $taskText -notmatch '(?m)^# skipped 0\s*$' -or $taskText -notmatch '(?m)^# todo 0\s*$') { throw 'AC-070 incomplete unit execution' }
Write-Output 'AC-070 OK'
```

- 期望输出：退出码 0，TAP 汇总 tests 大于 0、fail/skipped/todo 均为 0，stdout 含 `AC-070 OK`。夹具范围及结果规则以 design.md 为准。

命令：独立启动离线门禁验证所有固定夹具入口；不依赖上一条命令的变量、临时文件或运行结果。

```pwsh
@'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const cases = [
  ['good', 0, null],
  ['node-alternative', 0, null],
  ['ci-fail', 1, 'AC-001'],
  ['baseline-skip', 1, 'AC-001'],
  ['wrong-os', 1, 'AC-027'],
  ['dry-run', 1, 'AC-038'],
  ['unredacted', 1, 'AC-038'],
  ['wrong-version', 1, 'AC-038'],
  ['unmapped-smoke', 1, 'AC-038'],
  ['smoke-fail', 1, 'AC-038'],
  ['mandatory-skip', 1, 'AC-038'],
  ['waived-missing-smoke', 0, 'AC-038'],
  ['waived-mandatory-skip', 1, 'AC-038'],
  ['non-real-waiver', 1, 'AC-001'],
  ['stale-waiver', 1, 'AC-038'],
  ['planned', 1, 'AC-001'],
  ['missing-smoke', 1, 'AC-038'],
  ['missing-manifest', 1, null],
  ['missing-reporter', 1, null],
  ['missing-skips', 1, null],
  ['filtered', 1, null],
  ['missing-executed-file', 1, 'AC-001'],
  ['missing-result', 1, 'AC-001'],
  ['malformed-report', 1, null],
  ['malformed-waivers', 1, null],
  ['missing-waivers', 1, null],
]
for (const [name, expected, ac] of cases) {
  const root = path.resolve('test/fixtures/release-gate', name)
  assert.ok(fs.statSync(root).isDirectory(), name)
  const result = spawnSync(process.execPath, [
    'scripts/release-gate.mjs', '--root', root,
    '--ci-artifacts', path.join(root, 'ci'),
    '--smoke-report', path.join(root, 'smoke.json'),
    '--waivers', path.join(root, 'release/waivers.json'),
  ], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
  assert.ifError(result.error)
  assert.equal(result.status, expected, `${name}: ${result.stdout}\n${result.stderr}`)
  const lines = result.stdout.trim().split(/\r?\n/)
  assert.equal(lines.at(-1), `release-gate: ${expected === 0 ? 'PASS' : 'BLOCKED'}`, name)
  if (expected !== 0) {
    assert.ok(lines.some(line => line.startsWith(ac ? `BLOCKED ${ac} ` : 'BLOCKED ')), name)
    assert.ok(lines.some(line => line.startsWith('BLOCKED ') && line.trim().split(/\s+/).length >= 3), name)
  } else {
    assert.ok(!lines.some(line => line.startsWith('BLOCKED ')), name)
    const index = JSON.parse(fs.readFileSync(path.join(root, 'contracts/spec/ac-index.json'), 'utf8'))
    for (const entry of index.acs) {
      const prefix = name === 'waived-missing-smoke' && entry.ac === 'AC-038' ? 'WAIVED' : 'PASS'
      assert.equal(lines.filter(line => line.startsWith(`${prefix} ${entry.ac} `)).length, 1, `${name}: ${entry.ac}`)
    }
    if (name === 'waived-missing-smoke') assert.ok(!lines.some(line => line.startsWith('PASS AC-038 ')), name)
    else assert.ok(!lines.some(line => line.startsWith('WAIVED ')), name)
  }
  console.log(`${name}: OK`)
}
assert.deepEqual(JSON.parse(fs.readFileSync('release/waivers.json', 'utf8')), [])
console.log('AC-070 OK')
'@ | & node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-070 fixture CLI failed' }
```

- 期望输出：退出码 0，26 个 case 分别输出 `<case>: OK`，最后打印 `AC-070 OK`。放行例逐 AC 有且仅有 PASS；有效豁免例的 AC-038 仅为 WAIVED；各负例退出 1、输出 BLOCKED 和可定位原因；正式豁免文件仍为空列表。每例须只改变 design.md 指定的判定条件，不能以无关损坏制造预期退出码。

命令：保留任务要求的全部单元回归。

```pwsh
node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'AC-070 unit regression failed' }
Write-Output 'AC-070 OK'
```

- 期望输出：退出码 0，全部单元测试通过，stdout 含 `AC-070 OK`。

## AC-071 全流程完整性与 M5 收口

命令：真实流程集成测试必须实际执行，禁止 skip/TODO 或零测试通过。

```pwsh
$taskOutput = @(& node --test --test-reporter=tap test/integration/flow-complete.test.mjs 2>&1)
$taskCode = $LASTEXITCODE
$taskOutput | Write-Output
if ($taskCode -ne 0) { throw 'AC-071 integration failed' }
$taskText = $taskOutput -join "`n"
if ($taskText -notmatch '(?m)^# tests [1-9][0-9]*\s*$' -or $taskText -notmatch '(?m)^# fail 0\s*$' -or $taskText -notmatch '(?m)^# skipped 0\s*$' -or $taskText -notmatch '(?m)^# todo 0\s*$') { throw 'AC-071 incomplete integration execution' }
Write-Output 'AC-071 OK'
```

- 期望输出：退出码 0、tests 大于 0、fail/skipped/todo 均为 0、stdout 含 `AC-071 OK`。集成测试验证九步及顺序、准确 introduced_by、一次完整运行共用哨兵、真实子进程 env 消费及清理前全表面扫描 0 命中；不得仅验证测试元数据。

命令：独立验证真实步骤集合、归属和同一次完整流程结果。

```pwsh
@'
import assert from 'node:assert/strict'
import { discoverSteps, createFlow, runFlow } from './test/helpers/flow.mjs'
import { leakScan } from './test/helpers/leak-scan.mjs'
const expected = [
  ['auth', 'T-013'], ['doctor', 'T-024'], ['discover', 'T-016'],
  ['enumerate', 'T-036'], ['probe', 'T-020'], ['select', 'T-022'],
  ['run', 'T-023'], ['http-select', 'T-024'], ['http-admin', 'T-024'],
]
const steps = await discoverSteps()
assert.deepEqual(steps.map(step => [step.name, step.mod.introduced_by]), expected)
const flow = createFlow()
const sentinel = flow.sentinel
try {
  const report = await runFlow({ flow })
  assert.deepEqual(report.results.map(step => [step.name, step.introduced_by]), expected)
  assert.ok(report.results.every(step => step.ok === true), 'flow step failed')
  assert.ok(flow.sentinel === sentinel && flow.sentinels[0].value === sentinel, 'sentinel changed')
  assert.ok(Object.values(flow.env).includes(sentinel), 'sentinel env missing')
  assert.equal(report.ok, true)
  assert.equal(report.leak.ok, true)
  assert.deepEqual(report.leak.hits, [])
  assert.deepEqual(report.leak.errors, [])
  const leak = leakScan({ sentinels: flow.sentinels, ...flow.captured,
    state_dir: flow.root, auditFile: `${flow.state_dir}/audit.jsonl` })
  assert.equal(leak.ok, true, 'flow leaked or scan failed')
  assert.deepEqual(leak.hits, [])
  assert.deepEqual(leak.errors, [])
  for (const surface of ['argv', 'stdout', 'http', 'files', 'audit']) {
    assert.ok(leak.scanned[surface] > 0, `not scanned: ${surface}`)
  }
  console.log('flow steps: 9; leak hits: 0')
} finally {
  flow.cleanup()
}
console.log('AC-071 OK')
'@ | & node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-071 real flow failed' }
```

- 期望输出：退出码 0，stdout 含 `flow steps: 9; leak hits: 0` 和 `AC-071 OK`，无哨兵值。缺 discover 等任一步、顺序/归属错误或泄漏均失败。当前 checkout 缺 discover.mjs，该命令应失败直到上游产物补齐。

命令：沿用既有里程碑门，验证 M5 全部 covered、完整运行及 11 条缺陷 fixed。

```pwsh
$taskOutput = @(& node scripts/milestone-gate.mjs --milestone M5 2>&1)
$taskCode = $LASTEXITCODE
$taskOutput | Write-Output
if ($taskCode -ne 0 -or ($taskOutput -join "`n") -notmatch '(?m)^milestone-gate M5: PASS\s*$') { throw 'AC-071 M5 blocked' }
Write-Output 'AC-071 OK'
```

- 期望输出：退出码 0，stdout 含 `milestone-gate M5: PASS` 和 `AC-071 OK`。失败须保留真实阻断原因，不能修改其他任务分片、只读步骤或缺陷规则以放行。

命令：执行仓库快速检查入口。

```pwsh
pwsh -NoProfile -File scripts/check-fast.ps1
if ($LASTEXITCODE -ne 0) { throw 'AC-071 check-fast failed' }
Write-Output 'AC-071 OK'
```

- 期望输出：退出码 0、stdout 含 `check-fast: ok` 和 `AC-071 OK`。

命令：独立检查本任务验收文档格式。

```pwsh
node scripts/check-acceptance.mjs .collab/tasks/030/acceptance.md
if ($LASTEXITCODE -ne 0) { throw 'AC-071 acceptance format failed' }
Write-Output 'AC-071 OK'
```

- 期望输出：退出码 0、stdout 含 `check-acceptance: ok`、`warnings=0` 和 `AC-071 OK`。本地夹具/M5 的通过不替代真实 CI 与 real-smoke 发布证据。
