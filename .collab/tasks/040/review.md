# Task 040 评审（review）

评审 sha：`8ecbafa0c2279bb4990b2528e6773dbc73360002`（分支 task/040，读 `.git` HEAD 所得，未执行 git 命令）。
结论：**needs_revision**。通过 1 / 总数 2（AC-006 通过，AC-083 不能通过）。

## 证据口径

- `ci-results.json`：AC-083 `exitCode 0`、AC-006 `exitCode 0`，`passed 2/2`。但 AC-083 的 `durationS` 只有 3.87s，`output` 只含最后一块（追溯检查）的输出。验收里的 5 轮×24 进程测试、3 遍规模脚本、故障注入脚本共要启动上千个 node 进程，3.87s 装不下，所以这份 CI 记录不能证明并发稳定性那几块实际跑过。
- 这与 impl.md 第 8 行明显矛盾：开发方自己报告了真实的 23/24 丢更新。依口径，该项标为无法确认。
- 因此我在评审环境里把测试文件直接跑了 6 遍作独立复现（只读代码，不改任何文件）：

```
node --test test/integration/cross-process-write.test.mjs   # x6
run1: round 1 (stale lock): 23 !== 24, # fail 1
run2: round 2 (stale lock): 23 !== 24, # fail 1
run3: round 2 (stale lock): 23 !== 24, # fail 1
run4: # pass 3, # fail 0
run5: round 4 (stale lock): 23 !== 24, # fail 1
run6: round 1 (stale lock): 23 !== 24, # fail 1
```

6 遍里 5 遍失败，全部在 `xproc-commit-stale-lock-24x5`，23 个进程退出码 0，台账少一条。干净目录用例与纯内存反例用例均通过。故障注入变量未设置，所以这是真实丢更新，不是注入。

## 根因（只读核对 `lib/lock.mjs`）

`reclaimLock`（`lib/lock.mjs:157-185`）先 `readLockStateOrNull` 比对 token（158-160），再 `renameSync(lockPath, tomb)`（164），之后才检查被移走的是否仍是目标锁（171-172）。检查与移动之间不是原子的：

1. 等待者 B 读到 stale 锁 `planted`，并在 158 行确认 `sameLock`；
2. 此时等待者 A 已回收 `planted`、C 已用 `wx` 创建了新锁并进入临界区；
3. B 执行 164 行，把 C 的有效新锁 rename 走；`lockPath` 暂时不存在；
4. D 在这个窗口里 `tryCreate`（99 行 `wx`）成功，于是 C、D 同时在临界区，读-改-写互相覆盖，丢一条；
5. B 在 171 行发现 token 不符，再 rename 回去（176 行），覆盖掉 D 的锁。

lock.mjs 注释自称这一步防止「两个持有者同时运行」，但这个窗口使之仍可能发生。这是 `lib/` 的实现缺陷，本任务约束不得改 `lib/`，故需单独处理；该缺陷也说明测试本身是有效的：它在预置 stale 锁、24 进程争抢时把缺陷稳定抓出。

## 逐条核对 acceptance.md

| 小节/检查 | 结论 | 证据 |
|---|---|---|
| AC-083 测试文件通过、无 fail/skip | **不通过** | 独立复现 6 遍中 5 遍 `# fail 1`（见上） |
| AC-083 过滤运行入口 | 无法确认 | 该文件在同一缺陷下会失败，`run-tests --ac AC-083` 必然随机失败；CI 无该块输出 |
| AC-083 夹具直接驱动（5 轮干净、屏障、启动日志、故障注入） | 无法确认 | CI 无该块输出；代码核对：`commit-worker.mjs:10-12,13-24,29-31` 实现与设计一致 |
| AC-083 故障注入被抓到 | 代码核对满足 | `cross-process-write.test.mjs:15-18,56` 严格比较条目数与 id 集合；复现中已见 23!==24 被抓 |
| AC-083 规模与稳定性（连续 3 遍通过） | **不通过** | 复现显示连续 3 遍通过的概率很低；impl.md 第 8、12 行同样承认并发稳定性验收不能通过 |
| AC-083 写域与 lib 零改动 | 无法确认（评审禁用 git） | CI 无该块输出；impl.md 称未改 `lib/`；`test/fixtures/store` 下新增的只有 `commit-worker.mjs`，既有 `append-worker.mjs`、`counter-worker.mjs` 在目录里仍在 |
| AC-083 追溯与测试发现 | 满足 | CI `output`：`check-traceability: ok (covered=76 planned=3)`、`check-test-discovery: ok`、`AC-083 OK` |
| AC-006 单元测试 | 满足 | CI：`# tests 532 / pass 532 / fail 0 / skipped 0`，`AC-006 OK` |
| AC-006 check-fast.ps1 | 满足（按 CI） | `AC-006 OK`，exitCode 0 |

## 测试与夹具本身的质量

- 严格相等、id 集合比对、残留文件检查、屏障对齐、临时目录前缀 `cliworker-xwrite-` 与 `finally` 清理均符合 design.md；没有放宽断言，没有 skip。
- 测试文件失败信息带轮次和 stale/clean 标记，便于定位。
- 小问题（P2）：design.md 要求 `verifyLedger` 的 stdout 与 workerId 校验、`spawn log` 等都已具备；`runRound` 未给子进程设 `windowsHide`，无功能影响。

## Findings

- **P0** `lib/lock.mjs:157-185`：`reclaimLock` 的「检查后再 rename」不是原子的，stale 锁多方争抢时会让两个进程同时进入临界区，导致丢更新。24 进程、预置 stale 锁的场景下 6 遍复现 5 遍 23/24。本任务不得改 `lib/`，需要另开任务修复（例如改成先 rename 到唯一 tomb 再校验的现有顺序之外的互斥方案，或用持久化互斥保护回收段），修复后再复验本任务。
- **P1** 验收无法在当前状态通过：AC-083 的测试文件、过滤运行、规模稳定性三块都依赖上述缺陷已修；在此之前不应合并。
- **P1** `ci-results.json` 对 AC-083 只包含最后一块的输出，且 3.87s 与 5 轮×24 进程的规模不符，不能作为并发块的运行证据；请编排方确认每个 pwsh 块是否都被执行并记录。
- **P2** impl.md 的自测没有跑完验收命令（过滤运行、夹具、规模脚本未逐条运行）；修复缺陷后需补跑。

## 建议

1. 另开任务修复 `lib/lock.mjs` 的回收竞态（本任务已有稳定复现：`node --test test/integration/cross-process-write.test.mjs`）。
2. 修复合入后重新跑本任务验收；测试资产本身不需要改动，也不要放宽断言。
