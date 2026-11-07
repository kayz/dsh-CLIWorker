# Task 004 验收标准

约定：
- 所有命令在仓库根 `C:\git\dsh-CLIWorker\.collab\worktrees\004` 下用 PowerShell 7（`pwsh`）执行；每条命令独立判定，互不依赖。
- 基准提交：`93ebbb3`（`task/004` 起点）。既有验收基线：`node scripts/check-traceability.mjs` 在起点输出 `check-traceability: ok (covered=5 planned=69)`。
- 「期望」一栏中，`exit` 指进程退出码；「输出」指 stdout 满足的条件。任一条不满足即该条失败。
- 规格依据是同目录 `design.md`（章节号 §n 指向它）。涉及破坏性场景（删除、改名、篡改）的验收由测试在临时目录里完成，下面再补几条可直接复现的命令。
- 必须先对新文件执行 `git add <显式路径>`，AC-073 的 A-24 才能通过。

## A. 四条 AC 的测试入口

| # | 命令 | 期望 |
|---|---|---|
| A-1 | `node scripts/run-tests.mjs --ac AC-009; "exit=$LASTEXITCODE"` | 输出含 `run-tests: filtered`，末行 `exit=0`，spec 输出里没有 `✖` 行 |
| A-2 | `node scripts/run-tests.mjs --ac AC-010; "exit=$LASTEXITCODE"` | 同上 |
| A-3 | `node scripts/run-tests.mjs --ac AC-011; "exit=$LASTEXITCODE"` | 同上 |
| A-4 | `node scripts/run-tests.mjs --ac AC-073; "exit=$LASTEXITCODE"` | 同上 |

## B. 测试标题齐全（防止少写、改名、删测试）

下面每条命令运行对应 AC 的测试，并检查 §11 固定标题是否全部出现在输出里。期望输出恰为 `missing=0`。

| # | 命令 |
|---|---|
| B-1 | `$o = (node scripts/run-tests.mjs --ac AC-009 2>&1 \| Out-String); $t = @('[AC-009] REGISTRY deep-equals contracts/registry.snapshot.json','[AC-009] every code has exit, http_status, retryable, trigger_id and trigger','[AC-009] trigger_id and trigger text are unique across the table','[AC-009] codes, exits and retryable flags match the frozen exit-code table','[AC-009] the five 403 codes have mutually exclusive triggers','[AC-009] write route order is session, readonly, csrf, body','[AC-009] resolveView applies the select view rules','[AC-009] lib/contract modules are pure and import nothing','[AC-009] every schema uses only supported keywords','[AC-009] every valid example passes its schema','[AC-009] every invalid example fails with exactly the declared path and keyword','[AC-009] every wire schema has one valid and two invalid examples','[AC-009] schema enums for codes, warnings and reject reasons equal the registry','[AC-009] validator reports the expected path for each supported keyword','[AC-009] examples carry no token-like strings'); "missing=$(@($t \| Where-Object { -not $o.Contains($_) }).Count)"` |
| B-2 | `$o = (node scripts/run-tests.mjs --ac AC-010 2>&1 \| Out-String); $t = @('[AC-010] compareRegistry reports removed for a deleted code','[AC-010] compareRegistry reports removed and added for a renamed code','[AC-010] compareRegistry reports changed for a modified field','[AC-010] compareRegistry reports nothing for identical registries','[AC-010] checkFrozen fails for a deleted code, a renamed code and an added code with a stale snapshot','[AC-010] snapshot-update is a no-op on an unchanged registry','[AC-010] snapshot-update writes the snapshot only when snapshot_version is previous plus one','[AC-010] snapshot-update refuses an addition without a version bump','[AC-010] snapshot-update refuses removed, renamed or changed entries','[AC-010] snapshot holds reject reasons, risk thresholds, availability, warning codes, draft mapping and semantic_change'); "missing=$(@($t \| Where-Object { -not $o.Contains($_) }).Count)"` |
| B-3 | `$o = (node scripts/run-tests.mjs --ac AC-011 2>&1 \| Out-String); $t = @('[AC-011] every forbidden key is detected at depth 1','[AC-011] every forbidden key is detected at depth 3','[AC-011] forbidden keys are detected inside arrays, warnings, error and rejected','[AC-011] forbidden key matching is case-insensitive and exact','[AC-011] every forbidden value is detected at depth 1 and depth 3','[AC-011] forbidden values match whole words after tokenizing','[AC-011] cliworker, config and dsh-CLIWorker are not reported','[AC-011] the call subtree skips value scanning but must equal the wrapper template','[AC-011] clean examples produce zero hits','[AC-011] deeply nested input does not overflow the stack'); "missing=$(@($t \| Where-Object { -not $o.Contains($_) }).Count)"` |
| B-4 | `$o = (node scripts/run-tests.mjs --ac AC-073 2>&1 \| Out-String); $t = @('[AC-073] snapshot, spec, golden and forbidden files are tracked by git and not ignored','[AC-073] every spec and golden file validates against its schema','[AC-073] golden files hold the required case ids','[AC-073] manifest registers every spec and golden file with its normalized sha256','[AC-073] check-golden-frozen fails when a golden file is modified','[AC-073] check-golden-frozen fails when a golden file is added','[AC-073] check-golden-frozen fails when a golden file is deleted','[AC-073] check-write-scope reports an unregistered spec or golden file','[AC-073] check-write-scope reports changes outside the write scope','[AC-073] check-write-scope reads write_scope from markdown front matter','[AC-073] check-no-collab reports zero references in the repository','[AC-073] check-no-collab reports the violating fixture and passes the clean fixture','[AC-073] gen-contract-doc output equals the committed docs/contract.md','[AC-073] check-contract-doc fails on a stale document','[AC-073] snapshot contains every code, trigger, threshold, reason, mapping and semantic_change of interfaces section 5','[AC-073] new check scripts are discoverable by check-fast'); "missing=$(@($t \| Where-Object { -not $o.Contains($_) }).Count)"` |

（命令里的 `\|` 在 Markdown 表格中是转义，实际执行时写成 `|`。）

## C. AC-009：注册表与示例

| # | 命令 | 期望输出（逐字） |
|---|---|---|
| C-1 | `node --input-type=module -e "import {REGISTRY} from './lib/contract/registry.mjs'; import fs from 'node:fs'; import assert from 'node:assert/strict'; assert.deepStrictEqual(JSON.parse(JSON.stringify(REGISTRY)), JSON.parse(fs.readFileSync('contracts/registry.snapshot.json','utf8'))); console.log('equal')"` | `equal`，exit 0 |
| C-2 | `node -e "const s=JSON.parse(require('fs').readFileSync('contracts/registry.snapshot.json','utf8'));const c=s.codes;console.log([s.snapshot_version,c.length,new Set(c.map(x=>x.trigger_id)).size,new Set(c.map(x=>x.trigger)).size,c.filter(x=>x.retryable).map(x=>x.code).join('+')].join(' '))"` | `1 30 30 30 E_TIMEOUT+E_INSUFFICIENT_QUOTA+E_LEASE_EXPIRED` |
| C-3 | `node -e "const c=require('./contracts/registry.snapshot.json').codes.filter(x=>x.http_status===403);console.log(c.map(x=>x.code+':'+x.exit+':'+x.trigger_id).join(' '))"` | `E_VIEW_FORBIDDEN:2:select_view_without_admin E_ADMIN_REQUIRED:8:admin_route_no_session E_LOOPBACK_ONLY:8:bootstrap_non_loopback E_READONLY:8:write_route_readonly E_CSRF:8:write_route_csrf_invalid` |
| C-4 | `node -e "const s=require('./contracts/registry.snapshot.json');console.log(s.write_route_order.join(','))"` | `session,readonly,csrf,body` |
| C-5 | `node -e "const fs=require('fs');const d='contracts/examples';const names=fs.readdirSync(d).sort();console.log(names.length, names.every(n=>fs.readdirSync(d+'/'+n+'/valid').length>=1 && fs.readdirSync(d+'/'+n+'/invalid').length>=2)); console.log(names.join(' '))"` | 第一行 `14 true`；第二行 `config.v2 error-envelope event.v1 forecast.v1 handle-full.v1 handle.v1 inventory.v1 model.v1 pool request.v1 selection-failed.v1 selection-ok.v1 session.v1 usage.v1` |
| C-6 | `node -e "console.log(require('fs').readdirSync('contracts/schemas').filter(n=>n.endsWith('.schema.json')).length)"` | `21` |
| C-7 | `Select-String -Path lib/contract/registry.mjs -Pattern '^\s*import\s'` | 无任何输出 |
| C-8 | `Select-String -Path lib/contract/*.mjs -Pattern 'node:\|Date\.now\|new Date\|setTimeout\|setInterval\|setImmediate\|process\.env'` | 无任何输出（命令里的 `\|` 实际写成 `|`） |

## D. AC-010：冻结规则

| # | 命令 | 期望输出（逐字） |
|---|---|---|
| D-1 | `node --input-type=module -e "import {REGISTRY as r, compareRegistry as cmp} from './lib/contract/registry.mjs'; const a=structuredClone(r); a.codes=a.codes.filter(c=>c.code!=='E_CSRF'); const b=structuredClone(r); b.codes=b.codes.map(c=>c.code==='E_CSRF'?{...c,code:'E_CSRF2'}:c); console.log(JSON.stringify(cmp(r,a))); console.log(JSON.stringify(cmp(r,b))); console.log(JSON.stringify(cmp(r,structuredClone(r))))"` | 三行：`{"removed":["codes:E_CSRF"],"added":[],"changed":[]}`、`{"removed":["codes:E_CSRF"],"added":["codes:E_CSRF2"],"changed":[]}`、`{"removed":[],"added":[],"changed":[]}` |
| D-2 | `node scripts/snapshot-update.mjs; "exit=$LASTEXITCODE"` | 首行 `snapshot-update: unchanged (snapshot_version 1)`，`exit=0`；运行后 `git status --short -- contracts/registry.snapshot.json` 与运行前相同（文件未被改写） |
| D-3 | `node -e "const s=require('./contracts/registry.snapshot.json');console.log([s.reject_reasons.v1.length,s.reject_reasons.admin_only.join(),s.reject_reasons.draft.length,s.draft_reason_mapping.length,s.warning_codes.length,s.forecast_reasons.length,s.risk.length,s.risk_basis.length,s.tasks_left_basis.length,s.availability.length,s.identity.length,s.semantic_change.join('+'),s.thresholds.tasks.length,s.thresholds.fraction.length,s.thresholds.priority.join('>')].join(' '))"` | `15 not_allowed 7 10 8 7 5 4 3 5 3 forecast.tasks_left+forecast.risk+handle.cli_removed+draft_reason_mapping+config_v1_to_v2 4 4 tasks>usd>fraction>unknown` |
| D-4 | `node -e "const t=require('./contracts/registry.snapshot.json').thresholds;console.log(JSON.stringify(t.tasks.map(x=>[x.risk,x.op,x.value])));console.log(JSON.stringify(t.fraction.map(x=>[x.risk,x.op,x.value])))"` | `[["exhausted","<=",0],["critical","<=",2],["low_reserve","<=",5],["ok","else",null]]` 与 `[["exhausted","<=",0],["critical","<",0.05],["low_reserve","<",0.15],["ok","else",null]]` |

## E. AC-011：视图扫描器

AC-011 的 canary 逐键、逐深度的验证在 A-3/B-3 的测试里。补充可直接复现的三条：

| # | 命令 | 期望输出（逐字） |
|---|---|---|
| E-1 | `node -e "const f=require('./contracts/agentline-forbidden.json');console.log(f.schema, f.keys.length, f.keys.every(k=>k===k.toLowerCase()), f.keys.includes('detail'), f.call.keys.join(','), f.call.args.length)"` | `cliworker.agentline-forbidden/v1 25 true false command,args,cwd,input,output,timeout_ms 8` |
| E-2 | `node --input-type=module -e "import {scanView} from './lib/contract/scan.mjs'; import fs from 'node:fs'; const forbidden=JSON.parse(fs.readFileSync('contracts/agentline-forbidden.json','utf8')); const catalog={models:[{key:'k:zeta-model-9',id:'zeta-model-9',cli:'zetacli'}]}; const w={command:'node',bin:'bin/cliworker.mjs',state_dir:'/s',config:'/c'}; const hit=scanView({a:{b:{Model_Key:'x'}}},{forbidden,catalog,wrapper:w}); const val=scanView({a:[{m:'use zeta-model-9 now'}]},{forbidden,catalog,wrapper:w}); const clean=scanView({note:'cliworker config dsh-CLIWorker'},{forbidden,catalog,wrapper:w}); console.log(JSON.stringify(hit.hits.map(h=>[h.path,h.kind]))); console.log(JSON.stringify(val.hits.map(h=>[h.path,h.kind]))); console.log(clean.ok, clean.hits.length)"` | 三行：`[["/a/b/Model_Key","forbidden_key"]]`；`[["/a/0/m","forbidden_value"]]`；`true 0` |
| E-3 | `node --input-type=module -e "import {scanView} from './lib/contract/scan.mjs'; import fs from 'node:fs'; const forbidden=JSON.parse(fs.readFileSync('contracts/agentline-forbidden.json','utf8')); const catalog={models:[{key:'k:zeta-model-9',id:'zeta-model-9',cli:'zetacli'}]}; const w={command:'node',bin:'bin/cliworker.mjs',state_dir:'/s',config:'/c'}; const call=(over)=>({command:'node',args:['bin/cliworker.mjs','run','--lease','l_abc','--state-dir','/s','--config','/c'],cwd:'C:/work/zeta-model-9',input:'stdin',output:'cliworker.event/v1',timeout_ms:1000,...over}); const v=(c)=>({models:[{lease_id:'l_abc',call:c}],calls:[c]}); const ok=scanView(v(call({})),{forbidden,catalog,wrapper:w}); const bad=scanView(v(call({command:'zetacli'})),{forbidden,catalog,wrapper:w}); console.log(ok.ok, bad.ok, [...new Set(bad.hits.map(h=>h.kind))].join())"` | `true false call_mismatch`（`cwd` 含模型 id 不算命中；`command` 被改则只报 `call_mismatch`） |

## F. AC-073：自包含规格、冻结、禁止引用、文档

| # | 命令 | 期望 |
|---|---|---|
| F-1 | `node scripts/check-golden-frozen.mjs; "exit=$LASTEXITCODE"` | 首行 `check-golden-frozen: ok (14 files)`，`exit=0` |
| F-2 | `node -e "const m=require('./contracts/golden/manifest.json');console.log(m.schema, m.files.length, m.files.some(f=>f.path.endsWith('manifest.json')), m.files.some(f=>f.path==='contracts/spec/ac-index.json'), m.files.some(f=>f.path==='contracts/registry.snapshot.json'), m.files.every(f=>f.sha256.length===64 && f.sha256===f.sha256.toLowerCase()), JSON.stringify(m.files.map(f=>f.path))===JSON.stringify(m.files.map(f=>f.path).sort()))"` | `cliworker.golden-manifest/v1 14 false true false true true` |
| F-3 | 修改：`$t = Join-Path ([IO.Path]::GetTempPath()) 'ac073-mod'; Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $t \| Out-Null; Copy-Item contracts -Destination $t -Recurse; Add-Content "$t/contracts/golden/b44.json" ' '; node scripts/check-golden-frozen.mjs --root $t; "exit=$LASTEXITCODE"; Remove-Item $t -Recurse -Force` | 输出含 `FAIL golden.changed contracts/golden/b44.json` 与 `check-golden-frozen: FAILED (1 errors)`，`exit=1` |
| F-4 | 新增：同 F-3，但把 `Add-Content` 换成 `Set-Content -Encoding utf8NoBOM "$t/contracts/golden/extra.json" '{}'`（目录名用 `ac073-add`） | 输出含 `FAIL golden.unregistered contracts/golden/extra.json` 与 `check-golden-frozen: FAILED (1 errors)`，`exit=1` |
| F-5 | 删除：同 F-3，但把 `Add-Content` 换成 `Remove-Item "$t/contracts/golden/capacity.json"`（目录名用 `ac073-del`） | 输出含 `FAIL golden.missing contracts/golden/capacity.json` 与 `check-golden-frozen: FAILED (1 errors)`，`exit=1` |
| F-6 | 登记外文件：同 F-4 的准备步骤，但运行 `node scripts/check-write-scope.mjs --root $t`（目录名用 `ac073-ws`，新增文件 `contracts/spec/x.json`） | 输出含 `FAIL write_scope.unregistered contracts/spec/x.json` 与 `check-write-scope: FAILED (1 errors)`，`exit=1` |
| F-7 | `node scripts/check-write-scope.mjs; "exit=$LASTEXITCODE"` | 输出 `check-write-scope: ok`，`exit=0` |
| F-8 | `node scripts/check-write-scope.mjs --base 93ebbb3 --scope-from .collab/tasks/004/design.md --scope '.collab/tasks/004/**'; "exit=$LASTEXITCODE"` | 输出 `check-write-scope: ok`，`exit=0`（证明本任务所有变更都落在 design.md front matter 的 write_scope 内；`.collab/tasks/004/**` 只是放行调度器自己的运行产物） |
| F-9 | `node scripts/check-write-scope.mjs --base 93ebbb3 --scope 'lib/contract/**'; "exit=$LASTEXITCODE"` | 输出含 `FAIL write_scope.outside` 至少一行（例如 `contracts/registry.snapshot.json`），末行 `check-write-scope: FAILED (` 开头，`exit=1`（证明范围检查真的会报） |
| F-10 | `node scripts/check-no-collab.mjs; "exit=$LASTEXITCODE"` | 输出匹配 `^check-no-collab: ok \(scanned \d+ files\)$`，`exit=0` |
| F-11 | `node scripts/check-no-collab.mjs --root test/fixtures/no-collab/violating; "exit=$LASTEXITCODE"` | 输出逐行为 `FAIL no_collab contracts/d.json:2`、`FAIL no_collab docs/e.md:3`、`FAIL no_collab lib/a.mjs:1`、`FAIL no_collab package.json:2`、`FAIL no_collab scripts/b.mjs:2`、`FAIL no_collab test/c.txt:1`、`check-no-collab: FAILED (6 violations)`，`exit=1` |
| F-12 | `node scripts/check-no-collab.mjs --root test/fixtures/no-collab/clean; "exit=$LASTEXITCODE"` | 输出 `check-no-collab: ok (scanned 2 files)`，`exit=0` |
| F-13 | `node scripts/check-contract-doc.mjs; "exit=$LASTEXITCODE"` | 输出 `check-contract-doc: ok`，`exit=0` |
| F-14 | `node --input-type=module -e "import {renderContractDoc} from './scripts/gen-contract-doc.mjs'; import fs from 'node:fs'; const a=renderContractDoc('.'); const b=fs.readFileSync('docs/contract.md','utf8'); console.log(a===b.replace(/\r\n/g,'\n'), a.includes('\r'), a.charCodeAt(0)===0xFEFF, a.endsWith('\n') && !a.endsWith('\n\n'))"` | `true false false true` |
| F-15 | `node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');const h=t.split(/\r?\n/).filter(l=>/^#{1,2} /.test(l));console.log(h.join('\n'))"` | 逐行等于 `# CLIWorker 契约（自动生成）`、`## 1. 错误码`、`## 2. 403 触发与判定顺序`、`## 3. 警告码`、`## 4. 拒选原因`、`## 5. draft 到 v1 的原因映射`、`## 6. forecast 枚举与阈值`、`## 7. 可用性与 identity`、`## 8. semantic_change`、`## 9. 规格与金标登记清单`、`## 10. 契约 schema 清单` |
| F-16 | `node -e "const {execFileSync}=require('child_process');const out=execFileSync('git',['ls-files','--','contracts','lib/contract','scripts','docs/contract.md','test/contract','test/fixtures/no-collab','test/traceability/T-004.json'],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean);const want=['contracts/registry.snapshot.json','contracts/agentline-forbidden.json','contracts/spec/surfaces.json','contracts/spec/migration-map.json','contracts/golden/manifest.json','contracts/golden/quota-shapes.json','contracts/golden/b44.json','contracts/golden/capacity.json','contracts/golden/forecast/thresholds.json','contracts/golden/forecast/quantiles.json','contracts/golden/forecast/confidence.json','contracts/golden/forecast/burn-eta.json','contracts/golden/policy/p1-order.json','contracts/golden/policy/p2-quota-low.json','contracts/golden/policy/p3-unknown.json','contracts/golden/policy/p4-identity-group.json','scripts/snapshot-update.mjs','scripts/gen-contract-doc.mjs','scripts/check-contract-doc.mjs','scripts/check-no-collab.mjs','scripts/check-golden-frozen.mjs','scripts/check-write-scope.mjs','docs/contract.md','lib/contract/registry.mjs','lib/contract/validate.mjs','lib/contract/views.mjs','lib/contract/scan.mjs','test/contract/registry.test.mjs','test/contract/examples.test.mjs','test/contract/freeze.test.mjs','test/contract/scan-canary.test.mjs','test/contract/spec-tracked.test.mjs','test/traceability/T-004.json'];console.log('missing',want.filter(f=>!out.includes(f)).length)"` | `missing 0` |
| F-17 | `git diff --name-only 93ebbb3 -- contracts/spec/ac-index.json package.json lib/select.mjs lib/forecast.mjs lib/cli.mjs lib/config.mjs lib/availability.mjs scripts/run-tests.mjs scripts/check-fast.mjs scripts/check-traceability.mjs` | 无任何输出（这些既有文件未被改动） |

## G. 规格与金标内容

| # | 命令 | 期望输出（逐字） |
|---|---|---|
| G-1 | `node -e "const m=require('./contracts/spec/migration-map.json');const s=require('./contracts/spec/surfaces.json');console.log([m.schema,m.draft_to_v1.reasons.length,m.draft_to_v1.fields.length,m.config_v1_to_v2.length,s.schema,s.preserved.length,s.semantic_change.length].join(' '))"` | `cliworker.migration-map/v1 10 15 7 cliworker.surfaces/v1 4 5` |
| G-2 | `node -e "const m=require('./contracts/spec/migration-map.json');const r=require('./contracts/registry.snapshot.json');const a=JSON.stringify(m.draft_to_v1.reasons.map(x=>[x.draft,x.v1]));const b=JSON.stringify(r.draft_reason_mapping.map(x=>[x.draft,x.v1]));const ids=[...m.draft_to_v1.reasons,...m.draft_to_v1.fields,...m.config_v1_to_v2].map(x=>x.id);console.log(a===b, new Set(ids).size===ids.length, JSON.stringify(require('./contracts/spec/surfaces.json').semantic_change.map(x=>x.id))===JSON.stringify(r.semantic_change))"` | `true true true` |
| G-3 | `node -e "const n=p=>require('./contracts/golden/'+p).cases.length;console.log([n('quota-shapes.json'),n('b44.json'),n('forecast/thresholds.json'),n('forecast/quantiles.json'),n('forecast/confidence.json'),n('forecast/burn-eta.json'),n('capacity.json'),n('policy/p1-order.json'),n('policy/p2-quota-low.json'),n('policy/p3-unknown.json'),n('policy/p4-identity-group.json')].join(' '))"` | `9 9 21 15 11 14 5 1 1 2 2` |
| G-4 | `node -e "const q=require('./contracts/golden/forecast/quantiles.json');const m=Object.fromEntries(q.cases.map(c=>[c.id,c.expected.value]));const t=require('./contracts/golden/forecast/thresholds.json');const r=Object.fromEntries(t.cases.map(c=>[c.id,c.expected.risk+'/'+c.expected.risk_basis]));console.log(['n3-heavy','n12-light','n20-heavy','n2-invalid'].map(k=>m[k]).join(' '));console.log(['tasks-0','tasks-2','tasks-3','tasks-6','frac-0.049','frac-0.05','frac-0.15','unknown-none'].map(k=>r[k]).join(' '))"` | `0.3 3 18 null`；`exhausted/tasks critical/tasks low_reserve/tasks ok/tasks critical/fraction low_reserve/fraction ok/fraction unknown/none` |
| G-5 | `node -e "const q=require('./contracts/golden/quota-shapes.json');const b=require('./contracts/golden/b44.json');const c=require('./contracts/golden/capacity.json');const get=(g,id)=>g.cases.find(x=>x.id===id).expected;console.log(JSON.stringify(get(q,'q-credits-rate')));console.log(JSON.stringify(get(b,'b44-reading-then-1m')));console.log(JSON.stringify(get(c,'cap-k10-high')))"` | 第一行的对象含 `"remaining_mtok":0.001,"tasks_left":0,"tasks_left_basis":"tasks","risk":"exhausted","risk_basis":"tasks"`（键序不限）；第二行含 `"claude:claude-opus-5-5"` 的 `remaining_mtok` 为 0.8、`"claude:claude-sonnet-5-5"` 的为 4；第三行含 `"capacity_mtok":8,"k":10,"confidence":"high","source":"measured"` |
| G-6 | `node -e "const g=['quota-shapes.json','b44.json','capacity.json','forecast/thresholds.json','forecast/quantiles.json','forecast/confidence.json','forecast/burn-eta.json','policy/p1-order.json','policy/p2-quota-low.json','policy/p3-unknown.json','policy/p4-identity-group.json'].map(p=>require('./contracts/golden/'+p));console.log(g.map(x=>x.kind).join(' '), g.every(x=>x.schema==='cliworker.golden/v1'))"` | `quota-shapes b44 capacity forecast-thresholds forecast-quantiles forecast-confidence forecast-burn-eta policy policy policy policy true` |
| G-7 | `node -e "const p=require('./contracts/golden/policy/p1-order.json').cases[0];console.log(JSON.stringify(p.expected.selected))"` | `[{"key":"mA","funding":"plan"},{"key":"mB","funding":"plan"},{"key":"mC","funding":"paid"}]` |

## H. 追踪与完整检查

| # | 命令 | 期望 |
|---|---|---|
| H-1 | `node scripts/check-traceability.mjs; "exit=$LASTEXITCODE"` | 输出 `check-traceability: ok (covered=9 planned=65)`，`exit=0` |
| H-2 | `node -e "const s=require('./test/traceability/T-004.json');console.log(s.task, s.milestone, s.entries.map(e=>e.ac+':'+e.status).join(' '), JSON.stringify(s).includes('baseline'))"` | `T-004 M1 AC-009:covered AC-010:covered AC-011:covered AC-073:covered false` |
| H-3 | `node scripts/run-tests.mjs; "exit=$LASTEXITCODE"` | 输出含 `run-tests: full`，`exit=0`，无 `FAIL discovery.` 行 |
| H-4 | `node scripts/check-fast.mjs; "exit=$LASTEXITCODE"` | `exit=0`；输出依次含 `==> check-contract-doc.mjs`、`==> check-golden-frozen.mjs`、`==> check-no-collab.mjs`、`==> check-write-scope.mjs`（相对顺序按码点：`check-contract-doc` < `check-golden-frozen` < `check-no-collab` < `check-write-scope`）、`==> npm test`，末行 `check-fast: ok` |
| H-5 | `pwsh -NoProfile -File scripts/check-fast.ps1; "exit=$LASTEXITCODE"` | `exit=0`，输出末行含 `check-fast: ok`（项目约定的完成前检查） |

## I. 判定

- A、B、C、D、E、F、G、H 全部条目通过 → 通过。
- 任一条失败 → 不通过，评审在报告里引用失败条目编号与实际输出。
- 以下是不属于本任务、因此不作为失败依据的事项：`node scripts/milestone-gate.mjs --milestone M1` 仍因其他任务的 AC 未覆盖而 BLOCKED；`npm run snapshot:update` 仍指向 `run-tests --update-snapshots`（本任务入口为 `node scripts/snapshot-update.mjs`）。
