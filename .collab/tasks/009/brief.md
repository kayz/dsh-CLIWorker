# Task 009 — 打包清单与 bin 入口（A2），规格与金标不进包

## 目标

来自 Blueprint 任务图 T-009（M1）。交付：
- package.json 的 bin 与 files（contracts 白名单子路径）
- dsh.plugin.json 版本对齐
- scripts/check-pack.mjs
- defects/a2-pack 的 [fixed] 部分

## 约束

- 只允许写入以下路径（write_scope）：
  - package.json
  - dsh.plugin.json
  - scripts/check-pack.mjs
  - test/integration/pack.test.mjs
  - test/characterization/defects/a2-pack.test.mjs
  - test/traceability/T-009.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-025（levels: integration）：check-pack 解析 npm pack --dry-run --json：包含 bin/cliworker.mjs、config/cliworker.example.json、lib 下文件、contracts/registry.snapshot.json、contracts/schemas、contracts/host、contracts/context、contracts/agentline-forbidden.json；package.json 的 bin.cliworker 为 bin/cliworker.mjs；不含 config/*.local.json、state/、*.jsonl、test/、scripts/、.collab/、contracts/golden、contracts/spec；dsh.plugin.json 的 version 与 package.json 一致。defects/a2-pack 的 [fixed] 部分通过。

任务图给的验收方向：
- node scripts/check-pack.mjs
- node scripts/run-tests.mjs --ac AC-025
- node scripts/milestone-gate.mjs --milestone M1

测试层级：integration

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
