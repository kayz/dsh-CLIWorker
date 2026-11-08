# T-026 实现说明

- 新增 `test/e2e/select-run.test.mjs`，通过真实宿主 HTTP 路由和独立 CLI 进程选模，在共享文件时钟下原样执行返回的 call，校验事件、输入、路径、账本以及租约重放拒绝。
- 新增 `test/e2e/select-run-sequence.test.mjs`，分别验证两个入口的三个位置递延租约和独立的过期批次。夹具使用临时目录和本地 fake-cli，结束后清理。
- 新增 `test/traceability/T-026.json`，将 AC-064 映射到两个端到端测试文件。

自测结果：

- `node --test --test-reporter=tap test/e2e/select-run.test.mjs`：退出 0，1 通过，fail/cancelled/skipped/todo 均为 0。
- `node --test --test-reporter=tap test/e2e/select-run-sequence.test.mjs`：退出 0，4 通过，fail/cancelled/skipped/todo 均为 0。
- `node scripts/check-traceability.mjs`：退出 0，`check-traceability: ok`。
- `node --test "test/unit/*.test.mjs"`：退出 0，480 通过、1 跳过、0 失败、0 取消。
- `node scripts/check-acceptance.mjs .collab/tasks/026/acceptance.md`：退出 0，1 个 AC、6 条命令，warnings=0。
- `pwsh -NoProfile -File scripts/check-fast.ps1`：未执行。完整测试链包括 `test/contract/spec-tracked.test.mjs` 中的 Git 命令，直接违反本任务禁止执行 Git 的要求；因此不能声称该门禁通过。unit 回归中的既有 `test/unit/gitignore.test.mjs` 也会间接调用 Git，这是运行后检查发现的。
