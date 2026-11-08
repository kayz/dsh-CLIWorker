# Task 011 实施说明

## 1. 交付内容

### 运行时模块（`lib/`）

| 文件 | 内容 |
|---|---|
| `lib/redact.mjs` | `REDACTED`、`redactString`、`redact`、`createSecretRegistry`。按「已登记值 → `sk-` → Bearer → JWT」顺序打码；`Error` 转 `{ name, message, code? }`（无 `stack`）；循环引用输出 `'[Circular]'`；入参不变。纯函数，零依赖。 |
| `lib/store.mjs` | `ensureDir`、`readJson`、`atomicWriteJson`、`appendJsonl`、`readJsonl`、`RENAME_RETRY_DELAYS_MS`。原子写 = 同目录临时文件 + `renameSync`，失败清理临时文件并原样抛错；win32 上 `EPERM`/`EACCES`/`EBUSY` 按 10/20/40/80/160 ms 重试。追加走单次 `appendFileSync`。只经 `ctx.fs`/`ctx.clock`。 |
| `lib/lock.mjs` | `LOCK_DEFAULTS`、`lockFilePath`、`isPidAlive`、`acquireLock`、`withLock`。`wx` 建锁，死锁与陈旧锁回收（陈旧用严格 `>`），等锁循环只经 `ctx.clock.sleep`，超时抛 `E_STATE_LOCKED`；`release()` 校验 token 且幂等。 |
| `lib/audit.mjs` | `AUDIT_FILE`、`AUDIT_ENTRIES`、`AUDIT_ACTIONS`、`AUDIT_RESULTS`、`auditPath`、`writeAudit`、`readAudit`。落盘前整行经 `redact`，非法 `entry`/`action`/`result` 抛 `TypeError` 且不写文件。 |

### 测试与夹具

- `test/unit/store.test.mjs`（9 个测试）、`test/unit/lock.test.mjs`（8 个）、`test/unit/redact.test.mjs`（10 个）、`test/unit/audit.test.mjs`（6 个）、`test/integration/store-concurrency.test.mjs`（2 个）。
- `test/fixtures/store/`：`memfs.mjs`（契约里的 9 个方法、`wx`、`mtimeMs`、调用记录、按方法注入失败）、`drive.mjs`（推进伪时钟直到 promise 落定）、`append-worker.mjs`、`counter-worker.mjs`。未提交任何 `.jsonl`，数据都在 `os.tmpdir()` 下现造现删。
- `test/traceability/T-011.json`：AC-029、AC-030 均为 `covered`。

## 2. 关键实现选择与理由

1. **序列化先于 `ensureDir`**：`atomicWriteJson` / `appendJsonl` 先序列化，`undefined` 或不可序列化时抛 `TypeError`，此时没有触碰文件系统（对应 design 第 4 节「此时尚未触碰文件系统」，也让 `atomic-write-bad-value` 能断言「无任何写类调用」）。
2. **锁读取的瞬态错误**：Windows 上另一个进程刚用 `wx` 建好锁、尚未写完时，`readFileSync` 会抛 `EPERM`（共享冲突）。design 第 5 节只规定了 `ENOENT`（立即重试、不计重试），对这类瞬态错误未作规定；实现把 `EPERM`/`EACCES`/`EBUSY` 视为「有人持有」并按活锁路径处理（计入一次 poll、参与超时判定），既避免忙等也避免在 Windows 上把正常的并发误判为失败。回收时的 `renameSync` 命中同类错误同样按「别人先动了」继续循环。
3. **重试计数不含死锁/陈旧回收**：回收路径不调用 `sleep`、不推进虚拟时间，所以 `lock-dead-pid` 与陈旧回收用例的虚拟耗时都是 0。
4. **等待计数**：超时判定放在「建锁 + 读锁 + 回收判定」之后，最后一次 `sleep` 之后仍会再尝试一次建锁，因此活锁场景的 `sleep` 次数恰好是 `ceil(lock_wait_ms / lock_poll_ms)`（5000/50→100、120/50→3、100/50→2、1/50→1）。
5. **审计动作枚举**：白名单变更拆成 `allow`/`deny`，等级变更为 `level`，密钥设置为 `secret_set`，与 design 第 6 节一致；行对象只含 `at`/`entry`/`action`/`result` 与按需的 `code`/`detail`，不加 schema 字段。
6. **不使用 `node:fs`**：四个模块都只走 `ctx.fs`；`lock`/`audit`/`redact` 连 `node:fs` 都不导入，只有 `store`/`lock`/`audit` 导入 `node:path`。

## 3. 自测记录

在仓库根用 `pwsh -NoProfile` / `node` 逐条执行：

| 检查 | 结果 |
|---|---|
| `node scripts/check-seams.mjs` | `check-seams: ok (files=30)` |
| `node scripts/check-unused.mjs` | `check-unused: ok (files=30)` |
| `node scripts/check-traceability.mjs` | `check-traceability: ok (covered=30 planned=44)` |
| `node scripts/check-no-collab.mjs` | 仅基线的 2 行 `FAIL no_collab test/unit/gitignore.test.mjs:13/:18` |
| `node scripts/check-contract-doc.mjs` | `check-contract-doc: ok` |
| `node scripts/check-test-discovery.mjs` | `check-test-discovery: ok` |
| `node scripts/run-tests.mjs --ac AC-029` | `filtered 3 files`，`ℹ pass 19`、`ℹ fail 0`（连跑 4 次均通过） |
| `node scripts/run-tests.mjs --ac AC-030` | `filtered 2 files`，`ℹ pass 16`、`ℹ fail 0` |
| 单文件 TAP | `store` 9/9、`lock` 8/8、`store-concurrency` 2/2、`redact` 10/10、`audit` 6/6，均 `# skipped 0` |
| 逐条 `--test-name-pattern` | 单测试项均为 `# tests 1 / # pass 1`；`lock-release-token\|lock-with-lock`、`redact-no-mutation\|redact-cycle`、`redact-seams\|audit-seams` 均为 `# tests 2 / # pass 2` |
| `node scripts/run-tests.mjs` | `full 46 files`，`ℹ pass 358`、`ℹ fail 3`，失败恰为基线的 3 个，无 `FAIL discovery.` |
| 泄露扫描（AC 4.16 正则） | `lib/*.mjs` 与 `test/fixtures/store/*.mjs` 命中数 0 |
| 无定时器（AC 3.16 正则） | 三个测试文件命中数 0 |
| `pwsh -NoProfile -File scripts/check-fast.ps1` | 顺序执行到 `check-no-collab.mjs` 时按基线失败（仅那 2 行），此前各步均 ok，无其他 `check-fast: FAILED step` |

集成测试的 `lock-counter` 首次实现曾在 Windows 上偶发失败（进程读锁文件时撞上 `EPERM`），定位后按第 2.2 条修正，随后单独连跑 12 次、`--ac AC-029` 连跑 4 次均通过。

## 4. 未执行项

- `node scripts/check-write-scope.mjs --base 040d2e9 ...` 未在本次实施中运行（本任务禁止执行 git 命令）。本次只创建了 design.md 的 `write_scope` 内文件与本说明（`.collab/tasks/011/impl.md`），没有改动任何既有文件，预期该检查输出 `check-write-scope: ok`。
- 第 8 节的变异检查留给评审者按需执行，未改动任何文件做临时变更。
