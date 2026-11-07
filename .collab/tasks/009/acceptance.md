# Task 009 验收标准（AC-025）

规格来源：`.collab/blueprint/cliworker-v2/task-graph.json` T-009，`contracts/spec/ac-index.json` AC-025。缺陷登记：`test/characterization/defects.json` 的 `a2-pack`（`repro_sha256` = `f520198675d74dc94fd4be7bd120a0f7f5168e0058e85369bcc618100dbd9c93`，不得变化）。

所有命令在仓库根（worktree 根）用 `pwsh` 执行。「通过」指退出码 0 且 stdout 含期望文本。

## A. 清单字段

**A1** `package.json` 的 bin
- 命令：`node -p "require('./package.json').bin.cliworker"`
- 期望：stdout 为 `bin/cliworker.mjs`，退出码 0。

**A2** `files` 含必需条目
- 命令：`node -p "const f=require('./package.json').files; ['bin','lib','config/cliworker.example.json','contracts/registry.snapshot.json','contracts/agentline-forbidden.json','contracts/schemas','contracts/host','contracts/context'].every(x=>f.includes(x))"`
- 期望：stdout 为 `true`。

**A3** `files` 不含目录级放行或规格金标
- 命令：`node -p "const f=require('./package.json').files; ['config','contracts','contracts/spec','contracts/golden','contracts/examples','test','scripts'].some(x=>f.includes(x))"`
- 期望：stdout 为 `false`。

**A4** 版本对齐
- 命令：`node -p "require('./dsh.plugin.json').version===require('./package.json').version"`
- 期望：stdout 为 `true`。

**A5** 零第三方依赖
- 命令：`node -p "const p=require('./package.json'); Object.keys({...p.dependencies,...p.devDependencies,...p.optionalDependencies,...p.peerDependencies}).length"`
- 期望：stdout 为 `0`。

## B. 真实打包结果

**B1** check-pack 通过
- 命令：`node scripts/check-pack.mjs`
- 期望：stdout 为 `check-pack: ok`，退出码 0。

**B2** npm pack 清单含必需文件
- 命令：`$j = npm pack --dry-run --json --ignore-scripts | ConvertFrom-Json; $p = $j[0].files.path; ('bin/cliworker.mjs','config/cliworker.example.json','contracts/registry.snapshot.json','contracts/agentline-forbidden.json','lib/index.js','dsh.plugin.json','package.json') | ForEach-Object { "$_ " + ($p -contains $_) }`
- 期望：七行，全部以 ` True` 结尾。

**B3** 清单含三个 contracts 子目录
- 命令：`$j = npm pack --dry-run --json --ignore-scripts | ConvertFrom-Json; $p = $j[0].files.path; foreach ($d in 'contracts/schemas/','contracts/host/','contracts/context/') { "$d " + (@($p | Where-Object { $_.StartsWith($d) }).Count -gt 0) }`
- 期望：三行，全部以 ` True` 结尾。

**B4** 清单不含禁入路径
- 命令：`$j = npm pack --dry-run --json --ignore-scripts | ConvertFrom-Json; $j[0].files.path | Where-Object { $_ -match '^(test|scripts|state|contracts/golden|contracts/spec|contracts/examples)/' -or $_ -match '^\.collab/' -or $_ -match '^config/.*\.local\.json$' -or $_ -match '\.jsonl$' }`
- 期望：无任何输出。

**B5** 每个 lib 文件都在包里
- 命令：`$j = npm pack --dry-run --json --ignore-scripts | ConvertFrom-Json; $p = $j[0].files.path; Get-ChildItem lib -Recurse -File | ForEach-Object { 'lib/' + [IO.Path]::GetRelativePath((Resolve-Path lib), $_.FullName).Replace('\','/') } | Where-Object { $p -notcontains $_ }`
- 期望：无任何输出。

## C. check-pack 负向行为（由测试覆盖）

**C1** 集成测试全部通过
- 命令：`node --test --test-reporter=tap test/integration/pack.test.mjs`
- 期望：退出码 0；输出含 `# fail 0`；且以下七个标题各有一行 `ok`：
  - `ok N - [AC-025] check-pack passes against the real package`
  - `ok N - [AC-025] npm pack lists the required runtime files`
  - `ok N - [AC-025] npm pack lists no forbidden paths`
  - `ok N - [AC-025] evaluatePack rejects a missing required file`
  - `ok N - [AC-025] evaluatePack rejects each forbidden path class`
  - `ok N - [AC-025] evaluatePack rejects a bin or version mismatch`
  - `ok N - [AC-025] evaluatePack rejects a non-whitelisted contracts path`

**C2** CLI 参数错误
- 命令：`node scripts/check-pack.mjs --bogus; "exit=$LASTEXITCODE"`
- 期望：stderr 含 `unknown argument` 与 `usage`；最后输出 `exit=2`。

**C3** 包内容缺失时 CLI 失败（用临时目录，不碰仓库）
- 命令：`$d = Join-Path ([IO.Path]::GetTempPath()) ("cp-" + [guid]::NewGuid()); New-Item -ItemType Directory $d | Out-Null; Copy-Item package.json, dsh.plugin.json, cordis.patch.yml, README.md $d; node scripts/check-pack.mjs --root $d; "exit=$LASTEXITCODE"; Remove-Item -Recurse -Force $d`
- 期望：输出含 `FAIL pack.missing_required`（临时目录没有 `bin/`、`lib/`、`config/`、`contracts/`），不含 `pack.bin_mismatch` 与 `pack.version_mismatch`，含 `check-pack: FAILED`，最后输出 `exit=1`。

## D. 缺陷 a2-pack

**D1** repro 块未被改动、canary 有效、[fixed] 段存在
- 命令：`node scripts/check-defects.mjs`
- 期望：stdout 为 `check-defects: ok`，退出码 0。（覆盖 sha256 校验、`[repro]` 在 v0.1 副本上通过、canary 变体上失败、`a2-pack` 有 `[fixed]` 段。）

**D2** M1 口径
- 命令：`node scripts/check-defects.mjs --milestone M1`
- 期望：stdout 为 `check-defects: ok`，退出码 0。

**D3** `[fixed]` 测试通过
- 命令：`node --test --test-reporter=tap --test-name-pattern="\[fixed\]" test/characterization/defects/a2-pack.test.mjs`
- 期望：退出码 0；输出含 `ok 1 - [fixed] [AC-025] the live package ships bin and the config example but no spec or golden`，且 `# fail 0`。

**D4** repro 块 sha256 未变
- 命令：`node -e "import('./scripts/check-defects.mjs').then(m=>console.log(m.reproSha256(require('fs').readFileSync('test/characterization/defects/a2-pack.test.mjs','utf8'))))"`
- 期望：stdout 为 `f520198675d74dc94fd4be7bd120a0f7f5168e0058e85369bcc618100dbd9c93`。

## E. 追溯与里程碑

**E1** 按 AC 运行
- 命令：`node scripts/run-tests.mjs --ac AC-025`
- 期望：退出码 0；无 `FAIL run.no_match AC-025`；pack.test.mjs 与 a2-pack.test.mjs 的相关测试均被执行并通过。

**E2** traceability 分片
- 命令：`node -p "const t=require('./test/traceability/T-009.json'); JSON.stringify([t.task,t.milestone,t.entries.length,t.entries[0].ac,t.entries[0].status,t.entries[0].files.slice().sort()])"`
- 期望：stdout 为 `["T-009","M1",1,"AC-025","covered",["test/characterization/defects/a2-pack.test.mjs","test/integration/pack.test.mjs"]]`。

**E3** traceability 检查
- 命令：`node scripts/check-traceability.mjs`
- 期望：退出码 0，无 `FAIL` 行（不应出现 `shard.missing_file`、`shard.missing_title`）。

**E4** 里程碑门
- 命令：`node scripts/milestone-gate.mjs --milestone M1`
- 期望：stdout 含 `milestone-gate M1: PASS`，退出码 0。若失败原因仅是其它 M1 任务（如 T-008）尚未合并而 AC 为 `planned`，记录原因并以 E1–E3 为准，不算本任务失败；若失败涉及 AC-025 或 `a2-pack`，则本任务失败。

## F. 全局质量与范围

**F1** 无 `.collab` 引用
- 命令：`node scripts/check-no-collab.mjs`
- 期望：退出码 0，无 `FAIL` 行。

**F2** 无未使用代码
- 命令：`node scripts/check-unused.mjs`
- 期望：退出码 0，无报告项。

**F3** 完整快速检查
- 命令：`pwsh -NoProfile -File scripts/check-fast.ps1`
- 期望：退出码 0；输出中没有 `check-fast: FAILED`。

**F4** 写入范围
- 命令：`git diff --name-only main...HEAD | Where-Object { $_ -notlike '.collab/*' -and $_ -notin @('package.json','dsh.plugin.json','scripts/check-pack.mjs','test/integration/pack.test.mjs','test/characterization/defects/a2-pack.test.mjs','test/traceability/T-009.json') }`
- 期望：无任何输出。

**F5** `[repro]` 之外 canary 查找串唯一
- 命令：`(Select-String -Path test/characterization/defects/a2-pack.test.mjs -Pattern 'bin: null' -SimpleMatch).Count`
- 期望：stdout 为 `1`。

**F6** 仓库内无令牌
- 命令：`git diff main...HEAD -- . ':!.collab' | Select-String -Pattern 'sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9]'`
- 期望：无任何输出。
