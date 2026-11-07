# T-002 验收标准

对应 AC-005（levels: unit）。所有命令在仓库根（`C:\git\dsh-CLIWorker\.collab\worktrees\002`）用 `pwsh -NoProfile` 执行，Node ≥ 20。基准提交：`f75bb76`（0.1 副本的来源）。brief 没有给出既有验收报告路径。

通用约定：「退出码 0」指进程退出码；「stdout 含」指子串或正则匹配；任何一条不满足即该项不通过。

## A. 总入口

### A-1 过滤运行 AC-005
```
node scripts/run-tests.mjs --ac AC-005
```
- 退出码 0。
- stdout 含 `run-tests: filtered `，不含 `FAIL`、`✖`。
- stdout 含下列每个标题子串（各对应一个 `✔`）：
  - `[AC-005] stable: deprecated models are never candidates`
  - `[AC-005] stable: unverified identity is rejected unless require_verified is false`
  - `[AC-005] stable: level filter rejects other levels`
  - `[AC-005] stable: exclude wins and reports excluded`
  - `[AC-005] stable: the four schema names`
  - `[AC-005] stable: imports only the v0.1 copy`
  - `[AC-005] frozen: untouched fixture root passes`
  - `[AC-005] frozen: changing one registered byte fails with frozen.hash_mismatch`
  - `[AC-005] frozen: CRLF checkout of a registered file still passes`
  - `[AC-005] frozen: lib/, bin/ and config/ paths are rejected as frozen.forbidden_path`
  - `[AC-005] frozen: scripts/ and other unlisted paths fail with frozen.outside_allowed`
  - `[AC-005] frozen: contracts/spec and contracts/golden paths are allowed`
  - `[AC-005] frozen: unregistered file in the v0.1 copy fails with frozen.unregistered`
  - `[AC-005] frozen: missing registered file fails with frozen.file_missing`
  - `[AC-005] frozen: path traversal and absolute paths are rejected`
  - `[AC-005] defects: well-formed fixture ledger passes`
  - `[AC-005] defects: repro edited after registration fails with defects.repro_changed`
  - `[AC-005] defects: canary that still passes fails with defects.canary_survived`
  - `[AC-005] defects: missing canary fails with defects.canary_missing`
  - `[AC-005] defects: repro failing on the unmodified copy fails with defects.repro_baseline_failed`
  - `[AC-005] defects: a repro that cannot even load is not counted as a canary hit`
- stdout 含 10 个以 `[repro] [AC-005]` 开头的标题（a3-runner 的 [repro] 不带 `[AC-005]` 标签，由 A-5 覆盖）。

### A-2 冻结检查（真实仓库）
```
node scripts/check-frozen-files.mjs
```
- 退出码 0。
- stdout 匹配 `^check-frozen-files: ok \(\d+ files\)$`，且其中数字 ≥ 8（副本 7 个 + stable.test.mjs）。

### A-3 缺陷检查（真实仓库，严格模式，含 canary）
```
node scripts/check-defects.mjs
```
- 退出码 0。
- stdout 恰含 `check-defects: ok`，不含 `FAIL`、不含 `absent`。

### A-4 check-fast 执行了这两项检查
```
node scripts/check-fast.mjs
```
- 退出码 0。
- stdout 含 `==> check-defects.mjs`、`==> check-frozen-files.mjs`、`==> npm test`，最后一行 `check-fast: ok`。

### A-5 完整测试
```
node scripts/run-tests.mjs
```
- 退出码 0；stdout 含 `run-tests: full `，不含 `FAIL`、`✖`。
- stdout 含 `[repro] 0.1 has no test script`（a3-runner）以及另外 10 个以 `[repro] [AC-005]` 开头的标题。

## B. 副本逐字节与冻结清单

### B-1 副本与 f75bb76 的 blob 一致，且文件集合恰好是 7 个
命令（`pwsh -NoProfile -Command`，内部用 node 取原始字节，不经 PowerShell 管道）：
```
node -e "const cp=require('child_process'),fs=require('fs'),c=require('crypto');const norm=b=>c.createHash('sha256').update(b.toString('latin1').replace(/\r\n/g,'\n'),'latin1').digest('hex');const want=cp.execFileSync('git',['ls-tree','-r','--name-only','f75bb76','--','lib','config/cliworker.example.json']).toString().split(/\r?\n/).filter(Boolean).sort();const dir='test/fixtures/characterization/v0.1/';const have=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;e.isDirectory()?w(p):have.push(p.slice(dir.length))}})(dir.slice(0,-1));have.sort();let bad=JSON.stringify(want)!==JSON.stringify(have)?1:0;if(bad)console.log('SET',want,have);for(const p of want){const g=norm(cp.execFileSync('git',['cat-file','blob','f75bb76:'+p]));const f=norm(fs.readFileSync(dir+p));if(g!==f){bad++;console.log('DIFF',p)}}console.log(bad?'FAIL':'ok '+want.length);process.exit(bad?1:0)"
```
- 退出码 0，stdout 恰为 `ok 7`。

### B-2 frozen-files.json 的形状与允许集合
```
node -e "const j=require('./test/characterization/frozen-files.json');const p=j.files.map(f=>f.path);const allowed=x=>x.startsWith('test/fixtures/characterization/v0.1/')||x==='test/characterization/stable.test.mjs'||x.startsWith('contracts/spec/')||x.startsWith('contracts/golden/');const ok=Object.keys(j).sort().join()==='files,source_commit'&&j.source_commit==='f75bb76'&&p.every(allowed)&&!p.some(x=>/^(lib|bin|config|scripts)\//i.test(x))&&p.includes('test/characterization/stable.test.mjs')&&p.filter(x=>x.startsWith('test/fixtures/characterization/v0.1/')).length===7&&new Set(p).size===p.length&&j.files.every(f=>Object.keys(f).sort().join()==='path,sha256'&&/^[0-9a-f]{64}$/.test(f.sha256));console.log(ok?'ok '+p.length:'FAIL');process.exit(ok?0:1)"
```
- 退出码 0，stdout 匹配 `^ok \d+$`。

### B-3 篡改一个登记文件的字节 → 检查失败（在临时副本上做，不动仓库）
```
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-frozen-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
Copy-Item -Recurse test, contracts -Destination $t
Add-Content -Path (Join-Path $t 'test/fixtures/characterization/v0.1/lib/select.mjs') -Value '// tamper' -Encoding utf8NoBOM
node scripts/check-frozen-files.mjs --root $t
"exit=$LASTEXITCODE"
Remove-Item -Recurse -Force $t
```
- `exit=1`；stdout 含 `FAIL frozen.hash_mismatch test/fixtures/characterization/v0.1/lib/select.mjs` 和 `check-frozen-files: FAILED (1 errors)`。

### B-4 登记 lib/、bin/、config/、scripts/ 路径 → 检查失败
```
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-frozen-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
Copy-Item -Recurse test, contracts -Destination $t
node -e "const fs=require('fs');const f=process.argv[1]+'/test/characterization/frozen-files.json';const j=JSON.parse(fs.readFileSync(f,'utf8'));const h='0'.repeat(64);for(const p of ['lib/select.mjs','bin/cliworker.mjs','config/cliworker.example.json','scripts/run-tests.mjs'])j.files.push({path:p,sha256:h});fs.writeFileSync(f,JSON.stringify(j,null,2))" $t
node scripts/check-frozen-files.mjs --root $t
"exit=$LASTEXITCODE"
Remove-Item -Recurse -Force $t
```
- `exit=1`；stdout 含这四行（顺序不限）：
  - `FAIL frozen.forbidden_path lib/select.mjs`
  - `FAIL frozen.forbidden_path bin/cliworker.mjs`
  - `FAIL frozen.forbidden_path config/cliworker.example.json`
  - `FAIL frozen.outside_allowed scripts/run-tests.mjs`
- stdout 含 `check-frozen-files: FAILED (4 errors)`。

### B-5 副本里多出一个未登记文件 → 检查失败
```
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-frozen-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
Copy-Item -Recurse test, contracts -Destination $t
Set-Content -Path (Join-Path $t 'test/fixtures/characterization/v0.1/README.md') -Value 'x' -Encoding utf8NoBOM
node scripts/check-frozen-files.mjs --root $t
"exit=$LASTEXITCODE"
Remove-Item -Recurse -Force $t
```
- `exit=1`；stdout 含 `FAIL frozen.unregistered test/fixtures/characterization/v0.1/README.md`。

### B-6 未知参数
```
node scripts/check-frozen-files.mjs --bogus
```
- 退出码 2。

## C. stable.test.mjs 只依赖副本

### C-1 所有相对 import 都指向副本
```
node -e "const s=require('fs').readFileSync('test/characterization/stable.test.mjs','utf8');const specs=[...s.matchAll(/(?:from\s*|import\s*\(\s*)[\x27\x22](\.[^\x27\x22]*)[\x27\x22]/g)].map(m=>m[1]);const ok=specs.length>=2&&specs.every(x=>x.includes('fixtures/characterization/v0.1/'))&&!/[\x27\x22]\.\.\/\.\.\/(lib|bin|scripts)\//.test(s);console.log(ok?'ok '+specs.length:'FAIL '+JSON.stringify(specs));process.exit(ok?0:1)"
```
- 退出码 0，stdout 匹配 `^ok \d+$`。

### C-2 保留面是真的被锁住的：把副本里的等级过滤改坏，stable 必须失败（在临时副本上做）
```
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-stable-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
Copy-Item -Recurse test, scripts, package.json, contracts -Destination $t
$f = Join-Path $t 'test/fixtures/characterization/v0.1/lib/select.mjs'
(Get-Content -Raw $f).Replace("reason: 'excluded'", "reason: 'not_excluded'") | Set-Content -NoNewline -Path $f -Encoding utf8NoBOM
node --test (Join-Path $t 'test/characterization/stable.test.mjs')
"exit=$LASTEXITCODE"
Remove-Item -Recurse -Force $t
```
- `exit=1`；stdout 含 `✖ [AC-005] stable: exclude wins and reports excluded`（或 `not ok` 形式的同名行）。

## D. 缺陷账本

### D-1 defects.json 恰好 11 条，字段与取值正确
```
node -e "const j=require('./test/characterization/defects.json');const exp={'a1-quota':['T-006','M1','AC-015'],'a2-pack':['T-009','M1','AC-025'],'a3-runner':['T-001','M1','AC-001'],'a4-paths':['T-005','M1','AC-012'],'a4-null-config':['T-005','M1','AC-014'],'a5-dup-call':['T-007','M1','AC-020'],'a5-forecast-x3':['T-007','M1','AC-020'],'a5-unused':['T-007','M1','AC-022'],'a5-ignored-fields':['T-008','M1','AC-024'],'a5-shell':['T-010','M2','AC-026'],'a5-nocache':['T-022','M4','AC-055']};const d=j.defects;let bad=[];if(d.length!==11)bad.push('count '+d.length);for(const x of d){const e=exp[x.id];if(!e){bad.push('unknown '+x.id);continue}if(x.owner_task!==e[0]||x.owner_milestone!==e[1]||x.ac!==e[2])bad.push('fields '+x.id);if(!/^[0-9a-f]{64}$/.test(x.repro_sha256))bad.push('sha '+x.id)}if(new Set(d.map(x=>x.id)).size!==11)bad.push('dup');console.log(bad.length?'FAIL '+bad.join(';'):'ok 11');process.exit(bad.length?1:0)"
```
- 退出码 0，stdout 恰为 `ok 11`。

### D-2 每条缺陷都有 repro 文件（a3-runner 为 T-001 既有文件）、canary 与合法的 canary.json，且 canary 目录里没有 `*.test.mjs`
```
node -e "const fs=require('fs');const ids=require('./test/characterization/defects.json').defects.map(x=>x.id);let bad=[];for(const id of ids){if(!fs.existsSync('test/characterization/defects/'+id+'.test.mjs'))bad.push('repro '+id);const f='test/characterization/canary/'+id+'/canary.json';if(!fs.existsSync(f)){bad.push('canary '+id);continue}const c=JSON.parse(fs.readFileSync(f,'utf8'));const hasOverlay=fs.existsSync('test/characterization/canary/'+id+'/overlay');if(c.defect!==id||!(hasOverlay||(Array.isArray(c.repro_edits)&&c.repro_edits.length>0)))bad.push('shape '+id)}(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.isDirectory())w(p);else if(e.name.endsWith('.test.mjs'))bad.push('testfile '+p)}})('test/characterization/canary');console.log(bad.length?'FAIL '+bad.join(';'):'ok');process.exit(bad.length?1:0)"
```
- 退出码 0，stdout 恰为 `ok`。

### D-3 [repro] 与 [fixed] 分离：本任务写的 10 个 repro 文件里每个都有 [repro] 块、没有 [fixed] 块，且每个 [repro] 块以 `{` 结尾、以行首 `})` 结束
```
node -e "const fs=require('fs');const ids=require('./test/characterization/defects.json').defects.map(x=>x.id).filter(x=>x!=='a3-runner');let bad=[];for(const id of ids){const s=fs.readFileSync('test/characterization/defects/'+id+'.test.mjs','utf8').replace(/\r\n/g,'\n');const opens=s.split('\n').filter(l=>/^test\([\x27\x22]\[repro\]/.test(l));if(opens.length<1)bad.push('norepro '+id);if(opens.some(l=>!/\{\s*$/.test(l)))bad.push('open '+id);if(/\[fixed\]/.test(s))bad.push('fixed '+id);if(!/^\}\)$/m.test(s))bad.push('close '+id);if(!s.includes('CLIWORKER_V01_ROOT'))bad.push('root '+id)}console.log(bad.length?'FAIL '+bad.join(';'):'ok '+ids.length);process.exit(bad.length?1:0)"
```
- 退出码 0，stdout 恰为 `ok 10`。

### D-4 篡改 [repro] 段 → check-defects 失败（在临时副本上做）
```
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-defects-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
Copy-Item -Recurse test, contracts -Destination $t
$f = Join-Path $t 'test/characterization/defects/a5-dup-call.test.mjs'
(Get-Content -Raw $f) -replace '\[repro\]', '[repro] edited' | Set-Content -NoNewline -Path $f -Encoding utf8NoBOM
node scripts/check-defects.mjs --root $t --strict
"exit=$LASTEXITCODE"
Remove-Item -Recurse -Force $t
```
- `exit=1`；stdout 含 `FAIL defects.repro_changed a5-dup-call`。

### D-5 canary 失效 → check-defects 失败（把一条 canary 的覆盖文件换成未修复的 0.1 原文）
```
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-defects-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
Copy-Item -Recurse test, contracts -Destination $t
Copy-Item -Force (Join-Path $t 'test/fixtures/characterization/v0.1/lib/select.mjs') (Join-Path $t 'test/characterization/canary/a5-dup-call/overlay/lib/select.mjs')
node scripts/check-defects.mjs --root $t --strict
"exit=$LASTEXITCODE"
Remove-Item -Recurse -Force $t
```
- `exit=1`；stdout 含 `FAIL defects.canary_survived a5-dup-call`；不含对其它 10 个缺陷的 `canary_survived`。

### D-6 缺少 canary → check-defects 失败
```
$t = Join-Path ([IO.Path]::GetTempPath()) ('cw-defects-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $t | Out-Null
Copy-Item -Recurse test, contracts -Destination $t
Remove-Item -Recurse -Force (Join-Path $t 'test/characterization/canary/a4-paths')
node scripts/check-defects.mjs --root $t --strict
"exit=$LASTEXITCODE"
Remove-Item -Recurse -Force $t
```
- `exit=1`；stdout 含 `FAIL defects.canary_missing a4-paths`。

### D-7 T-001 既有行为不变
```
node --test test/unit/milestone-gate.test.mjs
```
- 退出码 0；不含 `✖`。

## E. 追踪与范围

### E-1 追踪分片
```
node scripts/check-traceability.mjs
```
- 退出码 0；stdout 匹配 `^check-traceability: ok \(covered=\d+ planned=\d+\)$`。
```
node -e "const j=require('./test/traceability/T-002.json');const e=j.entries;const ok=Object.keys(j).sort().join()==='entries,milestone,task'&&j.task==='T-002'&&j.milestone==='M1'&&e.length===1&&e[0].ac==='AC-005'&&e[0].status==='covered'&&e[0].files.join()==='test/characterization/stable.test.mjs,test/unit/frozen-files.test.mjs';console.log(ok?'ok':'FAIL');process.exit(ok?0:1)"
```
- 退出码 0，stdout 恰为 `ok`。

### E-2 只写了 write_scope 内的文件
```
git diff --name-only main...HEAD | node -e "const re=[/^test\/fixtures\/characterization\//,/^test\/characterization\/(stable\.test\.mjs|defects\.json|frozen-files\.json)$/,/^test\/characterization\/defects\/(a1-quota|a2-pack|a4-paths|a4-null-config|a5-dup-call|a5-forecast-x3|a5-unused|a5-shell|a5-nocache|a5-ignored-fields)\.test\.mjs$/,/^test\/unit\/frozen-files\.test\.mjs$/,/^scripts\/(check-frozen-files|check-defects)\.mjs$/,/^test\/traceability\/T-002\.json$/,/^test\/characterization\/canary\//,/^\.collab\/tasks\/002\//];const out=require('fs').readFileSync(0,'utf8').split(/\r?\n/).filter(Boolean).filter(f=>!re.some(r=>r.test(f)));console.log(out.length?'OUT '+out.join(','):'out-of-scope: none');process.exit(out.length?1:0)"
```
- 退出码 0，stdout 恰为 `out-of-scope: none`。
```
git status --porcelain
```
- 输出里每个路径同样落在上述范围内（`.collab/tasks/002/` 下的编排文件除外）；`test/characterization/defects/a3-runner.test.mjs`、`scripts/run-tests.mjs`、`package.json`、`lib/`、`bin/`、`config/` 均不出现。

### E-3 无第三方依赖、无令牌
```
node -e "const fs=require('fs');const files=['scripts/check-frozen-files.mjs','scripts/check-defects.mjs','test/characterization/stable.test.mjs','test/unit/frozen-files.test.mjs'];const bad=[];for(const f of files){const s=fs.readFileSync(f,'utf8');for(const m of s.matchAll(/(?:from\s*|import\s*\(\s*|require\(\s*)[\x27\x22]([^\x27\x22]+)[\x27\x22]/g)){const x=m[1];if(!(x.startsWith('.')||x.startsWith('node:')))bad.push(f+' '+x)}if(/(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*[\x27\x22][^\x27\x22]{8,})/i.test(s))bad.push(f+' secret')}console.log(bad.length?'FAIL '+bad.join(';'):'ok');process.exit(bad.length?1:0)"
```
- 退出码 0，stdout 恰为 `ok`。

## F. 各缺陷 repro 的实质内容（抽查，每条命令独立）

下面每条命令只运行一个缺陷文件里的 [repro]，在副本上必须通过；其后一条用该缺陷的 canary 叠加（由 check-defects 的 A-3 覆盖，这里只列 repro 本身的通过条件）：

```
node --test --test-name-pattern="\[repro\]" test/characterization/defects/a1-quota.test.mjs
node --test --test-name-pattern="\[repro\]" test/characterization/defects/a2-pack.test.mjs
node --test --test-name-pattern="\[repro\]" test/characterization/defects/a3-runner.test.mjs
node --test --test-name-pattern="\[repro\]" test/characterization/defects/a4-paths.test.mjs
node --test --test-name-pattern="\[repro\]" test/characterization/defects/a4-null-config.test.mjs
node --test --test-name-pattern="\[repro\]" test/characterization/defects/a5-dup-call.test.mjs
node --test --test-name-pattern="\[repro\]" test/characterization/defects/a5-forecast-x3.test.mjs
node --test --test-name-pattern="\[repro\]" test/characterization/defects/a5-unused.test.mjs
node --test --test-name-pattern="\[repro\]" test/characterization/defects/a5-shell.test.mjs
node --test --test-name-pattern="\[repro\]" test/characterization/defects/a5-nocache.test.mjs
node --test --test-name-pattern="\[repro\]" test/characterization/defects/a5-ignored-fields.test.mjs
```
- 每条退出码 0，输出中 `fail 0` 且 `pass` ≥ 1。

### F-1 canary 对每个缺陷都真的命中
```
node scripts/check-defects.mjs
```
- 与 A-3 同一条命令；在此强调判据：stdout 不含任何 `defects.canary_survived`、`defects.canary_missing`、`defects.canary_error`、`defects.repro_baseline_failed`、`defects.repro_changed`。11 个缺陷全部通过才输出 `check-defects: ok`。
