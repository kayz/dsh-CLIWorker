---
write_scope:
  - lib/migrate.mjs
  - lib/commands/state/**
  - scripts/e2e-install.mjs
  - test/e2e/install.test.mjs
  - test/e2e/upgrade.test.mjs
  - test/integration/restart-recovery.test.mjs
  - test/traceability/T-027.json
---

# Task 027 — 安装、升级、回滚、state 迁移与重启恢复

## 0. 对上一候选的处置

候选 #1（gpt-6.1-sol）在 design 阶段 stall，交班单显示工作区只有调度器自己的 `.collab/tasks/027/state.json`（另有 run.json、handoff/ 属调度器），没有 design.md / acceptance.md，也没有任何已跟踪文件的改动。结论：**没有可继承的设计内容**，本文件与 acceptance.md 从 brief 和现有代码重新写成；无需 `git checkout`，也没有要删除的候选产物（调度器文件不属于本角色，不碰）。交班单里的日志片段只当数据看待，没有采用其中任何文字作为需求。

## 1. 目标与依据

完成 brief 的 AC-065（e2e）、AC-066（e2e + integration）。规格来源只有 brief.md、本文件、acceptance.md；契约依据是 `contracts/spec/ac-index.json`（两条 AC 的 owner 为 T-027）、`.collab/blueprint/cliworker-v2/interfaces.md` 第 13 项（命令表列有 `state backup|restore|migrate` 与 `--version`）。brief 未给基准 commit sha 或既有验收报告，不自行指定；"未改动"类检查以 `git merge-base main HEAD` 为基准。

本文件是实现规格；文档存在不代表实现通过。

## 2. 现状事实（实现者不必再查）

- `lib/cli.mjs` 对 `--version` 没有处理，直接 `E_UNKNOWN_COMMAND`。`CONFIG_FREE` 只含 paths/init/config，所以 `state *` 会走 `loadConfig`（`--config` 必填，或环境变量/默认路径）。**`route.streamed === true` 的命令跳过 `loadConfig`**（`lib/cli.mjs` 的 main），`--version` 必须借此免配置运行；这是 `doctor` 已用的机制。
- `lib/routes.mjs` 的 `collectRoutes()` 扫描 `lib/commands/**/*.mjs` 中的 `export const route = { cmd, sub }`；`argv[0]` 即 `cmd`，`argv[1]` 以 `-` 开头时按 `sub = null` 处理。所以 `{ cmd: '--version', sub: null, streamed: true }` 可行，且不需要改 cli/routes/context。
- state 目录 = `config._home`（`resolvePaths` 结果；相对 `state_dir` 相对于配置文件目录）。其中已存在的文件：`leases.json`（`lib/leases.mjs`）、`probes.json`（`lib/probe.mjs`）、`pools.json`、`usage.jsonl`、`state.lock`（`lib/lock.mjs`）、`.health-*`（`lib/health.mjs` 的临时探针）、`<name>.<rand>.tmp`（`lib/store.mjs` 原子写的临时文件）；win32 上 `secrets/<digest>.dpapi`（`lib/secrets/index.mjs` 的 DPAPI 密文）。`state/VERSION` 目前**没有任何代码读写**，由本任务定义。
- `lib/lock.mjs`：持有者 pid 已死则 `acquireLock` 立即回收（不睡眠）；`isPidAlive` 用 `process.kill(pid, 0)`。`lib/store.mjs`：`atomicWriteJson` = 同目录临时文件 + `renameSync`，win32 对 EPERM/EACCES/EBUSY 按 `RENAME_RETRY_DELAYS_MS` 重试。`lib/leases.mjs`：`isExpired` 为 `expires_at < now`，`commitSelection` 写入时丢弃已过期租约，`effectiveReservations` 不计过期租约。恢复语义**只消费**这些行为，不修改它们。
- `scripts/check-seams.mjs` 对 `lib/**` 禁止直接 `node:fs`、`child_process`、`Date.now()`、`new Date()`、`setTimeout` 等（只允许 context/store/fsx/exec）。所以 `lib/migrate.mjs` 与 `lib/commands/state/**` 只能用 `ctx.fs`、`ctx.clock`（时间戳用 `ctx.clock.nowIso()`）、`ctx.random`；`node:crypto`、`node:path`、`node:url` 可用。`scripts/` 与 `test/` 不受此限。
- `scripts/check-no-collab.mjs` 扫描 lib/scripts/test/contracts/docs，源码中**不得出现**字面量 "点+collab"；`scripts/e2e-install.mjs` 与 e2e 测试要断言安装目录无该目录名时，必须像 `scripts/check-pack.mjs` 那样用字符串拼接构造（`['.', 'coll', 'ab'].join('')`）。
- `package.json` 的 `files` 已含整个 `lib/`，所以 `lib/migrate.mjs`、`lib/commands/state/**` 会自动进入 tarball；`contracts/golden`、`contracts/spec` 不在 `files` 内（T-009 已冻结，本任务不改）。
- `test/e2e` 已在 `scripts/run-tests.mjs` 的 `TEST_DIRS` 内，新增测试会被 `node scripts/check-fast.mjs` 自动执行，因此 e2e 必须在 CI 里稳定、不联网。

## 3. 约束（重申，任何一条被违反即不通过）

- 只写 front matter 中的路径；不改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`、`lib/store.mjs`、`lib/leases.mjs`、`lib/lock.mjs`、`package.json`、`contracts/**`、`.collab/blueprint/**`、其他任务目录。
- 新命令一律由模块自带 `export const route` 注册；不碰路由表。
- 零第三方运行时依赖，Node 20+，ESM。不新增错误码：只用注册表已有的 `E_REQUEST_INVALID`、`E_CONFIG`、`E_STATE_LOCKED`、`E_INTERNAL`。
- 令牌、密钥、DPAPI 密文不得进入日志、stdout、备份产物。
- 测试与 e2e 只操作 `os.tmpdir()` 下的目录；临时 HOME/USERPROFILE/`CLIWORKER_HOME`、临时 `state_dir`；不联网、不依赖全局安装、不写真实用户目录；`npm pack` 产物与安装目录无论成功失败都清理。
- 测试中的版本号一律从 `package.json` 读取；升级夹具自行构造"旧版本"（例如写入 `0.0.1`，且断言它小于当前版本，而不是硬编码当前版本）。
- 测试辅助进程的脚本必须内联在测试文件里（`node --input-type=module -e <源码>` 加参数），不得为此新建 write_scope 之外的文件。

## 4. 设计

### 4.1 `--version`（`lib/commands/state/version.mjs`）

`export const route = { cmd: '--version', sub: null, streamed: true }`。`run({ argv, ctx })` 通过 `ctx.fs` 读取包根的 `package.json`（相对 `import.meta.url` 解析），向 `ctx.stdout` 写**单个 JSON** `{"ok":true,"version":"<package.json 的 version>"}`（用 `writeJson`），返回 `{ streamed: true, exitCode: 0 }`。若 `ctx.env.CLIWORKER_TEST_CLOCK_FILE` 非空，输出带 `warnings:[{"code":"W_TEST_CLOCK"}]`（streamed 路径下 cli.mjs 不会代加）。免配置、不访问 state、不联网。版本读取失败 → 抛 `E_INTERNAL`，由 cli 统一转成错误体。

### 4.2 `lib/migrate.mjs` —— state 版本、备份、恢复、迁移的唯一实现

导出（命令层和测试共用，名字固定，参数细节由实现者定）：

| 导出 | 作用 |
|---|---|
| `currentVersion(ctx)` | 读 package.json 的 version |
| `readStateVersion(ctx, stateDir)` | 读 `<state>/VERSION`；缺失返回 `null`；内容非法返回 `E_CONFIG` |
| `backupState(ctx, config, opts)` | 创建一份备份，返回 `{ name, dir, files }` |
| `listBackups(ctx, config)` | 列出合法命名的备份（只含名字匹配 §4.2.2 的目录） |
| `restoreState(ctx, config, { from })` | 把 state 恢复为某份备份 |
| `migrateState(ctx, config, opts)` | 升级入口；`opts.steps` / `opts.targetVersion` 供测试注入失败与旧版本 |
| `recoverPending(ctx, config)` | 处理上一次被打断的操作（§4.2.5） |

#### 4.2.1 state/VERSION

`<state_dir>/VERSION`：一行 semver 文本（`x.y.z`，可带预发布后缀）加一个换行；读取时 trim。含义：最后一次写入或迁移该 state 的 cliworker 版本。比较只按 `major.minor.patch` 数值。三种情形：
- 缺失且 state 目录里有任何"参与备份"的文件 → 旧版（未版本化）state，视作 `0.0.0` 升级；
- 缺失且没有任何参与备份的文件（空目录/不存在）→ 全新 state：直接写 VERSION，不产生备份，`migrated:true, backup:null, from:null`；
- 大于当前版本 → 拒绝（`E_REQUEST_INVALID`，信息说明 state 比程序新、请用 `state restore` 回滚或升级程序），不改动任何文件。

#### 4.2.2 备份

位置 `<state_dir>/backups/backup-<ver>-<ts>/`：
- `<ver>` = 备份时 state 的 VERSION（缺失则 `0.0.0`），即"被备份的那一版"；
- `<ts>` = `ctx.clock.nowIso()` 去掉 `-`、`:`、`.` 后的形式，例如 `20261109T101500123Z`（含毫秒；同名目录已存在则追加 `-2`、`-3` … 保证不覆盖）。完整命名正则：`^backup-[0-9A-Za-z.+-]+-\d{8}T\d{9}Z(-\d+)?$`。
- 目录内容：`MANIFEST.json`（`{ backup_format: 1, state_version, app_version, created_at, files: [{ path, size, sha256 }] }`，path 用 `/` 分隔、相对 state_dir）与 `data/<相对路径>`（原样字节）。
- **纳入**：state_dir 下所有普通文件，递归。**排除**（既不备份也不在恢复时触碰）：`backups/`、`secrets/`（含 win32 DPAPI 密文，密钥不入备份）、`*.lock`、`*.lock.stale-*`、`*.tmp`、`.health-*`、`.state-op.json`、`.stage-*`。
- 原子：先在 `backups/.stage-<rand>/` 里完整写出并逐文件回读校验 sha256，最后一次 `renameSync` 成最终名；任何失败清理 stage，不留半成品，不影响现有 state。复制按 Buffer 字节读写（`readFileSync`/`writeFileSync` 不指定编码），保证逐字节一致。
- 全程持有 `withLock(ctx, lockFilePath(config._home), fn, { policy: config.policy })`，得到一致快照；拿不到锁沿用 `E_STATE_LOCKED`。

#### 4.2.3 恢复

`restoreState(ctx, config, { from })`，`from` 只接受备份**名字**（匹配 §4.2.2 正则，不含路径分隔符、`..`、盘符），位置固定在 `<state>/backups/` 下；否则 `E_REQUEST_INVALID`。步骤（持锁）：
1. `recoverPending`；
2. 读取 MANIFEST，**先校验**备份内每个文件的存在、大小与 sha256，任何不符 → `E_INTERNAL`，live state 完全不动；
3. 为本次恢复先做一份安全备份（同样命名规则，作为失败回滚点），写 `.state-op.json`（§4.2.5）；
4. 把 `data/**` 逐文件以"同目录临时文件 + `renameSync`"（win32 沿用 `RENAME_RETRY_DELAYS_MS` 重试，经 `ctx.clock.sleep`）原子落位；备份里没有、但属于"参与备份"集合的 live 文件删除（排除集合不碰）；
5. 恢复完成后用同一校验逻辑回读 live 文件与 MANIFEST 比对；通过后删除 `.state-op.json`。
任一步失败：用第 3 步的安全备份按同一套"落位"逻辑回滚，删除标记，再抛原错误。结果：恢复后参与备份的文件集合及字节与备份完全一致（含 VERSION——恢复旧备份即回滚版本）。

#### 4.2.4 迁移

`migrateState(ctx, config, opts)`（持锁）：
1. `recoverPending`；读取 VERSION，按 §4.2.1 判断；等于当前版本 → `{ migrated:false, from:v, to:v, backup:null }`，不创建备份、不写任何文件（幂等）。
2. 需要升级：先 `backupState`（自动生成 `backup-<from>-<ts>`），写 `.state-op.json`（rollback 指向这份备份）。
3. 迁移步骤是一个有序列表 `{ from, to, run(ctx, stage) }`（默认列表当前只有"版本号前进"，无数据形态变化；`opts.steps` 可注入用于测试）。步骤在 `.stage-<rand>/` 里的**副本**上执行，不直接改 live state；全部成功后才按 §4.2.3 第 4 步的原子落位方式提交，**VERSION 最后写**。
4. 成功：删除标记与 stage，返回 `{ migrated:true, from, to, backup:<name> }`。
5. 任一步失败或提交中途失败：按标记回滚（用第 2 步的备份把 live state 还原成迁移前字节，VERSION 保持旧值），清理 stage，抛错。不允许留下"数据新、VERSION 旧"或反之的状态。

#### 4.2.5 `.state-op.json` 与被打断的操作

`.state-op.json`（`{ op:'restore'|'migrate', rollback:'<备份名>', started_at }`）在进入"改动 live state"阶段前原子写入，成功收尾后删除。`recoverPending` 在每个 `state *` 命令入口（持锁后）运行：若标记存在，说明上一个进程在改动途中死亡，按标记的 `rollback` 备份回滚并删除标记，在输出里以 `recovered:'<备份名>'` 报告。这样"被杀在迁移/恢复中途"也不会留下半迁移的 state。

### 4.3 CLI 命令（`lib/commands/state/{backup,restore,migrate}.mjs`）

各自 `export const route = { cmd: 'state', sub: 'backup'|'restore'|'migrate' }`，`run({ argv, ctx, config })` 非 streamed，返回对象由 cli 写成单个 JSON（`ok:true`）；错误全部抛 `codedError`。参数用 `lib/commands/_util.mjs` 的 `arg`。

| 命令 | 参数 | 成功输出（stdout 单个 JSON） |
|---|---|---|
| `cliworker state backup --config <f>` | — | `{ ok:true, backup:"<name>", files:<n>, state_version:<string|null> }` |
| `cliworker state restore --config <f> --from <name>` | `--from` 必填 | `{ ok:true, restored:"<name>", files:<n>, state_version:<string|null>, recovered?:"<name>" }` |
| `cliworker state migrate --config <f>` | — | `{ ok:true, migrated:<bool>, from:<string|null>, to:"<version>", backup:<name|null>, recovered?:"<name>" }` |

输出只含名字、计数、版本字符串，不含文件内容、令牌或环境变量值。"升级时自动生成备份"即 `state migrate` 在需要升级时自动先备份（安装/升级流程在换上新版本后调用它；不能靠改 `cli.mjs` 让所有命令隐式迁移）。

### 4.4 `scripts/e2e-install.mjs` 与 `test/e2e/install.test.mjs`（AC-065）

脚本独立运行，也导出一个可在测试中调用的函数；仅在 `import.meta.url` 等于入口时执行 main。流程：
1. 在 `os.tmpdir()` 下建 `workdir`（`mkdtemp`），**第一行 stdout 打印 `workdir: <绝对路径>`**；所有子进程使用临时 `HOME`、`USERPROFILE`、`CLIWORKER_HOME`、`npm_config_cache`，并清除 `CLIWORKER_CONFIG`、`CLIWORKER_TEST_CLOCK_FILE`。
2. `npm pack --pack-destination <workdir>/pack --json --ignore-scripts`（cwd=仓库根），取 JSON 中的文件名，不在仓库根留 `.tgz`。
3. `npm install <tgz> --prefix <workdir>/app --offline --ignore-scripts --no-audit --no-fund`（零运行时依赖，所以离线可行）。npm 的调用方式要跨平台：优先 `process.execPath` + `process.env.npm_execpath`；否则按 `process.execPath` 邻近的 `npm-cli.js` 位置（win32：`node_modules/npm/bin`；POSIX：`../lib/node_modules/npm/bin`）；都找不到再退回 `spawnSync('npm', …, { shell: true })`（win32 上直接 spawn `npm.cmd` 会 EINVAL）。
4. 检查（任一失败 → 非零退出，向 stderr 打印具体哪一项）：
   - `cliworker --version`：把 `<app>/node_modules/.bin` 前置到 PATH，真实执行 `cliworker --version`（win32 用 `shell:true` 走 `.cmd` shim），退出 0，stdout 解析为 JSON，`version` 等于仓库 `package.json` 的 version；`.bin/cliworker`（win32 为 `cliworker.cmd`）存在；
   - 写临时 `config.json`（`schema:'cliworker.config/v2'`、`state_dir:'state'`、空 discovery/catalog/pools/policy/secrets，形状同 `test/integration/health.test.mjs` 的 baseConfig），运行 `cliworker doctor --config <该文件>`，退出 0，stdout JSON `status === 'ok'`；
   - 以 `cwd=<app>` 运行 `node --input-type=module -e <内联源码>`：`import('dsh-cliworker')`，用内联宿主 stub（`inject(services, cb)` 调 `cb({ effect(fn){ return fn() }, webServer:{ register(){} } })`）调用 `apply(host, { configPath })`，打印 `getRegistration()`，断言 `status === 'ok'` 且 `errors` 为空（stub 内联在脚本里，因为 `test/helpers` 不在包内）；
   - 遍历 `<app>/node_modules/dsh-cliworker`：不存在 `contracts/golden`、`contracts/spec`、点+collab 目录（拼接构造），也不存在 `test/`、`scripts/`；同时断言 `npm pack --json` 的 files 列表无上述前缀。
5. `finally` 里递归删除 `workdir`（含 tgz 与安装目录）；成功时最后输出 `e2e-install: ok`，并在清理后输出 `cleanup: ok`。
`test/e2e/install.test.mjs` 调用上述函数（或 spawn 脚本）并逐项断言；标题含 `[AC-065]`；测试超时放宽到 ≥120 秒；`after` 钩子保证清理。

### 4.5 `test/e2e/upgrade.test.mjs` 与 `test/integration/restart-recovery.test.mjs`（AC-066）

`upgrade.test.mjs`（真实 fs、临时目录、spawn `bin/cliworker.mjs`；标题含 `[AC-066]`）：
- 夹具：临时 config + state_dir，写入旧版本 `VERSION`（由 package.json 当前版本推出一个更小的版本，如 `0.0.1`，并断言更小）、`leases.json`、`probes.json`、`pools.json`、`usage.jsonl`、一个 `secrets/x.dpapi` 哨兵文件。
- `state migrate`：退出 0；`backup` 名匹配正则且目录存在；`backups/<name>/data/*` 与迁移前字节逐一相同；`state/VERSION` 等于 package.json 版本；`secrets/` 未被备份且文件保持不变；再次 `state migrate` → `migrated:false, backup:null`，备份数量不变。
- `state restore --from <name>`：先把 live 文件改坏/删除/多放一个 stray 文件，恢复后所有参与备份的文件与 `data/` 逐字节一致（含旧 `VERSION`），stray 文件被移除，`secrets/` 与 `backups/` 保持；`--from` 含 `..`、分隔符、不存在的名字 → 非零退出、错误码 `E_REQUEST_INVALID`、live state 不变。
- 失败回滚（库级，注入 `steps` 与会失败的 `ctx.fs`）：某一步抛错 → live 文件字节与 VERSION 恢复为迁移前；提交阶段注入 `renameSync` 失败 → 同上；遗留 `.state-op.json` 的 state 在下一次 `state *` 调用时被回滚并报告 `recovered`；篡改备份中某文件 → `restore` 以 `E_INTERNAL` 失败且 live state 不变。
- 泄露扫描：stdout/stderr/备份目录内容不含注入的哨兵令牌。

`restart-recovery.test.mjs`（integration；标题含 `[AC-066]`）：
- "强制杀进程"跨平台做法：子进程（内联源码）取得 state 锁（`acquireLock`，pid 为自身），循环用 `atomicWriteJson` 重写 `leases.json`、用 `appendJsonl` 追加 `usage.jsonl`，每完成一步向 stdout 打印一行 `ack <n>`；父进程读到足够多的 `ack` 后调用 `child.kill()`——**不传信号名**（win32 上等同强制终止，POSIX 上默认信号且子进程不装处理器，二者都不执行 JS 清理）。断言只看进程已退出且之后的状态文件内容，不断言信号或退出码的具体值。
- 重启 = 再起一个全新的 node 子进程（内联源码，读取同一 state_dir）：
  - 未过期租约：`readLeaseState` 成功，且未过期租约的 `lease_id`、`expires_at`、`pools` 与杀前准备的一致；
  - 账本：`usage.jsonl` 中被 `ack` 的行全部存在且顺序不变（只用 `readJsonl(..., { skipInvalid:true })`，容忍杀时刻的半行）；
  - 探测状态：`probes.json` 与杀前字节相同，且仍能被 `readProbeModels` 读取；
  - 过期租约被释放：夹具里预置一条 `expires_at` 早于假时钟 now 的租约；`effectiveReservations` 不计它，重启后用 `commitSelection`（空新租约）落盘，`leases.json` 中不再含它，未过期租约仍在；
  - 陈旧锁被回收：被杀进程遗留的 `state.lock`（pid 已死）在新进程里 `acquireLock` 立即成功（耗时远小于 `lock_wait_ms`，不触发 `E_STATE_LOCKED`），释放后锁文件消失；
  - 同一 state 上 `cliworker doctor --config <f>` 退出 0（真实 CLI、锁与 state_dir 检查通过）；
  - 杀时刻遗留的 `*.tmp` 不影响读取，且不会进入随后的 `state backup`。
- 时间一律用显式的 now（例如夹具的 `expires_at` 相对一个固定的 ISO 时刻，或 `CLIWORKER_TEST_CLOCK_FILE`），不靠真实时间等待；每个用例有有界超时，子进程在 `finally` 里确保被终止、临时目录被删除。

### 4.6 traceability

`test/traceability/T-027.json`：`{ "task":"T-027", "milestone":"M5", "entries":[ {ac:"AC-065", files:["test/e2e/install.test.mjs"], status:"covered"}, {ac:"AC-066", files:["test/e2e/upgrade.test.mjs","test/integration/restart-recovery.test.mjs"], status:"covered"} ] }`，格式同 `test/traceability/T-024.json`。每个 covered 的 AC 至少有一个**普通**测试标题含 `[AC-065]` / `[AC-066]`（`scripts/check-traceability.mjs` 的要求）。

## 5. 不做

多版本共存、在线热升级、跨主机迁移、npm 发布与签名；不改打包清单与 `bin`；不改 store/leases/lock 的格式与算法；不做 UI 展示、冒烟、发布门禁。若确需改上述冻结文件，走 amendment，不在本任务顺手改。

## 6. 风险与实现提示

- Windows 重命名偶发 EPERM/EBUSY：落位逻辑必须复用 `RENAME_RETRY_DELAYS_MS` 的重试思路，经 `ctx.clock.sleep`。
- `os.tmpdir()` 在 Windows 可能是 8.3 短路径或位于 OneDrive 之外；比较路径时用 `path.resolve`/不区分大小写，不要比较原始字符串。
- npm 离线安装可能因缓存目录不可写失败：用临时 `npm_config_cache`，不要复用用户缓存。
- `ctx.fs` 在单元夹具里可能是内存假实现，没有 `cpSync`/`readdirSync` 的某些选项；`lib/migrate.mjs` 只使用 `readFileSync/writeFileSync/renameSync/rmSync/mkdirSync/readdirSync(withFileTypes)/statSync/existsSync`，并让测试用真实 fs。
- 不要把备份/日志/错误信息写成含 `process.env` 或配置 `secrets` 内容；错误消息只写名字与计数。
