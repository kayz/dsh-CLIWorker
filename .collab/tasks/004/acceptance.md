# Task 004 验收标准

规格来源：同目录 design.md 与 brief.md。基线提交 93ebbb3（task/004 起点）；既有验收基线是 `node scripts/check-traceability.mjs` 在起点输出 `check-traceability: ok (covered=5 planned=69)`，本任务完成后应为 `covered=9 planned=65`。

执行约定：

- 环境为 PowerShell 7（pwsh），工作目录是仓库根 C:\git\dsh-CLIWorker\.collab\worktrees\004。
- 每个小节是一条独立检查，形式为标题加一行「- 命令: 」加单行可执行命令，再加若干「- 期望: 」断言要点。
- 命令自包含，不依赖其它小节定义的变量或函数；成功时在 stdout 打印该小节对应 AC 编号加 OK 的字符串（例如 AC-009 OK），并以退出码 0 结束；任一断言失败则抛出错误、以非 0 退出。
- 判定标准：退出码 0 且 stdout 含该 AC 的 OK 字符串。
- 涉及破坏性场景（删除、改名、篡改）的检查在仓库外的临时目录里完成。
- AC-073 的「被 git 跟踪」以 git ls-files 为准，因此本任务产物必须先以显式路径暂存。
- 不属于本任务、因此不作为失败依据的事项：`node scripts/milestone-gate.mjs --milestone M1` 仍因其它任务的 AC 未覆盖而 BLOCKED；`npm run snapshot:update` 仍指向 run-tests --update-snapshots（本任务入口为 node scripts/snapshot-update.mjs）。

## AC-009 A-1 测试入口

- 命令: `$o = (node scripts/run-tests.mjs --ac AC-009 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw "run-tests exited $e" }; if ($o -notmatch 'run-tests: filtered') { throw 'missing run-tests: filtered' }; if ($o.Contains([string][char]0x2716)) { throw 'output contains the failure mark' }; Write-Output 'AC-009 OK'`
- 期望: 输出含 run-tests: filtered。
- 期望: 退出码 0。
- 期望: 输出里没有失败标记行。

## AC-009 B-1 测试标题齐全

- 命令: `$o = (node scripts/run-tests.mjs --ac AC-009 2>&1 | Out-String); if ($LASTEXITCODE -ne 0) { throw 'run-tests failed' }; $t = @('[AC-009] REGISTRY deep-equals contracts/registry.snapshot.json','[AC-009] every code has exit, http_status, retryable, trigger_id and trigger','[AC-009] trigger_id and trigger text are unique across the table','[AC-009] codes, exits and retryable flags match the frozen exit-code table','[AC-009] the five 403 codes have mutually exclusive triggers','[AC-009] write route order is session, readonly, csrf, body','[AC-009] resolveView applies the select view rules','[AC-009] lib/contract modules are pure and import nothing','[AC-009] every schema uses only supported keywords','[AC-009] every valid example passes its schema','[AC-009] every invalid example fails with exactly the declared path and keyword','[AC-009] every wire schema has one valid and two invalid examples','[AC-009] schema enums for codes, warnings and reject reasons equal the registry','[AC-009] validator reports the expected path for each supported keyword','[AC-009] examples carry no token-like strings'); $m = @($t | Where-Object { -not $o.Contains($_) }); if ($m.Count -ne 0) { throw ('missing titles: ' + ($m -join ' | ')) }; Write-Output 'AC-009 OK'`
- 期望: design 第 11 节的 15 个 AC-009 测试标题全部出现在测试输出里。

## AC-009 C-1 注册表与快照深相等

- 命令: `node --input-type=module -e "import {REGISTRY} from './lib/contract/registry.mjs'; import fs from 'node:fs'; import assert from 'node:assert/strict'; assert.deepStrictEqual(JSON.parse(JSON.stringify(REGISTRY)), JSON.parse(fs.readFileSync('contracts/registry.snapshot.json','utf8'))); console.log('AC-009 OK')"`
- 期望: REGISTRY 与 contracts/registry.snapshot.json 深相等。

## AC-009 C-2 快照的版本、码数与唯一性

- 命令: `node -e "const s=JSON.parse(require('fs').readFileSync('contracts/registry.snapshot.json','utf8'));const c=s.codes;const got=[s.snapshot_version,c.length,new Set(c.map(x=>x.trigger_id)).size,new Set(c.map(x=>x.trigger)).size,c.filter(x=>x.retryable).map(x=>x.code).join('+')].join(' ');const want='1 30 30 30 E_TIMEOUT+E_INSUFFICIENT_QUOTA+E_LEASE_EXPIRED';if(got!==want){throw new Error('got: '+got)}console.log('AC-009 OK')"`
- 期望: snapshot_version 为 1，30 个码，30 个互不相同的 trigger_id 与 trigger。
- 期望: retryable 为真的恰好是 E_TIMEOUT、E_INSUFFICIENT_QUOTA、E_LEASE_EXPIRED。

## AC-009 C-3 五个 403 码的退出码与触发编号

- 命令: `node -e "const c=require('./contracts/registry.snapshot.json').codes.filter(x=>x.http_status===403);const got=c.map(x=>x.code+':'+x.exit+':'+x.trigger_id).join(' ');const want='E_VIEW_FORBIDDEN:2:select_view_without_admin E_ADMIN_REQUIRED:8:admin_route_no_session E_LOOPBACK_ONLY:8:bootstrap_non_loopback E_READONLY:8:write_route_readonly E_CSRF:8:write_route_csrf_invalid';if(got!==want){throw new Error('got: '+got)}console.log('AC-009 OK')"`
- 期望: 五个 403 码的 exit 与 trigger_id 逐字为 E_VIEW_FORBIDDEN 2 select_view_without_admin、E_ADMIN_REQUIRED 8 admin_route_no_session、E_LOOPBACK_ONLY 8 bootstrap_non_loopback、E_READONLY 8 write_route_readonly、E_CSRF 8 write_route_csrf_invalid。

## AC-009 C-4 写路由判定顺序

- 命令: `node -e "const s=require('./contracts/registry.snapshot.json');const got=s.write_route_order.join(',');if(got!=='session,readonly,csrf,body'){throw new Error('got: '+got)}console.log('AC-009 OK')"`
- 期望: write_route_order 逐字为 session,readonly,csrf,body。

## AC-009 C-5 示例目录的 14 组正反例

- 命令: `node -e "const fs=require('fs');const d='contracts/examples';const names=fs.readdirSync(d).sort();const want='config.v2 error-envelope event.v1 forecast.v1 handle-full.v1 handle.v1 inventory.v1 model.v1 pool request.v1 selection-failed.v1 selection-ok.v1 session.v1 usage.v1';if(names.length!==14){throw new Error('dir count '+names.length)};if(names.join(' ')!==want){throw new Error('names: '+names.join(' '))};for(const n of names){if(fs.readdirSync(d+'/'+n+'/valid').length<1){throw new Error('no valid example: '+n)};if(fs.readdirSync(d+'/'+n+'/invalid').length<2){throw new Error('fewer than two invalid examples: '+n)}};console.log('AC-009 OK')"`
- 期望: 恰好 14 个示例目录，名称与顺序逐字一致。
- 期望: 每个目录至少 1 个正例、至少 2 个反例。

## AC-009 C-6 schema 文件数量

- 命令: `node -e "const n=require('fs').readdirSync('contracts/schemas').filter(x=>x.endsWith('.schema.json')).length;if(n!==21){throw new Error('got '+n)}console.log('AC-009 OK')"`
- 期望: contracts/schemas 下有 21 个 .schema.json 文件。

## AC-009 C-7 注册表模块零 import

- 命令: `node -e "const t=require('fs').readFileSync('lib/contract/registry.mjs','utf8');if(/^\s*import\s/m.test(t)){throw new Error('import statement found')}console.log('AC-009 OK')"`
- 期望: lib/contract/registry.mjs 中没有任何 import 语句。

## AC-009 C-8 lib/contract 纯函数性

- 命令: `node -e "const fs=require('fs');const bad=fs.readdirSync('lib/contract').filter(n=>n.endsWith('.mjs')).filter(n=>/node:|Date\.now|new Date|setTimeout|setInterval|setImmediate|process\.env/.test(fs.readFileSync('lib/contract/'+n,'utf8')));if(bad.length){throw new Error('impure: '+bad.join(' '))}console.log('AC-009 OK')"`
- 期望: lib/contract 下的模块都不含 node: 导入、时钟、定时器或环境读取。

## AC-010 A-2 测试入口

- 命令: `$o = (node scripts/run-tests.mjs --ac AC-010 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw "run-tests exited $e" }; if ($o -notmatch 'run-tests: filtered') { throw 'missing run-tests: filtered' }; if ($o.Contains([string][char]0x2716)) { throw 'output contains the failure mark' }; Write-Output 'AC-010 OK'`
- 期望: 输出含 run-tests: filtered。
- 期望: 退出码 0。
- 期望: 输出里没有失败标记行。

## AC-010 B-2 测试标题齐全

- 命令: `$o = (node scripts/run-tests.mjs --ac AC-010 2>&1 | Out-String); if ($LASTEXITCODE -ne 0) { throw 'run-tests failed' }; $t = @('[AC-010] compareRegistry reports removed for a deleted code','[AC-010] compareRegistry reports removed and added for a renamed code','[AC-010] compareRegistry reports changed for a modified field','[AC-010] compareRegistry reports nothing for identical registries','[AC-010] checkFrozen fails for a deleted code, a renamed code and an added code with a stale snapshot','[AC-010] snapshot-update is a no-op on an unchanged registry','[AC-010] snapshot-update writes the snapshot only when snapshot_version is previous plus one','[AC-010] snapshot-update refuses an addition without a version bump','[AC-010] snapshot-update refuses removed, renamed or changed entries','[AC-010] snapshot holds reject reasons, risk thresholds, availability, warning codes, draft mapping and semantic_change'); $m = @($t | Where-Object { -not $o.Contains($_) }); if ($m.Count -ne 0) { throw ('missing titles: ' + ($m -join ' | ')) }; Write-Output 'AC-010 OK'`
- 期望: design 第 11 节的 10 个 AC-010 测试标题全部出现在测试输出里。

## AC-010 D-1 compareRegistry 的 removed、renamed 与 identical

- 命令: `node --input-type=module -e "import {REGISTRY as r, compareRegistry as cmp} from './lib/contract/registry.mjs'; const a=structuredClone(r); a.codes=a.codes.filter(c=>c.code!=='E_CSRF'); const b=structuredClone(r); b.codes=b.codes.map(c=>c.code==='E_CSRF'?{...c,code:'E_CSRF2'}:c); const same=(x,y)=>JSON.stringify(x)===JSON.stringify(y); if(!same(cmp(r,a),{removed:['codes:E_CSRF'],added:[],changed:[]})){throw new Error('deleted code mismatch: '+JSON.stringify(cmp(r,a)))}; if(!same(cmp(r,b),{removed:['codes:E_CSRF'],added:['codes:E_CSRF2'],changed:[]})){throw new Error('renamed code mismatch: '+JSON.stringify(cmp(r,b)))}; if(!same(cmp(r,structuredClone(r)),{removed:[],added:[],changed:[]})){throw new Error('identical registries mismatch')}; console.log('AC-010 OK')"`
- 期望: 删除 E_CSRF 只报 removed 的 codes:E_CSRF。
- 期望: 改名报 removed 的 codes:E_CSRF 与 added 的 codes:E_CSRF2。
- 期望: 相同注册表三组均为空。

## AC-010 D-2 snapshot-update 在未改动注册表上是空操作

- 命令: `$b = (git status --short -- contracts/registry.snapshot.json | Out-String); $o = (node scripts/snapshot-update.mjs 2>&1 | Out-String); $e = $LASTEXITCODE; $a = (git status --short -- contracts/registry.snapshot.json | Out-String); if ($e -ne 0) { throw "snapshot-update exited $e" }; if (-not $o.Contains('snapshot-update: unchanged (snapshot_version 1)')) { throw ('unexpected output: ' + $o) }; if ($a -ne $b) { throw 'snapshot file was rewritten' }; Write-Output 'AC-010 OK'`
- 期望: 首行 snapshot-update: unchanged (snapshot_version 1)。
- 期望: 退出码 0，且运行后快照文件未被改写。

## AC-010 D-3 快照的枚举、映射与阈值计数

- 命令: `node -e "const s=require('./contracts/registry.snapshot.json');const got=[s.reject_reasons.v1.length,s.reject_reasons.admin_only.join(),s.reject_reasons.draft.length,s.draft_reason_mapping.length,s.warning_codes.length,s.forecast_reasons.length,s.risk.length,s.risk_basis.length,s.tasks_left_basis.length,s.availability.length,s.identity.length,s.semantic_change.join('+'),s.thresholds.tasks.length,s.thresholds.fraction.length,s.thresholds.priority.join('>')].join(' ');const want='15 not_allowed 7 10 8 7 5 4 3 5 3 forecast.tasks_left+forecast.risk+handle.cli_removed+draft_reason_mapping+config_v1_to_v2 4 4 tasks>usd>fraction>unknown';if(got!==want){throw new Error('got: '+got)}console.log('AC-010 OK')"`
- 期望: 各枚举与映射计数逐字为 15 not_allowed 7 10 8 7 5 4 3 5 3，semantic_change 五项按序，两张阈值表各 4 项，priority 为 tasks>usd>fraction>unknown。

## AC-010 D-4 两张阈值表的边界

- 命令: `node -e "const t=require('./contracts/registry.snapshot.json').thresholds;const same=(x,y)=>JSON.stringify(x)===JSON.stringify(y);if(!same(t.tasks.map(x=>[x.risk,x.op,x.value]),[['exhausted','<=',0],['critical','<=',2],['low_reserve','<=',5],['ok','else',null]])){throw new Error('tasks table mismatch: '+JSON.stringify(t.tasks))};if(!same(t.fraction.map(x=>[x.risk,x.op,x.value]),[['exhausted','<=',0],['critical','<',0.05],['low_reserve','<',0.15],['ok','else',null]])){throw new Error('fraction table mismatch: '+JSON.stringify(t.fraction))};console.log('AC-010 OK')"`
- 期望: thresholds.tasks 为 exhausted <= 0、critical <= 2、low_reserve <= 5、ok else null。
- 期望: thresholds.fraction 为 exhausted <= 0、critical < 0.05、low_reserve < 0.15、ok else null。

## AC-011 A-3 测试入口

- 命令: `$o = (node scripts/run-tests.mjs --ac AC-011 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw "run-tests exited $e" }; if ($o -notmatch 'run-tests: filtered') { throw 'missing run-tests: filtered' }; if ($o.Contains([string][char]0x2716)) { throw 'output contains the failure mark' }; Write-Output 'AC-011 OK'`
- 期望: 输出含 run-tests: filtered。
- 期望: 退出码 0。
- 期望: 输出里没有失败标记行。

## AC-011 B-3 测试标题齐全

- 命令: `$o = (node scripts/run-tests.mjs --ac AC-011 2>&1 | Out-String); if ($LASTEXITCODE -ne 0) { throw 'run-tests failed' }; $t = @('[AC-011] every forbidden key is detected at depth 1','[AC-011] every forbidden key is detected at depth 3','[AC-011] forbidden keys are detected inside arrays, warnings, error and rejected','[AC-011] forbidden key matching is case-insensitive and exact','[AC-011] every forbidden value is detected at depth 1 and depth 3','[AC-011] forbidden values match whole words after tokenizing','[AC-011] cliworker, config and dsh-CLIWorker are not reported','[AC-011] the call subtree skips value scanning but must equal the wrapper template','[AC-011] clean examples produce zero hits','[AC-011] deeply nested input does not overflow the stack'); $m = @($t | Where-Object { -not $o.Contains($_) }); if ($m.Count -ne 0) { throw ('missing titles: ' + ($m -join ' | ')) }; Write-Output 'AC-011 OK'`
- 期望: design 第 11 节的 10 个 AC-011 测试标题全部出现在测试输出里。

## AC-011 E-1 禁用键配置的形态

- 命令: `node -e "const f=require('./contracts/agentline-forbidden.json');const got=[f.schema,f.keys.length,f.keys.every(k=>k===k.toLowerCase()),f.keys.includes('detail'),f.call.keys.join(','),f.call.args.length].join(' ');const want='cliworker.agentline-forbidden/v1 25 true false command,args,cwd,input,output,timeout_ms 8';if(got!==want){throw new Error('got: '+got)}console.log('AC-011 OK')"`
- 期望: 25 个全小写禁用键，不含 detail。
- 期望: call.keys 逐字为 command,args,cwd,input,output,timeout_ms，call.args 为 8 项。

## AC-011 E-2 禁用键与禁用值的命中路径

- 命令: `node --input-type=module -e "import {scanView} from './lib/contract/scan.mjs'; import fs from 'node:fs'; const forbidden=JSON.parse(fs.readFileSync('contracts/agentline-forbidden.json','utf8')); const catalog={models:[{key:'k:zeta-model-9',id:'zeta-model-9',cli:'zetacli'}]}; const w={command:'node',bin:'bin/cliworker.mjs',state_dir:'/s',config:'/c'}; const hit=scanView({a:{b:{Model_Key:'x'}}},{forbidden,catalog,wrapper:w}); const val=scanView({a:[{m:'use zeta-model-9 now'}]},{forbidden,catalog,wrapper:w}); const clean=scanView({note:'cliworker config dsh-CLIWorker'},{forbidden,catalog,wrapper:w}); const same=(x,y)=>JSON.stringify(x)===JSON.stringify(y); if(!same(hit.hits.map(h=>[h.path,h.kind]),[['/a/b/Model_Key','forbidden_key']])){throw new Error('key hit mismatch: '+JSON.stringify(hit.hits))}; if(!same(val.hits.map(h=>[h.path,h.kind]),[['/a/0/m','forbidden_value']])){throw new Error('value hit mismatch: '+JSON.stringify(val.hits))}; if(!clean.ok||clean.hits.length!==0){throw new Error('clean sample produced hits')}; console.log('AC-011 OK')"`
- 期望: 禁用键在 /a/b/Model_Key 以 forbidden_key 命中。
- 期望: 禁用值在 /a/0/m 以 forbidden_value 命中。
- 期望: 干净样例 0 命中。

## AC-011 E-3 call 子树的模板比对

- 命令: `node --input-type=module -e "import {scanView} from './lib/contract/scan.mjs'; import fs from 'node:fs'; const forbidden=JSON.parse(fs.readFileSync('contracts/agentline-forbidden.json','utf8')); const catalog={models:[{key:'k:zeta-model-9',id:'zeta-model-9',cli:'zetacli'}]}; const w={command:'node',bin:'bin/cliworker.mjs',state_dir:'/s',config:'/c'}; const call=(over)=>({command:'node',args:['bin/cliworker.mjs','run','--lease','l_abc','--state-dir','/s','--config','/c'],cwd:'C:/work/zeta-model-9',input:'stdin',output:'cliworker.event/v1',timeout_ms:1000,...over}); const v=(c)=>({models:[{lease_id:'l_abc',call:c}],calls:[c]}); const ok=scanView(v(call({})),{forbidden,catalog,wrapper:w}); const bad=scanView(v(call({command:'zetacli'})),{forbidden,catalog,wrapper:w}); if(!ok.ok||ok.hits.length!==0){throw new Error('compliant call produced hits: '+JSON.stringify(ok.hits))}; if(bad.ok){throw new Error('tampered call passed')}; const kinds=[...new Set(bad.hits.map(h=>h.kind))]; if(kinds.length!==1||kinds[0]!=='call_mismatch'){throw new Error('unexpected kinds: '+kinds.join())}; console.log('AC-011 OK')"`
- 期望: 合规 call 0 命中，cwd 含模型 id 不算命中。
- 期望: 改 command 只报 call_mismatch。

## AC-073 A-4 测试入口

- 命令: `$o = (node scripts/run-tests.mjs --ac AC-073 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw "run-tests exited $e" }; if ($o -notmatch 'run-tests: filtered') { throw 'missing run-tests: filtered' }; if ($o.Contains([string][char]0x2716)) { throw 'output contains the failure mark' }; Write-Output 'AC-073 OK'`
- 期望: 输出含 run-tests: filtered。
- 期望: 退出码 0。
- 期望: 输出里没有失败标记行。

## AC-073 B-4 测试标题齐全

- 命令: `$o = (node scripts/run-tests.mjs --ac AC-073 2>&1 | Out-String); if ($LASTEXITCODE -ne 0) { throw 'run-tests failed' }; $t = @('[AC-073] snapshot, spec, golden and forbidden files are tracked by git and not ignored','[AC-073] every spec and golden file validates against its schema','[AC-073] golden files hold the required case ids','[AC-073] manifest registers every spec and golden file with its normalized sha256','[AC-073] check-golden-frozen fails when a golden file is modified','[AC-073] check-golden-frozen fails when a golden file is added','[AC-073] check-golden-frozen fails when a golden file is deleted','[AC-073] check-write-scope reports an unregistered spec or golden file','[AC-073] check-write-scope reports changes outside the write scope','[AC-073] check-write-scope reads write_scope from markdown front matter','[AC-073] check-no-collab reports zero references in the repository','[AC-073] check-no-collab reports the violating fixture and passes the clean fixture','[AC-073] gen-contract-doc output equals the committed docs/contract.md','[AC-073] check-contract-doc fails on a stale document','[AC-073] snapshot contains every code, trigger, threshold, reason, mapping and semantic_change of interfaces section 5','[AC-073] new check scripts are discoverable by check-fast'); $m = @($t | Where-Object { -not $o.Contains($_) }); if ($m.Count -ne 0) { throw ('missing titles: ' + ($m -join ' | ')) }; Write-Output 'AC-073 OK'`
- 期望: design 第 11 节的 16 个 AC-073 测试标题全部出现在测试输出里。

## AC-073 F-1 金标冻结检查通过

- 命令: `$o = (node scripts/check-golden-frozen.mjs 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw "exit $e" }; if (-not $o.Contains('check-golden-frozen: ok (14 files)')) { throw ('unexpected output: ' + $o) }; Write-Output 'AC-073 OK'`
- 期望: 首行 check-golden-frozen: ok (14 files)，退出码 0。

## AC-073 F-2 金标清单的内容

- 命令: `node -e "const m=require('./contracts/golden/manifest.json');const got=[m.schema,m.files.length,m.files.some(f=>f.path.endsWith('manifest.json')),m.files.some(f=>f.path==='contracts/spec/ac-index.json'),m.files.some(f=>f.path==='contracts/registry.snapshot.json'),m.files.every(f=>f.sha256.length===64&&f.sha256===f.sha256.toLowerCase()),JSON.stringify(m.files.map(f=>f.path))===JSON.stringify(m.files.map(f=>f.path).sort())].join(' ');const want='cliworker.golden-manifest/v1 14 false true false true true';if(got!==want){throw new Error('got: '+got)}console.log('AC-073 OK')"`
- 期望: 14 个文件，不含 manifest 自身与 registry.snapshot.json，含 contracts/spec/ac-index.json。
- 期望: 哈希均为 64 位小写十六进制，路径按码点升序。

## AC-073 F-3 修改金标后冻结检查失败

- 命令: `$t = Join-Path ([IO.Path]::GetTempPath()) 'ac073-mod'; Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $t | Out-Null; Copy-Item contracts -Destination $t -Recurse; Add-Content "$t/contracts/golden/b44.json" ' '; $o = (node scripts/check-golden-frozen.mjs --root $t 2>&1 | Out-String); $e = $LASTEXITCODE; Remove-Item $t -Recurse -Force; if ($e -ne 1) { throw "exit $e" }; if (-not $o.Contains('FAIL golden.changed contracts/golden/b44.json')) { throw ('missing changed line: ' + $o) }; if (-not $o.Contains('check-golden-frozen: FAILED (1 errors)')) { throw ('missing FAILED line: ' + $o) }; Write-Output 'AC-073 OK'`
- 期望: 输出含 FAIL golden.changed contracts/golden/b44.json 与 check-golden-frozen: FAILED (1 errors)，退出码 1。

## AC-073 F-4 新增金标后冻结检查失败

- 命令: `$t = Join-Path ([IO.Path]::GetTempPath()) 'ac073-add'; Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $t | Out-Null; Copy-Item contracts -Destination $t -Recurse; Set-Content -Encoding utf8NoBOM "$t/contracts/golden/extra.json" '{}'; $o = (node scripts/check-golden-frozen.mjs --root $t 2>&1 | Out-String); $e = $LASTEXITCODE; Remove-Item $t -Recurse -Force; if ($e -ne 1) { throw "exit $e" }; if (-not $o.Contains('FAIL golden.unregistered contracts/golden/extra.json')) { throw ('missing unregistered line: ' + $o) }; if (-not $o.Contains('check-golden-frozen: FAILED (1 errors)')) { throw ('missing FAILED line: ' + $o) }; Write-Output 'AC-073 OK'`
- 期望: 输出含 FAIL golden.unregistered contracts/golden/extra.json 与 check-golden-frozen: FAILED (1 errors)，退出码 1。

## AC-073 F-5 删除金标后冻结检查失败

- 命令: `$t = Join-Path ([IO.Path]::GetTempPath()) 'ac073-del'; Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $t | Out-Null; Copy-Item contracts -Destination $t -Recurse; Remove-Item "$t/contracts/golden/capacity.json"; $o = (node scripts/check-golden-frozen.mjs --root $t 2>&1 | Out-String); $e = $LASTEXITCODE; Remove-Item $t -Recurse -Force; if ($e -ne 1) { throw "exit $e" }; if (-not $o.Contains('FAIL golden.missing contracts/golden/capacity.json')) { throw ('missing missing-line: ' + $o) }; if (-not $o.Contains('check-golden-frozen: FAILED (1 errors)')) { throw ('missing FAILED line: ' + $o) }; Write-Output 'AC-073 OK'`
- 期望: 输出含 FAIL golden.missing contracts/golden/capacity.json 与 check-golden-frozen: FAILED (1 errors)，退出码 1。

## AC-073 F-6 登记清单之外的规格文件

- 命令: `$t = Join-Path ([IO.Path]::GetTempPath()) 'ac073-ws'; Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $t | Out-Null; Copy-Item contracts -Destination $t -Recurse; Set-Content -Encoding utf8NoBOM "$t/contracts/spec/x.json" '{}'; $o = (node scripts/check-write-scope.mjs --root $t 2>&1 | Out-String); $e = $LASTEXITCODE; Remove-Item $t -Recurse -Force; if ($e -ne 1) { throw "exit $e" }; if (-not $o.Contains('FAIL write_scope.unregistered contracts/spec/x.json')) { throw ('missing unregistered line: ' + $o) }; if (-not $o.Contains('check-write-scope: FAILED (1 errors)')) { throw ('missing FAILED line: ' + $o) }; Write-Output 'AC-073 OK'`
- 期望: 输出含 FAIL write_scope.unregistered contracts/spec/x.json 与 check-write-scope: FAILED (1 errors)，退出码 1。

## AC-073 F-7 写域检查（登记模式）通过

- 命令: `$o = (node scripts/check-write-scope.mjs 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw "exit $e" }; if (-not $o.Contains('check-write-scope: ok')) { throw ('unexpected output: ' + $o) }; Write-Output 'AC-073 OK'`
- 期望: 输出 check-write-scope: ok，退出码 0。

## AC-073 F-8 本任务全部变更落在 design.md 的 write_scope 内

- 命令: `$o = (node scripts/check-write-scope.mjs --base 93ebbb3 --scope-from .collab/tasks/004/design.md --scope '.collab/tasks/004/**' 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw ('exit ' + $e + ': ' + $o) }; if (-not $o.Contains('check-write-scope: ok')) { throw ('unexpected output: ' + $o) }; Write-Output 'AC-073 OK'`
- 期望: 输出 check-write-scope: ok，退出码 0。
- 期望: 变更集不越出 design.md 的 write_scope（.collab/tasks/004/** 只用于放行调度器自己的运行产物）。

## AC-073 F-9 范围检查能报出越界变更

- 命令: `$o = (node scripts/check-write-scope.mjs --base 93ebbb3 --scope 'lib/contract/**' 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 1) { throw "exit $e" }; if (-not $o.Contains('FAIL write_scope.outside')) { throw ('missing outside line: ' + $o) }; if (-not $o.Contains('check-write-scope: FAILED (')) { throw ('missing FAILED line: ' + $o) }; Write-Output 'AC-073 OK'`
- 期望: 至少一行 FAIL write_scope.outside（例如 contracts/registry.snapshot.json）。
- 期望: 末行以 check-write-scope: FAILED ( 开头，退出码 1。

## AC-073 F-10 仓库内没有蓝图目录引用

- 命令: `$o = (node scripts/check-no-collab.mjs 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw ('exit ' + $e + ': ' + $o) }; if (-not $o.Contains('check-no-collab: ok (scanned ')) { throw ('unexpected output: ' + $o) }; Write-Output 'AC-073 OK'`
- 期望: 输出形如 check-no-collab: ok (scanned N files)，退出码 0。

## AC-073 F-11 违规夹具被逐行报出

- 命令: `$o = (node scripts/check-no-collab.mjs --root test/fixtures/no-collab/violating 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 1) { throw "exit $e" }; $want = @('FAIL no_collab contracts/d.json:2','FAIL no_collab docs/e.md:3','FAIL no_collab lib/a.mjs:1','FAIL no_collab package.json:2','FAIL no_collab scripts/b.mjs:2','FAIL no_collab test/c.txt:1','check-no-collab: FAILED (6 violations)'); $lines = @($o -split '\r?\n' | Where-Object { $_.Trim() -ne '' }); if ($lines.Count -ne 7) { throw ('line count ' + $lines.Count + ': ' + $o) }; for ($i = 0; $i -lt 7; $i += 1) { if ($lines[$i].Trim() -ne $want[$i]) { throw ('line ' + $i + ' is ' + $lines[$i]) } }; Write-Output 'AC-073 OK'`
- 期望: 依次输出 contracts/d.json:2、docs/e.md:3、lib/a.mjs:1、package.json:2、scripts/b.mjs:2、test/c.txt:1 六行 FAIL no_collab。
- 期望: 末行 check-no-collab: FAILED (6 violations)，退出码 1。

## AC-073 F-12 干净夹具通过

- 命令: `$o = (node scripts/check-no-collab.mjs --root test/fixtures/no-collab/clean 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw ('exit ' + $e + ': ' + $o) }; if (-not $o.Contains('check-no-collab: ok (scanned 2 files)')) { throw ('unexpected output: ' + $o) }; Write-Output 'AC-073 OK'`
- 期望: 输出 check-no-collab: ok (scanned 2 files)，退出码 0。

## AC-073 F-13 契约文档与生成结果一致

- 命令: `$o = (node scripts/check-contract-doc.mjs 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw ('exit ' + $e + ': ' + $o) }; if (-not $o.Contains('check-contract-doc: ok')) { throw ('unexpected output: ' + $o) }; Write-Output 'AC-073 OK'`
- 期望: 输出 check-contract-doc: ok，退出码 0。

## AC-073 F-14 渲染结果与已提交文档逐字节一致

- 命令: `node --input-type=module -e "import {renderContractDoc} from './scripts/gen-contract-doc.mjs'; import fs from 'node:fs'; const a=renderContractDoc('.'); const b=fs.readFileSync('docs/contract.md','utf8'); if(a!==b.replace(/\r\n/g,'\n')){throw new Error('render mismatch')}; if(a.includes('\r')){throw new Error('CR found')}; if(a.charCodeAt(0)===0xFEFF){throw new Error('BOM found')}; if(!a.endsWith('\n')||a.endsWith('\n\n')){throw new Error('trailing newline mismatch')}; console.log('AC-073 OK')"`
- 期望: 渲染结果归一化后与 docs/contract.md 全等，且无 CR、无 BOM、末尾恰一个换行。

## AC-073 F-15 文档的固定章节标题

- 命令: `node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');const h=t.split(/\r?\n/).filter(l=>/^#{1,2} /.test(l));const want=['# CLIWorker 契约（自动生成）','## 1. 错误码','## 2. 403 触发与判定顺序','## 3. 警告码','## 4. 拒选原因','## 5. draft 到 v1 的原因映射','## 6. forecast 枚举与阈值','## 7. 可用性与 identity','## 8. semantic_change','## 9. 规格与金标登记清单','## 10. 契约 schema 清单'];if(h.length!==want.length){throw new Error('heading count '+h.length)};for(let i=0;i<want.length;i+=1){if(h[i]!==want[i]){throw new Error('line '+i+' is '+h[i])}};console.log('AC-073 OK')"`
- 期望: 11 个标题逐行与 design 第 10.1 节的字面值一致。

## AC-073 F-16 本任务产物已被 git 跟踪

- 命令: `node -e "const {execFileSync}=require('child_process');const out=execFileSync('git',['ls-files','--','contracts','lib/contract','scripts','docs/contract.md','test/contract','test/fixtures/no-collab','test/traceability/T-004.json'],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean);const want=['contracts/registry.snapshot.json','contracts/agentline-forbidden.json','contracts/spec/surfaces.json','contracts/spec/migration-map.json','contracts/golden/manifest.json','contracts/golden/quota-shapes.json','contracts/golden/b44.json','contracts/golden/capacity.json','contracts/golden/forecast/thresholds.json','contracts/golden/forecast/quantiles.json','contracts/golden/forecast/confidence.json','contracts/golden/forecast/burn-eta.json','contracts/golden/policy/p1-order.json','contracts/golden/policy/p2-quota-low.json','contracts/golden/policy/p3-unknown.json','contracts/golden/policy/p4-identity-group.json','scripts/snapshot-update.mjs','scripts/gen-contract-doc.mjs','scripts/check-contract-doc.mjs','scripts/check-no-collab.mjs','scripts/check-golden-frozen.mjs','scripts/check-write-scope.mjs','docs/contract.md','lib/contract/registry.mjs','lib/contract/validate.mjs','lib/contract/views.mjs','lib/contract/scan.mjs','test/contract/registry.test.mjs','test/contract/examples.test.mjs','test/contract/freeze.test.mjs','test/contract/scan-canary.test.mjs','test/contract/spec-tracked.test.mjs','test/traceability/T-004.json'];const missing=want.filter(f=>!out.includes(f));if(missing.length){throw new Error('missing: '+missing.join(' '))}console.log('AC-073 OK')"`
- 期望: 33 个要求路径全部被 git ls-files 列出。

## AC-073 F-17 既有文件未被改动

- 命令: `$o = (git diff --name-only 93ebbb3 -- contracts/spec/ac-index.json package.json lib/select.mjs lib/forecast.mjs lib/cli.mjs lib/config.mjs lib/availability.mjs scripts/run-tests.mjs scripts/check-fast.mjs scripts/check-traceability.mjs | Out-String); if ($o.Trim() -ne '') { throw ('unexpected changes: ' + $o.Trim()) }; Write-Output 'AC-073 OK'`
- 期望: 相对基线无任何改动。

## AC-073 G-1 规格文件的结构计数

- 命令: `node -e "const m=require('./contracts/spec/migration-map.json');const s=require('./contracts/spec/surfaces.json');const got=[m.schema,m.draft_to_v1.reasons.length,m.draft_to_v1.fields.length,m.config_v1_to_v2.length,s.schema,s.preserved.length,s.semantic_change.length].join(' ');const want='cliworker.migration-map/v1 10 15 7 cliworker.surfaces/v1 4 5';if(got!==want){throw new Error('got: '+got)}console.log('AC-073 OK')"`
- 期望: 10 条原因映射、15 条字段迁移、7 条配置迁移；保留面 4 项、semantic_change 5 项。

## AC-073 G-2 规格与注册表一致、id 全局唯一

- 命令: `node -e "const m=require('./contracts/spec/migration-map.json');const r=require('./contracts/registry.snapshot.json');const s=require('./contracts/spec/surfaces.json');const a=JSON.stringify(m.draft_to_v1.reasons.map(x=>[x.draft,x.v1]));const b=JSON.stringify(r.draft_reason_mapping.map(x=>[x.draft,x.v1]));const ids=[...m.draft_to_v1.reasons,...m.draft_to_v1.fields,...m.config_v1_to_v2].map(x=>x.id);const ok=a===b&&new Set(ids).size===ids.length&&JSON.stringify(s.semantic_change.map(x=>x.id))===JSON.stringify(r.semantic_change);if(!ok){throw new Error('spec and registry disagree')}console.log('AC-073 OK')"`
- 期望: reasons 与 draft_reason_mapping 逐项相同，id 全局唯一，semantic_change 集合与注册表相等。

## AC-073 G-3 金标文件的 case 数

- 命令: `node -e "const n=p=>require('./contracts/golden/'+p).cases.length;const got=[n('quota-shapes.json'),n('b44.json'),n('forecast/thresholds.json'),n('forecast/quantiles.json'),n('forecast/confidence.json'),n('forecast/burn-eta.json'),n('capacity.json'),n('policy/p1-order.json'),n('policy/p2-quota-low.json'),n('policy/p3-unknown.json'),n('policy/p4-identity-group.json')].join(' ');const want='9 9 21 15 11 14 5 1 1 2 2';if(got!==want){throw new Error('got: '+got)}console.log('AC-073 OK')"`
- 期望: case 数依次为 9 9 21 15 11 14 5 1 1 2 2。

## AC-073 G-4 分位数与阈值的关键期望值

- 命令: `node -e "const q=require('./contracts/golden/forecast/quantiles.json');const qm=Object.fromEntries(q.cases.map(c=>[c.id,c.expected.value]));const t=require('./contracts/golden/forecast/thresholds.json');const tm=Object.fromEntries(t.cases.map(c=>[c.id,c.expected.risk+'/'+c.expected.risk_basis]));const l1=['n3-heavy','n12-light','n20-heavy','n2-invalid'].map(k=>qm[k]);const e1=[0.3,3,18,null];if(JSON.stringify(l1)!==JSON.stringify(e1)){throw new Error('quantiles: '+JSON.stringify(l1))};const l2=['tasks-0','tasks-2','tasks-3','tasks-6','frac-0.049','frac-0.05','frac-0.15','unknown-none'].map(k=>tm[k]);const e2=['exhausted/tasks','critical/tasks','low_reserve/tasks','ok/tasks','critical/fraction','low_reserve/fraction','ok/fraction','unknown/none'];if(JSON.stringify(l2)!==JSON.stringify(e2)){throw new Error('thresholds: '+JSON.stringify(l2))};console.log('AC-073 OK')"`
- 期望: 分位数为 0.3、3、18、null。
- 期望: 阈值分类依次为 exhausted/tasks、critical/tasks、low_reserve/tasks、ok/tasks、critical/fraction、low_reserve/fraction、ok/fraction、unknown/none。

## AC-073 G-5 三张关键金标的 expected 子集

- 命令: `node -e "const q=require('./contracts/golden/quota-shapes.json');const b=require('./contracts/golden/b44.json');const c=require('./contracts/golden/capacity.json');const get=(g,id)=>g.cases.find(x=>x.id===id).expected;const a=get(q,'q-credits-rate');const x=get(b,'b44-reading-then-1m');const y=get(c,'cap-k10-high');const ok=(a.remaining_mtok===0.001&&a.tasks_left===0&&a.tasks_left_basis==='tasks'&&a.risk==='exhausted'&&a.risk_basis==='tasks')&&(x['claude:claude-opus-5-5'].remaining_mtok===0.8&&x['claude:claude-sonnet-5-5'].remaining_mtok===4)&&(y.capacity_mtok===8&&y.k===10&&y.confidence==='high'&&y.source==='measured');if(!ok){throw new Error('expected subset mismatch')};console.log('AC-073 OK')"`
- 期望: q-credits-rate 的 remaining_mtok 0.001、tasks_left 0、risk exhausted、risk_basis tasks。
- 期望: b44-reading-then-1m 中 opus 为 0.8、sonnet 为 4。
- 期望: cap-k10-high 的 capacity_mtok 8、k 10、confidence high、source measured。

## AC-073 G-6 金标的 kind 与外壳

- 命令: `node -e "const ps=['quota-shapes.json','b44.json','capacity.json','forecast/thresholds.json','forecast/quantiles.json','forecast/confidence.json','forecast/burn-eta.json','policy/p1-order.json','policy/p2-quota-low.json','policy/p3-unknown.json','policy/p4-identity-group.json'];const g=ps.map(p=>require('./contracts/golden/'+p));const got=g.map(x=>x.kind).join(' ');const want='quota-shapes b44 capacity forecast-thresholds forecast-quantiles forecast-confidence forecast-burn-eta policy policy policy policy';if(got!==want){throw new Error('kinds: '+got)};if(!g.every(x=>x.schema==='cliworker.golden/v1')){throw new Error('schema mismatch')};console.log('AC-073 OK')"`
- 期望: kind 依次为 quota-shapes、b44、capacity、forecast-thresholds、forecast-quantiles、forecast-confidence、forecast-burn-eta、policy 四次。
- 期望: 全部 schema 为 cliworker.golden/v1。

## AC-073 G-7 策略金标的选序

- 命令: `node -e "const p=require('./contracts/golden/policy/p1-order.json').cases[0];const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);if(!same(p.expected.selected,[{key:'mA',funding:'plan'},{key:'mB',funding:'plan'},{key:'mC',funding:'paid'}])){throw new Error('selection order mismatch: '+JSON.stringify(p.expected.selected))};console.log('AC-073 OK')"`
- 期望: selected 依次为 mA plan、mB plan、mC paid。

## AC-073 H-1 追踪检查通过

- 命令: `$o = (node scripts/check-traceability.mjs 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw ('exit ' + $e + ': ' + $o) }; if (-not $o.Contains('check-traceability: ok (covered=9 planned=65)')) { throw ('unexpected output: ' + $o) }; Write-Output 'AC-073 OK'`
- 期望: 输出 check-traceability: ok (covered=9 planned=65)，退出码 0。

## AC-073 H-2 追踪分片的内容

- 命令: `node -e "const s=require('./test/traceability/T-004.json');const got=[s.task,s.milestone,s.entries.map(e=>e.ac+':'+e.status).join(' '),JSON.stringify(s).includes('baseline')].join(' ');const want='T-004 M1 AC-009:covered AC-010:covered AC-011:covered AC-073:covered false';if(got!==want){throw new Error('got: '+got)}console.log('AC-073 OK')"`
- 期望: 四个 AC 均为 covered，且分片不声明 baseline。

## AC-073 H-3 完整测试回归

- 命令: `$o = (node scripts/run-tests.mjs 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw ('exit ' + $e + ': ' + $o.Substring([Math]::Max(0, $o.Length - 4000))) }; if (-not $o.Contains('run-tests: full')) { throw 'missing run-tests: full' }; if ($o.Contains('FAIL discovery.')) { throw 'discovery failure reported' }; Write-Output 'AC-073 OK'`
- 期望: 输出含 run-tests: full，退出码 0，没有 FAIL discovery. 行。

## AC-073 H-4 check-fast 按码点纳入新检查

- 命令: `$o = (node scripts/check-fast.mjs 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw ('exit ' + $e + ': ' + $o.Substring([Math]::Max(0, $o.Length - 4000))) }; foreach ($n in @('==> check-contract-doc.mjs','==> check-golden-frozen.mjs','==> check-no-collab.mjs','==> check-write-scope.mjs','==> npm test')) { if (-not $o.Contains($n)) { throw ('missing step ' + $n) } }; if (-not $o.Contains('check-fast: ok')) { throw 'check-fast not ok' }; Write-Output 'AC-073 OK'`
- 期望: 退出码 0，末行 check-fast: ok。
- 期望: 依次输出四个新检查脚本与 npm test 的步骤行。

## AC-073 H-5 pwsh 包装入口

- 命令: `$o = (pwsh -NoProfile -File scripts/check-fast.ps1 2>&1 | Out-String); $e = $LASTEXITCODE; if ($e -ne 0) { throw ('exit ' + $e + ': ' + $o.Substring([Math]::Max(0, $o.Length - 4000))) }; if (-not $o.Contains('check-fast: ok')) { throw 'check-fast not ok' }; Write-Output 'AC-073 OK'`
- 期望: 退出码 0，输出含 check-fast: ok。
