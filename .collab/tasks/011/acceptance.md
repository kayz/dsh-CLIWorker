# Task 011 验收标准（AC-029 / AC-030）

规格见同目录 `design.md`。AC 属主与层级以 `contracts/spec/ac-index.json` 为准：AC-029（levels: integration, unit）与 AC-030（levels: unit）均属 T-011、里程碑 M2，baseline 为 darwin / linux / win32。

本文件按 CI 契约（`tools/ci-runner.ps1`）书写：每个 AC 一个以 AC id 开头的二级小节，`- 命令:` 是一条单行命令，`- 期望:` 是判定条件。命令可能在临时目录下执行，因此全部使用绝对路径，只依赖 `node`（Node 20+）与 PowerShell。通过判据是退出码 0 且 stdout 里出现该 AC 的 `AC-0xx OK`。

## AC-029 状态存储、原子写、JSONL 追加与文件锁（unit + integration）

- 命令: `$r='C:/git/dsh-CLIWorker/.collab/worktrees/011'; $need=@('lib/store.mjs','lib/lock.mjs','test/unit/store.test.mjs','test/unit/lock.test.mjs','test/integration/store-concurrency.test.mjs','test/fixtures/store/memfs.mjs','test/fixtures/store/drive.mjs','test/fixtures/store/append-worker.mjs','test/fixtures/store/counter-worker.mjs'); $miss=@($need | Where-Object { -not (Test-Path ($r + '/' + $_)) }).Count; $junk=@(Get-ChildItem "$r/test/fixtures/store" -Filter *.jsonl -ErrorAction SilentlyContinue).Count; $s=(node "$r/scripts/check-seams.mjs" 2>&1 | Out-String); $a=$LASTEXITCODE; $u=(node "$r/scripts/check-unused.mjs" 2>&1 | Out-String); $b=$LASTEXITCODE; $t=(node --test --test-reporter=tap "$r/test/unit/store.test.mjs" "$r/test/unit/lock.test.mjs" "$r/test/integration/store-concurrency.test.mjs" 2>&1 | Out-String); $c=$LASTEXITCODE; $f=(node "$r/scripts/run-tests.mjs" --ac AC-029 2>&1 | Out-String); $d=$LASTEXITCODE; if ($miss -eq 0 -and $junk -eq 0 -and $a -eq 0 -and $b -eq 0 -and $c -eq 0 -and $d -eq 0 -and $s -match 'check-seams: ok \(files=30\)' -and $u -match 'check-unused: ok \(files=30\)' -and $t -match '# pass 19' -and $t -match '# fail 0' -and $t -match '# skipped 0' -and $f -match 'run-tests: filtered 3 files') { 'AC-029 OK' } else { "AC-029 FAILED missing=$miss jsonl=$junk seams=$a unused=$b tests=$c ac=$d"; exit 1 }`
- 期望: 退出码 0，stdout 含且仅含一行 `AC-029 OK`。任一环节失败时打印 `AC-029 FAILED missing=<n> jsonl=<n> seams=<n> unused=<n> tests=<n> ac=<n>` 并以非 0 退出。

覆盖范围（逐条对应本 AC 的可验收事实，均由上面那一条命令验证）：

- **交付物齐全**：`lib/store.mjs`、`lib/lock.mjs`、`test/unit/store.test.mjs`、`test/unit/lock.test.mjs`、`test/integration/store-concurrency.test.mjs`、`test/fixtures/store/{memfs,drive,append-worker,counter-worker}.mjs` 全部存在（`$miss -eq 0`）；夹具目录不含任何 `.jsonl`（`$junk -eq 0`，`.gitignore` 会忽略该后缀，数据一律在 `os.tmpdir()` 下现造现删）。
- **接缝与静态检查**：`check-seams: ok (files=30)`（基线 26 + 4 个新 lib 文件），说明 `lib/lock.mjs` 没有导入 `node:fs`，四个新模块都没有无参 `Date.now` / `new Date` 或全局定时器；`check-unused: ok (files=30)`，没有未使用的导入或未导出的死代码。
- **整文件通过**：三个测试文件合计 `# tests 19`、`# pass 19`、`# fail 0`、`# skipped 0`——`store.test.mjs` 9 个、`lock.test.mjs` 8 个、`store-concurrency.test.mjs` 2 个，数量与 design 第 8.2 节的清单一致，没有测试被跳过或漏跑。
- **`--ac` 过滤**：`run-tests: filtered 3 files`，说明 `[AC-029]` 只出现在这三个测试文件里。
- **原子写**（`atomic-write-*`）：写入后内容严格为 `JSON.stringify(value, null, 2) + '\n'`、无 BOM、无残留 `.tmp`；`renameSync` 注入 `EIO` 或临时文件写入注入 `ENOSPC` 时拒绝并保留目标文件的原有字节、清理临时文件、原始错误码不变；win32 上 `EPERM` 依次按 10/20/40/80/160 毫秒重试（前两次失败第三次成功时睡眠 2 次、虚拟时间推进 30 毫秒；持续失败恰好 5 次睡眠后拒绝）；非 win32 不重试、不睡眠；`undefined` 在触碰文件系统之前抛 `TypeError`。
- **JSONL**（`jsonl-append-shape`、`jsonl-read`）：追加恰好一次 `appendFileSync`，一行 JSON 加一个 `\n`，值内的换行被转义；缺文件读成 `[]`，CRLF 与空行被忽略，坏行默认抛带行号的 `SyntaxError`，`skipInvalid:true` 时丢弃坏行。
- **文件系统表面**（`store-fs-surface`）：所有场景记录到的方法名都落在 `contracts/context/context.v1.json` 的 `fs_methods` 内（9 个方法），没有绕开 `ctx.fs`。
- **锁**（`lock-*`，全部走 `test/fixtures/store/memfs.mjs` 与伪时钟，不使用任何真实定时器）：无锁时立即获得且锁文件含数值 `pid`、数值 `at`（等于伪时钟 `now`）、字符串 `token`；持有者 pid 已死的锁立即回收（0 次 `sleep`、虚拟时间不前进）；活锁在虚拟时间严格超过 `lock_stale_ms` 后回收，恰好相等时仍在等待；活锁且未陈旧时虚拟耗时达到 `lock_wait_ms` 后抛 `E_STATE_LOCKED`（registry 里的 exit 4），`sleep` 次数恰为 `ceil(lock_wait_ms / lock_poll_ms)`（5000/50→100、120/50→3、100/50→2、1/50→1），原持有者的锁文件内容未变；`release()` 校验 token、幂等，`withLock` 在 `fn` 抛错时也释放；空或非 JSON 的锁文件用 `mtimeMs` 判断陈旧，新鲜时按活锁等待；`lock.mjs` 源码不含 `node:fs`、`Date.now`、`setTimeout`、`setInterval`、`setImmediate`、`node:timers`。
- **多进程集成**（真实文件系统与真实子进程）：`append-20x50` 同时启动 20 个追加进程各写 50 行，全部退出码 0，文件恰好 1000 行、每行可 `JSON.parse`、`id` 唯一、每个 worker 恰 50 行且 `i` 按 0..49 递增；`lock-counter` 五个进程在锁下各做 10 次「读 → +1 → 原子写」，最终 `n === 50`，目录里不残留 `.lock`、`.stale-*`、`.tmp`。

评审者可对单个用例做更细的核对，例如 `node --test --test-reporter=tap --test-name-pattern="atomic-write-rename-fail" "<repo>/test/unit/store.test.mjs"`；slug 与 design 第 8.2 节一致，每个 `--test-name-pattern` 只命中一个用例时应当 `# tests 1`、`# pass 1`。这类逐例命令是补充证据，不替代上面的 `- 命令:`。

## AC-030 脱敏与审计日志（unit）

- 命令: `$r='C:/git/dsh-CLIWorker/.collab/worktrees/011'; $need=@('lib/audit.mjs','lib/redact.mjs','test/unit/redact.test.mjs','test/unit/audit.test.mjs','test/traceability/T-011.json'); $miss=@($need | Where-Object { -not (Test-Path ($r + '/' + $_)) }).Count; $g=(node --test --test-reporter=tap "$r/test/unit/redact.test.mjs" "$r/test/unit/audit.test.mjs" 2>&1 | Out-String); $a=$LASTEXITCODE; $h=(node "$r/scripts/run-tests.mjs" --ac AC-030 2>&1 | Out-String); $b=$LASTEXITCODE; $j=(node "$r/scripts/check-traceability.mjs" 2>&1 | Out-String); $c=$LASTEXITCODE; $leak=(Select-String -Path "$r/lib/store.mjs","$r/lib/lock.mjs","$r/lib/audit.mjs","$r/lib/redact.mjs","$r/test/fixtures/store/*.mjs" -Pattern 'sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' | Measure-Object).Count; $task=(Get-Content "$r/test/traceability/T-011.json" -Raw | ConvertFrom-Json).task; if ($miss -eq 0 -and $a -eq 0 -and $b -eq 0 -and $c -eq 0 -and $g -match '# tests 16' -and $g -match '# pass 16' -and $g -match '# skipped 0' -and $h -match 'run-tests: filtered 2 files' -and $j -match 'check-traceability: ok' -and $leak -eq 0 -and $task -eq 'T-011') { 'AC-030 OK' } else { "AC-030 FAILED missing=$miss tests=$a ac=$b trace=$c leak=$leak task=$task"; exit 1 }`
- 期望: 退出码 0，stdout 含且仅含一行 `AC-030 OK`。任一环节失败时打印 `AC-030 FAILED missing=<n> tests=<n> ac=<n> trace=<n> leak=<n> task=<task>` 并以非 0 退出。

覆盖范围（逐条对应本 AC 的可验收事实，均由上面那一条命令验证）：

- **交付物齐全**：`lib/redact.mjs`、`lib/audit.mjs`、`test/unit/redact.test.mjs`、`test/unit/audit.test.mjs`、`test/traceability/T-011.json` 全部存在（`$miss -eq 0`）。
- **整文件通过**：`redact.test.mjs` 与 `audit.test.mjs` 合计 `# tests 16`、`# pass 16`、`# skipped 0`——10 个脱敏用例、6 个审计用例，与 design 第 8.2 节的清单一致。
- **`--ac` 过滤**：`run-tests: filtered 2 files`，说明 `[AC-030]` 只出现在这两个测试文件里。
- **脱敏规则**（`redact-*`）：`sk-` 前缀（含 `sk-ant-` 形态）整段打码而 `task-description-long` 之类普通词不受影响；`Bearer <credential>` 变为「原样的 Bearer 字样 + 空格 + `[REDACTED]`」，小写 `bearer` 同样处理且保留原写法；三段 base64url 的 JWT（`eyJ` 开头）整段打码而 `config.example.json`、`1.2.3` 不受影响；已登记的密钥值在任意位置、多次出现时全部打码，长短值重叠时不残留，空串与非字符串登记被忽略；嵌套对象与数组里的值**和键**都打码，数字、布尔、null 原样；`Error` 转成 `{ name, message }`（有 `code` 时带上），`message` 里的密钥被打掉且结果不含 `stack`；入参深度冻结后调用不抛错且原对象不变；自引用对象输出 `'[Circular]'` 而不是死循环；`createSecretRegistry().add(x)` 之后 `.redact(...)` 与 `redact(..., { secrets: [x] })` 结果深相等且 `list()` 去重。
- **审计行形状**（`audit-fields`）：每行含 `at`（等于 `ctx.clock.nowIso()`）、`entry`（`cli` / `http` 各可写）、`action`、`result`，字段顺序固定，不额外加 schema 字段。
- **审计动作覆盖**（`audit-actions`）：`AUDIT_ACTIONS` 的 8 个动作 select、lease、run、probe、allow、deny、level、secret_set 各写一行，文件恰好 8 行，`action` 集合与枚举相等——覆盖需求里的「select、lease、run、probe、白名单与等级变更、密钥设置」。
- **入参校验**（`audit-invalid`）：非法 `entry`、`action`、`result` 各抛 `TypeError`，且文件未被创建或未增加行（校验发生在触碰文件系统之前）。
- **落盘前脱敏**（`audit-redacts`）：`detail` 里的 `sk-`、`Bearer`、JWT 样本、已登记密钥（含嵌套对象内，以及 `new Error('boom ' + secret)` 的 `message`）在写入磁盘前全部打码，落盘的行里没有任何明文。
- **泄露检查**（`audit-leak-scan`）：以 select、lease、run、probe、allow、level、secret_set 七类事件各写一行（各自 `detail` 带一个不同的已登记密钥），把 `audit.jsonl` 全文读成字符串，对每个已登记密钥做子串检查命中数为 0，同时断言文件非空且行数为 7。T-012 才交付共享 leak-scan harness，本 AC 不依赖它。
- **接缝**（`redact-seams`、`audit-seams`）：`lib/redact.mjs` 与 `lib/audit.mjs` 的源码不含 `node:fs`、`Date.now`、`new Date`、`setTimeout` 等字样，时间只经 `ctx.clock`。
- **仓库内无真密钥**：`lib/{store,lock,audit,redact}.mjs` 与 `test/fixtures/store/*.mjs` 里 `sk-<20+ 字符>` 与三段 base64url JWT 的匹配数为 0（`$leak -eq 0`）。
- **追踪分片**：`check-traceability: ok`，`test/traceability/T-011.json` 的 `task` 为 `T-011`，其中 AC-029 与 AC-030 均登记为 `covered` 并指向各自的测试文件。

评审者可对单个用例做更细的核对，例如 `node --test --test-reporter=tap --test-name-pattern="audit-leak-scan" "<repo>/test/unit/audit.test.mjs"`；slug 与 design 第 8.2 节一致。这类逐例命令是补充证据，不替代上面的 `- 命令:`。

说明：`check-no-collab`、`check-contract-doc`、全量 `run-tests`、`check-fast.ps1` 属于仓库级门禁而非某个 AC，本文件不把它们并入 AC 判定。本任务开工前的既有失败保持原样、不修复也不加重：`check-no-collab` 的 2 行 `FAIL no_collab test/unit/gitignore.test.mjs:13` 与 `:18`，以及全量运行里既有的 3 个失败（`[AC-073]`、`[AC-013]`、`[AC-006]`）。本任务新增后全量应为 `run-tests: full 46 files`、`pass 358`、`fail 3`。
