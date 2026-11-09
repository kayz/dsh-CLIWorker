# Task 040 评审 r3（review）

评审 sha：`80f73b4d733cec9c4cc5985c0f801fa2cc7df052`（分支 task/040，读 `.git/refs/heads/task/040` 所得，未执行 git 命令）。
结论：**needs_revision**。通过 1 / 总数 2（AC-006 通过，AC-083 不通过）。

## 相对 r2 的变化

- dev-r3 没有改动任何代码或测试资产：`lib/lock.mjs` mtime 10:33:59、`cross-process-write.test.mjs` 10:41:50、`commit-worker.mjs` 10:40:09、`T-040.json` 10:40:11，均早于 r2 评审。impl.md 第 14 行承认「本轮未改动测试资产或重复运行测试」。
- r2 的 P0（`lib/lock.mjs` 回收竞态）**仍未修复**，`reclaimLock` 仍是 `lib/lock.mjs:157-185`「先 read 比对（158-160）、后 rename（164）、再校验（171-176）」。本任务约束禁止改 `lib/`，dev 在本任务内无法解决。
- 测试资产严格且正确，不要放宽断言。

## 证据

### 独立复现（评审环境，未改任何文件）

```
node --test --test-reporter=tap test/integration/cross-process-write.test.mjs   # x3
run1: 23 !== 24   # pass 2  # fail 1
run2: 23 !== 24   # pass 2  # fail 1
run3: 23 !== 24   # pass 2  # fail 1
```

3/3 失败，均为 `xproc-commit-stale-lock-24x5`；干净目录用例与纯内存反例用例通过。未设置 `CROSS_PROCESS_FAULT_DROP_ID`，是真实丢更新：24 个进程全部退出码 0，台账只有 23 条。r1 至 r3 合计 13 遍中 12 遍失败。

### 根因

见 r2：`lib/lock.mjs:158-164` 检查与 rename 非原子，等待者可把别人新建的有效锁移走，使 `lockPath` 短暂缺失，另一进程 `wx` 创建成功，两个进程同时进入临界区，读-改-写互相覆盖。171-176 行的事后校验与放回不能阻止重叠。

### CI 记录（`ci-results.json`，ranAt 2026-11-09T10:48:08+08:00）

- AC-083：`exitCode 0`、`durationS 1.13`，`output` 只有 `AC-083 OK / check-traceability: ok (covered=76 planned=3) / check-test-discovery: ok / AC-083 OK`，即只有最后一块（追溯与测试发现）。1.13s 不可能跑完 5 轮×24 进程的测试文件、3 遍规模脚本和故障注入脚本，不能证明并发块已执行；且与上面的独立复现矛盾，以复现为准。
- AC-006：`exitCode 0`、`durationS 7.39`、`lastLine AC-006 OK`。

## 逐条核对 acceptance.md

| 小节/检查 | 结论 | 证据 |
|---|---|---|
| AC-083 测试文件通过、无 fail/skip | **不通过** | 独立复现 3/3 `# fail 1`，`23 !== 24` |
| AC-083 过滤运行入口（`run-tests --ac AC-083`） | **不通过** | 运行同一测试文件，同一缺陷下失败；CI 无该块输出 |
| AC-083 夹具直接驱动 | 无法确认 | CI 无该块输出。代码核对：`commit-worker.mjs` 的启动日志、屏障、故障注入与 design.md 一致 |
| AC-083 故障注入必须被测试抓到 | 代码核对满足 | `cross-process-write.test.mjs:15-18` 严格比较条目数与 id 集合，`:48-59` 校验退出码、stdout、成功数、残留文件；复现中 `23 !== 24` 已被抓 |
| AC-083 规模与稳定性（连续 3 遍通过） | **不通过** | 3 遍复现全部失败 |
| AC-083 写域与 lib 零改动 | 无法确认（评审禁用 git） | CI 无该块输出。`lib/lock.mjs` mtime 早于任务创建；`append-worker.mjs`、`counter-worker.mjs` mtime 10:34 未变；新增的只有 `commit-worker.mjs`（`drive.mjs`、`memfs.mjs` mtime 10:34，属既有） |
| AC-083 追溯与测试发现 | 满足 | `T-040.json` 与 design.md 一致；CI：`check-traceability: ok (covered=76 planned=3)`、`check-test-discovery: ok` |
| AC-006 单元测试 | 满足 | CI：`exitCode 0`，`AC-006 OK` |
| AC-006 check-fast.ps1 | 满足（按 CI） | CI AC-006 总结果 `passed true`、`exitCode 0` |

## Findings

- **P0** `lib/lock.mjs:157-185`：`reclaimLock` 检查后 rename 非原子，stale 锁多方争抢时两个进程同时进入临界区，丢更新。24 进程、预置 stale 锁下 r1–r3 合计 13 遍复现 12 遍（23/24）。不在本任务写域内，须另开任务修复，修复后再复验。
- **P1** AC-083 的测试文件、过滤运行、规模稳定性三块在该缺陷修复前不能通过，本任务不应合并。再重试 dev 不会有新结果。
- **P1** `ci-results.json` 对 AC-083 只记录最后一块输出，`durationS 1.13` 与测试规模不符，不是并发块的执行证据；请编排方确认所有 pwsh 块都被执行并记录。
- **P2** impl.md 未逐条运行过滤运行、夹具、规模和 git 写域验收命令；缺陷修复后需补跑。

## 建议

1. 停止空转重试 dev。把 `lib/lock.mjs` 回收竞态的修复设为独立任务，并作为本任务前置依赖；合入后重跑本任务验收。
2. 或由人工明确授权本任务修改 `lib/lock.mjs`（须更新 design.md 的写域与约束）。
3. 测试资产无需改动，不要放宽断言。
