# Task 040 实施记录

新增 `test/fixtures/store/commit-worker.mjs`，以屏障协调子进程，并通过现有锁和原子写接口提交台账；支持启动日志和丢失提交的故障注入。新增 `test/integration/cross-process-write.test.mjs`，覆盖干净目录、过期锁回收及内存中的丢失和重复反例，每轮严格比较 24 次成功提交与台账的数量和 ID，并检查残留文件。新增 `test/traceability/T-040.json` 将 AC-083 关联到测试文件。

## 自测与发现

- `node --test --test-name-pattern='xproc-verify-catches-loss' test/integration/cross-process-write.test.mjs`：通过。
- `node --test --test-reporter=tap test/integration/cross-process-write.test.mjs`：一次完整运行 3 项通过；随后重复运行出现真实丢更新。第二次重复运行在过期锁第 5 轮复现：24 个工作进程均成功退出，台账只有 23 条（`23 !== 24`）。之前一次失败也为过期锁场景的 23/24，当时尚未在错误信息中记录轮次。没有设置故障注入。断言保持严格，未修改 `lib/`。
- 设置 `CROSS_PROCESS_FAULT_DROP_ID=w0` 后运行测试：干净和过期锁场景均在第 1 轮以 23/24 失败，故障被抓到。
- `node scripts/check-traceability.mjs`、`node scripts/check-test-discovery.mjs`、`node scripts/check-acceptance.mjs .collab/tasks/040/acceptance.md`：通过。
- `node --test "test/unit/*.test.mjs"`：退出码 0，532 项中 531 项通过、1 项跳过、0 项失败。
- 验收中的 Git 写域检查未运行：用户明确禁止执行 Git。`scripts/check-fast.ps1` 会调用包含 Git 操作的检查，也未运行。验收的过滤运行、独立夹具及规模脚本尚未逐条运行；已发现的真实丢更新使并发稳定性验收不能通过。
- 第 2 轮评审反馈：独立运行 6 次，过期锁场景 5 次出现 23/24；评审指出 `lib/lock.mjs` 的回收检查与重命名之间存在竞态。该实现位于本任务写域之外，需要另行修复；本轮未改动测试资产或放宽断言，AC-083 仍不能判为通过。
- 第 3 轮收到的评审反馈：再次独立运行 4 次，过期锁场景全部出现 23/24；未设置故障注入。评审同时指出 CI 中 AC-083 的输出只证明追溯和测试发现检查，不能证明并发及其他验收块已执行。锁实现的修复仍在本任务写域之外，AC-083 仍未通过；本轮未改动测试资产或重复运行测试。
