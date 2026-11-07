# Task 007 验收标准

基准：分支 `task/007`，起点提交 `f6f6057`。所有命令在仓库根（`C:\git\dsh-CLIWorker\.collab\worktrees\007`）用 `pwsh` 执行。每条的「通过」按「退出码 + 期望输出」判定，条与条之间互不依赖（A-01 先于其它条运行的除外：它们都假设文件已存在）。

约定：`$LASTEXITCODE` 指紧邻上一条原生命令的退出码；`run-tests` 的成功输出含 `ℹ fail 0`，并以 `run-tests: filtered N files` 报告过滤出的文件数。

本文按 design.md §0 的默认方案 A 写（`lib/contract/validate.mjs` 获批进入写域，删除 `typeOf`）。人类若选 B 或 C，A-18 以及 A-12、A-13 里涉及「lib 为 0」的部分由设计师重跑本轮后改写。

## 一、AC-020：draft handle 无 cli 键，forecast 记忆化

**A-01** 过滤运行 AC-020

```
node scripts/run-tests.mjs --ac AC-020; $LASTEXITCODE
```

期望：输出含 `ℹ fail 0`，含 `run-tests: filtered 3 files`，最后一行是 `0`。基准上同一命令输出 `FAIL run.no_match AC-020`、退出码非 0。

**A-02** handle 没有 `cli` 键，有 `call`

```
node -e "import('./lib/select.mjs').then(({selectModels})=>{const c={providers:{claude:{cli:'claude',readonly:true}},models:{q:{provider:'claude',id:'q',level:'Quick',identity:'verified'}}};const r=selectModels(c,{level:'Quick'},{status:{claude:{state:'callable'}}});const h=r.models[0];console.log('cli' in h, 'call' in h, JSON.stringify(h.call)===JSON.stringify(r.calls[0]))})"
```

期望：输出恰为一行 `false true true`，退出码 0。

**A-03** 12 个模型、count 12 时每个模型的 quota 只读一次

```
node -e "import('./lib/select.mjs').then(({selectModels})=>{let reads=0;const quotas=new Proxy({},{get(t,p){if(p==='claude')reads+=1;return t[p]}});const models={};for(let i=0;i<12;i++)models['claude-m'+i]={provider:'claude',id:'m'+i,level:'Quick',identity:'verified',prices:{input_per_mtok:1,output_per_mtok:1}};const c={providers:{claude:{cli:'claude',readonly:true}},models,quotas};const r=selectModels(c,{level:'Quick',count:12},{status:{claude:{state:'callable'}}});console.log(r.ok,r.models.length,reads)})"
```

期望：输出恰为一行 `true 12 12`，退出码 0。基准上 `reads` 大于 12。

**A-04** 注入的 forecast 计数器等于通过前置过滤的模型数，与 count、usage 无关

```
node -e "import('./lib/select.mjs').then(({selectModels})=>{const models={};for(let i=0;i<12;i++)models['m'+i]={provider:'claude',id:'m'+i,level:'Quick',identity:'verified',prices:{input_per_mtok:i,output_per_mtok:1}};models.m0.level='Top';models.m1.deprecated=true;models.m2.identity='unverified';const c={providers:{claude:{cli:'claude',readonly:true}},models};const out=[];for(const usage of ['Normal','Light','Heavy'])for(const count of [1,3,8]){const seen=[];const ctx={forecast:(a)=>{seen.push(a.model);return {risk:'ok',tasks_left:9}}};selectModels(c,{level:'Quick',count,usage,exclude:['m3']},{status:{claude:{state:'callable'}},ctx});out.push(seen.length+'/'+new Set(seen).size)}console.log([...new Set(out)].join(','))})"
```

期望：输出恰为一行 `8/8`（12 个模型减去 level 不符、deprecated、identity 未验证、被 exclude 的 4 个），退出码 0。

**A-05** 三个缺陷文件的 `[fixed]` 段存在且通过，`[repro]` 未被改动

```
node scripts/check-defects.mjs; $LASTEXITCODE
```

期望：输出 `check-defects: ok`，最后一行 `0`。

```
node --test test/characterization/defects/a5-dup-call.test.mjs test/characterization/defects/a5-forecast-x3.test.mjs; $LASTEXITCODE
```

期望：输出含 `ℹ fail 0`，且 `ℹ pass 4`（每个文件各 1 个 `[repro]` + 1 个 `[fixed]`），最后一行 `0`。

**A-06** `[repro]` 段哈希未变

```
git diff f6f6057 -- test/characterization/defects.json; $LASTEXITCODE
```

期望：无输出（`defects.json` 未被修改），退出码 0。（`check-defects` 在 A-05 里校验各 `[repro]` 的 sha256。）

## 二、AC-021：draft 视图的 Heavy 拒选

**A-07** 过滤运行 AC-021

```
node scripts/run-tests.mjs --ac AC-021; $LASTEXITCODE
```

期望：输出含 `ℹ fail 0`，含 `run-tests: filtered 1 files`，最后一行 `0`。

**A-08** Heavy 下 exhausted、critical、low_reserve 全部以 `E_FORECAST_EXHAUSTION` 拒选；Normal 与 Light 不拒（用 AC-015 金标 `contracts/golden/quota-shapes.json`）

```
node -e "Promise.all([import('./lib/select.mjs'),import('./lib/forecast.mjs'),import('node:fs')]).then(([{selectModels},{buildForecast},fs])=>{const g=JSON.parse(fs.readFileSync('contracts/golden/quota-shapes.json','utf8'));const cases=g.cases.filter(c=>c.expected.risk);const providers={},models={},quotas={},byKey={};cases.forEach((c,i)=>{providers['p'+i]={cli:'p'+i,readonly:true};models['m-'+c.id]={provider:'p'+i,id:'x'+i,level:'Quick',identity:'verified'};quotas['p'+i]=c.input.quota;byKey['m-'+c.id]=c});const cfg={providers,models,quotas};const status=Object.fromEntries(Object.keys(providers).map(k=>[k,{state:'callable'}]));const ctx={forecast:(a)=>buildForecast({quota:a.quota,samples:byKey[a.model].input.samples,usage:a.usage,now:0})};const bad=['exhausted','critical','low_reserve'];const want=cases.filter(c=>bad.includes(c.expected.risk)).map(c=>'m-'+c.id).sort();const h=selectModels(cfg,{level:'Quick',count:10,usage:'Heavy'},{status,ctx});const got=h.rejected.filter(x=>x.reason==='E_FORECAST_EXHAUSTION').map(x=>x.key).sort();const n=selectModels(cfg,{level:'Quick',count:10,usage:'Normal'},{status,ctx});const l=selectModels(cfg,{level:'Quick',count:10,usage:'Light'},{status,ctx});console.log(JSON.stringify(got)===JSON.stringify(want),want.length>=5,h.rejected.length===want.length,n.rejected.length,l.rejected.length)})"
```

期望：输出恰为一行 `true true true 0 0`，退出码 0。

**A-09** `heavyRejection` 与导出清单

```
node -e "import('./lib/select-draft.mjs').then(m=>{const f=(r)=>({risk:r});console.log(Object.keys(m).sort().join(','));console.log(['exhausted','critical','low_reserve','ok','unknown'].map(r=>m.heavyRejection({key:'k',usage:'Heavy',forecast:f(r)})?.reason??'-').join(','));console.log(m.heavyRejection({key:'k',usage:'Normal',forecast:f('exhausted')})===null,m.heavyRejection({key:'k',usage:'Light',forecast:f('critical')})===null)})"
```

期望：输出三行，且恰为：

```
HANDLE_SCHEMA,HEAVY_REJECT_RISKS,SELECTION_SCHEMA,draftHandle,draftSelection,heavyRejection
E_FORECAST_EXHAUSTION,E_FORECAST_EXHAUSTION,E_FORECAST_EXHAUSTION,-,-
true true
```

退出码 0。

**A-10** 本任务没有改 `a1-quota.test.mjs`（它归 T-006）

```
git diff f6f6057 --stat -- test/characterization/defects/a1-quota.test.mjs; $LASTEXITCODE
```

期望：无输出，退出码 0。

## 三、AC-022：check-unused

**A-11** 过滤运行 AC-022

```
node scripts/run-tests.mjs --ac AC-022; $LASTEXITCODE
```

期望：输出含 `ℹ fail 0`，含 `run-tests: filtered 2 files`，最后一行 `0`。

**A-12** 对 lib 报告 0

```
node scripts/check-unused.mjs; $LASTEXITCODE
```

期望：输出恰为 `check-unused: ok (files=N)`（N 为 `lib` 下 `.mjs/.js/.cjs` 文件数，大于 0），最后一行 `0`。基准上脚本不存在，命令报 `Cannot find module`、退出码 1。

**A-13** 对夹具恰好报告其中声明的 8 项

```
node scripts/check-unused.mjs --json test/fixtures/unused; $LASTEXITCODE
```

期望：stdout 是单个 JSON，`items` 恰为下列 8 项（`line` 不限，`items` 按 `file`、`line`、`name` 排序），最后一行（退出码）`1`：

| file | kind | name |
|---|---|---|
| dirty/functions.mjs | function | deadAsync |
| dirty/functions.mjs | function | deadGen |
| dirty/functions.mjs | function | deadHelper |
| dirty/functions.mjs | function | deadRecursive |
| dirty/imports.mjs | import | fs |
| dirty/imports.mjs | import | joinPath |
| dirty/imports.mjs | import | os |
| dirty/imports.mjs | import | readFileSync |

（同一文件内按行号排序，上表只给出集合。）

```
node -e "const {execFileSync}=require('node:child_process');let o;try{o=execFileSync(process.execPath,['scripts/check-unused.mjs','--json','test/fixtures/unused'],{encoding:'utf8'})}catch(e){o=e.stdout}const j=JSON.parse(o);const e=JSON.parse(require('node:fs').readFileSync('test/fixtures/unused/expected.json','utf8'));const k=(x)=>x.file+'|'+x.kind+'|'+x.name;console.log(j.items.length,JSON.stringify(j.items.map(k).sort())===JSON.stringify(e.items.map(k).sort()))"
```

期望：输出恰为一行 `8 true`，退出码 0。

**A-14** 干净夹具报告 0

```
node scripts/check-unused.mjs test/fixtures/unused/clean; $LASTEXITCODE
```

期望：输出恰为 `check-unused: ok (files=1)`，最后一行 `0`。

**A-15** 用法错误

```
node scripts/check-unused.mjs --no-such-flag; $LASTEXITCODE
```

期望：stderr 有说明用法的文字，stdout 无 `check-unused: ok`，最后一行 `2`。

```
node scripts/check-unused.mjs no/such/dir; $LASTEXITCODE
```

期望：最后一行 `2`。

**A-16** 缺陷 a5-unused 的 `[fixed]` 段通过，并且死函数已删

```
node --test test/characterization/defects/a5-unused.test.mjs; $LASTEXITCODE
```

期望：输出含 `ℹ fail 0` 和 `ℹ pass 2`，最后一行 `0`。

```
node -e "const s=require('node:fs').readFileSync('lib/select.mjs','utf8');console.log(s.split('isObject').length-1)"
```

期望：输出 `0`，退出码 0。

**A-17** 扫描器自身不留下未使用项

```
node scripts/check-unused.mjs scripts/check-unused.mjs; $LASTEXITCODE
```

期望：输出恰为 `check-unused: ok (files=1)`，最后一行 `0`。

**A-18** 写域缺口（方案 A）：只删了 `typeOf`

```
git diff f6f6057 --stat -- lib/contract/validate.mjs
```

期望：恰为一个文件被改，且只有删除行：`git diff f6f6057 --numstat -- lib/contract/validate.mjs` 输出形如 `0<TAB>N<TAB>lib/contract/validate.mjs`（新增行数为 0，删除行数 N 大于 0 且不超过 9）。

```
node -e "const s=require('node:fs').readFileSync('lib/contract/validate.mjs','utf8');console.log(s.includes('typeOf'))"
```

期望：输出 `false`，退出码 0。

## 四、其它不退化的检查

**A-19** 既有选模测试不改也通过

```
node --test test/unit/select.test.mjs; $LASTEXITCODE
```

期望：输出含 `ℹ pass 6` 和 `ℹ fail 0`，最后一行 `0`；`git diff f6f6057 --stat -- test/unit/select.test.mjs` 无输出。

**A-20** 追踪与门禁

```
node scripts/check-traceability.mjs; $LASTEXITCODE
```

期望：输出 `check-traceability: ok (covered=22 planned=52)`（基准是 covered=19 planned=55，AC-020、AC-021、AC-022 由 planned 变 covered），最后一行 `0`。

```
node scripts/check-seams.mjs; $LASTEXITCODE
```

期望：输出形如 `check-seams: ok (files=22)`（比基准多 `lib/select-draft.mjs` 和 `scripts/check-unused.mjs`；若 `check-seams` 不扫 `scripts/`，则是 `files=21`），最后一行 `0`。

```
node scripts/check-no-collab.mjs; $LASTEXITCODE
```

期望：输出以 `check-no-collab: ok` 开头，最后一行 `0`。

```
node scripts/check-golden-frozen.mjs; $LASTEXITCODE
```

期望：输出 `check-golden-frozen: ok (14 files)`，最后一行 `0`（金标未被改动）。

**A-21** 写域

```
node scripts/check-write-scope.mjs --base f6f6057 --scope-from .collab/tasks/007/design.md; $LASTEXITCODE
```

期望：无以 `FAIL` 开头的行，最后一行 `0`（`.collab/tasks/007/` 下由调度器维护的文件不属于 `lib`、`scripts`、`test`，不在判定之内；若该脚本把它们当作越界，实现者在 `impl.md` 里如实写明并给出输出）。

**A-22** 整体检查

```
pwsh -NoProfile -File scripts/check-fast.ps1; $LASTEXITCODE
```

期望：输出含 `check-fast: ok`，且 `check-unused` 作为 `check-*` 步骤被运行并通过（输出里有 `check-unused: ok`），最后一行 `0`。

```
npm test; $LASTEXITCODE
```

期望：输出含 `ℹ fail 0`，最后一行 `0`。

## 五、零第三方运行时依赖

```
node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies||{}).length)"
```

期望：输出 `0`，退出码 0；`git diff f6f6057 --stat -- package.json package-lock.json` 无输出。
