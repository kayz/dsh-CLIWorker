# Task 030 实施记录

本任务尚未完成。新增 `test/integration/flow-complete.test.mjs`，严格检查真实步骤的顺序与归属，并在同一 flow 中运行步骤、检查哨兵及泄漏扫描覆盖面；auth 步骤自身验证子进程环境中的凭据哈希及 argv。新增的 `release/waivers.json` 为空数组。

发布门禁 `scripts/release-gate.mjs`、其单元测试与固定夹具，以及 `test/traceability/T-030.json` 尚未实现。不能据此认为 AC-070 或发布门禁通过，也不能将 AC-070 标为 covered。

自测结果：

- `node --test --test-reporter=tap test/integration/flow-complete.test.mjs` 失败：真实步骤集合缺少 `discover`，符合设计中记载的上游缺项；后续完整流程断言尚未执行。
- `node scripts/milestone-gate.mjs --milestone M5` 阻断，报告 AC-070、AC-071 为 planned。
- `node --test "test/unit/*.test.mjs"` 退出 0，486 项中 485 通过、1 跳过；尚不包含本任务未实现的门禁单测。
- `node scripts/check-acceptance.mjs .collab/tasks/030/acceptance.md` 通过，warnings=0。
- `pwsh -NoProfile -File scripts/check-fast.ps1` 无法启动：当前环境找不到 `pwsh`。
