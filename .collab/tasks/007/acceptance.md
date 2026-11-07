# Task 007 验收标准

基准：分支 `task/007`，起点提交 `f6f6057`。工作树根：`C:/git/dsh-CLIWorker/.collab/worktrees/007`。

执行契约（与 `tools/ci-runner.ps1` 一致）：每个检查是一个 `## AC-0xx ...` 小节（标题以 AC 号开头），命令写在 `- 命令:` 行的反引号里，单独一行，命令成功时打印该小节所属 AC 号的精确字符串 `AC-0xx OK`。命令一律从临时目录执行，全部使用绝对路径（ESM 用 `file:///C:/...`），不依赖 cwd；每个命令自带断言，断言失败即 `exit 1`，因此只有「退出码 0 + 打印 `AC-0xx OK`」同时成立才算通过。

人类已批准 design.md §0 的方案 A：`lib/contract/validate.mjs` 进入写域，只删除 `typeOf`，其余不动（见 `AC-022 A-19`）。

## AC-020 A-01 过滤运行 AC-020

- 命令: `$o = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/run-tests.mjs --ac AC-020 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if (-not ($o -match 'fail 0')) { exit 1 }; if (-not ($o -match 'filtered 3 files')) { exit 1 }; Write-Output "AC-020 OK"`
- 期望: 退出码 0；输出含 `fail 0` 与 `filtered 3 files`。基准提交上同一命令输出 `FAIL run.no_match AC-020`、退出码非 0。

## AC-020 A-02 draft handle 有 call、没有 cli 键

- 命令: `node -e "import('file:///C:/git/dsh-CLIWorker/.collab/worktrees/007/lib/select.mjs').then(({selectModels})=>{const c={providers:{claude:{cli:'claude',readonly:true}},models:{q:{provider:'claude',id:'q',level:'Quick',identity:'verified'}}};const r=selectModels(c,{level:'Quick'},{status:{claude:{state:'callable'}}});const h=r.models[0];if(!h||('cli' in h)!==false||('call' in h)!==true||JSON.stringify(h.call)!==JSON.stringify(r.calls[0]))process.exit(1)})"; if ($LASTEXITCODE -ne 0) { exit 1 }; Write-Output "AC-020 OK"`
- 期望: 退出码 0。等价于基准旧命令打印 `false true true`：`'cli' in handle` 为假、`'call' in handle` 为真、`calls[0]` 与 `handle.call` 深相等。

## AC-020 A-03 每个模型的配额只读一次

- 命令: `node -e "import('file:///C:/git/dsh-CLIWorker/.collab/worktrees/007/lib/select.mjs').then(({selectModels})=>{let reads=0;const quotas=new Proxy({},{get(t,p){if(p==='claude')reads+=1;return t[p]}});const models={};for(let i=0;i<12;i++)models['claude-m'+i]={provider:'claude',id:'m'+i,level:'Quick',identity:'verified',prices:{input_per_mtok:1,output_per_mtok:1}};const c={providers:{claude:{cli:'claude',readonly:true}},models,quotas};const r=selectModels(c,{level:'Quick',count:12},{status:{claude:{state:'callable'}}});if(r.ok!==true||r.models.length!==12||reads!==12)process.exit(1)})"; if ($LASTEXITCODE -ne 0) { exit 1 }; Write-Output "AC-020 OK"`
- 期望: 退出码 0。等价于基准旧命令打印 `true 12 12`：12 个模型、`count: 12`、Proxy 统计到的配额读取次数恰为 12。基准上 `reads` 大于 12。

## AC-020 A-04 forecast 计数等于通过前置过滤的模型数

- 命令: `node -e "import('file:///C:/git/dsh-CLIWorker/.collab/worktrees/007/lib/select.mjs').then(({selectModels})=>{const models={};for(let i=0;i<12;i++)models['m'+i]={provider:'claude',id:'m'+i,level:'Quick',identity:'verified',prices:{input_per_mtok:i,output_per_mtok:1}};models.m0.level='Top';models.m1.deprecated=true;models.m2.identity='unverified';const c={providers:{claude:{cli:'claude',readonly:true}},models};const out=new Set();for(const usage of ['Normal','Light','Heavy'])for(const count of [1,3,8]){const seen=[];const ctx={forecast:(a)=>{seen.push(a.model);return {risk:'ok',tasks_left:9}}};selectModels(c,{level:'Quick',count,usage,exclude:['m3']},{status:{claude:{state:'callable'}},ctx});out.add(seen.length+'/'+new Set(seen).size)}if(out.size!==1||!out.has('8/8'))process.exit(1)})"; if ($LASTEXITCODE -ne 0) { exit 1 }; Write-Output "AC-020 OK"`
- 期望: 退出码 0。等价于基准旧命令打印 `8/8`：12 个模型减去 level 不符、deprecated、identity 未验证、被 exclude 的 4 个；`usage` ∈ {Normal, Light, Heavy} × `count` ∈ {1, 3, 8} 共 9 组，每组注入的 forecast 调用次数都是 8 且覆盖 8 个不同模型。

## AC-020 A-05 两个缺陷文件的 [fixed] 段通过

- 命令: `$o = & node --test C:/git/dsh-CLIWorker/.collab/worktrees/007/test/characterization/defects/a5-dup-call.test.mjs C:/git/dsh-CLIWorker/.collab/worktrees/007/test/characterization/defects/a5-forecast-x3.test.mjs 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if (-not ($o -match 'pass 4')) { exit 1 }; if (-not ($o -match 'fail 0')) { exit 1 }; Write-Output "AC-020 OK"`
- 期望: 退出码 0；`pass 4`、`fail 0`（每个文件各 1 个 `[repro]` + 1 个 `[fixed]`）。

## AC-020 A-06 缺陷账本未被改动

- 命令: `$o = & git -C C:/git/dsh-CLIWorker/.collab/worktrees/007 diff f6f6057 -- test/characterization/defects.json; if ($LASTEXITCODE -ne 0) { exit 1 }; if ("$o".Trim().Length -ne 0) { exit 1 }; Write-Output "AC-020 OK"`
- 期望: 退出码 0；无输出（`defects.json` 未被修改）。`[repro]` 的 sha256 由 `AC-022 A-20` 的 `check-defects` 校验。

## AC-020 A-07 既有选模测试不改也通过

- 命令: `$o = & node --test C:/git/dsh-CLIWorker/.collab/worktrees/007/test/unit/select.test.mjs 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if (-not ($o -match 'pass 6')) { exit 1 }; if (-not ($o -match 'fail 0')) { exit 1 }; $d = & git -C C:/git/dsh-CLIWorker/.collab/worktrees/007 diff f6f6057 -- test/unit/select.test.mjs; if ($LASTEXITCODE -ne 0) { exit 1 }; if ("$d".Trim().Length -ne 0) { exit 1 }; Write-Output "AC-020 OK"`
- 期望: 退出码 0；`pass 6`、`fail 0`；`test/unit/select.test.mjs` 相对基准无 diff。

## AC-021 A-08 过滤运行 AC-021

- 命令: `$o = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/run-tests.mjs --ac AC-021 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if (-not ($o -match 'fail 0')) { exit 1 }; if (-not ($o -match 'filtered 1 files')) { exit 1 }; Write-Output "AC-021 OK"`
- 期望: 退出码 0；输出含 `fail 0` 与 `filtered 1 files`。

## AC-021 A-09 金标 Heavy 全拒、Normal 与 Light 不拒

- 命令: `node -e "Promise.all([import('file:///C:/git/dsh-CLIWorker/.collab/worktrees/007/lib/select.mjs'),import('file:///C:/git/dsh-CLIWorker/.collab/worktrees/007/lib/forecast.mjs'),import('node:fs')]).then(([{selectModels},{buildForecast},fs])=>{const g=JSON.parse(fs.readFileSync('C:/git/dsh-CLIWorker/.collab/worktrees/007/contracts/golden/quota-shapes.json','utf8'));const cases=g.cases.filter(c=>c.expected.risk);const providers={},models={},quotas={},byKey={};cases.forEach((c,i)=>{providers['p'+i]={cli:'p'+i,readonly:true};models['m-'+c.id]={provider:'p'+i,id:'x'+i,level:'Quick',identity:'verified'};quotas['p'+i]=c.input.quota;byKey['m-'+c.id]=c});const cfg={providers,models,quotas};const status=Object.fromEntries(Object.keys(providers).map(k=>[k,{state:'callable'}]));const ctx={forecast:(a)=>buildForecast({quota:a.quota,samples:byKey[a.model].input.samples,usage:a.usage,now:0})};const bad=['exhausted','critical','low_reserve'];const want=cases.filter(c=>bad.includes(c.expected.risk)).map(c=>'m-'+c.id).sort();const h=selectModels(cfg,{level:'Quick',count:10,usage:'Heavy'},{status,ctx});const got=h.rejected.filter(x=>x.reason==='E_FORECAST_EXHAUSTION').map(x=>x.key).sort();const n=selectModels(cfg,{level:'Quick',count:10,usage:'Normal'},{status,ctx});const l=selectModels(cfg,{level:'Quick',count:10,usage:'Light'},{status,ctx});if(JSON.stringify(got)!==JSON.stringify(want))process.exit(1);if(want.length<5)process.exit(1);if(h.rejected.length!==want.length)process.exit(1);if(n.rejected.length!==0||l.rejected.length!==0)process.exit(1)})"; if ($LASTEXITCODE -ne 0) { exit 1 }; Write-Output "AC-021 OK"`
- 期望: 退出码 0。等价于基准旧命令打印 `true true true 0 0`：Heavy 下 `reason === 'E_FORECAST_EXHAUSTION'` 的 key 集合恰等于 `expected.risk ∈ {exhausted, critical, low_reserve}` 的金标用例集合（≥ 5 个），且 `rejected` 只有这些；Normal 与 Light 下没有任何拒选。

## AC-021 A-10 heavyRejection 与导出清单

- 命令: `node -e "import('file:///C:/git/dsh-CLIWorker/.collab/worktrees/007/lib/select-draft.mjs').then(m=>{const keys=Object.keys(m).sort().join(',');if(keys!=='HANDLE_SCHEMA,HEAVY_REJECT_RISKS,SELECTION_SCHEMA,draftHandle,draftSelection,heavyRejection')process.exit(1);const f=(r)=>({risk:r});for(const r of ['exhausted','critical','low_reserve']){const x=m.heavyRejection({key:'k',usage:'Heavy',forecast:f(r)});if(!x||x.reason!=='E_FORECAST_EXHAUSTION'||x.key!=='k')process.exit(1)}for(const r of ['ok','unknown']){if(m.heavyRejection({key:'k',usage:'Heavy',forecast:f(r)})!==null)process.exit(1)}if(m.heavyRejection({key:'k',usage:'Heavy'})!==null)process.exit(1);if(m.heavyRejection({key:'k',usage:'Normal',forecast:f('exhausted')})!==null)process.exit(1);if(m.heavyRejection({key:'k',usage:'Light',forecast:f('critical')})!==null)process.exit(1);if(m.SELECTION_SCHEMA!=='cliworker.selection/v1'||m.HANDLE_SCHEMA!=='cliworker.handle/v1')process.exit(1);if(JSON.stringify(m.HEAVY_REJECT_RISKS)!==JSON.stringify(['exhausted','critical','low_reserve']))process.exit(1)})"; if ($LASTEXITCODE -ne 0) { exit 1 }; Write-Output "AC-021 OK"`
- 期望: 退出码 0。等价于基准旧命令的三行输出：导出清单恰为 `HANDLE_SCHEMA,HEAVY_REJECT_RISKS,SELECTION_SCHEMA,draftHandle,draftSelection,heavyRejection`；三种高风险拒绝、`ok`/`unknown`/缺 forecast 与 `Normal`/`Light` 不拒；两个 schema 字符串与冻结的 risk 数组不变。

## AC-021 A-11 a1-quota.test.mjs 未被修改

- 命令: `$o = & git -C C:/git/dsh-CLIWorker/.collab/worktrees/007 diff f6f6057 -- test/characterization/defects/a1-quota.test.mjs; if ($LASTEXITCODE -ne 0) { exit 1 }; if ("$o".Trim().Length -ne 0) { exit 1 }; Write-Output "AC-021 OK"`
- 期望: 退出码 0；无输出（该文件归 T-006，本任务只在 `select-draft.test.mjs` 里断言 draft 拒选）。

## AC-022 A-12 过滤运行 AC-022

- 命令: `$o = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/run-tests.mjs --ac AC-022 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if (-not ($o -match 'fail 0')) { exit 1 }; if (-not ($o -match 'filtered 2 files')) { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；输出含 `fail 0` 与 `filtered 2 files`。

## AC-022 A-13 对 lib 报告 0

- 命令: `$o = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-unused.mjs 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if ("$o".Trim() -notmatch '^check-unused: ok \(files=[1-9][0-9]*\)$') { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；输出恰为 `check-unused: ok (files=N)`，N 为 `lib` 下 `.mjs/.js/.cjs` 文件数且大于 0。基准上脚本不存在，命令报 `Cannot find module`、退出码 1。

## AC-022 A-14 对夹具恰好报告 8 项

- 命令: `$o = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-unused.mjs --json C:/git/dsh-CLIWorker/.collab/worktrees/007/test/fixtures/unused 2>&1; if ($LASTEXITCODE -ne 1) { exit 1 }; $j = ($o | Out-String) | ConvertFrom-Json; $e = (Get-Content -Raw C:/git/dsh-CLIWorker/.collab/worktrees/007/test/fixtures/unused/expected.json) | ConvertFrom-Json; $got = @($j.items | ForEach-Object { $_.file + '|' + $_.kind + '|' + $_.name } | Sort-Object); $want = @($e.items | ForEach-Object { $_.file + '|' + $_.kind + '|' + $_.name } | Sort-Object); if ($got.Count -ne 8) { exit 1 }; if (Compare-Object $got $want) { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 1（有未使用项）；stdout 是单个 JSON，`items` 恰为 8 项并与 `expected.json` 集合一致：`dirty/functions.mjs` 的 `deadAsync`、`deadGen`、`deadHelper`、`deadRecursive`（kind 为 `function`），`dirty/imports.mjs` 的 `fs`、`joinPath`、`os`、`readFileSync`（kind 为 `import`）。

## AC-022 A-15 干净夹具报告 0

- 命令: `$o = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-unused.mjs C:/git/dsh-CLIWorker/.collab/worktrees/007/test/fixtures/unused/clean 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if ("$o".Trim() -ne 'check-unused: ok (files=1)') { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；输出恰为 `check-unused: ok (files=1)`。

## AC-022 A-16 用法错误退出 2

- 命令: `$a = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-unused.mjs --no-such-flag 2>&1; if ($LASTEXITCODE -ne 2) { exit 1 }; if ("$a" -match 'check-unused: ok') { exit 1 }; $b = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-unused.mjs C:/git/dsh-CLIWorker/.collab/worktrees/007/no/such/dir 2>&1; if ($LASTEXITCODE -ne 2) { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 两次都退出码 2；未知参数时 stderr 有用法说明、输出中没有 `check-unused: ok`。

## AC-022 A-17 a5-unused 的 [fixed] 段通过且死函数已删

- 命令: `$o = & node --test C:/git/dsh-CLIWorker/.collab/worktrees/007/test/characterization/defects/a5-unused.test.mjs 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if (-not ($o -match 'pass 2')) { exit 1 }; if (-not ($o -match 'fail 0')) { exit 1 }; $s = Get-Content -Raw C:/git/dsh-CLIWorker/.collab/worktrees/007/lib/select.mjs; if ($s -cmatch 'isObject') { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；`pass 2`、`fail 0`；`lib/select.mjs` 源码中 `isObject` 出现 0 次。

## AC-022 A-18 扫描器自身不留下未使用项

- 命令: `$o = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-unused.mjs C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-unused.mjs 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if ("$o".Trim() -ne 'check-unused: ok (files=1)') { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；输出恰为 `check-unused: ok (files=1)`。

## AC-022 A-19 只删了 typeOf，其余未动

- 命令: `$o = & git -C C:/git/dsh-CLIWorker/.collab/worktrees/007 diff --numstat f6f6057 -- lib/contract/validate.mjs; $c = $LASTEXITCODE; $s = Get-Content -Raw C:/git/dsh-CLIWorker/.collab/worktrees/007/lib/contract/validate.mjs; $n = "$o".Trim(); if ($c -ne 0 -or $n -notmatch '^0\s+[67]\s+lib/contract/validate\.mjs$' -or $s -cmatch 'typeOf') { Write-Output "numstat=[$n] code=$c typeOf=[$($s -cmatch 'typeOf')]"; exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；`git diff --numstat` 输出 `0<TAB>7<TAB>lib/contract/validate.mjs`（新增 0 行、删除 7 行：`typeOf` 的 6 行函数加其后 1 个空行；若删的是空行的另一侧，删除行数允许为 6）；文件内容不再含 `typeOf`。

## AC-022 A-20 缺陷账本门禁

- 命令: `$o = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-defects.mjs 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if ("$o".Trim() -ne 'check-defects: ok') { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；输出 `check-defects: ok`（三个缺陷文件的 `[repro]` sha256 与 `defects.json` 一致）。

## AC-022 A-21 追踪门禁

- 命令: `$o = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-traceability.mjs 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if ("$o".Trim() -ne 'check-traceability: ok (covered=22 planned=52)') { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；输出 `check-traceability: ok (covered=22 planned=52)`（基准是 covered=19 planned=55，AC-020、AC-021、AC-022 由 planned 变 covered）。

## AC-022 A-22 缝隙门禁

- 命令: `$o = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-seams.mjs 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if ("$o".Trim() -notmatch '^check-seams: ok \(files=2[12]\)$') { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；输出形如 `check-seams: ok (files=22)`（比基准多 `lib/select-draft.mjs` 与 `scripts/check-unused.mjs`；若该检查不扫 `scripts/` 则为 `files=21`）。

## AC-022 A-23 无协作目录引用与金标冻结

- 命令: `$o = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-no-collab.mjs 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if ("$o".Trim() -notmatch '^check-no-collab: ok') { exit 1 }; $g = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-golden-frozen.mjs 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if ("$g".Trim() -ne 'check-golden-frozen: ok (14 files)') { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；`check-no-collab: ok` 开头；`check-golden-frozen: ok (14 files)`（金标未被改动）。

## AC-022 A-24 写域

- 命令: `$o = & node C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-write-scope.mjs --base f6f6057 --scope-from C:/git/dsh-CLIWorker/.collab/worktrees/007/.collab/tasks/007/design.md 2>&1; if (-not ("$o" -match 'check-write-scope: (ok|FAILED)')) { exit 1 }; $bad = @($o | Where-Object { $_ -match '^FAIL' -and $_ -notmatch '^FAIL write_scope\.outside \.collab/' }); if ($bad.Count -ne 0) { $bad; exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；没有 FAIL 行指向 `.collab/` 之外。`check-write-scope` 会把调度器维护的 `.collab/tasks/007/` 与 `.collab/blueprint/` 文件当作越界（它们在判定范围内但不由实现者创建），因此本命令只断言这些越界报告全部以 `.collab/` 开头；`lib`、`scripts`、`test` 下的改动必须全部落在 `design.md` 的 write_scope 内。若把这些调度器文件也算进去，报告行数与 `impl.md` 记录的基线一致。

## AC-022 A-25 整体检查

- 命令: `$o = & pwsh -NoProfile -File C:/git/dsh-CLIWorker/.collab/worktrees/007/scripts/check-fast.ps1 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if (-not ($o -match 'check-fast: ok')) { exit 1 }; if (-not ($o -match 'check-unused: ok')) { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；输出含 `check-fast: ok`，且 `check-unused` 作为 `check-*` 步骤被运行并通过（输出里有 `check-unused: ok`）。

## AC-022 A-26 全量测试

- 命令: `$o = & npm --prefix C:/git/dsh-CLIWorker/.collab/worktrees/007 test 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; if (-not ($o -match 'fail 0')) { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；输出含 `fail 0`（`run-tests: full 34 files`）。

## AC-022 A-27 零第三方运行时依赖

- 命令: `node -e "const p=require('C:/git/dsh-CLIWorker/.collab/worktrees/007/package.json');if(Object.keys(p.dependencies||{}).length!==0)process.exit(1)"; if ($LASTEXITCODE -ne 0) { exit 1 }; $d = & git -C C:/git/dsh-CLIWorker/.collab/worktrees/007 diff f6f6057 -- package.json package-lock.json; if ($LASTEXITCODE -ne 0) { exit 1 }; if ("$d".Trim().Length -ne 0) { exit 1 }; Write-Output "AC-022 OK"`
- 期望: 退出码 0；`dependencies` 数量为 0；`package.json` 与 `package-lock.json` 相对基准无 diff。
