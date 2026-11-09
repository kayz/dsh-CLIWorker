---
write_scope:
  - test/integration/cross-process-write.test.mjs
  - test/fixtures/store/**
  - test/traceability/T-040.json
---

# Task 040 — 跨进程写入并发一致性

## 背景与继承说明

依据同目录 brief.md，以及现有 `lib/lock.mjs`（`withLock` / `lockFilePath`，含 stale 锁回收）、`lib/store.mjs`（`readJson` / `atomicWriteJson`）、`test/integration/store-concurrency.test.mjs` 与 `test/fixtures/store/{append-worker,counter-worker}.mjs`。brief 没有给基准 commit sha 或既有验收报告路径，不另造基准；中央 AC 索引 `contracts/spec/ac-index.json` 已登记 AC-083 / T-040 / M4 / integration，baseline 为 darwin、linux、win32，`scripts/check-traceability.mjs` 已接受 AC-083，本任务不改索引、不改检查脚本。

候选 #1（gpt-6.1-sol）在本阶段因 `tls handshake eof` 传输错误失败，交班单与 `git status` 一致：已跟踪文件 0 处改动，没有 design.md / acceptance.md，也没有任何测试资产。结论是**放弃**：没有可继承的改动，因此没有执行 `git checkout HEAD -- .`，也没有删除文件。工作区里未跟踪的 `handoff/`、`run.json`、`state.json` 属于调度器，不删除。本文件与 acceptance.md 均为本候选从头写成。

## 目标

多进程同时写 state 时不得丢更新。本任务只新增测试资产，用真实子进程守住「N 个进程各完成一次提交，全部退出码 0，最终 state 条目数恰好等于 N」这一语义，覆盖 `lib/lock.mjs` 的回收竞态（曾导致 98/100）。

已在设计阶段用临时目录（不在仓库内）做过一次试跑：24 个进程在一个预置了 stale 锁（`pid` 为存活进程、`at: 1`）的状态目录里竞争，连续 5 轮均为 24/24 条目，目录里只剩 `ledger.json`。方案对当前 `lib/` 可行，无需改实现。

## 约束

1. **不得修改 `lib/` 下任何文件**，也不得修改 `store-concurrency.test.mjs`、`append-worker.mjs`、`counter-worker.mjs`。工作进程只用 `lib/context.mjs`、`lib/store.mjs`、`lib/lock.mjs` 的既有导出。若运行中发现实现缺陷（丢更新、残留 `.lock` / `.stale-*` / `.tmp`），在 impl.md 写清复现轮次与现象，**测试断言保持严格**，不得放宽、不得 skip、不得为让测试通过而改 `lib/`。
2. 不复用 `store-concurrency.test.mjs` 的用例名（`append-20x50`、`lock-counter`）。本任务所有用例标题为普通 `test('...')` 字符串字面量并含 `[AC-083]`，以便 `scripts/run-tests.mjs --ac AC-083` 与 `check-traceability` 的标题扫描命中。
3. 每轮子进程数 `N = 24`（不少于 20），轮数 `ROUNDS = 5`（至少 5 轮）。最终断言是 `entries.length === N` 的严格相等，并且条目 id 集合与期望集合逐项相等；禁止「大于等于」「不少于某比例」之类的放宽。
4. 测试不 sleep 固定墙钟时间来「等并发发生」：靠屏障文件让 N 个进程同时放行；等待屏障用轮询 `existsSync`（间隔 ≤ 10ms）并设 60s 上限。
5. 临时目录一律在 `os.tmpdir()` 下以前缀 `cliworker-xwrite-` 创建，`finally` 中递归删除；不在仓库内产生运行时文件，不访问网络、不碰用户目录。
6. 写域严格为 front matter 所列三项；`test/fixtures/store/**` 下只新增文件，不改既有两个 worker。

## 文件与接口

### 1. `test/fixtures/store/commit-worker.mjs`（新增）

命令行：`node commit-worker.mjs <stateDir> <workerId> [<barrierDir>]`。

- 台账文件：`<stateDir>/ledger.json`，结构 `{ "entries": [ { "id": "<workerId>", "pid": <number> } ] }`；缺失视为 `{ "entries": [] }`。
- 锁文件：`lockFilePath(stateDir)`（即 `<stateDir>/state.lock`）；策略 `{ lock_wait_ms: 60000, lock_poll_ms: 10 }`。
- 环境变量（均可选，由测试和验收命令设置，工作进程直接继承 `process.env`）：
  - `CROSS_PROCESS_SPAWN_LOG`：非空时，进程启动后立即 `appendFileSync` 一行 `<stateDir>\t<workerId>\t<pid>\n`，用于旁路证明每轮实际启动了多少个进程。
  - `CROSS_PROCESS_FAULT_DROP_ID`：当其值等于本进程 `workerId` 时，临界区内**跳过写入**但仍照常打印成功行并以 0 退出，模拟「一次提交悄悄丢失」，只用来证明测试能抓到丢失。默认未设置。
- 流程：记录 spawn 日志 → 若给了 `barrierDir`：写空文件 `ready-<workerId>`，轮询等待 `go` 文件出现（60s 超时则 stderr 输出 `barrier timeout` 并以 3 退出）→ `withLock` 内 `readJson` → 追加 `{ id, pid }` → `atomicWriteJson` → stdout 打印一行 `COMMITTED <workerId>`，退出 0。
- 任何异常让进程以非 0 退出并把原因写入 stderr，不吞错误。

### 2. `test/integration/cross-process-write.test.mjs`（新增）

导入 Node 内置 `node:test` 与 `node:assert/strict`；常量 `N = 24`、`ROUNDS = 5`；路径用 `import.meta.url` 解析仓库根，worker 取 `test/fixtures/store/commit-worker.mjs`。

内部辅助（均在该文件内，不对外导出）：

- `runRound({ stateDir, barrierDir, n })`：启动 `n` 个 `process.execPath` 子进程（`workerId = w0..w(n-1)`，参数含 `barrierDir`，stdio 为 `ignore / pipe / pipe`，默认继承环境变量）。等 `ready-*` 文件数达到 `n`（超时即失败并带出已收集的 stderr），再写 `go`，`Promise.all` 收集 `{ code, stdout, stderr }`。
- `verifyLedger(stateDir, results, n)`：
  1. 每个子进程 `code === 0`，失败信息带上 stderr 与 workerId；
  2. 每个 stdout 恰为 `COMMITTED <workerId>`；成功提交数 `successes = results.filter(code === 0).length`，断言 `successes === n`；
  3. 读 `ledger.json`，`entries.length` 严格等于 `successes` 且等于 `n`；
  4. 条目 id 排序后与 `w0..w(n-1)` 排序后逐项 `deepEqual`（既抓丢失也抓重复）；
  5. `fs.readdirSync(stateDir)` 结果恰为 `['ledger.json']`，即无 `state.lock`、`*.stale-*`、`*.tmp` 残留。
  `verifyLedger` 把期望值作为参数（由调用方独立构造），不用被测实现的输出推导期望。

用例（均 `{ timeout: 180000 }`，轮次顺序执行，每轮使用全新 `mkdtempSync` 根目录，下设 `state/` 与 `barrier/` 两个子目录）：

1. `[AC-083] xproc-commit-24x5 …`：干净状态目录，5 轮，每轮 24 进程，调用 `verifyLedger`。
2. `[AC-083] xproc-commit-stale-lock-24x5 …`：5 轮；每轮在 `state/` 里预置一个过期锁文件 `state.lock`，所有进程都要通过回收路径争抢。奇数轮的锁内容 `{ pid: process.pid, at: 1, token: 'planted' }`（持有者存活但已超过 `lock_stale_ms`）；偶数轮的 `pid` 取自一个已启动并已退出的 `process.execPath -e ""` 子进程（持有者已死）。两种情形都调用 `verifyLedger`，并额外断言预置 token `planted` 不再出现在任何文件里（即 `state.lock` 已消失，这已被「目录里只剩 ledger.json」覆盖）。
3. `[AC-083] xproc-verify-catches-loss …`：纯内存的反例，直接调用与上面相同的校验逻辑：对一份正确台账分别删去一条、重复一条、多出一条未知 id、替换一条 id，每种变形都必须使校验抛出 `AssertionError`；对正确台账不得抛出。这条保证「任何一次丢失都被抓到」不依赖并发时序。校验逻辑的核心比较写成接收 `entries` 数组和期望 id 数组的小函数，供 `verifyLedger` 与本用例共用。

测试文件自身不得读取、清除或覆盖 `CROSS_PROCESS_FAULT_DROP_ID` 与 `CROSS_PROCESS_SPAWN_LOG`：子进程环境直接继承，验收命令借此做故障注入与启动计数。

### 3. `test/traceability/T-040.json`（新增）

与既有 shard 同形（见 `T-036.json`），UTF-8 无 BOM：

```json
{
  "task": "T-040",
  "milestone": "M4",
  "entries": [
    { "ac": "AC-083", "files": ["test/integration/cross-process-write.test.mjs"], "status": "covered" }
  ]
}
```

不加 `baseline` 字段（check-traceability 禁止）。

## 实施顺序

1. 先写 `commit-worker.mjs`，手工用 2 个进程验证单次提交、屏障、故障注入三条路径。
2. 写测试文件，先跑用例 3（纯内存），再跑用例 1、2。
3. 写 T-040.json，运行 `node scripts/check-traceability.mjs` 与 `node scripts/check-test-discovery.mjs`。
4. 连续运行测试文件至少 3 次确认稳定；在 Windows 上重点观察 stale 锁回收轮的残留文件。
5. 逐条跑 acceptance.md 的命令。

## 非目标

不测跨机器并发、不测网络文件系统；不测租约提交（`commitSelection`）本身——那由 `select-concurrency.test.mjs` 覆盖，本任务用锁加原子写这一存储层语义做提交；不为 `lib/` 增加任何测试接缝。

## 验收对应

AC-083（integration）：N 进程并发写入后条目数精确等于成功提交数，重复运行至少 5 轮无失败。验收命令见 acceptance.md，全部是「命令 + 退出码 + `AC-083 OK` 哨兵」；回归门禁 `node --test "test/unit/*.test.mjs"` 以 AC-006 小节保留（沿用 task 036 / 037 的写法）。
