# Task 039 实现说明

- 新增 discover flow 步骤，使用独立 v2 配置和隔离的 PATH 调用真实 CLI，校验 stdout 与落盘 inventory 的 schema、entries、时间及完整内容一致；不修改共享配置。
- 两个 flow 测试入口从磁盘推导步骤集合，保留顺序、元数据、泄漏与成功断言；新增 AC-082 真实 flow 测试和 T-039 追踪记录。

自测结果：

- acceptance.md 的 AC-082 独立行为脚本通过，输出 `AC-082 OK`；`node --test test/flows/flow.test.mjs`、`node --test test/integration/flow-complete.test.mjs` 和 `node scripts/run-tests.mjs --ac AC-082` 通过。
- `node scripts/check-acceptance.mjs .collab/tasks/039/acceptance.md` 通过。
- `node --test "test/unit/*.test.mjs"`：526 通过、5 失败、1 跳过；失败位于已有 `release-gate.test.mjs`，报告 `BLOCKED index index.count`，与设计阶段记录一致。
- `node scripts/check-fast.mjs`：在 `check-pack.mjs` 失败，`npm pack` 退出码 4294963248，与设计阶段记录一致。当前环境无法通过 PATH 找到 `pwsh` 可执行文件，故使用验收允许的 Node 入口。
