# Task 011 评审（review，第 1 轮）

## 结论：pass（2/2）

- 所验证的 git sha（so 验证的 git sha）：`4a61283de4ffde461bb5226e8f2c6bcbc9a3a359`（分支 `task/011` HEAD）。由只读解压 `.git` 对象取得，全程未执行任何 git 子命令；详见「SHA 核验」。基准提交 `040d2e9037844e5e2f0421956c1020a8d8f2d36e`（`design.md:28` 的 040d2e9）。
- 通过数 / 总数：**2 / 2**。`acceptance.md` 恰含 2 个以 AC id 开头的二级小节（`## AC-029` :7、`## AC-030` :26），各下挂 1 条 `- 命令:`（:9 / :28）与 1 条 `- 期望:`（:10 / :29）；覆盖范围 :12-23、:31-44 的说明均由各自单条命令验证，不另立 AC 编号。逐条 `passed=true`，0 项无法确认，0 条 finding。
- 执行证据：`.collab/tasks/011/ci-results.json`（SHA-256 `18aec62be83c79d4917a31892e6720df30a5eb41cdaf8f888adfc6e0075f36d1`，`ranAt=2026-11-08T09:12:21.2656074+08:00`，`:5-7 passed=2 total=2 ok=true`）。两条 results（`:8-17` AC-029、`:18-27` AC-030）均 `passed=true`、`exitCode=0`、`lastLine`/`output` 为 `AC-029 OK` / `AC-030 OK`，与 `acceptance.md:10/:29` 期望（退出码 0、stdout 含且仅含一行 `AC-029 OK` / `AC-030 OK`）逐字相符。按【执行证据口径】直接引用，不自行重跑验收命令；评审环境缺 pwsh 7 或临时文件权限不作为判 needs_revision 的理由。
- CI 结果不与代码矛盾：`ranAt`（= 01:12:21Z）晚于 HEAD 提交（01:12:17Z）4 秒；reflog 末条即该提交且无后续提交；14 个交付文件工作树字节与 HEAD blob 逐字节相等（LF 归一化后 `MATCH=True`，`mismatch=0`）；只读复跑 `check-seams` / `check-unused` / `check-traceability` 均 `ok` 且退出 0。
- 独立复核不只依赖 CI：凡「执行类」以外的规格一致性，均以只读方式（读文件、算哈希、核对行号、只读解压 `.git` 对象、纯函数内存求值、只读运行不写文件的 `check-*` 脚本）独立验证；57 项内存行为断言 `total=57 bad=0`。

## 1. 核验范围与证据口径

- 规格以 `design.md` 与 `acceptance.md` 为准；沿用既有 `verdict` 字段（`verdict/sha/passed/total/evidence/findings/checks`）与 `acceptance.md` 的章节名 `AC-029` / `AC-030`，未新增字段、版本号或章节名。
- CI 契约：`ci-results.json` 由编排方用 PowerShell 7 产生，含每条命令的 `id/passed/exitCode/durationS/lastLine/output`，是执行类验收项的有效运行证据，直接引用；本轮未重跑 `acceptance.md:9/:28` 的验收命令。仅当 CI 结果缺失或与代码明显矛盾时才把该项标为无法确认——本轮未出现。
- 其余以只读方式独立验证：读文件、算哈希、核对行号、只读解压 `.git` 对象、对模块做内存求值（`memfs` + 伪时钟 + `drive`，纯内存、不写仓库文件）、只读运行不含写调用的 `check-*` 脚本。`scripts/run-tests.mjs:234-238` 会写产物，故未运行。
- `brief.md` / `design.md` 及任务文档 grep `验收报告|报告路径|acceptance.report|report.?path` 无命中，未指定验收报告路径，本轮结论无追加目标，未改动任何历史小节。

## 2. SHA 核验（只读解压 .git 对象，未用 git 子命令）

- 工作区 `.git` 文件:1：`gitdir: C:/git/dsh-CLIWorker/.git/worktrees/011`。
- `.git/worktrees/011/HEAD:1` = `ref: refs/heads/task/011`；`.git/refs/heads/task/011:1` = `4a61283de4ffde461bb5226e8f2c6bcbc9a3a359`。
- zlib 解压松散对象 `.git/objects/4a/61283de4ffde461bb5226e8f2c6bcbc9a3a359`，对解压字节重算 SHA-1 = `4a61283de4ffde461bb5226e8f2c6bcbc9a3a359`（`match=true`）。对象头 `commit 243`，`tree 7fad7fdbb0a2953537d21a0734df0b524b5c1341`，`parent 7260b28bc22a7c9f1f5f8cf8f7b1e02ce3fb4c06`，时间戳 `1794100337 +0800` = `2026-11-08T01:12:17Z`，消息 `fix(dev): repair after CI failure (task 011)`。
- `.git/worktrees/011/ORIG_HEAD` = `040d2e9037844e5e2f0421956c1020a8d8f2d36e`（基准）；reflog 末条 `7260b28b... -> 4a61283d...` 即 HEAD，无后续提交；`ci-results.json:4 ranAt` 比 HEAD 提交晚 4 秒，故本 SHA 即被验收代码。
- 全树比对（只读解压两棵 tree）：base 498 跟踪文件 → HEAD 517。`ADDED 19`（14 个 `design.md:4-15` / `brief.md:13-24` write_scope 交付文件 + 5 个 `.collab/tasks/011/` 编排文档 `acceptance.md` / `design.md` / `impl.md` / `run.json` / `state.json`），`MODIFIED 0`，`REMOVED 0`；`contracts/**`、`lib/**` 其余文件、`test/helpers/**` 零改动。
- 工作树 == HEAD（交付物）：14 个交付文件按 git blob 算法（工作树 CRLF 归一化为 LF 后 SHA-1）与 HEAD tree 逐字节比对全部 `MATCH=True`（`mismatch=0`），无被评审文件的未提交改动。写域外仅 `.collab/tasks/011/state.json` 与 `run.json` 相对 HEAD 有差异：逐行 diff 显示是编排方在 HEAD 提交（01:12:17Z）之后追加的 `implemented→reviewable` 状态迁移与 `ci passed=2 total=2 ok=true` 运行记录（时间戳 01:12:21Z），属编排状态维护、非被评审代码，按既有轮次口径不计入写域判定。

## 3. CI 结果与一致性

| 项 | `ci-results.json` 证据 | 与 `acceptance.md` 期望 |
|---|---|---|
| 顶层 | `:5-7` `passed=2 total=2 ok=true` | 2 个 AC 全部通过 |
| AC-029 | `:8-17` `passed=true`、`exitCode=0`、`durationS=2.42`、`lastLine='AC-029 OK'`、`output='AC-029 OK'` | `:10` 退出码 0、stdout 含且仅含一行 `AC-029 OK` |
| AC-030 | `:18-27` `passed=true`、`exitCode=0`、`durationS=0.89`、`lastLine='AC-030 OK'`、`output='AC-030 OK'` | `:29` 退出码 0、stdout 含且仅含一行 `AC-030 OK` |

`acceptance.md:9/:28` 的命令把各子命令输出收进 `Out-String` 变量、仅在全部条件成立时打印一行 `AC-0xx OK`，故 `output` 恰为该行是与命令写法一致的，不是「输出缺失」。只读复跑三个不写文件的检查脚本作为独立佐证：`node scripts/check-seams.mjs` → `check-seams: ok (files=30)`（退出 0）、`node scripts/check-unused.mjs` → `check-unused: ok (files=30)`（退出 0）、`node scripts/check-traceability.mjs` → `check-traceability: ok (covered=30 planned=44)`（退出 0），与 `impl.md:48-50` 自测记录及 `acceptance.md:9/:28` 命令内断言一致。

## 4. 独立只读核对

| 项 | 核对内容 | 结果 |
|---|---|---|
| 交付物齐全（`:14`、`:33`） | 9 + 5 个 `$need` 文件逐个 `test -f` 全 OK；`test/fixtures/store` 下 `*.jsonl` 计数 = 0 | 满足 |
| 接缝与静态检查（`:15`） | `lib` 递归 30 个 `.mjs/.js/.cjs`（`find ... \| wc -l` = 30，基线 26 + 4 新模块，与 `design.md:39` 一致）；`check-seams.mjs:201` / `check-unused.mjs:421` 只扫描 `lib`；四个模块只读 grep 无 `node:fs`/`Date.now`/`new Date`/`setTimeout`/`setInterval`/`setImmediate`/`node:timers` 命中 | 满足 |
| 整文件通过（`:16`、`:34`） | 顶层 `test(` 计数：`store.test.mjs` 9（:49,63,78,93,122,137,147,161,180）、`lock.test.mjs` 8（:44,66,83,132,163,181,213,240）、`store-concurrency.test.mjs` 2（:32,66）= 19；`redact.test.mjs` 10（:19,28,34,41,50,68,79,92,102,117）、`audit.test.mjs` 6（:28,52,65,78,113,136）= 16；slug 与 `design.md:206-264` 清单逐项一致，无 `describe(`、无 `test.skip` | 满足 |
| `--ac` 过滤（`:17`、`:35`） | `grep -rl '\[AC-029\]' --include='*.test.mjs' test` 恰 3 文件、`'\[AC-030\]'` 恰 2 文件、无文件同时含两者；`run-tests.mjs:243-253` 按 `source.includes` 过滤、`:314` 输出 `run-tests: filtered 3 files` / `filtered 2 files` | 满足 |
| 原子写（`:18`） | `lib/store.mjs:70-85`（serialize 先于 FS、同目录 tmp、rename、失败 `rmSync` 清理后原样抛错）、`:52-64` 与 `:6`（仅 win32 且 `EPERM/EACCES/EBUSY` 按 `[10,20,40,80,160]` 重试、5 次 sleep 后抛最后错误）；`store.test.mjs:49-145` 六个 `atomic-write-*` | 满足 |
| JSONL（`:19`） | `lib/store.mjs:88-93` 单次 `appendFileSync`；`:96-117` `readJsonl`（ENOENT→[]、`\r?\n` 切分、空行忽略、坏行带行号 `SyntaxError`、`skipInvalid` 丢弃）；`store.test.mjs:147-178` | 满足 |
| 文件系统表面（`:20`） | `contracts/context/context.v1.json` `fs_methods` 恰 9 个；`memfs.mjs:48-129` 恰实现这 9 个（`:60-64` `wx`、`:95` `mtimeMs`、`:33-42` 按方法注入失败）；`store.test.mjs:180-188` | 满足 |
| 锁（`:21`） | `lib/lock.mjs:191-219`（`start=clock.now`、wx 建锁、EEXIST 读状态、死锁/陈旧回收不 sleep、`:215` `codedError('E_STATE_LOCKED', 含路径与 wait 毫秒)`）、`:115-120` 陈旧严格 `>`、`:108-113` `heldSince` 优先 `parsed.at` 否则 `statSync().mtimeMs`、`:139-164` 墓碑改名与 token 核对、`:166-185` release 校验 token 幂等、`:222-229` `withLock` try/finally；`lib/output.mjs:13-19` 不覆盖 `retryable`，`contracts/registry.snapshot.json:110-116` `E_STATE_LOCKED` = exit 4 / 503 / `retryable:false` / `state_lock_timeout`，符合 `design.md:37` | 满足 |
| 多进程集成（`:22`） | `store-concurrency.test.mjs:32-64`（20×50、退出 0、1000 行、id 唯一、每 worker 50 行且 `i` 0..49）、`:66-86`（5×10 次 `withLock` 读+1+原子写、`n===50`、无 `.lock`/`.stale-*`/`.tmp` 残留、`os.tmpdir()` 现造现删）；`append-worker.mjs:7-13`、`counter-worker.mjs:9-26` 符合 `design.md:199-200` | 满足 |
| 脱敏规则（`:36`） | `lib/redact.mjs:4/6/7/8`（四规则正则）、`:11-19`（登记值去重/长度降序/忽略空串非字符串）、`:22-29`（顺序 登记值→sk-→Bearer→JWT）、`:31-55`（键也打码、`Error` 转 `{name,message,code?}` 无 stack、`'[Circular]'`、标量原样、入参不变）、`:63-77`（registry） | 满足 |
| 审计（`:37`-`:42`） | `lib/audit.mjs:7-13` 常量、`:15-17` `auditPath`、`:23-42`（`:25-33` 先校验后写、`:35-37` 字段顺序 `at/entry/action/result` 按需 `code/detail`、`:39` 整行 redact、`:40` appendJsonl）、`:44-46` `readAudit`；`AUDIT_ACTIONS` 恰 8 项；`redact.test.mjs:117-123` / `audit.test.mjs:136-142` seams；只读 grep 两模块无 `node:fs`/`Date.now`/`new Date`/`setTimeout` 命中 | 满足 |
| 仓库内无真密钥（`:43`） | 按 `acceptance.md:28` 正则 `sk-[A-Za-z0-9_-]{20,}\|eyJ...` 扫 `lib/{store,lock,audit,redact}.mjs` 与 `test/fixtures/store/*.mjs`，只读复算命中数 = 0 | 满足 |
| 追踪分片（`:44`） | `test/traceability/T-011.json:1-8` 键恰 `task/milestone/entries`，`task='T-011'`、AC-029/AC-030 均 `covered` 并指向各自测试文件，与 `design.md:266-277` 一致；`check-traceability: ok` 退出 0 | 满足 |

### 只读运行 / 内存求值复核（均不写仓库文件）

- 三个 `check-*` 脚本：`check-seams: ok (files=30)`、`check-unused: ok (files=30)`、`check-traceability: ok (covered=30 planned=44)`，退出码均 0。
- 以 `memfs` + 伪时钟 + `drive` 对四个模块做 57 项纯内存行为断言，`total=57 bad=0`：涵盖 redact（sk-ant-/左边界/Bearer 大小写/JWT/`config.example.json`/`1.2.3`/登记值长短重叠/嵌套键/Error/冻结入参/循环/registry）、store（pretty JSON 无 BOM 无残留、EIO/ENOSPC 保留字节并清理、win32 `[10,20]` 与持续 5 次重试、posix 不重试、undefined 抛 TypeError 且无写调用、单次 append、缺文件 `[]`/CRLF/坏行 line 2/skipInvalid）、lock（无锁、死锁、age==30000 等待 / age==30001 回收、`(5000,50)/(120,50)/(100,50)/(1,50)` → sleep 100/3/2/1 且 `E_STATE_LOCKED`、release token、withLock、空/非 JSON 锁）、audit（四字段顺序、非法入参不写文件、detail/Error 落盘脱敏、7 事件泄露 0 命中、8 动作）。
- 全树 diff 与工作树 blob 比对见第 2 节：`ADDED 19 / MODIFIED 0 / REMOVED 0`、`mismatch=0`。

## 5. 逐条核对（2/2）

- **AC-029**（`ci-results.json:8-17`，`acceptance.md:7-24`）：`exitCode=0`、`lastLine='AC-029 OK'`、`output='AC-029 OK'`，命中期望。命令一次性验证 9 个交付文件、`files=30` 的接缝/静态检查、19 个测试整文件通过、`filtered 3 files`，以及覆盖范围 :14-22 的交付物、原子写、JSONL、文件系统表面、锁、多进程集成；逐条由第 4 节行号、只读复跑与 57 项内存断言佐证，全部满足。通过。
- **AC-030**（`ci-results.json:18-27`，`acceptance.md:26-46`）：`exitCode=0`、`lastLine='AC-030 OK'`、`output='AC-030 OK'`，命中期望。命令一次性验证 5 个交付文件、16 个测试整文件通过、`filtered 2 files`、`check-traceability: ok`、`$leak=0`、`$task='T-011'`，以及覆盖范围 :33-44 的脱敏规则、审计行形状、动作覆盖、入参校验、落盘脱敏、泄露检查、接缝、追踪分片；逐条由第 4 节行号、只读复算与内存断言佐证，全部满足。通过。

## 6. Findings

无（`findings` 为空数组）。逐条核对与独立只读复核均未发现与 `design.md` / `acceptance.md` 不符之处；CI 结果存在且不与代码矛盾，无「无法确认」项，无 P0/P1/P2 问题。

## 7. 备注（非缺陷）

- `acceptance.md:48` 明确 `check-no-collab` / `check-contract-doc` / 全量 `run-tests` / `check-fast.ps1` 属仓库级门禁、不并入 AC 判定；其既有失败（`test/unit/gitignore.test.mjs:13,18` 的 `.collab` 字面量、`[AC-073]` / `[AC-013]` / `[AC-006]` 三个失败）按口径保持原样、不修复也不加重，不作为判 needs_revision 的理由。
- `acceptance.md:24` 的逐例 `--test-name-pattern` 命令属补充证据、不替代 `- 命令:`，本轮结论未以其作为判据。
- 实现相对 `design.md:149-150` 额外把 `EPERM/EACCES/EBUSY` 的读锁/改名错误按 `BUSY` / 继续循环处理（`lib/lock.mjs:13,87-95,122-124,143-146`），并让 `acquireLock` 句柄多带 `path/token` 字段（`:166-185`）。二者均不改变任一 AC 事实与测试行为（57 项内存复验、CI 2/2 通过），属非缺陷观察。
- `impl.md` 记载第 1 轮 CI 退出码 2 后按编排 note 整篇重写 `acceptance.md` 为 CI 可抽取形状；`ci-results.json` 已成功抽出 2 条命令并全部通过，属编排/规格文件维护，与既有轮次一致。
- 未修改 `brief.md`、`design.md`、`acceptance.md`、`impl.md`、`state.json`、`run.json` 及任何被评审代码与文档；未执行 git 命令；SHA、写域与 diff 等价核验均通过只读解压 `.git` 对象与读文件完成，未以 git 得出任何验收结论；除 `review.md` / `review-r1.md` / `verdict.json` / `verdict-r1.json` 外未在仓库内创建任何文件（核验期临时脚本写在系统临时目录并已删除）。沿用既有 verdict 字段与 `AC-029` / `AC-030` 章节名，未发明字段、版本号或章节名。
