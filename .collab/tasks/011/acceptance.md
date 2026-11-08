# Task 011 验收标准

规格见同目录 `design.md`。所有命令在仓库根（`C:\git\dsh-CLIWorker\.collab\worktrees\011`）用 `pwsh -NoProfile` 执行，只依赖 `node`（Node 20+）。测试输出统一用 `--test-reporter=tap`，通过判据是退出码 0 加上 TAP 汇总行。

注意：表格单元格里的 `\|` 是 Markdown 的管道符转义，实际执行的命令里写作 `|`（PowerShell 管道或正则的 `a|b` 备选）。

## 0. 基线（任务开工前，HEAD 040d2e9，Node v22.23.3）

| 命令 | 基线输出 |
|---|---|
| `node scripts/check-seams.mjs` | `check-seams: ok (files=26)`，退出码 0 |
| `node scripts/check-unused.mjs` | `check-unused: ok (files=26)`，退出码 0 |
| `node scripts/check-traceability.mjs` | `check-traceability: ok (covered=28 planned=46)`，退出码 0 |
| `node scripts/check-no-collab.mjs` | 退出码 1，恰好 2 行 `FAIL no_collab test/unit/gitignore.test.mjs:13` 与 `:18`（已存在、与本任务无关） |
| `node scripts/run-tests.mjs` | `run-tests: full 41 files`；3 个已存在的失败：`[AC-073] check-no-collab reports zero references in the repository`、`[AC-013] git check-ignore -v matches ...`、`[AC-006] failures are reported on ctx.stderr and never leave the process`；`ℹ pass 323`、`ℹ fail 3` |

下文的「不得新增失败」均相对这份基线判定：本任务不得修复、也不得加重这些已有失败。

## 1. 交付物存在

| # | 命令 | 期望 |
|---|---|---|
| 1.1 | `Get-ChildItem lib/store.mjs,lib/lock.mjs,lib/audit.mjs,lib/redact.mjs,test/unit/store.test.mjs,test/unit/lock.test.mjs,test/unit/redact.test.mjs,test/unit/audit.test.mjs,test/integration/store-concurrency.test.mjs,test/traceability/T-011.json \| Measure-Object \| Select-Object -ExpandProperty Count` | 输出 `10`，退出码 0（缺任何一个文件会报错且退出码非 0） |
| 1.2 | `Get-ChildItem test/fixtures/store -Name` | 输出至少包含 `memfs.mjs`、`drive.mjs`、`append-worker.mjs`、`counter-worker.mjs`，且不含任何 `.jsonl` 文件 |

## 2. 结构性检查

| # | 命令 | 期望 |
|---|---|---|
| 2.1 | `node scripts/check-seams.mjs` | 输出 `check-seams: ok (files=30)`，退出码 0（基线 26 + 4 个新 lib 文件）。`lock.mjs`、`audit.mjs`、`redact.mjs` 没有导入 `node:fs`，四个文件都没有无参 `Date.now` / `new Date`、全局定时器 |
| 2.2 | `node scripts/check-unused.mjs` | 输出 `check-unused: ok (files=30)`，退出码 0 |
| 2.3 | `node scripts/check-traceability.mjs` | 输出 `check-traceability: ok (covered=30 planned=44)`，退出码 0（AC-029、AC-030 由 planned 变为 covered） |
| 2.4 | `node scripts/check-no-collab.mjs` | 输出里只允许出现基线的 2 行 `FAIL no_collab test/unit/gitignore.test.mjs:13` 和 `:18`；不得出现涉及 `lib/store.mjs`、`lib/lock.mjs`、`lib/audit.mjs`、`lib/redact.mjs`、`test/unit/store.test.mjs`、`test/unit/lock.test.mjs`、`test/unit/redact.test.mjs`、`test/unit/audit.test.mjs`、`test/integration/store-concurrency.test.mjs`、`test/fixtures/store`、`test/traceability/T-011.json` 的 `FAIL` 行 |
| 2.5 | `node scripts/check-write-scope.mjs --base 040d2e9 --scope-from .collab/tasks/011/design.md --scope ".collab/tasks/011/**"` | 输出 `check-write-scope: ok`，退出码 0；变更和未跟踪文件都落在 design.md 的 write_scope 或任务目录内 |

## 3. AC-029：存储、原子写、追加、锁（unit + integration）

入口命令（过滤运行只选源码含 `[AC-029]` 的文件）：

| # | 命令 | 期望 |
|---|---|---|
| 3.0 | `node scripts/run-tests.mjs --ac AC-029` | 退出码 0；输出无 `FAIL` 行；末行以 `run-tests: filtered 3 files,` 开头（`store.test.mjs`、`lock.test.mjs`、`store-concurrency.test.mjs`） |

逐文件（整文件，所有测试必须通过且无跳过）：

| # | 命令 | 期望（TAP 汇总行） |
|---|---|---|
| 3.1 | `node --test --test-reporter=tap test/unit/store.test.mjs` | 退出码 0；`# tests 9`、`# pass 9`、`# fail 0`、`# skipped 0` |
| 3.2 | `node --test --test-reporter=tap test/unit/lock.test.mjs` | 退出码 0；`# tests 8`、`# pass 8`、`# fail 0`、`# skipped 0` |
| 3.3 | `node --test --test-reporter=tap test/integration/store-concurrency.test.mjs` | 退出码 0；`# tests 2`、`# pass 2`、`# fail 0`、`# skipped 0` |

逐条行为（每条命令只选一个测试，期望：退出码 0，`# tests 1`、`# pass 1`、`# fail 0`、`# skipped 0`。`# tests 0` 视为失败，说明没有这个测试）：

| # | 要证明的行为 | 命令 |
|---|---|---|
| 3.4 | 20 个进程各追加 50 行，1000 行全部可解析且 id 唯一，每个 worker 恰 50 行 | `node --test --test-reporter=tap --test-name-pattern="append-20x50" test/integration/store-concurrency.test.mjs` |
| 3.5 | 多进程在锁下读改写计数器，最终 `n === 50`，无残留 `.lock` / `.stale-*` / `.tmp` | `node --test --test-reporter=tap --test-name-pattern="lock-counter" test/integration/store-concurrency.test.mjs` |
| 3.6 | 改名前抛错时原文件字节不变，临时文件已清理，原始错误码保留 | `node --test --test-reporter=tap --test-name-pattern="atomic-write-rename-fail" test/unit/store.test.mjs` |
| 3.7 | 临时文件写入阶段失败时原文件字节不变 | `node --test --test-reporter=tap --test-name-pattern="atomic-write-write-fail" test/unit/store.test.mjs` |
| 3.8 | win32 上 `EPERM` 按 10、20 毫秒重试后成功；持续失败则恰好 5 次睡眠后拒绝且原文件不变 | `node --test --test-reporter=tap --test-name-pattern="atomic-write-eperm-retry" test/unit/store.test.mjs` |
| 3.9 | 非 win32 不重试 | `node --test --test-reporter=tap --test-name-pattern="atomic-write-posix-no-retry" test/unit/store.test.mjs` |
| 3.10 | `appendJsonl` 单次追加一整行，换行被转义 | `node --test --test-reporter=tap --test-name-pattern="jsonl-append-shape" test/unit/store.test.mjs` |
| 3.11 | 持有 pid 已死的锁被立即回收：0 次 sleep，伪时钟不前进，无需 `advance` | `node --test --test-reporter=tap --test-name-pattern="lock-dead-pid" test/unit/lock.test.mjs` |
| 3.12 | 活锁在伪时钟 `advance` 超过 `lock_stale_ms` 后被回收；恰等于 `lock_stale_ms` 时仍在等待 | `node --test --test-reporter=tap --test-name-pattern="lock-stale-advance" test/unit/lock.test.mjs` |
| 3.13 | 活锁且未陈旧：虚拟耗时达到 `lock_wait_ms` 后抛 `E_STATE_LOCKED`，`sleep` 调用次数等于 `ceil(lock_wait_ms/lock_poll_ms)`（覆盖 5000/50→100、120/50→3、100/50→2、1/50→1），原持有者的锁文件未被改动 | `node --test --test-reporter=tap --test-name-pattern="lock-timeout-retries" test/unit/lock.test.mjs` |
| 3.14 | `release` 校验 token，幂等；`withLock` 在 `fn` 抛错时也释放 | `node --test --test-reporter=tap --test-name-pattern="lock-release-token\|lock-with-lock" test/unit/lock.test.mjs` 期望 `# tests 2`、`# pass 2`、`# fail 0` |
| 3.15 | `lock.mjs` 源码不含 `node:fs`、`Date.now`、`setTimeout` 等字样 | `node --test --test-reporter=tap --test-name-pattern="lock-seams" test/unit/lock.test.mjs` |

不使用 sleep：

| # | 命令 | 期望 |
|---|---|---|
| 3.16 | `Select-String -Path test/unit/store.test.mjs,test/unit/lock.test.mjs,test/integration/store-concurrency.test.mjs -Pattern "setTimeout\|setInterval\|setImmediate\|timers/promises\|Atomics\.wait" \| Measure-Object \| Select-Object -ExpandProperty Count` | 输出 `0` |

## 4. AC-030：脱敏与审计日志（unit）

| # | 命令 | 期望 |
|---|---|---|
| 4.0 | `node scripts/run-tests.mjs --ac AC-030` | 退出码 0；无 `FAIL` 行；末行以 `run-tests: filtered 2 files,` 开头（`redact.test.mjs`、`audit.test.mjs`） |
| 4.1 | `node --test --test-reporter=tap test/unit/redact.test.mjs` | 退出码 0；`# tests 10`、`# pass 10`、`# fail 0`、`# skipped 0` |
| 4.2 | `node --test --test-reporter=tap test/unit/audit.test.mjs` | 退出码 0；`# tests 6`、`# pass 6`、`# fail 0`、`# skipped 0` |

逐条行为（每条：退出码 0，`# tests 1`、`# pass 1`、`# fail 0`、`# skipped 0`）：

| # | 要证明的行为 | 命令 |
|---|---|---|
| 4.3 | `sk-` 前缀打码，`task-description-long` 不误伤 | `node --test --test-reporter=tap --test-name-pattern="redact-sk" test/unit/redact.test.mjs` |
| 4.4 | Bearer 打码，保留 Bearer 字样 | `node --test --test-reporter=tap --test-name-pattern="redact-bearer" test/unit/redact.test.mjs` |
| 4.5 | 三段 base64url JWT 打码，`config.example.json` 与 `1.2.3` 不误伤 | `node --test --test-reporter=tap --test-name-pattern="redact-jwt" test/unit/redact.test.mjs` |
| 4.6 | 已登记密钥值全部出现位置打码，长短值重叠不残留 | `node --test --test-reporter=tap --test-name-pattern="redact-registered" test/unit/redact.test.mjs` |
| 4.7 | 嵌套对象与数组里的值和键打码 | `node --test --test-reporter=tap --test-name-pattern="redact-nested" test/unit/redact.test.mjs` |
| 4.8 | `error.message` 里的密钥被打码，结果不含 `stack` | `node --test --test-reporter=tap --test-name-pattern="redact-error-message" test/unit/redact.test.mjs` |
| 4.9 | 入参不被修改；循环引用不死循环 | `node --test --test-reporter=tap --test-name-pattern="redact-no-mutation\|redact-cycle" test/unit/redact.test.mjs` 期望 `# tests 2`、`# pass 2`、`# fail 0` |
| 4.10 | 每行含 `at`、`entry`（cli 或 http）、`action`、`result` | `node --test --test-reporter=tap --test-name-pattern="audit-fields" test/unit/audit.test.mjs` |
| 4.11 | select、lease、run、probe、allow、deny、level、secret_set 各写一行，共 8 行 | `node --test --test-reporter=tap --test-name-pattern="audit-actions" test/unit/audit.test.mjs` |
| 4.12 | 非法 entry / action / result 抛 `TypeError` 且不写文件 | `node --test --test-reporter=tap --test-name-pattern="audit-invalid" test/unit/audit.test.mjs` |
| 4.13 | 审计的 `detail`（含嵌套对象和 Error）落盘前打码 | `node --test --test-reporter=tap --test-name-pattern="audit-redacts" test/unit/audit.test.mjs` |
| 4.14 | 七类事件写入后，对 `audit.jsonl` 全文做泄露检查：已登记密钥命中数为 0，行数为 7 | `node --test --test-reporter=tap --test-name-pattern="audit-leak-scan" test/unit/audit.test.mjs` |
| 4.15 | `redact.mjs`、`audit.mjs` 无 `node:fs` / 时间原语 | `node --test --test-reporter=tap --test-name-pattern="redact-seams\|audit-seams" test/unit/redact.test.mjs test/unit/audit.test.mjs` 期望 `# tests 2`、`# pass 2`、`# fail 0` |

输出与仓库内不得出现密钥：

| # | 命令 | 期望 |
|---|---|---|
| 4.16 | `Select-String -Path lib/store.mjs,lib/lock.mjs,lib/audit.mjs,lib/redact.mjs,test/fixtures/store/*.mjs -Pattern "sk-[A-Za-z0-9_-]{20,}\|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}" \| Measure-Object \| Select-Object -ExpandProperty Count` | 输出 `0`（lib 与夹具中没有看起来像真实密钥的字面量；测试用的样本在测试文件里且明显是假值） |

## 5. 追踪分片

| # | 命令 | 期望 |
|---|---|---|
| 5.1 | `node scripts/check-traceability.mjs --json` | 退出码 0；JSON 中 `ok` 为 `true`；`acs` 里 `AC-029` 与 `AC-030` 的 `status` 都是 `covered` |
| 5.2 | `Get-Content test/traceability/T-011.json -Raw \| ConvertFrom-Json \| Select-Object -ExpandProperty task` | 输出 `T-011` |

## 6. 全量回归（不得新增失败）

| # | 命令 | 期望 |
|---|---|---|
| 6.1 | `node scripts/run-tests.mjs` | 末行 `run-tests: full 46 files,`（基线 41 + 5 个新测试文件）；失败的测试恰为第 0 节列出的那 3 个，`ℹ fail 3`；`ℹ pass` 大于 323；输出里没有 `FAIL discovery.` 开头的行 |
| 6.2 | `node scripts/check-contract-doc.mjs` | 输出 `check-contract-doc: ok`，退出码 0（本任务没有改 `contracts/**`） |

## 7. 完成前总检查

| # | 命令 | 期望 |
|---|---|---|
| 7.1 | `pwsh -NoProfile -File scripts/check-fast.ps1` | 本任务相关的步骤全部通过：`check-seams`、`check-unused`、`check-traceability`、`check-contract-doc` 不出现 `FAILED`。整体退出码允许因第 0 节的既有失败（`check-no-collab`、全量测试里的 3 个失败）而非 0，但失败项必须只限这些，不得有其他步骤出现 `check-fast: FAILED step` |

## 8. 可选：变异检查（评审者按需手动做，做完必须还原）

这些检查证明测试确实卡得住关键边界；任何一个改动后对应测试仍然通过，就说明该测试无效。

| # | 临时改动 | 应当失败的测试 |
|---|---|---|
| 8.1 | `lib/lock.mjs` 里陈旧判定的 `>` 改成 `>=` | `lock-stale-advance` |
| 8.2 | 重试循环多睡一次，或少睡一次 | `lock-timeout-retries` |
| 8.3 | 死锁判定去掉，只保留陈旧判定 | `lock-dead-pid` |
| 8.4 | `atomicWriteJson` 直接对目标 `writeFileSync`，不经临时文件改名 | `atomic-write-rename-fail` |
| 8.5 | `appendJsonl` 改成先读后写整个文件 | `append-20x50` |
| 8.6 | `lib/audit.mjs` 落盘前不调用 `redact` | `audit-redacts`、`audit-leak-scan` |
| 8.7 | `lib/redact.mjs` 去掉 `Error` 分支 | `redact-error-message` |
