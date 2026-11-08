# Task 010 评审（当前轮，round 1）

结论：**pass**。所验证的 git sha：`56065d1d708254572b4ba2232097d201659c27b6`。逐条核对 `acceptance.md` 的 3 条 AC，**3/3 通过、0 项无法确认、0 条 finding**。CI（`.collab/tasks/010/ci-results.json`）顶层为 `passed=3, total=3, ok=true`（:5-7）。

## 1. 核验范围与证据口径

- **SHA 来源（只读）**：工作区 `.git:1` = `gitdir: C:/git/dsh-CLIWorker/.git/worktrees/010` → `worktrees/010/HEAD:1` = `ref: refs/heads/task/010` → `.git/refs/heads/task/010:1` = `56065d1d708254572b4ba2232097d201659c27b6`。只读 zlib 解压 `.git/objects/56/065d1d708254572b4ba2232097d201659c27b6`，对象头 `commit 243`，tree `64de4703e05153eed8e08fbed1647bb5361db35e`，parent `2dbfe2b38990acb76010903944e0055addd74cc0`，时间戳 `1794100472 +0800` = `2026-11-08T01:14:32Z`，消息 `fix(dev): repair after CI failure (task 010)`（COMMIT_EDITMSG 同）；对解压字节重算 SHA-1 得同一值（`match=true`）。`worktrees/010/logs/HEAD` 末条 `2dbfe2b3 -> 56065d1d` 即该提交，之后无新提交；`ORIG_HEAD = 040d2e9037844e5e2f0421956c1020a8d8f2d36e` 与 `acceptance.md:3` 起点提交 `040d2e9` 一致。`ci-results.json:4` 的 `ranAt=2026-11-08T09:14:39.1646543+08:00`（=01:14:39Z）晚于该提交 7 秒，故 CI 结果对应当前 HEAD，不矛盾。
- **执行证据口径**：`ci-results.json`（SHA-256 `5911a51bd4bc1dcb0b119cf32abe9c108e8f35e5b857ef5bfa0b6a53097beb43`）由编排方用 PowerShell 7 产生，含每条命令退出码与输出，按口径为执行类验收项的有效运行证据，直接引用、不自行重跑；评审环境缺 pwsh 7 或临时文件权限不作为判 `needs_revision` 的理由。CI 结果不缺失、且与代码无明显矛盾（见 §3 的逐项对齐）。
- **其余用只读方式独立验证**：读文件、算哈希、核对行号、只读解压 git tree 对象、对 `check-seams.mjs` 的 `scanRoot()` 做内存求值。未执行任何 git 子命令；未重跑任何会写文件的验收/测试/check 脚本。
- 规格以 `design.md` 与 `acceptance.md` 为准；沿用既有 `verdict` 字段（verdict/sha/passed/total/evidence/findings/checks）与 `acceptance.md` 的 3 个 AC 章节名，未新增字段、版本号或章节名。
- `brief.md` 全文 grep `报告/报告路径/report/追加` 无验收报告路径，`design.md` 亦未给出（:106/:123 的「追加」分别指 `observed.log` 与 `[fixed]` 用例），故本轮结论无追加目标、未改动任何历史小节。

## 2. 逐项结论（沿用 acceptance.md 编号，共 3 项）

| 验收项 | 结论 | 证据 |
|---|---|---|
| AC-026 | 通过 | **命令输出**：`ci-results.json:9-17`，`passed=true`、`exitCode=0`、`lastLine='AC-026 OK'`；`output(:16)` 含 16 条通过标题（`[repro] [AC-005]` 与 `[fixed] [AC-026]` 齐全）、`tests 16/pass 16/fail 0`、`run-tests: filtered 2 files`、`check-seams: ok (files=26)`、`check-defects: ok`，无 `FAIL` 行，与 `acceptance.md:9-10` 期望逐项相符。**文件行号**：`lib/exec.mjs:12-15` 默认值/`SAFE_ARG_RE`、`:100-106` `checkCmdArgs`、`:113-146` `resolveShim`、`:187-214` `buildAttempts`、`:278-319` `runSync`（`shell:false`:293、`EINVAL`:311-315）；`test/unit/exec.test.mjs:120-130` 默认值与白名单、`:132-155` 四垫片解析 + `plain-batch=null`、`:157-198` 直接/node/cmd.exe 三路径 `shell===false`、`:200-230` runAsync node/taskkill 两路径 `shell===false`、`:232-242` 10 敌意参数直通、`:244-257` cmd 回退逐个 `E_UNSAFE_ARG` 且 0 spawn、`:259-270` 可解析垫片敌意参数原样传给 node、`:272-310` EINVAL（spawnSync 返回码 + spawn 抛错）转入 node+script、`:312-328` 错误只含下标不回显值；`a5-shell.test.mjs:13` `[repro]`、`:18-42` `[fixed] [AC-026]`；独立重算 `[repro]` SHA-256 = `3e2896c7…e2c` 与 `defects.json:71` 相等；内存 `scanRoot()` = `files 26 / violations []`。 |
| AC-027 | 通过 | **命令输出**：`ci-results.json:18-26`，`passed=true`、`exitCode=0`、`lastLine='AC-027 OK'`；`output(:25)` 为 `✔ [AC-027] a generated win32 .cmd shim is parsed and node runs with the exact argv` 且 `tests 1/pass 1/fail 0/skipped 0`、`run-tests: filtered 1 files`——win32 基线真实通过且非 skip，符合 `acceptance.md:14-15` 与 `:26`。**文件行号**：`test/integration/exec-native.test.mjs:21-23` `platformTest(requires:'win32')`、`:25` 临时目录、`:30-33` 由 `npm-v7.cmd.txt` 生成 `foo.cmd`（`foo.js→foo.mjs` + `cmd-ran.marker` 探针）、`:35-37` 复制 `argv-recorder.mjs` 为 `foo.mjs`、`:12` 九个敌意 ARGS、`:40-54` 注入记录包装的 `createExec`、`:56-62` runSync/runAsync argv 与 ARGS `deepEqual`、`:64` `cmd-ran.marker` 不存在、`:66-68` 唯一 spawn 且 `file===process.execPath`、`:69-72` 无 `cmd.exe` 且所有 `shell===false`；`test/helpers/platform-gate.mjs:80-97` `recordSkip` 写 `cliworker.skip/v1`、`:111-129` 非 win32 记跳过。 |
| AC-028 | 通过 | **命令输出**：`ci-results.json:27-35`，`passed=true`、`exitCode=0`、`lastLine='AC-028 OK'`；`output(:34)` 含 `✔ [AC-028] a timed out child and its grandchild are both killed`、`✔ [AC-028] ten tasks run with at most four at a time` 及 14 条 `[AC-026]/[AC-028]` 单测标题，`tests 16/pass 16/fail 0`、`run-tests: filtered 2 files`，符合 `acceptance.md:19-20`。**文件行号**：`test/integration/exec-tree.test.mjs:37-71`（timeout 60000、`pids.json` 屏障 10 秒轮询、`clock.advance(60000)`、`E_TIMEOUT`、child/grandchild 5 秒内 `ESRCH`、`pending()===0`）、`:73-93`（10 任务全 ok、`observed.log` 10 行、峰值 ≤4）；`test/unit/exec.test.mjs:330-360`（峰值恰 4、排队不登记定时器）、`:362-377`（定时器经伪时钟、正常结束 `pending()===0`）、`:379-412`（`taskkill /PID /T /F` 与 `shell:false`）、`:414-437`（进程组 `kill(-pid,'SIGKILL')` 与 `detached`）、`:439-446`（缺 clock `TypeError` / 非法 `maxConcurrent` `RangeError`）；`lib/exec.mjs:251-271` 信号量、`:397` E_TIMEOUT、`:412-447` win32 杀树、`:460-472` POSIX 杀组、`:508` 时钟登记、`:352-355` 清除。 |

## 3. CI 输出与代码的独立对齐（不只看文件存在）

- `scripts/run-tests.mjs:243-253` 的 `--ac` 过滤按源码是否含 `[AC-0xx]` 选文件。只读 grep 命中 `[AC-026]` 恰 2 文件（unit/exec.test.mjs、defects/a5-shell.test.mjs）、`[AC-027]` 恰 1 文件（integration/exec-native.test.mjs）、`[AC-028]` 恰 2 文件（unit/exec.test.mjs、integration/exec-tree.test.mjs），与 CI 三处 `filtered 2/1/2 files` 精确一致。
- 用例数：unit 14 + a5-shell 2 = 16、exec-tree 2 + unit 14 = 16、exec-native 1，与 CI `tests 16/pass 16/fail 0`、`tests 1/pass 1/skipped 0` 精确一致；a5-shell 的 `[repro]`/`[fixed]` 两标题齐全。
- 只读内存调用 `check-seams.mjs` 的 `scanRoot()` 得 `files=26, violations=[]`，与 CI `check-seams: ok (files=26)` 一致。
- 按 `check-defects.mjs:145-179` 算法独立重算 `a5-shell.test.mjs` 的 `[repro]` 段 SHA-256 = `3e2896c799db13a45e72a9d74879b4e4fd5e0ba07cb4261342f720b5a7071e2c`，与 `test/characterization/defects.json:71` 登记值逐字相等，与 CI `check-defects: ok` 一致。

## 4. 实现与规格一致性（独立只读核对）

| 项 | 核对内容 | 结果 |
|---|---|---|
| `lib/exec.mjs` §2–§6 | `:12-15` 默认值与 `SAFE_ARG_RE`；`:100-106` 白名单；`:113-146` `resolveShim`（`path.win32`、`:21-22` 正则与 §4 字面一致、`%~dp0`/`%dp0%` 替换、`existsSync` 失败即关闭、`node.exe` 探测）；`:187-214` 执行规划（非 win32 直连、win32 `.exe/.com/.cmd/.bat` 固定序解析、三分支、不安全结果只写下标）；`:278-319` runSync（`shell:false`、EINVAL 降级、ETIMEDOUT→E_TIMEOUT）；`:322-521` runAsync（信号量、伪时钟登记/清除、win32 taskkill、POSIX `kill(-pid)`、E_TIMEOUT、只结算一次）；`:529-531` `run` 保持同步 | 与 design 一致 |
| 全部 spawn | 3 处 spawn 选项 `:293/:416/:492` 均 `shell: false`；静态扫描无 `shell: true`/`shell: process.platform`、无 `node:fs` 导入、无裸全局定时器/`Date.now`/`new Date()`/`performance.now`/`process.hrtime`/`process.exit`；仅 `node:child_process` + `node:path`（§4 强制） | 满足 |
| `lib/availability.mjs` §7 | `:9-15` 两处 `ctx.exec` 均带 `lookup`，无 `child_process` 导入；只读解压基准 `040d2e9` 同名 blob 逐行对比：除两处新增 `lookup` 外，probe/版本解析/错误分支/200 字符截断/auth/providerStatus 全部逐字不变 | 满足 |
| `a5-shell` `[fixed]` | `:18-42` live availability + `createExec({platform:'win32',spawnSync:记录器}).runSync` 作 `ctx.exec`，断言每次 spawn `shell===false`、断言 exec 源码不含 `shell: process.platform`（另加 `shell: true`） | 满足 design.md:123 |
| 夹具 `test/fixtures/exec/**` | 5 份 `.cmd.txt` 与 design.md:98-102 表格逐行一致；`argv-recorder.mjs:2`、`spawn-grandchild.mjs:10-15`、`sleep-forever.mjs:2`、`slot-task.mjs:11-15` 与 design.md:103-107 一致；无 BOM、无 CR、无 `*.test.mjs` | 满足 |
| 追踪 `T-010.json` | `:1-29` 三键、AC-026/027/028 全 `covered`、files 列表与 design.md:124 一致，每个列出文件均含对应 `[AC-0xx]` 标题 | 满足 |
| 写域（只读解压 git tree） | 基准 `040d2e9`（498 跟踪）→ HEAD（516 跟踪）：ADDED 18 = 13 个 write_scope 代码/测试 + 5 个 `.collab/tasks/010/` 编排维护文件；MODIFIED 3（`lib/exec.mjs`、`lib/availability.mjs`、`a5-shell.test.mjs`）均在 design.md:2-11 write_scope 内；REMOVED 0；`lib/context.mjs`、`lib/commands/**`、`lib/index.js`、`contracts/**`、`scripts/**`、`test/helpers/**`、`defects.json` 零改动 | 满足 |
| 工作树 == HEAD | 全仓 516 跟踪文件逐字节比对：仅 `.collab/tasks/010/run.json` 与 `state.json` 因编排状态更新而不同，无产品代码差异；16 个 write_scope 文件全部与 HEAD blob 匹配（3 个 lib/测试文件为工作树 CRLF、git 对象 LF，归一化相等）；仓库内无未跟踪文件（排除 `.collab`）、无 test-results/files-executed.json/skips.jsonl 残留 | 满足 |
| 编码与令牌门 | 16 个交付文本文件 0 BOM、`.cmd.txt` 0 CR、`sk-/ghp_/xox/AKIA/Bearer/PRIVATE KEY` 命中 0 | 满足 |

## 5. Findings

无。

## 6. 备注（非缺陷，不写入 findings）

- `impl.md` §4 记载的全量 `run-tests` 3 条基线遗留失败（AC-073/AC-013/AC-006）与 `milestone-gate M2` 的 AC-029..035 阻断，均属其它任务写域，`acceptance.md` 仅覆盖本任务 AC-026/027/028，按 `acceptance.md:22-26` 判定规则不计入。
- `impl.md` §5 记载 dev 依 `inputs.jsonl:1` 的用户 note 把 `acceptance.md` 重写为 CI 可抽取形状（授权行为，ci-results.json 已成功抽出 3 条命令并全过），与 task 004/008/009 先例一致，非本任务代码缺陷。
- `design.md` §1 写 exec「只允许导入 node:child_process」而 §4 强制用 `path.win32`，实现按 §4 引入 `node:path`，`check-seams` 实测 0 违规、CI `check-seams: ok`，属受规格约束的最小实现；`design.md` §2 写 `lookup`「仅 run/runSync 使用」，实现 `runAsync(:325)` 亦调用 `withLookup`，为无害超集，不影响任一验收项。

## 7. 交付

本轮仅创建/修改允许的评审产物：`review.md`、`review-r1.md`、`verdict.json`、`verdict-r1.json`（两份 review、两份 verdict 内容一致）。未修改 `brief.md`、`design.md`、`acceptance.md`、`impl.md`、`state.json`、`run.json` 及任何被评审代码与文档；未执行 git 命令；未重跑会写文件的验收/测试/check 脚本；未改动任何历史小节。
