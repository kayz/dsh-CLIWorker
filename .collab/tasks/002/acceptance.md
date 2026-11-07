# T-002 验收标准

对应 AC-005（levels: unit）。所有命令在仓库根（`C:\git\dsh-CLIWorker\.collab\worktrees\002`）用 `pwsh -NoProfile` 执行，Node ≥ 20。基准提交：`f75bb76`（0.1 副本的来源）。brief 没有给出既有验收报告路径。

格式约定（与 `ci-runner.ps1` 的解析规则一致）：每个用例是一个 `### <编号> <标题>` 小节，编号形如 `A1`、`B3`、`D4`（字母 + 数字），小节下只有一个 ```powershell 代码块且其首行就是可执行命令；断言写成紧随其后的项目符号。每个脚本在全部断言成立时打印 `<编号> OK` 并以退出码 0 结束，否则以非 0 退出。脚本自包含，不依赖任何前置小节定义的函数或变量。

## 1. 总入口

### A1 过滤运行 AC-005

```powershell
$out = (node scripts/run-tests.mjs --ac AC-005 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "run-tests --ac AC-005 exited $code" }
if ($out -notmatch 'run-tests: filtered ') { throw 'stdout is missing run-tests: filtered' }
if ($out.Contains('FAIL')) { throw 'stdout contains FAIL' }
$cross = [string][char]0x2716
if ($out.Contains($cross)) { throw 'stdout contains the failure mark' }
$titles = @(
  '[AC-005] stable: deprecated models are never candidates',
  '[AC-005] stable: unverified identity is rejected unless require_verified is false',
  '[AC-005] stable: level filter rejects other levels',
  '[AC-005] stable: exclude wins and reports excluded',
  '[AC-005] stable: the four schema names',
  '[AC-005] stable: imports only the v0.1 copy',
  '[AC-005] frozen: untouched fixture root passes',
  '[AC-005] frozen: changing one registered byte fails with frozen.hash_mismatch',
  '[AC-005] frozen: CRLF checkout of a registered file still passes',
  '[AC-005] frozen: lib/, bin/ and config/ paths are rejected as frozen.forbidden_path',
  '[AC-005] frozen: scripts/ and other unlisted paths fail with frozen.outside_allowed',
  '[AC-005] frozen: contracts/spec and contracts/golden paths are allowed',
  '[AC-005] frozen: unregistered file in the v0.1 copy fails with frozen.unregistered',
  '[AC-005] frozen: missing registered file fails with frozen.file_missing',
  '[AC-005] frozen: path traversal and absolute paths are rejected',
  '[AC-005] defects: well-formed fixture ledger passes',
  '[AC-005] defects: repro edited after registration fails with defects.repro_changed',
  '[AC-005] defects: canary that still passes fails with defects.canary_survived',
  '[AC-005] defects: missing canary fails with defects.canary_missing',
  '[AC-005] defects: repro failing on the unmodified copy fails with defects.repro_baseline_failed',
  '[AC-005] defects: a repro that cannot even load is not counted as a canary hit'
)
foreach ($title in $titles) { if (-not $out.Contains($title)) { throw "missing title: $title" } }
$repros = [regex]::Matches($out, '\[repro\] \[AC-005\]').Count
if ($repros -lt 10) { throw "expected 10 repro titles, found $repros" }
'A1 OK'
exit 0
```

- 退出码 0。
- stdout 含 `run-tests: filtered `，不含 `FAIL`、不含 `✖`。
- 上面 21 个标题子串全部出现（各对应一个 `✔`）。
- stdout 含 10 个以 `[repro] [AC-005]` 开头的标题（a3-runner 的 `[repro]` 不带 `[AC-005]` 标签，由 A5 覆盖）。

### A2 冻结检查（真实仓库）

```powershell
$out = (node scripts/check-frozen-files.mjs 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "check-frozen-files exited $code" }
$m = [regex]::Match($out, '(?m)^check-frozen-files: ok \((\d+) files\)\s*$')
if (-not $m.Success) { throw 'stdout does not match check-frozen-files: ok (<N> files)' }
if ([int]$m.Groups[1].Value -lt 8) { throw "registered file count $($m.Groups[1].Value) is below 8" }
'A2 OK'
exit 0
```

- 退出码 0。
- stdout 匹配 `^check-frozen-files: ok \(\d+ files\)$`，且其中数字 ≥ 8（副本 7 个 + stable.test.mjs）。

### A3 缺陷检查（真实仓库，严格模式，含 canary）

```powershell
$out = (node scripts/check-defects.mjs 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "check-defects exited $code" }
if (-not $out.Contains('check-defects: ok')) { throw 'stdout is missing check-defects: ok' }
if ($out.Contains('FAIL')) { throw 'stdout contains FAIL' }
if ($out.Contains('absent')) { throw 'stdout contains absent' }
'A3 OK'
exit 0
```

- 退出码 0。
- stdout 恰含 `check-defects: ok`，不含 `FAIL`、不含 `absent`。

### A4 check-fast 执行了这两项检查

```powershell
$out = (node scripts/check-fast.mjs 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "check-fast exited $code" }
foreach ($needle in @('==> check-defects.mjs', '==> check-frozen-files.mjs', '==> npm test')) {
  if (-not $out.Contains($needle)) { throw "missing step marker: $needle" }
}
$lines = $out.TrimEnd() -split "\r?\n"
if ($lines[-1] -ne 'check-fast: ok') { throw "last line is '$($lines[-1])'" }
'A4 OK'
exit 0
```

- 退出码 0。
- stdout 含 `==> check-defects.mjs`、`==> check-frozen-files.mjs`、`==> npm test`，最后一行 `check-fast: ok`。

### A5 完整测试

```powershell
$out = (node scripts/run-tests.mjs 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "run-tests exited $code" }
if ($out -notmatch 'run-tests: full ') { throw 'stdout is missing run-tests: full' }
if ($out.Contains('FAIL')) { throw 'stdout contains FAIL' }
$cross = [string][char]0x2716
if ($out.Contains($cross)) { throw 'stdout contains the failure mark' }
if (-not $out.Contains('[repro] 0.1 has no test script')) { throw 'missing the a3-runner repro title' }
$repros = [regex]::Matches($out, '\[repro\] \[AC-005\]').Count
if ($repros -lt 10) { throw "expected 10 repro titles, found $repros" }
'A5 OK'
exit 0
```

- 退出码 0；stdout 含 `run-tests: full `，不含 `FAIL`、`✖`。
- stdout 含 `[repro] 0.1 has no test script`（a3-runner）以及另外 10 个以 `[repro] [AC-005]` 开头的标题。

## 2. 副本逐字节与冻结清单

### B1 副本与 f75bb76 的 blob 一致，且文件集合恰好是 7 个

```powershell
$out = (node -e "const cp=require('child_process'),fs=require('fs'),c=require('crypto');const norm=b=>c.createHash('sha256').update(b.toString('latin1').replace(/\r\n/g,'\n'),'latin1').digest('hex');const want=cp.execFileSync('git',['ls-tree','-r','--name-only','f75bb76','--','lib','config/cliworker.example.json']).toString().split(/\r?\n/).filter(Boolean).sort();const dir='test/fixtures/characterization/v0.1/';const have=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;e.isDirectory()?w(p):have.push(p.slice(dir.length))}})(dir.slice(0,-1));have.sort();let bad=JSON.stringify(want)!==JSON.stringify(have)?1:0;if(bad)console.log('SET',want,have);for(const p of want){const g=norm(cp.execFileSync('git',['cat-file','blob','f75bb76:'+p]));const f=norm(fs.readFileSync(dir+p));if(g!==f){bad++;console.log('DIFF',p)}}console.log(bad?'FAIL':'ok '+want.length);process.exit(bad?1:0)" 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "byte comparison exited ${code}: $($out.Trim())" }
if ($out.Trim() -ne 'ok 7') { throw "expected 'ok 7', got '$($out.Trim())'" }
'B1 OK'
exit 0
```

- 退出码 0，stdout 恰为 `ok 7`（内部用 `git cat-file blob` 取原始字节，不经 PowerShell 管道）。

### B2 frozen-files.json 的形状与允许集合

```powershell
$out = (node -e "const j=require('./test/characterization/frozen-files.json');const p=j.files.map(f=>f.path);const allowed=x=>x.startsWith('test/fixtures/characterization/v0.1/')||x==='test/characterization/stable.test.mjs'||x.startsWith('contracts/spec/')||x.startsWith('contracts/golden/');const ok=Object.keys(j).sort().join()==='files,source_commit'&&j.source_commit==='f75bb76'&&p.every(allowed)&&!p.some(x=>/^(lib|bin|config|scripts)\//i.test(x))&&p.includes('test/characterization/stable.test.mjs')&&p.filter(x=>x.startsWith('test/fixtures/characterization/v0.1/')).length===7&&new Set(p).size===p.length&&j.files.every(f=>Object.keys(f).sort().join()==='path,sha256'&&/^[0-9a-f]{64}$/.test(f.sha256));console.log(ok?'ok '+p.length:'FAIL');process.exit(ok?0:1)" 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "frozen-files.json shape check exited ${code}: $($out.Trim())" }
if ($out.Trim() -notmatch '^ok \d+$') { throw "unexpected output: '$($out.Trim())'" }
'B2 OK'
exit 0
```

- 退出码 0，stdout 匹配 `^ok \d+$`。
- 键恰为 `files`、`source_commit`；`source_commit` 为 `f75bb76`；每条只有 `path`、`sha256`；路径去重且全部落在允许集合内；副本 7 个且 `stable.test.mjs` 已登记。

### B3 篡改一个登记文件的字节 → 检查失败

```powershell
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-frozen-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
try {
  Copy-Item -Recurse test, contracts -Destination $t
  Add-Content -Path (Join-Path $t 'test/fixtures/characterization/v0.1/lib/select.mjs') -Value '// tamper' -Encoding utf8NoBOM
  $out = (node scripts/check-frozen-files.mjs --root $t 2>&1 | Out-String)
  $code = $LASTEXITCODE
  if ($code -ne 1) { throw "expected exit code 1, got $code" }
  if (-not $out.Contains('FAIL frozen.hash_mismatch test/fixtures/characterization/v0.1/lib/select.mjs')) { throw 'missing frozen.hash_mismatch line' }
  if (-not $out.Contains('check-frozen-files: FAILED (1 errors)')) { throw 'missing FAILED summary' }
} finally {
  Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
}
'B3 OK'
exit 0
```

- 在临时副本上做，不动仓库。
- 退出码 1；stdout 含 `FAIL frozen.hash_mismatch test/fixtures/characterization/v0.1/lib/select.mjs` 和 `check-frozen-files: FAILED (1 errors)`。

### B4 登记 lib/、bin/、config/、scripts/ 路径 → 检查失败

```powershell
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-frozen-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
try {
  Copy-Item -Recurse test, contracts -Destination $t
  node -e "const fs=require('fs');const f=process.argv[1]+'/test/characterization/frozen-files.json';const j=JSON.parse(fs.readFileSync(f,'utf8'));const h='0'.repeat(64);for(const p of ['lib/select.mjs','bin/cliworker.mjs','config/cliworker.example.json','scripts/run-tests.mjs'])j.files.push({path:p,sha256:h});fs.writeFileSync(f,JSON.stringify(j,null,2))" $t
  $out = (node scripts/check-frozen-files.mjs --root $t 2>&1 | Out-String)
  $code = $LASTEXITCODE
  if ($code -ne 1) { throw "expected exit code 1, got $code" }
  foreach ($line in @(
    'FAIL frozen.forbidden_path lib/select.mjs',
    'FAIL frozen.forbidden_path bin/cliworker.mjs',
    'FAIL frozen.forbidden_path config/cliworker.example.json',
    'FAIL frozen.outside_allowed scripts/run-tests.mjs'
  )) { if (-not $out.Contains($line)) { throw "missing line: $line" } }
  if (-not $out.Contains('check-frozen-files: FAILED (4 errors)')) { throw 'missing FAILED summary' }
} finally {
  Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
}
'B4 OK'
exit 0
```

- 退出码 1；stdout 含四条 `FAIL` 行（顺序不限：`lib/`、`bin/`、`config/` 为 `frozen.forbidden_path`，`scripts/` 为 `frozen.outside_allowed`）。
- stdout 含 `check-frozen-files: FAILED (4 errors)`。

### B5 副本里多出一个未登记文件 → 检查失败

```powershell
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-frozen-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
try {
  Copy-Item -Recurse test, contracts -Destination $t
  Set-Content -Path (Join-Path $t 'test/fixtures/characterization/v0.1/README.md') -Value 'x' -Encoding utf8NoBOM
  $out = (node scripts/check-frozen-files.mjs --root $t 2>&1 | Out-String)
  $code = $LASTEXITCODE
  if ($code -ne 1) { throw "expected exit code 1, got $code" }
  if (-not $out.Contains('FAIL frozen.unregistered test/fixtures/characterization/v0.1/README.md')) { throw 'missing frozen.unregistered line' }
} finally {
  Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
}
'B5 OK'
exit 0
```

- 退出码 1；stdout 含 `FAIL frozen.unregistered test/fixtures/characterization/v0.1/README.md`。

### B6 未知参数

```powershell
$out = (node scripts/check-frozen-files.mjs --bogus 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 2) { throw "expected exit code 2, got $code" }
'B6 OK'
exit 0
```

- 退出码 2，stderr 含 `unknown argument: --bogus`。

## 3. stable.test.mjs 只依赖副本

### C1 所有相对 import 都指向副本

```powershell
$out = (node -e "const s=require('fs').readFileSync('test/characterization/stable.test.mjs','utf8');const specs=[...s.matchAll(/(?:from\s*|import\s*\(\s*)[\x27\x22](\.[^\x27\x22]*)[\x27\x22]/g)].map(m=>m[1]);const ok=specs.length>=2&&specs.every(x=>x.includes('fixtures/characterization/v0.1/'))&&!/[\x27\x22]\.\.\/\.\.\/(lib|bin|scripts)\//.test(s);console.log(ok?'ok '+specs.length:'FAIL '+JSON.stringify(specs));process.exit(ok?0:1)" 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "import check exited ${code}: $($out.Trim())" }
if ($out.Trim() -notmatch '^ok \d+$') { throw "unexpected output: '$($out.Trim())'" }
'C1 OK'
exit 0
```

- 退出码 0，stdout 匹配 `^ok \d+$`（相对 import 数量 ≥ 2，且每个都含 `fixtures/characterization/v0.1/`）。

### C2 保留面是真的被锁住的：把副本里的排除原因改坏，stable 必须失败

```powershell
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-stable-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
try {
  Copy-Item -Recurse test, scripts, package.json, contracts -Destination $t
  $f = Join-Path $t 'test/fixtures/characterization/v0.1/lib/select.mjs'
  (Get-Content -Raw $f).Replace("reason: 'excluded'", "reason: 'not_excluded'") | Set-Content -NoNewline -Path $f -Encoding utf8NoBOM
  $out = (node --test (Join-Path $t 'test/characterization/stable.test.mjs') 2>&1 | Out-String)
  $code = $LASTEXITCODE
  if ($code -eq 0) { throw 'stable.test.mjs still passed on the broken copy' }
  $cross = [string][char]0x2716
  $hit = $out.Contains('stable: exclude wins and reports excluded')
  if (-not $hit) { throw 'the exclude test did not run' }
  if (-not (($out -match 'not ok') -or $out.Contains($cross))) { throw 'no failure line reported' }
} finally {
  Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
}
'C2 OK'
exit 0
```

- 在临时副本上做，不动仓库。
- 退出码 1；输出含 `[AC-005] stable: exclude wins and reports excluded` 且带 `not ok`（或 `✖`）。

## 4. 缺陷账本

### D1 defects.json 恰好 11 条，字段与取值正确

```powershell
$out = (node -e "const j=require('./test/characterization/defects.json');const exp={'a1-quota':['T-006','M1','AC-015'],'a2-pack':['T-009','M1','AC-025'],'a3-runner':['T-001','M1','AC-001'],'a4-paths':['T-005','M1','AC-012'],'a4-null-config':['T-005','M1','AC-014'],'a5-dup-call':['T-007','M1','AC-020'],'a5-forecast-x3':['T-007','M1','AC-020'],'a5-unused':['T-007','M1','AC-022'],'a5-ignored-fields':['T-008','M1','AC-024'],'a5-shell':['T-010','M2','AC-026'],'a5-nocache':['T-022','M4','AC-055']};const d=j.defects;let bad=[];if(d.length!==11)bad.push('count '+d.length);for(const x of d){const e=exp[x.id];if(!e){bad.push('unknown '+x.id);continue}if(x.owner_task!==e[0]||x.owner_milestone!==e[1]||x.ac!==e[2])bad.push('fields '+x.id);if(!/^[0-9a-f]{64}$/.test(x.repro_sha256))bad.push('sha '+x.id)}if(new Set(d.map(x=>x.id)).size!==11)bad.push('dup');console.log(bad.length?'FAIL '+bad.join(';'):'ok 11');process.exit(bad.length?1:0)" 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "defects.json check exited ${code}: $($out.Trim())" }
if ($out.Trim() -ne 'ok 11') { throw "expected 'ok 11', got '$($out.Trim())'" }
'D1 OK'
exit 0
```

- 退出码 0，stdout 恰为 `ok 11`。
- 每条含 `id`、`owner_task`、`owner_milestone`、`ac`、`repro_sha256`（64 位小写十六进制），id 不重复。

### D2 每条缺陷都有 repro 文件、canary 与合法的 canary.json，且 canary 目录里没有 `*.test.mjs`

```powershell
$out = (node -e "const fs=require('fs');const ids=require('./test/characterization/defects.json').defects.map(x=>x.id);let bad=[];for(const id of ids){if(!fs.existsSync('test/characterization/defects/'+id+'.test.mjs'))bad.push('repro '+id);const f='test/characterization/canary/'+id+'/canary.json';if(!fs.existsSync(f)){bad.push('canary '+id);continue}const c=JSON.parse(fs.readFileSync(f,'utf8'));const hasOverlay=fs.existsSync('test/characterization/canary/'+id+'/overlay');if(c.defect!==id||!(hasOverlay||(Array.isArray(c.repro_edits)&&c.repro_edits.length>0)))bad.push('shape '+id)}(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.isDirectory())w(p);else if(e.name.endsWith('.test.mjs'))bad.push('testfile '+p)}})('test/characterization/canary');console.log(bad.length?'FAIL '+bad.join(';'):'ok');process.exit(bad.length?1:0)" 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "defect assets check exited ${code}: $($out.Trim())" }
if ($out.Trim() -ne 'ok') { throw "expected 'ok', got '$($out.Trim())'" }
'D2 OK'
exit 0
```

- 退出码 0，stdout 恰为 `ok`。
- 11 条都有 `<id>.test.mjs` 与 `canary/<id>/canary.json`；`canary.json` 的 `defect` 等于目录名，且有 overlay 目录或非空 `repro_edits`。

### D3 [repro] 与 [fixed] 分离

```powershell
$out = (node -e "const fs=require('fs');const ids=require('./test/characterization/defects.json').defects.map(x=>x.id).filter(x=>x!=='a3-runner');let bad=[];for(const id of ids){const s=fs.readFileSync('test/characterization/defects/'+id+'.test.mjs','utf8').replace(/\r\n/g,'\n');const opens=s.split('\n').filter(l=>/^test\([\x27\x22]\[repro\]/.test(l));if(opens.length<1)bad.push('norepro '+id);if(opens.some(l=>!/\{\s*$/.test(l)))bad.push('open '+id);if(/\[fixed\]/.test(s))bad.push('fixed '+id);if(!/^\}\)$/m.test(s))bad.push('close '+id);if(!s.includes('CLIWORKER_V01_ROOT'))bad.push('root '+id)}console.log(bad.length?'FAIL '+bad.join(';'):'ok '+ids.length);process.exit(bad.length?1:0)" 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "repro section check exited ${code}: $($out.Trim())" }
if ($out.Trim() -ne 'ok 10') { throw "expected 'ok 10', got '$($out.Trim())'" }
'D3 OK'
exit 0
```

- 退出码 0，stdout 恰为 `ok 10`。
- 本任务写的 10 个文件每个都有 `[repro]` 块、没有 `[fixed]` 块；块以 `{` 结尾、以行首 `})` 结束；块外定义了 `CLIWORKER_V01_ROOT`。

### D4 篡改 [repro] 段 → check-defects 失败

```powershell
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-defects-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
try {
  Copy-Item -Recurse test, contracts -Destination $t
  $f = Join-Path $t 'test/characterization/defects/a5-dup-call.test.mjs'
  (Get-Content -Raw $f) -replace '\[repro\]', '[repro] edited' | Set-Content -NoNewline -Path $f -Encoding utf8NoBOM
  $out = (node scripts/check-defects.mjs --root $t --strict 2>&1 | Out-String)
  $code = $LASTEXITCODE
  if ($code -ne 1) { throw "expected exit code 1, got $code" }
  if (-not $out.Contains('FAIL defects.repro_changed a5-dup-call')) { throw 'missing defects.repro_changed line' }
} finally {
  Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
}
'D4 OK'
exit 0
```

- 在临时副本上做，不动仓库。
- 退出码 1；stdout 含 `FAIL defects.repro_changed a5-dup-call`。

### D5 canary 失效 → check-defects 失败

```powershell
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-defects-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
try {
  Copy-Item -Recurse test, contracts -Destination $t
  Copy-Item -Force (Join-Path $t 'test/fixtures/characterization/v0.1/lib/select.mjs') (Join-Path $t 'test/characterization/canary/a5-dup-call/overlay/lib/select.mjs')
  $out = (node scripts/check-defects.mjs --root $t --strict 2>&1 | Out-String)
  $code = $LASTEXITCODE
  if ($code -ne 1) { throw "expected exit code 1, got $code" }
  if (-not $out.Contains('FAIL defects.canary_survived a5-dup-call')) { throw 'missing defects.canary_survived line' }
  $ids = @('a1-quota','a2-pack','a3-runner','a4-paths','a4-null-config','a5-forecast-x3','a5-unused','a5-ignored-fields','a5-shell','a5-nocache')
  foreach ($id in $ids) { if ($out.Contains("defects.canary_survived $id")) { throw "unexpected canary_survived for $id" } }
} finally {
  Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
}
'D5 OK'
exit 0
```

- 把 `a5-dup-call` 的 overlay 换回未修复的 0.1 原文。
- 退出码 1；stdout 含 `FAIL defects.canary_survived a5-dup-call`；不含对其它 10 个缺陷的 `canary_survived`。

### D6 缺少 canary → check-defects 失败

```powershell
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-defects-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
try {
  Copy-Item -Recurse test, contracts -Destination $t
  Remove-Item -Recurse -Force (Join-Path $t 'test/characterization/canary/a4-paths')
  $out = (node scripts/check-defects.mjs --root $t --strict 2>&1 | Out-String)
  $code = $LASTEXITCODE
  if ($code -ne 1) { throw "expected exit code 1, got $code" }
  if (-not $out.Contains('FAIL defects.canary_missing a4-paths')) { throw 'missing defects.canary_missing line' }
} finally {
  Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
}
'D6 OK'
exit 0
```

- 退出码 1；stdout 含 `FAIL defects.canary_missing a4-paths`。

### D7 T-001 既有行为不变

```powershell
$out = (node --test test/unit/milestone-gate.test.mjs 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "milestone-gate test exited $code" }
$cross = [string][char]0x2716
if ($out.Contains($cross)) { throw 'output contains the failure mark' }
if ($out -match '(?m)^not ok ') { throw 'output contains a failing subtest' }
'D7 OK'
exit 0
```

- 退出码 0；不含 `✖`、不含 `not ok`。

## 5. 追踪与范围

### E1 追踪分片

```powershell
$out = (node scripts/check-traceability.mjs 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "check-traceability exited $code" }
if ($out -notmatch '(?m)^check-traceability: ok \(covered=\d+ planned=\d+\)\s*$') { throw 'unexpected check-traceability output' }
$json = (node -e "const j=require('./test/traceability/T-002.json');const e=j.entries;const ok=Object.keys(j).sort().join()==='entries,milestone,task'&&j.task==='T-002'&&j.milestone==='M1'&&e.length===1&&e[0].ac==='AC-005'&&e[0].status==='covered'&&e[0].files.join()==='test/characterization/stable.test.mjs,test/unit/frozen-files.test.mjs';console.log(ok?'ok':'FAIL')" 2>&1 | Out-String)
if ($json.Trim() -ne 'ok') { throw "T-002.json check failed: $($json.Trim())" }
'E1 OK'
exit 0
```

- 退出码 0；stdout 匹配 `^check-traceability: ok \(covered=\d+ planned=\d+\)$`。
- `test/traceability/T-002.json` 的键恰为 `task`、`milestone`、`entries`，且内容为 AC-005 covered、两个测试文件。

### E2 只写了 write_scope 内的文件

```powershell
$diff = (git diff --name-only main...HEAD | node -e "const re=[/^test\/fixtures\/characterization\//,/^test\/characterization\/(stable\.test\.mjs|defects\.json|frozen-files\.json)$/,/^test\/characterization\/defects\/(a1-quota|a2-pack|a4-paths|a4-null-config|a5-dup-call|a5-forecast-x3|a5-unused|a5-shell|a5-nocache|a5-ignored-fields)\.test\.mjs$/,/^test\/unit\/frozen-files\.test\.mjs$/,/^scripts\/(check-frozen-files|check-defects|check-ci)\.mjs$/,/^test\/unit\/traceability\.test\.mjs$/,/^test\/traceability\/T-002\.json$/,/^test\/characterization\/canary\//,/^\.collab\/(tasks\/002\/|blueprint\/cliworker-v2\/task-graph\.json$)/];const out=require('fs').readFileSync(0,'utf8').split(/\r?\n/).filter(Boolean).filter(f=>!re.some(r=>r.test(f)));console.log(out.length?'OUT '+out.join(','):'out-of-scope: none');process.exit(out.length?1:0)" 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw "diff scope check failed: $($diff.Trim())" }
if ($diff.Trim() -ne 'out-of-scope: none') { throw "unexpected diff scope: $($diff.Trim())" }
$status = (git status --porcelain | node -e "const re=[/^test\/fixtures\/characterization\//,/^test\/characterization\/(stable\.test\.mjs|defects\.json|frozen-files\.json)$/,/^test\/characterization\/defects\/(a1-quota|a2-pack|a4-paths|a4-null-config|a5-dup-call|a5-forecast-x3|a5-unused|a5-shell|a5-nocache|a5-ignored-fields)\.test\.mjs$/,/^test\/unit\/frozen-files\.test\.mjs$/,/^scripts\/(check-frozen-files|check-defects|check-ci)\.mjs$/,/^test\/unit\/traceability\.test\.mjs$/,/^test\/traceability\/T-002\.json$/,/^test\/characterization\/canary\//,/^\.collab\/tasks\/002\//];const out=require('fs').readFileSync(0,'utf8').split(/\r?\n/).filter(Boolean).map(l=>l.slice(3).replace(/^.* -> /,'').replace(/^\"|\"$/g,'')).filter(f=>!re.some(r=>r.test(f)));console.log(out.length?'OUT '+out.join(','):'dirty: in-scope only');process.exit(out.length?1:0)" 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw "working tree scope check failed: $($status.Trim())" }
if ($status.Trim() -ne 'dirty: in-scope only') { throw "unexpected working tree: $($status.Trim())" }
'E2 OK'
exit 0
```

- `git diff --name-only main...HEAD` 里每条路径都落在 write_scope（含 task-graph 为本任务追加的 `scripts/check-ci.mjs`、`test/unit/traceability.test.mjs` 两处单行修复）或 `.collab/tasks/002/`、`.collab/blueprint/cliworker-v2/task-graph.json`。
- `git status --porcelain` 的输出同样只落在上述范围（不含 `test/characterization/defects/a3-runner.test.mjs`、`scripts/run-tests.mjs`、`package.json`、`lib/`、`bin/`、`config/`）。

### E3 无第三方依赖、无令牌

```powershell
$out = (node -e "const fs=require('fs');const files=['scripts/check-frozen-files.mjs','scripts/check-defects.mjs','test/characterization/stable.test.mjs','test/unit/frozen-files.test.mjs'];const bad=[];for(const f of files){const s=fs.readFileSync(f,'utf8');for(const m of s.matchAll(/(?:from\s*|import\s*\(\s*|require\(\s*)[\x27\x22]([^\x27\x22]+)[\x27\x22]/g)){const x=m[1];if(!(x.startsWith('.')||x.startsWith('node:')))bad.push(f+' '+x)}if(/(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*[\x27\x22][^\x27\x22]{8,})/i.test(s))bad.push(f+' secret')}console.log(bad.length?'FAIL '+bad.join(';'):'ok');process.exit(bad.length?1:0)" 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "dependency check exited ${code}: $($out.Trim())" }
if ($out.Trim() -ne 'ok') { throw "expected 'ok', got '$($out.Trim())'" }
'E3 OK'
exit 0
```

- 退出码 0，stdout 恰为 `ok`。
- 四个文件的 import 说明符只有相对路径与 `node:` 内置模块；没有 `sk-`/`ghp_`/`api_key` 形态的令牌。

## 6. 各缺陷 repro 的实质内容

### F1 每条 repro 在副本上通过

```powershell
$files = @(
  'test/characterization/defects/a1-quota.test.mjs',
  'test/characterization/defects/a2-pack.test.mjs',
  'test/characterization/defects/a3-runner.test.mjs',
  'test/characterization/defects/a4-paths.test.mjs',
  'test/characterization/defects/a4-null-config.test.mjs',
  'test/characterization/defects/a5-dup-call.test.mjs',
  'test/characterization/defects/a5-forecast-x3.test.mjs',
  'test/characterization/defects/a5-unused.test.mjs',
  'test/characterization/defects/a5-shell.test.mjs',
  'test/characterization/defects/a5-nocache.test.mjs',
  'test/characterization/defects/a5-ignored-fields.test.mjs'
)
foreach ($f in $files) {
  $out = (node --test --test-name-pattern="\[repro\]" $f 2>&1 | Out-String)
  $code = $LASTEXITCODE
  if ($code -ne 0) { throw "$f exited $code" }
  if ($out -notmatch '(?m)^# fail 0\s*$') { throw "$f did not report fail 0" }
  if ($out -notmatch '(?m)^# pass [1-9]\d*\s*$') { throw "$f did not report a passing subtest" }
}
'F1 OK'
exit 0
```

- 11 个文件逐个运行，每条退出码 0，输出中 `fail 0` 且 `pass` ≥ 1。

### F2 canary 对每个缺陷都真的命中

```powershell
$out = (node scripts/check-defects.mjs 2>&1 | Out-String)
$code = $LASTEXITCODE
if ($code -ne 0) { throw "check-defects exited $code" }
foreach ($failure in @('defects.canary_survived', 'defects.canary_missing', 'defects.canary_error', 'defects.repro_baseline_failed', 'defects.repro_changed')) {
  if ($out.Contains($failure)) { throw "stdout contains $failure" }
}
if (-not $out.Contains('check-defects: ok')) { throw 'stdout is missing check-defects: ok' }
'F2 OK'
exit 0
```

- 与 A3 同一条命令；11 个缺陷全部通过才输出 `check-defects: ok`，且不含任何 `defects.canary_*` / `defects.repro_*` 失败行。
