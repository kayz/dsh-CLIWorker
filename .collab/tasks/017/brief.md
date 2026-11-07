# Task 017 — 按 CLI 分别实现模型枚举，失败时回退到手工补录，禁止写死模型表

## 目标

来自 Blueprint 任务图 T-017（M3）。交付：
- lib/models/**（每个 CLI 一个枚举器，另有 normalize）
- lib/commands/models/enumerate.mjs、add.mjs
- scripts/check-no-model-table.mjs
- test/flows/steps/enumerate.mjs

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/models/**
  - lib/commands/models/enumerate.mjs
  - lib/commands/models/add.mjs
  - scripts/check-no-model-table.mjs
  - test/unit/enumerators.test.mjs
  - test/unit/check-no-model-table.test.mjs
  - test/fixtures/enumerators/**
  - test/fixtures/model-table/**
  - test/flows/steps/enumerate.mjs
  - test/traceability/T-017.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-041（levels: unit）：每个已知 CLI 的枚举器至少有一种策略（子命令、--help、缓存、API）的夹具测试；所有策略都失败时回退为 source.kind manual，并给 W_MODELS_MANUAL_REQUIRED；models add 录入后可以列出；归一字段 id、cli、vendor、capabilities、source.kind、source.at 齐全。
- AC-042（levels: unit）：check-no-model-table 对 lib 报告 0 个模型 id 字面量表，对 test/fixtures/model-table 下的违规样例报出。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-041
- node scripts/check-no-model-table.mjs

测试层级：unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
