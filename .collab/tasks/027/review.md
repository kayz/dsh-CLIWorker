# Task 027 评审

- 评审基准：分支 task/027，HEAD `7178e85597797c237dd1c974517d6e124f627d5e`（SHA 从 `.git/refs/heads/task/027` 读取；按规定未执行 git 命令）。
- 结论：**pass**，2/2 条 AC 通过。
- 执行证据：`ci-results.json`（ranAt 2026-11-09T03:50:12+08:00）中 AC-065、AC-066 均为 `passed: true, exitCode: 0`，`ok: true`，`passed 2 / total 2`。AC-066 的 TAP 输出为 `# tests 2 / # pass 2 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`。

## 逐条核对

### AC-065 安装产物可用且不含冻结目录 —— 通过
- 执行类项：`ci-results.json` AC-065 `exitCode 0`，末行 `AC-065 OK`。
- 独立核对 `scripts/e2e-install.mjs`：
  - 第 10-11 行在 `os.tmpdir()` 下 `mkdtemp`，随即打印 `workdir: <路径>`。
  - 第 16-17 行使用临时 HOME、USERPROFILE、CLIWORKER_HOME 和 npm_config_cache，并删除 CLIWORKER_CONFIG 与 CLIWORKER_TEST_CLOCK_FILE。
  - 第 18、24 行先用 `process.execPath` 加 npm-cli.js 调 npm，找不到时退回 `shell:true`。
  - 第 25 行执行 `npm pack --pack-destination <work>/pack --json --ignore-scripts`，tgz 不落在仓库根。
  - 第 28 行执行 `npm install --offline --ignore-scripts`。
  - 第 26-27、30 行同时检查 pack 文件列表和安装目录，不含 `contracts/golden`、`contracts/spec`、点+collab（用 `['.','coll','ab'].join('')` 拼接构造）、`test`、`scripts`。
  - 第 31-34 行检查 `.bin` shim 存在，并真实执行 `cliworker --version`，其 version 等于从 package.json 读取的值。
  - 第 36-37 行用 `cliworker doctor --config` 断言 `status === 'ok'`。
  - 第 38-40 行在安装目录内 `import('dsh-cliworker')`，用内联宿主 stub 调用 `apply`，断言 `getRegistration().status === 'ok'` 且 `errors` 为空。
  - 第 42 行 `finally` 递归删除 workdir，再输出 `cleanup: ok`。
- `test/e2e/install.test.mjs:3`：标题含 `[AC-065]`，超时 120 s，调用 `runInstall()`，失败即抛错。
- `lib/commands/state/version.mjs:3`：通过 `export const route = { cmd:'--version', sub:null, streamed:true }` 自注册，免配置，输出 `{ok,version}`。`lib/cli.mjs:79` 的 streamed 跳过 loadConfig 机制与设计一致，cli 未被改动。
- write_scope 与冻结文件检查：已有的 `ci-results.json` 通过。独立检查改动文件，均落在 `lib/migrate.mjs`、`lib/commands/state/*`、`scripts/e2e-install.mjs`、三个测试文件、`T-027.json` 与任务目录内，未见越界。无法确认的部分：评审环境不允许 git，故没有自行重算 merge-base diff。

### AC-066 升级备份、迁移、恢复与重启恢复 —— 通过
- 执行类项：`ci-results.json` AC-066 `exitCode 0`，末行 `AC-066 OK`，TAP 两个测试（upgrade、restart-recovery）全绿。
- 独立核对 `lib/migrate.mjs`：
  - 备份：第 70-92 行写入 `.stage-<rand>` 并回读校验 sha256，最后一次原子 rename。命名为 `backup-<ver>-<ts>`，同名追加 `-N`，目录内含 MANIFEST.json 与 data/。第 13 行的排除集合含 backups、secrets、`*.lock`、`*.tmp`、`.health-*`、`.state-op.json`、`.stage-*`。复制按 Buffer 字节读写。
  - 持锁：第 109-111 行所有入口走 `withLock`。
  - 迁移：第 129-155 行实现幂等（版本相同返回 `migrated:false, backup:null`）、全新 state 不备份、state 比程序新则 `E_REQUEST_INVALID`。迁移前自动备份，写 `.state-op.json`，在 stage 副本上跑 steps，VERSION 最后落位（`versionLast`），失败则按标记回滚。
  - 恢复：第 113-127 行先 `manifest()` 校验备份内每个文件的大小与 sha256，失败为 `E_INTERNAL` 且 live 不变。随后做安全备份、写标记、原子落位、回读校验，失败则回滚。
  - 名字校验：第 52 行以正则拒绝路径分隔符、`..` 和绝对路径，均为 `E_REQUEST_INVALID`。
  - 中断恢复：第 99-108 行的 `recoverLocked` 在 backup、restore、migrate 入口运行，并以 `recovered` 报告。
  - 缝隙约束：全文只用 `ctx.fs`、`ctx.clock`、`ctx.random`、`ctx.platform`，没有直接 fs、Date、setTimeout。`ctx.platform` 与 `ctx.random` 已在 `lib/context.mjs:84,87` 提供。win32 的 EPERM/EACCES/EBUSY 重试复用 `RENAME_RETRY_DELAYS_MS`（第 39-45 行）。
  - 错误码只用 `E_REQUEST_INVALID`、`E_CONFIG`、`E_INTERNAL`，没有新增。
- 命令层：`backup.mjs`、`restore.mjs`、`migrate.mjs` 各自带 `route = { cmd:'state', sub }`，输出只含名字、计数、版本字符串。
- `test/e2e/upgrade.test.mjs`：标题含 `[AC-066]`，版本取自 package.json，旧版本固定为 `0.0.1`，由 `assert` 保证它更小。覆盖以下各项：
  - 真实 CLI 迁移，包括备份名正则、data/ 字节一致、secrets 不入备份、VERSION 迁移、二次迁移幂等。
  - 破坏 live 后 restore，逐字节一致，stray 被移除，secrets 不变。
  - `../x`、`..\x`、不存在的名字、绝对路径均返回 `E_REQUEST_INVALID`。
  - 迁移步骤抛错后回滚、提交阶段注入 rename 失败后回滚（全部文件字节校验）。
  - 遗留 `.state-op.json` 在下次命令时回滚并返回 `recovered`。
  - 备份被篡改时 restore 返回 `E_INTERNAL` 且 VERSION 不变。
  - 令牌哨兵泄露扫描。
- `test/integration/restart-recovery.test.mjs`：子进程持锁并循环写 leases、追加 usage，输出 `ack`。父进程用不带信号名的 `child.kill()` 终止它，之后只断言状态内容。重启进程中，未过期租约及其 pools 与预置一致，`effectiveReservations` 为 `[['p',0.5]]`，`commitSelection` 后只剩未过期租约（过期租约被释放）。ack 过的 usage 行顺序完整，probes.json 字节相同且能被 `readProbeModels` 读取。陈旧锁在远小于 `lock_wait_ms` 内被回收，释放后锁文件消失，`doctor` 退出 0，遗留的 `*.tmp` 不进入 `state backup`。
- `test/traceability/T-027.json`：AC-065、AC-066 均为 covered，对应测试标题含 `[AC-065]`、`[AC-066]`，与设计 §4.6 一致。
- 回归门禁（unit、check-acceptance、check-fast）：以 ci-results 的 AC-066 `passed: true` 为准。impl.md 记录的 check-fast 失败发生在实现者受限环境的 `check-pack` 的 npm 调用处，属于环境问题，未见代码层面的矛盾。

## 备注（不阻塞，P2 级观察）
1. `scripts/e2e-install.mjs:42`：`cleanup: ok` 在失败路径也会输出；失败仍以非零退出并向 stderr 报告具体项，因此不影响验收判定。
2. `test/e2e/upgrade.test.mjs:36-37`：步骤抛错的回滚用例只断言 VERSION，没有逐文件比对字节；提交阶段 rename 失败的用例（第 39-41 行）已做全文件字节比对，回滚路径本身有覆盖。
3. `restart-recovery` 中"过期租约被释放"是通过 `commitSelection` 的返回值断言，没有再读取 `leases.json`；设计 §4.5 对这一点的措辞偏强，但行为等价。
4. `ci-results.json` 只保留了每条 AC 的汇总结果和一段输出，没有逐命令的输出。我对 `passed: true` 的信任建立在实现与规格逐项一致的静态核对之上。

## 总结
没有 P0、P1 级问题，也没有需要打回的 finding。
