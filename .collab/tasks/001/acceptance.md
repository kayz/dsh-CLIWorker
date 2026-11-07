# Task 001 验收标准

规格来源：`design.md`（本目录）与 brief。brief 没有给基准 commit 或既有验收报告，所以写域检查以 `HEAD` 为基准；蓝图任务图为 `.collab/blueprint/cliworker-v2/task-graph.json`。

执行环境：仓库根（`C:\git\dsh-CLIWorker\.collab\worktrees\001`），PowerShell 7（`pwsh`），Node 20 或更高。所有命令在同一个 pwsh 会话里依次执行，先执行 §0 的辅助函数。「期望」一栏写的是命令的输出或退出码，任一条不符即该条不通过。

## 0. 辅助函数（先执行一次）

```powershell
function Run { $out = & node @args 2>&1; [pscustomobject]@{ Exit = $LASTEXITCODE; Out = ($out | Out-String) } }
function NewTmp { $d = Join-Path ([IO.Path]::GetTempPath()) ('cw-acc-' + [guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $d | Out-Null; $d }
```

`Run` 返回 `Exit`（退出码）与 `Out`（stdout 加 stderr）。`NewTmp` 返回一个新的临时目录（在仓库之外）。

## 1. 通用要求

### V-01 写入范围

```powershell
$allowed = @('^package\.json$','^package-lock\.json$','^scripts/run-tests\.mjs$','^scripts/reporters/','^scripts/check-test-discovery\.mjs$','^scripts/check-fast\.mjs$','^scripts/check-fast\.ps1$','^scripts/check-traceability\.mjs$','^scripts/check-ci\.mjs$','^scripts/gen-ci\.mjs$','^scripts/ci-matrix\.json$','^scripts/milestone-gate\.mjs$','^scripts/check-defects\.mjs$','^contracts/spec/ac-index\.json$','^\.github/workflows/','^test/select\.test\.mjs$','^test/unit/select\.test\.mjs$','^test/unit/runner-selftest\.test\.mjs$','^test/unit/traceability\.test\.mjs$','^test/unit/milestone-gate\.test\.mjs$','^test/helpers/platform-gate\.mjs$','^test/fixtures/discovery-selftest/','^test/fixtures/traceability/','^test/fixtures/milestone-gate/','^test/characterization/defects/a3-runner\.test\.mjs$','^test/traceability/T-001\.json$')
git status --porcelain --untracked-files=all | ForEach-Object { $_.Substring(3) -replace ' -> .*','' } | Where-Object { $_ -notmatch '^\.collab/tasks/001/' } | Where-Object { $p = $_; -not ($allowed | Where-Object { $p -match $_ }) }
```

期望：无任何输出（`.collab/tasks/001/` 下是调度器产物，不计）。跑过 `npm test` 之后仓库里也不应多出 `test-results/` 之类的文件，同一命令再执行一次仍无输出。

### V-02 零第三方依赖与锁文件

```powershell
node -p "const p=require('./package.json'); ['dependencies','devDependencies','optionalDependencies','peerDependencies'].some(k=>k in p)"
node -p "JSON.stringify(Object.keys(require('./package-lock.json').packages))"
```

期望：第一条输出 `false`；第二条输出 `[""]`（锁文件只含根包）。

### V-03 `package.json` 的脚本

```powershell
node -p "JSON.stringify(require('./package.json').scripts)"
```

期望（逐字符一致）：`{"test":"node scripts/run-tests.mjs","check":"node scripts/check-fast.mjs","perf":"node scripts/run-tests.mjs --perf","snapshot:update":"node scripts/run-tests.mjs --update-snapshots"}`

### V-04 编码

```powershell
git status --porcelain --untracked-files=all | ForEach-Object { $_.Substring(3) } | Where-Object { $_ -match '\.(mjs|json|ps1|yml|md)$' -and $_ -notmatch '^\.collab/' -and (Test-Path $_ -PathType Leaf) } | Where-Object { $b = [IO.File]::ReadAllBytes($_); ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) -or ([Text.Encoding]::UTF8.GetString($b) -match "`r") }
```

期望：无任何输出（没有带 BOM 或含 CR 的新文本文件）。

### V-05 select 测试迁入

```powershell
Test-Path test/select.test.mjs
Test-Path test/unit/select.test.mjs
node --test test/unit/select.test.mjs; $LASTEXITCODE
```

期望：依次输出 `False`、`True`，第三条测试全部通过，最后一行输出 `0`。

## 2. AC-001：运行器、完整与过滤模式

### A1-01 完整运行

```powershell
$o = NewTmp
npm test; $LASTEXITCODE
$r = Run scripts/run-tests.mjs --out-dir $o; $r.Exit; $r.Out -match 'run-tests: full'
```

期望：`npm test` 的退出码为 `0`；第二段输出 `0`、`True`。

### A1-02 完整运行的清单

```powershell
node -p "const m=require(process.argv[1]); [m.mode, m.filter, m.files.length>0, m.files.includes('test/unit/select.test.mjs'), m.files.includes('test/characterization/defects/a3-runner.test.mjs'), m.files.some(f=>/^test\/(fixtures|helpers|perf)\//.test(f)), Object.keys(m).sort().join(',')].join('|')" "$o/files-executed.json"
Test-Path "$o/skips.jsonl"
```

期望：第一条输出 `full||true|true|true|false|files,filter,mode,node,platform`；第二条输出 `True`（`skips.jsonl` 即使没有跳过也存在）。

### A1-03 过滤运行

```powershell
$r = Run scripts/run-tests.mjs --ac AC-074 --out-dir $o; $r.Exit
node -p "const m=require(process.argv[1]); [m.mode, m.filter, m.files.join(',')].join('|')" "$o/files-executed.json"
```

期望：第一条输出 `0`；第二条输出 `filtered|AC-074|test/unit/milestone-gate.test.mjs`。

### A1-04 过滤运行的参数错误

```powershell
$r = Run scripts/run-tests.mjs --ac foo --out-dir $o; $r.Exit
$r = Run scripts/run-tests.mjs --ac AC-999 --out-dir $o; $r.Exit; $r.Out -match 'run\.no_match'
```

期望：依次输出 `2`、`1`、`True`（找不到测试时不得以 0 退出）。

### A1-05 夹具：完整运行当场校验，诱饵文件不被执行

```powershell
$r = Run scripts/run-tests.mjs --root test/fixtures/discovery-selftest/ok --out-dir $o; $r.Exit
node -p "const m=require(process.argv[1]); [m.mode, m.files.join(',')].join('|')" "$o/files-executed.json"
```

期望：第一条输出 `0`（`test/fixtures`、`test/helpers`、`test/perf` 下的诱饵测试若被执行会使运行失败）；第二条输出 `full|test/flows/c.test.mjs,test/integration/b.test.mjs,test/unit/a.test.mjs`。

### A1-06 夹具：过滤运行不做相等比较

```powershell
$r = Run scripts/run-tests.mjs --root test/fixtures/discovery-selftest/ok --ac AC-001 --out-dir $o; $r.Exit
node -p "const m=require(process.argv[1]); [m.mode, m.filter, m.files.join(',')].join('|')" "$o/files-executed.json"
```

期望：输出 `0`，然后 `filtered|AC-001|test/unit/a.test.mjs`。

### A1-07 夹具：孤儿测试文件

```powershell
$r = Run scripts/run-tests.mjs --root test/fixtures/discovery-selftest/orphan --out-dir $o; $r.Exit; $r.Out -match 'discovery\.orphan'; $r.Out -match 'test/loose\.test\.mjs'
```

期望：依次输出 `1`、`True`、`True`。

### A1-08 `check-test-discovery` 完整自测

```powershell
$r = Run scripts/check-test-discovery.mjs; $r.Exit; $r.Out -match 'check-test-discovery: ok'
```

期望：依次输出 `0`、`True`。

### A1-09 `check-test-discovery` 能检出不一致，过滤清单不能顶替完整清单

```powershell
$d = 'test/fixtures/discovery-selftest/drift'
foreach ($c in @(@('manifest-ok.json',0,$null), @('manifest-missing.json',1,'discovery\.missing'), @('manifest-extra.json',1,'discovery\.unexpected'), @('manifest-filtered.json',1,'discovery\.mode_not_full'))) {
  $r = Run scripts/check-test-discovery.mjs --root $d --manifest "$d/$($c[0])"
  "$($c[0]) exit=$($r.Exit) ok=$(($r.Exit -eq $c[1]) -and ($null -eq $c[2] -or $r.Out -match $c[2]))"
}
```

期望（四行，顺序一致）：
```
manifest-ok.json exit=0 ok=True
manifest-missing.json exit=1 ok=True
manifest-extra.json exit=1 ok=True
manifest-filtered.json exit=1 ok=True
```

### A1-10 `--ac AC-001` 命中自测文件

```powershell
$r = Run scripts/run-tests.mjs --ac AC-001 --out-dir $o; $r.Exit
node -p "const m=require(process.argv[1]); m.mode+'|'+m.files.includes('test/unit/runner-selftest.test.mjs')" "$o/files-executed.json"
```

期望：输出 `0`，然后 `filtered|true`。

### A1-11 嵌套运行不覆盖父运行产物

```powershell
$env:CLIWORKER_RUN_ACTIVE = '1'; $env:CLIWORKER_RESULTS_DIR = $o
$r = Run scripts/run-tests.mjs --ac AC-074 --out-dir $o; $r.Exit
Remove-Item Env:CLIWORKER_RUN_ACTIVE, Env:CLIWORKER_RESULTS_DIR
```

期望：输出 `2`。

### A1-12 `perf` 脚本

```powershell
npm run perf; $LASTEXITCODE
```

期望：退出码 `0`，输出含 `no perf tests`（`test/perf` 暂不存在）。该命令不得写 `files-executed.json`。

### A1-13 平台门控的跳过记录格式

```powershell
Select-String -Path test/helpers/platform-gate.mjs -SimpleMatch 'cliworker.skip/v1','platformTest','recordSkip','satisfies' | Select-Object -ExpandProperty Pattern -Unique | Sort-Object
```

期望：输出 `cliworker.skip/v1`、`platformTest`、`recordSkip`、`satisfies` 四行（每个至少出现一次）。skip 记录的字段内容由 `runner-selftest` 中的 `[AC-001]` 测试断言，A1-10 已运行它。

## 3. AC-002：CI 矩阵

### A2-01 `check-ci` 通过

```powershell
$r = Run scripts/check-ci.mjs; $r.Exit; $r.Out -match 'check-ci: ok'
```

期望：依次输出 `0`、`True`。

### A2-02 矩阵内容

```powershell
node -p "const m=require('./scripts/ci-matrix.json'); [m.os.map(o=>o.name).join(','), m.node.join(','), m.check_command, m.artifacts.join(','), m.perf.blocking].join('|')"
```

期望：输出 `ubuntu,windows,macos|20,22|npm run check|files-executed.json,skips.jsonl|false`。

### A2-03 生成物里的关键内容

```powershell
$y = '.github/workflows/ci.yml'
foreach ($s in 'continue-on-error: true','npm run check','actions/upload-artifact@v4','ubuntu-latest','windows-latest','macos-latest','files-executed.json','skips.jsonl','CLIWORKER_RESULTS_DIR') { "$s => " + ((Select-String -Path $y -SimpleMatch $s).Count -ge 1) }
(Select-String -Path $y -SimpleMatch 'continue-on-error: true').Count
(Select-String -Path $y -SimpleMatch 'needs:').Count
```

期望：前九行的右侧都是 `True`；随后输出 `1`（只有 perf 作业不阻断）、`0`（没有作业依赖别的作业，perf 也不被依赖）。

### A2-04 篡改检测

```powershell
$t = NewTmp
New-Item -ItemType Directory "$t/scripts","$t/.github/workflows" | Out-Null
Copy-Item scripts/ci-matrix.json "$t/scripts/"; Copy-Item .github/workflows/ci.yml "$t/.github/workflows/"
$r = Run scripts/check-ci.mjs --root $t; "clean: $($r.Exit)"
Add-Content "$t/.github/workflows/ci.yml" '# x'
$r = Run scripts/check-ci.mjs --root $t; "stale: $($r.Exit) $($r.Out -match 'ci\.stale')"
Copy-Item .github/workflows/ci.yml "$t/.github/workflows/ci.yml" -Force
$m = Get-Content -Raw scripts/ci-matrix.json | ConvertFrom-Json; $m.perf.blocking = $true
$m | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8NoBOM "$t/scripts/ci-matrix.json"
$r = Run scripts/check-ci.mjs --root $t; "blocking: $($r.Exit) $($r.Out -match 'ci\.matrix_invalid')"
$m = Get-Content -Raw scripts/ci-matrix.json | ConvertFrom-Json; $m.node = @(20)
$m | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8NoBOM "$t/scripts/ci-matrix.json"
$r = Run scripts/check-ci.mjs --root $t; "node: $($r.Exit) $($r.Out -match 'ci\.matrix_invalid')"
```

期望（四行）：
```
clean: 0
stale: 1 True
blocking: 1 True
node: 1 True
```

## 4. AC-003：check-fast 与 pwsh 包装

### A3-01 注入失败步骤：node 入口立即停止并透传退出码

```powershell
$f = NewTmp; $log = Join-Path $f 'log.txt'
Set-Content -Encoding utf8NoBOM "$f/check-a.mjs" "import fs from 'node:fs'; fs.appendFileSync(process.env.CW_LOG, 'a\n')"
Set-Content -Encoding utf8NoBOM "$f/check-b.mjs" "import fs from 'node:fs'; fs.appendFileSync(process.env.CW_LOG, 'b\n'); process.exit(7)"
Set-Content -Encoding utf8NoBOM "$f/check-c.mjs" "import fs from 'node:fs'; fs.appendFileSync(process.env.CW_LOG, 'c\n')"
Set-Content -Encoding utf8NoBOM "$f/final.mjs" "import fs from 'node:fs'; fs.appendFileSync(process.env.CW_LOG, 'final\n')"
$env:CW_LOG = $log; $env:CLIWORKER_TEST_CHECK_DIR = $f; $env:CLIWORKER_TEST_FINAL_SCRIPT = "$f/final.mjs"
$r = Run scripts/check-fast.mjs
"exit=$($r.Exit) names=$($r.Out -match 'check-b\.mjs') log=$((Get-Content $log) -join ',')"
```

期望：`exit=7 names=True log=a,b`（`check-c` 与最后一步都没有执行；输出里含失败步骤名 `check-b.mjs`）。

### A3-02 同一注入：pwsh 入口以同一个码退出

```powershell
pwsh -NoProfile -File scripts/check-fast.ps1; $LASTEXITCODE
```

期望：命令输出里含 `check-b.mjs`，最后一行输出 `7`（与 A3-01 的 node 入口同码；此时环境变量沿用 A3-01 设置的值）。

### A3-03 全部成功：字母序，不含自身，最后跑最后一步

```powershell
Remove-Item $log
Set-Content -Encoding utf8NoBOM "$f/check-b.mjs" "import fs from 'node:fs'; fs.appendFileSync(process.env.CW_LOG, 'b\n')"
Set-Content -Encoding utf8NoBOM "$f/check-fast.mjs" "import fs from 'node:fs'; fs.appendFileSync(process.env.CW_LOG, 'SELF\n')"
$r = Run scripts/check-fast.mjs
"exit=$($r.Exit) log=$((Get-Content $log) -join ',')"
```

期望：`exit=0 log=a,b,c,final`（注入目录里名为 `check-fast.mjs` 的文件不被执行，最后一步在所有 check 之后）。

### A3-04 清理注入变量

```powershell
Remove-Item Env:CW_LOG, Env:CLIWORKER_TEST_CHECK_DIR, Env:CLIWORKER_TEST_FINAL_SCRIPT
```

期望：无输出。之后 A3-05 及以后的命令必须在没有这些变量的环境里执行。

### A3-05 pwsh 包装只有一层 node 调用

```powershell
(Get-Content scripts/check-fast.ps1 | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') }).Count -le 3
(Select-String -Path scripts/check-fast.ps1 -SimpleMatch '$LASTEXITCODE').Count -ge 1
(Select-String -Path scripts/check-fast.ps1 -SimpleMatch 'check-fast.mjs').Count -ge 1
```

期望：依次输出 `True`、`True`、`True`。

### A3-06 真实运行

```powershell
pwsh -NoProfile -File scripts/check-fast.ps1; $LASTEXITCODE
npm run check; $LASTEXITCODE
```

期望：两次退出码都为 `0`；输出里可见按字母序的 `==> check-ci.mjs`、`==> check-defects.mjs`、`==> check-test-discovery.mjs`、`==> check-traceability.mjs`，之后是 `==> npm test`，最后一行 `check-fast: ok`；输出里没有 `==> check-fast.mjs`。

## 5. AC-004：AC 索引与追踪合并

### A4-01 真实仓库通过

```powershell
$r = Run scripts/check-traceability.mjs; $r.Exit; ($r.Out -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1).Trim()
```

期望：输出 `0`，然后 `check-traceability: ok (covered=5 planned=69)`（本工作树只有 T-001 的分片，覆盖 AC-001、002、003、004、074）。

### A4-02 与任务图交叉校验

```powershell
$r = Run scripts/check-traceability.mjs --task-graph .collab/blueprint/cliworker-v2/task-graph.json; $r.Exit; $r.Out -match 'graph\.mismatch'
```

期望：依次输出 `0`、`False`（owner、milestone、levels 与任务图一致）。

### A4-03 索引内容

```powershell
node -p "const a=require('./contracts/spec/ac-index.json').acs; const g=i=>a.find(x=>x.ac===i); [a.length,a[0].ac,a[73].ac,g('AC-001').baseline,g('AC-027').baseline,g('AC-033').baseline,g('AC-038').baseline,g('AC-069').baseline,g('AC-074').owner,g('AC-026').milestone,g('AC-055').milestone,g('AC-072').milestone,g('AC-008').levels,g('AC-038').levels].join('|')"
```

期望：输出 `74|AC-001|AC-074|darwin,linux,win32|win32|linux|real-smoke|linux|T-001|M2|M4|M1|contract,integration|smoke`。

### A4-04 索引文件的键与 schema

```powershell
node -p "const x=require('./contracts/spec/ac-index.json'); [x.schema, Object.keys(x).join(','), Object.keys(x.acs[0]).join(','), new Set(x.acs.map(a=>a.ac)).size].join('|')"
```

期望：输出 `cliworker.ac-index/v1|schema,acs|ac,owner,milestone,levels,baseline|74`。

### A4-05 夹具：四种分片失败与通过用例

```powershell
$b = 'test/fixtures/traceability'
foreach ($c in @(@('ok',0,$null), @('duplicate',1,'shard\.duplicate'), @('not-owner',1,'shard\.not_owner'), @('missing-file',1,'shard\.missing_file'), @('missing-title',1,'shard\.missing_title'), @('baseline-in-shard',1,'shard\.baseline_forbidden'))) {
  $r = Run scripts/check-traceability.mjs --root "$b/$($c[0])" --index "$b/ac-index.json"
  "$($c[0]) exit=$($r.Exit) ok=$(($r.Exit -eq $c[1]) -and ($null -eq $c[2] -or $r.Out -match $c[2]))"
}
```

期望（六行）：
```
ok exit=0 ok=True
duplicate exit=1 ok=True
not-owner exit=1 ok=True
missing-file exit=1 ok=True
missing-title exit=1 ok=True
baseline-in-shard exit=1 ok=True
```

### A4-06 `--json` 输出结构

```powershell
$r = Run scripts/check-traceability.mjs --root "$b/duplicate" --index "$b/ac-index.json" --json
($r.Out | ConvertFrom-Json) | ForEach-Object { "$($_.ok)|$(($_.errors | ForEach-Object { $_.id } | Sort-Object -Unique) -join ',')" }
```

期望：输出 `False|shard.duplicate,shard.not_owner`。

### A4-07 自测文件覆盖了索引自身的失败

```powershell
foreach ($s in 'index.count','index.owner','index.milestone','index.levels','index.baseline','index.baseline_incompatible','index.schema','shard.missing_title') { "$s => " + ((Select-String -Path test/unit/traceability.test.mjs -SimpleMatch $s).Count -ge 1) }
$r = Run scripts/run-tests.mjs --ac AC-004 --out-dir $o; $r.Exit
node -p "const m=require(process.argv[1]); m.mode+'|'+m.files.join(',')" "$o/files-executed.json"
```

期望：前八行右侧都是 `True`；然后输出 `0`，最后输出 `filtered|test/unit/traceability.test.mjs`。

### A4-08 脚本不引用 `.collab`

```powershell
Select-String -Path scripts/*.mjs,scripts/reporters/*.mjs,test/helpers/platform-gate.mjs,test/unit/*.test.mjs -SimpleMatch '.collab' | Measure-Object | Select-Object -ExpandProperty Count
```

期望：输出 `0`（任务图路径只能经 `--task-graph` 参数传入）。

## 6. AC-074：milestone-gate 与 check-defects

### A74-01 自测通过

```powershell
$r = Run scripts/run-tests.mjs --ac AC-074 --out-dir $o; $r.Exit
```

期望：输出 `0`。

### A74-02 夹具 `m2-planned`：M1 通过，M2 阻断

```powershell
$f = 'test/fixtures/milestone-gate/m2-planned'
$r = Run scripts/milestone-gate.mjs --milestone M1 --root $f; "M1 exit=$($r.Exit) pass=$($r.Out -match 'milestone-gate M1: PASS')"
$r = Run scripts/milestone-gate.mjs --milestone M2 --root $f; "M2 exit=$($r.Exit) blocked=$($r.Out -match 'milestone-gate M2: BLOCKED') ac=$($r.Out -match 'gate\.ac_not_covered[^\n]*AC-026') defect=$($r.Out -match 'defects\.missing_fixed[^\n]*a5-shell')"
```

期望：
```
M1 exit=0 pass=True
M2 exit=1 blocked=True ac=True defect=True
```

### A74-03 夹具 `m4-nocache`：M3 通过，M4 阻断且只因缺陷

```powershell
$f = 'test/fixtures/milestone-gate/m4-nocache'
$r = Run scripts/milestone-gate.mjs --milestone M3 --root $f; "M3 exit=$($r.Exit) pass=$($r.Out -match 'milestone-gate M3: PASS')"
$r = Run scripts/milestone-gate.mjs --milestone M4 --root $f; "M4 exit=$($r.Exit) blocked=$($r.Out -match 'milestone-gate M4: BLOCKED') defect=$($r.Out -match 'defects\.missing_fixed[^\n]*a5-nocache') noac=$(-not ($r.Out -match 'gate\.ac_not_covered'))"
```

期望：
```
M3 exit=0 pass=True
M4 exit=1 blocked=True defect=True noac=True
```

### A74-04 check-defects 默认模式不提前误报

```powershell
$r = Run scripts/check-defects.mjs --root test/fixtures/milestone-gate/m2-planned; "m2-planned default exit=$($r.Exit)"
$r = Run scripts/check-defects.mjs --root test/fixtures/milestone-gate/m4-nocache; "m4-nocache default exit=$($r.Exit) missing=$($r.Out -match 'defects\.missing_fixed[^\n]*a5-nocache')"
```

期望：
```
m2-planned default exit=0
m4-nocache default exit=1 missing=True
```
（前者的 AC-026 仍是 planned，所以 a5-shell 不要求 `[fixed]`；后者的 AC-055 已 covered，却没有 `[fixed]`。）

### A74-05 `--milestone` 模式按归属里程碑要求

```powershell
$f = 'test/fixtures/milestone-gate/m2-planned'
foreach ($m in 'M1','M2','M5') { $r = Run scripts/check-defects.mjs --milestone $m --root $f; "$m exit=$($r.Exit) set=$($r.Out -match 'defects\.set_mismatch') missing=$($r.Out -match 'defects\.missing_fixed')" }
$r = Run scripts/check-defects.mjs --milestone M9 --root $f; "M9 exit=$($r.Exit)"
```

期望：
```
M1 exit=0 set=False missing=False
M2 exit=1 set=False missing=True
M5 exit=1 set=True missing=True
M9 exit=2
```

### A74-06 门禁必须给 `--milestone`

```powershell
$r = Run scripts/milestone-gate.mjs --root test/fixtures/milestone-gate/m2-planned; $r.Exit
```

期望：输出 `2`。

### A74-07 真实仓库的过渡态（仅当 `test/characterization/defects.json` 不存在时适用）

```powershell
if (-not (Test-Path test/characterization/defects.json)) {
  $r = Run scripts/check-defects.mjs; "default exit=$($r.Exit)"
  $r = Run scripts/check-defects.mjs --milestone M1; "M1 exit=$($r.Exit) file=$($r.Out -match 'defects\.file_missing')"
} else { 'n/a' }
```

期望：账本不存在时输出 `default exit=0` 与 `M1 exit=1 file=True`；账本已存在时输出 `n/a`。

### A74-08 a3-runner 的缺陷文件

```powershell
node --test test/characterization/defects/a3-runner.test.mjs; $LASTEXITCODE
foreach ($s in '[repro] ','[fixed] ') { "$s => " + ((Select-String -Path test/characterization/defects/a3-runner.test.mjs -SimpleMatch $s).Count -ge 1) }
```

期望：测试全部通过，退出码 `0`；随后两行右侧都是 `True`（标题里至少各有一条以 `[repro] `、`[fixed] ` 开头的测试）。

## 7. 追踪分片与整体回归

### T-01 T-001 分片

```powershell
node -p "const s=require('./test/traceability/T-001.json'); [s.task, s.milestone, JSON.stringify(Object.keys(s)), s.entries.map(e=>e.ac+':'+e.status+':'+e.files.join('+')).join(';'), s.entries.some(e=>'baseline' in e)].join('|')"
```

期望：输出 `T-001|M1|["task","milestone","entries"]|AC-001:covered:test/unit/runner-selftest.test.mjs;AC-002:covered:test/unit/runner-selftest.test.mjs;AC-003:covered:test/unit/runner-selftest.test.mjs;AC-004:covered:test/unit/traceability.test.mjs;AC-074:covered:test/unit/milestone-gate.test.mjs|false`。

### T-02 全量回归

```powershell
npm test; $LASTEXITCODE
npm run check; $LASTEXITCODE
```

期望：两次退出码都是 `0`；`npm test` 的输出中没有 `# fail` 之外的非零失败计数（即 `# fail 0`），`# skipped` 只允许是 pwsh 不可用等平台门控造成的跳过，且每个跳过都在 `skips.jsonl` 里有一条记录。

### T-03 回归后工作区仍然干净

重新执行 V-01 的命令。期望：无任何输出。
