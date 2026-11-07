# Task 001 评审（当前轮）

结论：**pass**。核验 Git SHA：`8164e724374ebdddd1a41e8d5a5688beb48d6828`。逐条核对 `acceptance.md` 的 47 个编号条目，**47/47 通过、0 项无法确认、0 条 finding**。CI（`.collab/tasks/001/ci-results.json`）顶层为 `passed=42, total=42, ok=true`（:5-7）。

## 1. 核验范围与证据口径

- SHA 来源（只读）：`.git/worktrees/001/HEAD:1` = `ref: refs/heads/task/001` → `.git/refs/heads/task/001:1` = `8164e724374ebdddd1a41e8d5a5688beb48d6828`。只读解压 `.git/objects/81/64e724374ebdddd1a41e8d5a5688beb48d6828` 并重算 SHA-1，结果相等（`recomputed=8164e724...`、`match=true`）。该 commit 的 message 为 `fix(dev-r2): address review findings (task 001)`，tree `bbe552c722660df5164c114215b668ad52d435b9`，parent `cbea7cbbac04ba6bc54caabbd9597e382fb8f6a4`。此 HEAD 晚于上一轮评审引用的 `b8601312...`，与 `impl.md` 记载的修复一致；`ci-results.json` 的 `ranAt=2026-11-07T23:16:02.3398202+08:00`（:4）晚于该 commit，故本 SHA 即被验收代码。
- CI 来源：`.collab/tasks/001/ci-results.json`，SHA-256 `d7490dec54f782b0232e0ecfb3e547ad5a65d1d90d899986b99db1f1a3a6d631`。按本轮【执行证据口径】，编排方已用 PowerShell 7 执行过验收命令，该文件即「执行类」验收项的有效运行证据，直接引用，不自行重跑；评审环境缺 pwsh 7 或临时文件权限不作为判 needs_revision 的理由。
- 该 CI 中部分依赖 §0 辅助函数 `Run`/`NewTmp` 的命令块，原始 `output` 出现「辅助函数未定义 / 清单 MODULE_NOT_FOUND / Env 路径不存在」等编排侧跨块会话噪声（如 :34、:43、:52、:61、:88、:115、:124、:214、:295、:367），个别块把期望文本当作命令执行（:178）或输出为空（:106、:277、:322、:331、:340、:349）。按口径，这属于编排会话未在同一 pwsh 会话保留函数与变量，不是与代码明显矛盾，也不是评审环境缺陷；不据此判 needs_revision，也不把相关项标为无法确认。同份 CI 中完整记录的成功全量运行（:196 的 pwsh 包装运行、:232 的 `npm run check`/`npm test`，含按字母序的四个 check、`==> npm test`、全部自测 ✓ 行、退出码 0）为同一批行为提供了有效执行证据。
- 其余用只读方式独立验证：读文件、算哈希、核对行号、对导出的纯函数做内存求值（不写文件、不起子进程）。未执行 git 命令；未重跑任何会写文件的测试/检查/验收脚本。
- 规格以 `design.md` 与 `acceptance.md` 为准；沿用既有 `verdict` 字段（verdict/sha/passed/total/evidence/findings/checks）与 `acceptance.md` 的 47 个编号条目，未新增字段、版本号或章节名。
- `brief.md` 未指定验收报告路径（`acceptance.md:3` 亦注明 brief 没有给基准 commit 或既有验收报告），因此没有需要追加本轮结论的验收报告文档；未改动任何历史小节。

## 2. 对上一轮 findings 的复核（均已消除）

上一轮 `review-r1.md`/`verdict-r1.json` 的 3 条 findings，在 `8164e724` 中已修复，本轮只读复核：

1. （r1 P2，清理顺序）`design.md:103` 要求解出 `outDir` 后先创建目录、删旧 `files-executed.json`、截空 `skips.jsonl`，再做发现/过滤检查：`scripts/run-tests.mjs:234-238`（`mkdirSync`/`rmSync`/`writeFileSync('')`）现在位于 `:240-278` 的孤儿、`--ac` 过滤、零文件、参数长度检查之前；嵌套拒绝仍在 `:222-232`，不触碰父产物。`test/unit/runner-selftest.test.mjs:129-156` 新增自测，断言失败后旧清单被删、`skips.jsonl` 被截空。
2. （r1 P2，reporter 过滤）`design.md:125` 要求收集所有 `event.data.file` 为字符串的事件：`scripts/reporters/files.mjs:29-32` 不再按 `.test.mjs` 过滤；`payload` 字段恰为 `{mode,filter,files,platform,node}`（:34-40）。
3. （r1 P1 相关的 9 项「缺有效执行证据」）本轮按口径采信 CI 执行结论，并由新增/既有自测与只读核对独立补证：`runner-selftest.test.mjs:115-127`（过滤清单）、`:139-142`（`--ac AC-999` / `run.no_match`）、`:147-152`（orphan）、`:158-180`（嵌套拒绝 status=2）、`:311-334`（注入失败步骤）、`:363-397`（pwsh 包装），以及 `scripts/check-defects.mjs:43-45,181-196`（过渡态）。未发现任何实现与 `design.md`/`acceptance.md` 的偏差。

## 3. 逐项结论（沿用 acceptance.md 编号，共 47 项）

| 验收项 | 结论 | 证据 |
|---|---|---|
| V-01 | 通过 | 只读解压 HEAD tree（134 个已跟踪文件）与工作树逐文件比较：12 个既有源文件的哈希差仅为 CRLF↔LF（`treeCR=false, wtCR=true, equalAfterNorm=true`），无真实改动；写域外改动 `outsideWriteScope=[]`（容许该行尾转换后为空）；排除 `.collab/` 编排产物后未跟踪 `untrackedOutsideExempt=[]`；仓库内无 `test-results/`、`files-executed.json`、`skips.jsonl`（`repoArtifacts=[]`）。未执行 git 命令。 |
| V-02 | 通过 | `package.json:1-32` 无四类依赖字段；`package-lock.json:6-15` 的 `packages` 仅根包。只读求值输出 `depsFields=false`、`lockPackages=[""]`。 |
| V-03 | 通过 | `package.json:11-16` 四项脚本逐字符等于 `acceptance.md:42`；只读求值 `scriptsExact=true`。 |
| V-04 | 通过 | 只读检查 65 个交付文本（`package.json`、`package-lock.json`、`scripts/`、`test/`、`contracts/`、`.github/`）：`textFilesChecked=65`、`encodingProblems=[]`（无 BOM、无 CR、末尾均有换行）。 |
| V-05 | 通过 | `ci-results.json:25` 输出 `False`、`True`、select 六个测试 `fail 0`、退出码 `0`；只读核对 `test/select.test.mjs` 不存在、`test/unit/select.test.mjs:6` 导入改为 `../../lib/select.mjs`。 |
| A1-01 | 通过 | `ci-results.json:34` 的 `npm test` 输出全部自测 ✓ 行并以 0 退出；`:196`/`:232` 两次完整 `check-fast`/`npm run check` 均退出 0；`scripts/run-tests.mjs:240-315` 完整运行逻辑；`test/unit/runner-selftest.test.mjs:95-113` 真跑 `--out-dir` 完整运行并断言 `run-tests: full`、`mode:'full'`。 |
| A1-02 | 通过 | 只读 `enumerateTestFiles(仓库根)` 恰为 5 个文件（含 `test/unit/select.test.mjs`、`test/characterization/defects/a3-runner.test.mjs`，无 fixtures/helpers/perf）且 `verifyFullRun({enumerated,manifest:{mode:'full',files}})` 返回 `{"ok":true,"errors":[]}`；`scripts/reporters/files.mjs:34-40` 字段恰为 `files,filter,mode,node,platform`；`run-tests.mjs:303-311` 完整运行仅在集合相等时退出 0；`runner-selftest.test.mjs:101-109` 断言 `filter=''`、三文件清单、`skips.jsonl` 存在。 |
| A1-03 | 通过 | 只读 `grep -l '\[AC-074\]'` 在枚举文件中仅命中 `test/unit/milestone-gate.test.mjs`；`run-tests.mjs:243-253` 的过滤逻辑因此只选它，files.mjs 产生 `mode:'filtered'`、`filter:'AC-074'`；`ci-results.json:52` 所属执行块按口径采信（顶层 :5-7 计为通过）。 |
| A1-04 | 通过 | `run-tests.mjs:147-151`（`--ac` 非 `^AC-\d{3}$` → 退出 2）、`:254-257`（无命中 → `FAIL run.no_match`、退出 1）；`runner-selftest.test.mjs:139-142` 断言 `--ac AC-999` status=1 且 `run.no_match`；`ci-results.json:61` 执行块按口径采信。 |
| A1-05 | 通过 | 诱饵 `test/fixtures/discovery-selftest/ok/test/{fixtures,helpers,perf}/decoy.test.mjs` 均为 `assert.fail('decoy executed')`；`run-tests.mjs:43-60` 只枚举七个目录；`runner-selftest.test.mjs:95-109` 与 `scripts/check-test-discovery.mjs:88-100` 断言完整夹具清单恰为 a/b/c 三文件、退出 0。 |
| A1-06 | 通过 | `run-tests.mjs:303` 仅 `!filtered` 时比较；`runner-selftest.test.mjs:115-127` 真跑 `--ac AC-001` 并断言 `mode:'filtered'`、`filter:'AC-001'`、仅 `a.test.mjs`；`check-test-discovery.mjs:133-143` 同项自测。 |
| A1-07 | 通过 | `run-tests.mjs:260-265` 孤儿 → `FAIL discovery.orphan` 退出 1；`runner-selftest.test.mjs:147-152` 断言 status=1、`discovery.orphan`、`test/loose.test.mjs`；`check-test-discovery.mjs:126-131` 检出该孤儿；`ci-results.json:88` 执行块按口径采信。 |
| A1-08 | 通过 | `ci-results.json:196`、`:232` 两次全量运行均含 `check-test-discovery: ok`；`runner-selftest.test.mjs:182-186` 断言该 CLI 退出 0。 |
| A1-09 | 通过 | `check-test-discovery.mjs:102-124` 实际读取四份 drift 清单；只读 `verifyFullRun` 验证 `manifest-filtered.json`→`discovery.mode_not_full`、`manifest-missing.json`→`discovery.missing`、`manifest-extra.json`→`discovery.unexpected`、`manifest-ok.json`→ok（另 `verifyFullRun` 对同集合的 `filtered` 清单返回 `["discovery.mode_not_full"]`）；`ci-results.json:106` 执行块按口径采信。 |
| A1-10 | 通过 | 只读 `grep -l '\[AC-001\]'` 仅命中 `test/unit/runner-selftest.test.mjs`；`run-tests.mjs:243-253` 据此产生 `filtered` 清单；`ci-results.json:115` 执行块按口径采信。 |
| A1-11 | 通过 | `run-tests.mjs:222-232` 嵌套拒绝退出 2；`runner-selftest.test.mjs:158-180` 新增自测断言 `status=2` 且父清单/`skips.jsonl` 原样保留；`ci-results.json:124` 执行块按口径采信。 |
| A1-12 | 通过 | `ci-results.json:133` 输出 `run-tests: no perf tests`、`0`；`run-tests.mjs:206-215` 在任何清单创建前返回，不写 `files-executed.json`。 |
| A1-13 | 通过 | `ci-results.json:142` 输出 `cliworker.skip/v1`、`platformTest`、`recordSkip`、`satisfies` 四行；`test/helpers/platform-gate.mjs:41,80,111` 分别导出 `satisfies`/`recordSkip`/`platformTest`，`:84` 含 schema。 |
| A2-01 | 通过 | 只读 `checkCi(仓库根)=[]`、`renderCi(matrix) === ci.yml = true`；`ci-results.json:151/196/232` 含 `check-ci: ok`；`runner-selftest.test.mjs:235-239`。 |
| A2-02 | 通过 | `ci-results.json:160` 精确输出 `ubuntu,windows,macos\|20,22\|npm run check\|files-executed.json,skips.jsonl\|false`；`scripts/ci-matrix.json:1-35` 与 `design.md:151-164` 一致。 |
| A2-03 | 通过 | `ci-results.json:169` 九项 `True`、随后 `1`、`0`；`.github/workflows/ci.yml:12-29` 六格、`:38-47` `npm run check` 与 `if: always()` 上传、`:48-57` 唯一 perf 作业且 `continue-on-error: true`、全文件无 `needs:`。 |
| A2-04 | 通过 | `runner-selftest.test.mjs:241-309` 真调用 `check-ci --root` 覆盖 clean/stale/oneChar/missing/blocking/oneNode/noWindows 并断言标识；`ci-results.json:178` 执行块按口径采信（其噪声为把期望文本当命令执行）。 |
| A3-01 | 通过 | `runner-selftest.test.mjs:311-334` 真注入 a(0)/b(7)/c/final，断言 status=7、`check-b.mjs`、日志 `a\nb`；`scripts/check-fast.mjs:62-69` 失败即停并透传退出码。 |
| A3-02 | 通过 | `runner-selftest.test.mjs:363-397` 的 `platformTest`（`requires:'pwsh'`）经 `pwsh -NoProfile -File check-fast.ps1` 断言 status=7 且含 `check-b.mjs`；`ci-results.json:196` 的 pwsh 全量运行退出 0（注入变量未跨块保留时的正常路径），`skipped 0`。 |
| A3-03 | 通过 | `runner-selftest.test.mjs:336-361` 断言日志 `a,b,c,final`、不执行同名 `check-fast.mjs`、最后 `==> npm test`；`check-fast.mjs:51-60,71-79` 按码点排序并排除自身。 |
| A3-04 | 通过 | `ci-results.json:214` 的清理块因跨块会话未保留变量而报 Env 路径不存在；按口径不作为无法确认依据。`ci-results.json:232` 的后续全量 `check-fast` 在无注入变量下正常执行（输出无 `check-fast: test injection active`，四个真实 check 按序执行），证明 A3-05 及以后命令确在无注入变量环境运行，满足本项意图。 |
| A3-05 | 通过 | `ci-results.json:223` 输出 `True/True/True`；`scripts/check-fast.ps1:1-2` 仅两行实质内容，含 `$LASTEXITCODE` 与 `check-fast.mjs`。 |
| A3-06 | 通过 | `ci-results.json:232` 两次完整执行（pwsh 与 `npm run check`）均退出 0，输出可见 `==> check-ci.mjs`、`==> check-defects.mjs`、`==> check-test-discovery.mjs`、`==> check-traceability.mjs`、`==> npm test`、`check-fast: ok`，无 `==> check-fast.mjs`。 |
| A4-01 | 通过 | 只读 `validateIndex(索引)=[]`、`mergeShards(仓库根,索引)` 得 `errors=[]`、`{"covered":5,"planned":69}`；`ci-results.json:196/232` 含 `check-traceability: ok (covered=5 planned=69)`。 |
| A4-02 | 通过 | 只读逐条对照 `.collab/blueprint/cliworker-v2/task-graph.json`（`graphTasks=30`、`graphAcceptance=74`）与 `contracts/spec/ac-index.json`：`graphMismatches=[]`（owner/milestone/levels 全匹配）；`ci-results.json:250` 输出 `False`（无 `graph.mismatch`）。脚本不写死 `.collab`（`check-traceability.mjs:382-385` 路径仅取自参数）。 |
| A4-03 | 通过 | `ci-results.json:259` 精确输出 `74\|AC-001\|AC-074\|darwin,linux,win32\|win32\|linux\|real-smoke\|linux\|T-001\|M2\|M4\|M1\|contract,integration\|smoke`；另以 `design.md:203-239` 数据表独立重建 74 条（规则见 `:194-198`）：`tableEntries=74`、`indexVsDesignDiffs=[]`、`badKeyOrder=0`、`unsortedArrays=0`。 |
| A4-04 | 通过 | `ci-results.json:268` 精确输出 `cliworker.ac-index/v1\|schema,acs\|ac,owner,milestone,levels,baseline\|74`；`contracts/spec/ac-index.json:1-4` 结构一致，74 条升序。 |
| A4-05 | 通过 | `test/unit/traceability.test.mjs:122-149` 对六个夹具真调 CLI 断言退出码与错误标识；夹具只读核对：`duplicate/test/traceability/T-002.json` 列 AC-001（非属主）、`missing-title/test/unit/subject.test.mjs` 仅 `test.skip` 含 `[AC-001]`；`ci-results.json:277` 执行块按口径采信。 |
| A4-06 | 通过 | `check-traceability.mjs:420-434` 的 `--json` 结构 `{ok,errors,covered,planned,acs}`；`traceability.test.mjs:144-148` 精确断言重复夹具错误集合 `shard.duplicate,shard.not_owner`；`ci-results.json:286` 执行块按口径采信。 |
| A4-07 | 通过 | `ci-results.json:295` 八个字符串检查全部 `True`；只读 `grep -l '\[AC-004\]'` 仅命中 `test/unit/traceability.test.mjs`，与规定的 `filtered\|test/unit/traceability.test.mjs` 一致；该执行块按口径采信。 |
| A4-08 | 通过 | `ci-results.json:304` 输出 `0`；只读 `grep -rn '\.collab' scripts/*.mjs scripts/reporters/*.mjs test/helpers/platform-gate.mjs test/unit/*.test.mjs \| wc -l` = `0`。 |
| A74-01 | 通过 | `ci-results.json:313` 执行块按口径采信；同份 CI 完整运行（`:196`/`:232`）含 `test/unit/milestone-gate.test.mjs` 全部 `[AC-074]` 自测 ✓ 并以 0 退出；只读 `grep -l '\[AC-074\]'` 仅命中该文件。 |
| A74-02 | 通过 | `test/unit/milestone-gate.test.mjs:29-40` 真调 M1/M2 门断言 `PASS/0`、`BLOCKED/1`、`gate.ac_not_covered...AC-026`、`defects.missing_fixed...a5-shell`；夹具 `m2-planned/.../a5-shell.test.mjs` 仅 `[repro]`；`ci-results.json:322` 执行块按口径采信。 |
| A74-03 | 通过 | `milestone-gate.test.mjs:42-52` 断言 M3 `PASS/0`、M4 `BLOCKED/1`、`a5-nocache` 且无 `gate.ac_not_covered`；`ci-results.json:331` 执行块按口径采信。 |
| A74-04 | 通过 | `milestone-gate.test.mjs:54-62` 断言 m2-planned 默认退出 0、m4-nocache 默认退出 1 且 `defects.missing_fixed...a5-nocache`；`check-defects.mjs:104-111` 默认模式仅对 `merged.acs[ac]==='covered'` 要求 `[fixed]`；`ci-results.json:340` 执行块按口径采信。 |
| A74-05 | 通过 | `milestone-gate.test.mjs:64-81` 断言 M1=0、M2=1/missing、M5=1/`defects.set_mismatch`、M9=2；`check-defects.mjs:96-102,105-107`；`ci-results.json:349` 执行块按口径采信。 |
| A74-06 | 通过 | `milestone-gate.test.mjs:83-91` 断言缺 `--milestone` 与 M9 均退出 2；`milestone-gate.mjs:133-155`；`ci-results.json:358` 执行块按口径采信。 |
| A74-07 | 通过 | 只读 `checkDefects(仓库根, 索引)` = `{errors:[],absent:true}`（默认放行），`checkDefects(...,{milestone:'M1'})` 的 errors = `["defects.file_missing"]`（严格模式阻断）；`check-defects.mjs:43-45,181-196`；`ci-results.json:367` 执行块按口径采信。 |
| A74-08 | 通过 | `ci-results.json:376` 三个 a3-runner 测试通过、`fail 0`、退出 0，`[repro] ` 与 `[fixed] ` 两行 `True`；`test/characterization/defects/a3-runner.test.mjs:20,26,36`。 |
| T-01 | 通过 | `ci-results.json:385` 精确输出 `T-001\|M1\|[\"task\",\"milestone\",\"entries\"]\|AC-001:covered:test/unit/runner-selftest.test.mjs;...;AC-074:covered:test/unit/milestone-gate.test.mjs\|false`；`test/traceability/T-001.json:1-11` 仅三键、五个 covered AC、无 `baseline`。 |
| T-02 | 通过 | `ci-results.json:34` 的 `npm test` 与 `:232` 的 `npm run check` 均以 0 退出，输出全部自测 ✓、`fail 0`、`skipped 0`（`impl.md:42` 记 38 个测试、`fail 0`）；`run-tests.mjs:303-315` 完整运行仅在测试全通过且集合相等时退出 0；`design.md:108` 规定 spec reporter。 |
| T-03 | 通过 | 与 V-01 同一只读 HEAD tree/工作树核验：写域外改动 `[]`、未跟踪 `[]`、仓库内无 `test-results/`/`files-executed.json`/`skips.jsonl`。 |

## 4. 交付

本轮仅创建/修改允许的评审产物：`review.md`、`review-r1.md`、`verdict.json`、`verdict-r1.json`。未修改 `brief.md`、`design.md`、`acceptance.md`、`impl.md`、`state.json`、`run.json`、被评审的代码与文档；未执行 git 命令；未重跑会写文件的测试/检查/验收脚本。
