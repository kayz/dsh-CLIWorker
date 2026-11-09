# Task 040 评审 r2（review）

评审 sha：`1bda7fc83e9c70b074da73e233db022b0d71c2d2`（分支 task/040，读 `.git/refs/heads/task/040` 所得，未执行 git 命令）。
结论：**needs_revision**。通过 1 / 总数 2（AC-006 通过，AC-083 不通过）。

## 相对 r1 的变化

- r1 的 P0（`lib/lock.mjs` 回收竞态导致丢更新）**未修复**：`lib/lock.mjs` 的 mtime 为 10:33，早于任务创建（10:34），`reclaimLock` 仍是 `lib/lock.mjs:157-185` 的「先 read 比对、后 rename、再校验」顺序。
- dev-r2 没有改动测试资产（`cross-process-write.test.mjs` 10:41、`commit-worker.mjs` 10:40、`T-040.json` 10:40，均在 r1 之前）。impl.md 第 8、12 行明确承认 AC-083 不能通过。本任务约束禁止改 `lib/`，所以 dev 无法在本任务内解决。
- 这是实现缺陷，不是测试缺陷。测试断言严格且正确，不要放宽。

## 证据

### 独立复现（评审环境，只读，未改任何文件）

```
node --test --test-reporter=tap test/integration/cross-process-write.test.mjs   # x4
run1: 23 !== 24   # pass 2  # fail 1
run2: 23 !== 24   # pass 2  # fail 1
run3: 23 !== 24   # pass 2  # fail 1
run4: 23 !== 24   # pass 2  # fail 1
```

4 遍 4 遍失败，失败的都是 `xproc-commit-stale-lock-24x5`（预置 stale 锁、24 进程争抢），干净目录用例和纯内存反例用例通过。未设置 `CROSS_PROCESS_FAULT_DROP_ID`，所以是真实丢更新：24 个进程全部退出码 0，台账只有 23 条。加上 r1 的 6 遍中 5 遍失败，合计 10 遍中 9 遍失败。

### 根因（只读核对 `lib/lock.mjs`）

`reclaimLock`（`lib/lock.mjs:157-185`）：

1. 等待者 B 在 228 行读到 stale 锁 `planted`，158-160 行再读一次并确认 `sameLock`；
2. 此时 A 已回收 `planted`，C 已用 `wx` 建了新锁并进入临界区；
3. B 在 164 行把 C 的有效新锁 rename 走，`lockPath` 暂时不存在；
4. D 在这个窗口里 `tryCreate`（99 行 `wx`）成功，C、D 同时在临界区，读-改-写互相覆盖，丢一条；
5. B 在 171-172 行发现 token 不符，176 行再 rename 回去，覆盖掉 D 的锁。

158 行的检查与 164 行的移动之间不是原子的，171 行的事后校验无法阻止 C、D 的重叠。

### CI 记录（`ci-results.json`，ranAt 2026-11-09T10:45:58+08:00）

- AC-083：`exitCode 0`、`durationS 1.11`，`output` 只有最后一块的输出（`check-traceability: ok (covered=76 planned=3)`、`check-test-discovery: ok`、`AC-083 OK`）。
- AC-006：`exitCode 0`、`durationS 7.8`，`lastLine AC-006 OK`；输出为 TAP 单元测试汇总。
- AC-083 在 1.11s 内不可能跑完 5 轮×24 进程的测试文件、3 遍规模脚本和故障注入脚本，CI 对该小节只记录了最后一块，不能作为并发块已通过的证据。它与上面的独立复现矛盾，依口径按「CI 与代码明显矛盾」处理，以独立复现为准。

## 逐条核对 acceptance.md

| 小节/检查 | 结论 | 证据 |
|---|---|---|
| AC-083 测试文件通过、无 fail/skip | **不通过** | 独立复现 4/4 遍 `# fail 1`，`23 !== 24` |
| AC-083 过滤运行入口（`run-tests --ac AC-083`） | **不通过** | 运行同一测试文件，同一缺陷下随机失败；CI 无该块输出 |
| AC-083 夹具直接驱动（5 轮干净、屏障、启动日志、故障注入） | 无法确认 | CI 无该块输出。代码核对：`commit-worker.mjs:10-12`（启动日志）、`13-24`（屏障）、`29-32`（故障注入）与 design.md 一致；干净目录用例在复现中稳定通过 |
| AC-083 故障注入必须被测试抓到 | 代码核对满足 | `cross-process-write.test.mjs:15-18` 严格比较条目数与 id 集合，`:50-58` 校验退出码、stdout、成功数、残留文件；复现中已见 `23 !== 24` 被抓 |
| AC-083 规模与稳定性（连续 3 遍通过） | **不通过** | 连续 3 遍通过在当前缺陷下概率很低，复现 4/4 失败 |
| AC-083 写域与 lib 零改动 | 无法确认（评审禁用 git） | CI 无该块输出。`lib/lock.mjs` mtime 早于任务创建，`test/fixtures/store` 下既有 `append-worker.mjs`、`counter-worker.mjs` mtime 为 10:34 未变，新增的只有 `commit-worker.mjs` |
| AC-083 追溯与测试发现 | 满足 | `T-040.json` 内容与 design.md 一致（task/milestone/entries，无 baseline）；CI：`check-traceability: ok (covered=76 planned=3)`、`check-test-discovery: ok`、`AC-083 OK` |
| AC-006 单元测试 | 满足 | CI：`exitCode 0`，`lastLine AC-006 OK`；impl.md 记 532 项中 531 通过、1 跳过、0 失败 |
| AC-006 check-fast.ps1 | 满足（按 CI） | CI 该小节的 AC-006 总结果 `passed true`、`exitCode 0` |

## 测试与夹具质量

- 严格相等、id 集合逐项比对、残留文件检查、屏障对齐、`cliworker-xwrite-` 前缀与 `finally` 清理均符合 design.md，没有放宽断言，没有 skip，没有改 `lib/`。
- 失败信息带轮次与 stale/clean 标记，定位容易。
- P2：`runRound` 的 `spawn` 未设 `windowsHide`，无功能影响。

## Findings

- **P0** `lib/lock.mjs:157-185`：`reclaimLock` 的「检查后 rename」不是原子的，stale 锁多方争抢时会让两个进程同时进入临界区，丢更新。24 进程、预置 stale 锁下 r1 与 r2 合计 10 遍复现 9 遍（23/24）。不在本任务写域内，需要另开任务修复，修复后再复验本任务。
- **P1** AC-083 的测试文件、过滤运行、规模稳定性三块在该缺陷修复前都不能通过，本任务不应合并。重试 dev 不会有新结果，因为约束不允许 dev 改 `lib/`。
- **P1** `ci-results.json` 对 AC-083 只记录最后一块输出，`durationS 1.11` 与测试规模不符，不能作为并发块的执行证据；请编排方确认所有 pwsh 块都被执行并记录。
- **P2** impl.md 未逐条运行过滤运行、夹具、规模和 git 写域验收命令；缺陷修复后需补跑。

## 建议

1. 另开任务修复 `lib/lock.mjs` 的回收竞态（复现命令：`node --test test/integration/cross-process-write.test.mjs`），合入后重新跑本任务验收。
2. 本任务的测试资产不需要改动，也不要放宽断言。
3. 若编排方不打算在本任务内修复 `lib/`，应把该缺陷的修复任务设为本任务的前置依赖，避免 dev 反复空转。
