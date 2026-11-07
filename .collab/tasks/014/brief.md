# Task 014 — 配置 v2 与 v1 迁移（按仓库内迁移映射，quotas 映射为 pools）

## 目标

来自 Blueprint 任务图 T-014（M2）。交付：
- lib/config-migrate.mjs
- lib/commands/config/**
- test/fixtures/config/**

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/config.mjs
  - lib/config-migrate.mjs
  - lib/commands/config/**
  - test/unit/config-v2.test.mjs
  - test/fixtures/config/**
  - test/traceability/T-014.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-034（levels: unit）：无 schema 和 schema 为 v1 的配置都在内存中迁移为 v2，并给 W_CONFIG_V1。config migrate 生成的 v2 文件按 contracts/spec/migration-map.json：models 转为 catalog.manual、allow 和 levels（level_source 为 config）；quotas 映射为 pools；providers 转为 cli_overrides。同一夹具迁移前后，在注入可用性的情况下 draft 选模结果深相等。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-034
- node bin/cliworker.mjs config migrate --in test/fixtures/config/v1.json --out <临时文件>
- node scripts/milestone-gate.mjs --milestone M2

测试层级：unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
