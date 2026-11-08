# Task 011 实施说明（第 2 轮）

## 1. 本轮改了什么

第 1 轮交付的四个运行时模块、五个测试文件、夹具和追踪分片已经满足 design.md，本轮**只改一个文件**：

| 文件 | 改动 | 原因 |
|---|---|---|
| `.collab/tasks/011/acceptance.md` | 整文件重写为 CI 契约形状：每个 AC 一个 `## AC-0xx` 小节 + 一条 `- 命令:` + 一条 `- 期望:`，命令以绝对路径调用 `node`/PowerShell，成功时打印 `AC-029 OK` / `AC-030 OK` | 第 1 轮 CI 退出码 2、`passed=null total=null commands=[]`：旧的表格式验收（`\|` 表格单元格 + 逐例 `--test-name-pattern` 行）不被 `tools/ci-runner.ps1` 识别，抽取到 0 条命令。本轮按上游 note 与同仓 T-009 的既有范例改写 |

`lib/store.mjs`、`lib/lock.mjs`、`lib/audit.mjs`、`lib/redact.mjs`、五个测试文件、`test/fixtures/store/**`、`test/traceability/T-011.json` 与第 1 轮一致，未再改动；本轮重跑全部验收命令确认仍然通过。

## 2. 交付内容（沿用第 1 轮，已复核）

### 运行时模块（`lib/`）

| 文件 | 内容 |
|---|---|
| `lib/redact.mjs` | `REDACTED`、`redactString`、`redact`、`createSecretRegistry`。按「已登记值（长的先替换）→ `sk-` → Bearer（保留原写法）→ 三段 base64url JWT」顺序打码；`Error` 转 `{ name, message, code? }`（无 `stack`）；循环引用输出 `'[Circular]'`；入参不变。纯函数，零依赖。 |
| `lib/store.mjs` | `ensureDir`、`readJson`、`atomicWriteJson`、`appendJsonl`、`readJsonl`、`RENAME_RETRY_DELAYS_MS`。原子写 = 同目录临时文件 + `renameSync`，失败清理临时文件并原样抛错；win32 上 `EPERM`/`EACCES`/`EBUSY` 按 10/20/40/80/160 ms 重试；追加走单次 `appendFileSync`；只经 `ctx.fs`/`ctx.clock`。 |
| `lib/lock.mjs` | `LOCK_DEFAULTS`、`lockFilePath`、`isPidAlive`、`acquireLock`、`withLock`。`wx` 建锁，死锁与陈旧锁回收（陈旧用严格 `>`）不耗虚拟时间，等锁循环只经 `ctx.clock.sleep`，超时抛 `E_STATE_LOCKED`；`release()` 校验 token 且幂等。 |
| `lib/audit.mjs` | `AUDIT_FILE`、`AUDIT_ENTRIES`、`AUDIT_ACTIONS`、`AUDIT_RESULTS`、`auditPath`、`writeAudit`、`readAudit`。行字段固定为 `at`/`entry`/`action`/`result`（按需 `code`/`detail`），落盘前整行经 `redact`，非法 `entry`/`action`/`result` 抛 `TypeError` 且不写文件。 |

### 测试与夹具

- `test/unit/store.test.mjs`（9）、`test/unit/lock.test.mjs`（8）、`test/unit/redact.test.mjs`（10）、`test/unit/audit.test.mjs`（6）、`test/integration/store-concurrency.test.mjs`（2），全部顶层 `test(...)`，标题以纯字符串 `'[AC-029] <slug>: ...'` / `'[AC-030] <slug>: ...'` 开头。
- `test/fixtures/store/`：`memfs.mjs`（契约 9 个方法、`wx`、`mtimeMs`、调用记录、按方法注入失败）、`drive.mjs`（推进伪时钟直到 promise 落定，超限抛错）、`append-worker.mjs`、`counter-worker.mjs`。不提交任何 `.jsonl`。
- `test/traceability/T-011.json`：AC-029、AC-030 均 `covered`。

## 3. 新验收文件的写法

- 小节标题严格是 `## AC-029 ...` / `## AC-030 ...`，没有以其他 AC id 开头的标题，也没有依赖围栏代码块。
- 每条命令是**一行** PowerShell：定义 `$r` 为 worktree 绝对路径，一次性文件存在性检查 + `check-seams` + `check-unused`（AC-029）/ `check-traceability` + 泄露正则（AC-030）+ 三个（两个）测试文件的 TAP 运行 + `run-tests.mjs --ac AC-xxx` 过滤运行，全部子命令输出被 `Out-String` 收进变量，stdout 只剩 `AC-029 OK` / `AC-030 OK`（失败时打印 `AC-0xx FAILED ...` 并 `exit 1`）。
- 只断言 `check-seams`/`check-unused` 的 `files=30`、TAP 的 `# pass 19` / `# tests 16` / `# fail 0` / `# skipped 0`、`run-tests: filtered 3|2 files`、`check-traceability: ok`、泄露命中数 0，不新造字段或版本号。
- 命令全部在 `Set-Location $env:TEMP` 下执行验证过，因此不依赖当前工作目录；路径前缀与 `test/traceability` 的读取都用绝对路径。

## 4. 自测记录（本轮在仓库根重跑）

| 检查 | 结果 |
|---|---|
| 从 `$env:TEMP` 执行验收文件里的 AC-029 命令（逐字复制） | `AC-029 OK`，退出码 0 |
| 从 `$env:TEMP` 执行验收文件里的 AC-030 命令（逐字复制） | `AC-030 OK`，退出码 0 |
| 验收文件结构解析（`^- 命令: \`...\`$`） | 命中 2 条命令、2 条 `- 期望:`、2 个 `## AC-0xx` 标题 |
| `node scripts/run-tests.mjs --ac AC-029` | `filtered 3 files`，`pass 19`、`fail 0` |
| `node scripts/run-tests.mjs --ac AC-030` | `filtered 2 files`，`pass 16`、`fail 0` |
| 三个 AC-029 测试文件整文件 TAP | `# tests 19`、`# pass 19`、`# fail 0`、`# skipped 0` |
| 两个 AC-030 测试文件整文件 TAP | `# tests 16`、`# pass 16`、`# fail 0`、`# skipped 0` |
| `node scripts/check-seams.mjs` | `check-seams: ok (files=30)` |
| `node scripts/check-unused.mjs` | `check-unused: ok (files=30)` |
| `node scripts/check-traceability.mjs` | `check-traceability: ok (covered=30 planned=44)` |
| `node scripts/check-contract-doc.mjs` | `check-contract-doc: ok` |
| `node scripts/check-no-collab.mjs` | 仍只有基线的 2 行 `FAIL no_collab test/unit/gitignore.test.mjs:13/:18`，无新增行 |
| `node scripts/check-write-scope.mjs --base 040d2e9 --scope-from .collab/tasks/011/design.md --scope ".collab/tasks/011/**"` | `check-write-scope: ok` |
| 泄露正则（`sk-<20+>`、三段 base64url）扫 `lib/*.mjs` 与 `test/fixtures/store/*.mjs` | 命中 0 |
| 定时器正则（`setTimeout|setInterval|setImmediate|timers/promises|Atomics.wait`）扫三个 AC-029 测试文件 | 命中 0 |
| `node scripts/run-tests.mjs` | `full 46 files`、`pass 358`、`fail 3`，失败恰为基线的 `[AC-073]`、`[AC-013]`、`[AC-006]`，无 `FAIL discovery.` |

改动范围：只写了 `.collab/tasks/011/acceptance.md` 与 `.collab/tasks/011/impl.md`，加上第 1 轮已交付的 `write_scope` 内文件；没有直接执行任何 git 命令，`check-write-scope` 是仓库脚本、由它自行读取基线与工作区状态。

## 5. 未做与边界

- 未接线到 `lib/commands/**`：design 第 6 节明确「在 select、lease、run、probe、allow/deny、level、secret set 的命令里调用」不在本任务范围内。
- 未改动 `lib/config.mjs` 里已有的 `readUsage`/`appendUsage`/`ensureDir`，也未迁移任何既有调用方。
- 未改 `contracts/**`、`brief.md`、`design.md`，未动 `state.json`/`run.json`/日志。
- 第 8 节的可选变异检查留给评审者按需执行；本轮没有为验证而临时改动实现代码。
