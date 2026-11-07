# Task 012 — 泄露检查共享 harness 与全流程测试框架（自动发现步骤，带 canary）

## 目标

来自 Blueprint 任务图 T-012（M2）。交付：
- test/helpers/leak-scan.mjs
- test/helpers/flow.mjs
- test/flows/flow.test.mjs
- test/flows/steps/select.mjs、doctor.mjs（最小版）
- test/unit/leak-scan-canary.test.mjs

## 约束

- 只允许写入以下路径（write_scope）：
  - test/helpers/leak-scan.mjs
  - test/helpers/flow.mjs
  - test/flows/flow.test.mjs
  - test/flows/steps/select.mjs
  - test/flows/steps/doctor.mjs
  - test/unit/leak-scan-canary.test.mjs
  - test/traceability/T-012.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-031（levels: integration, unit）：leak-scan 的 canary 测试：把哨兵分别放进 stdout、stderr、state_dir 下深层文件、audit、HTTP 响应体、子进程 argv，每处都被检出并报告位置；干净运行 0 命中。flows 测试自动发现 test/flows/steps/*.mjs，在同一个临时 state_dir 中用 env 提供哨兵，依次运行全部已有步骤。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-031
- node --test test/flows/flow.test.mjs

测试层级：integration, unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
