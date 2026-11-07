# Task 002 — 特征化：0.1 副本冻结、保留面测试、缺陷账本与 repro 档案

## 目标

来自 Blueprint 任务图 T-002（M1）。交付：
- test/fixtures/characterization/v0.1/**（逐字节副本）
- test/characterization/stable.test.mjs（只 import 副本）
- test/characterization/defects.json（11 条，含 owner_task、owner_milestone）
- test/characterization/defects/<id>.test.mjs 的 [repro] 部分
- test/characterization/frozen-files.json
- scripts/check-frozen-files.mjs

## 约束

- 只允许写入以下路径（write_scope）：
  - test/fixtures/characterization/**
  - test/characterization/stable.test.mjs
  - test/characterization/defects.json
  - test/characterization/frozen-files.json
  - test/characterization/defects/a1-quota.test.mjs
  - test/characterization/defects/a2-pack.test.mjs
  - test/characterization/defects/a4-paths.test.mjs
  - test/characterization/defects/a4-null-config.test.mjs
  - test/characterization/defects/a5-dup-call.test.mjs
  - test/characterization/defects/a5-forecast-x3.test.mjs
  - test/characterization/defects/a5-unused.test.mjs
  - test/characterization/defects/a5-shell.test.mjs
  - test/characterization/defects/a5-nocache.test.mjs
  - test/characterization/defects/a5-ignored-fields.test.mjs
  - test/unit/frozen-files.test.mjs
  - scripts/check-frozen-files.mjs
  - test/traceability/T-002.json
  - scripts/check-defects.mjs
  - test/characterization/canary/**
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-005（levels: unit）：特征化与冻结口径（与 Q-3 对齐）：test/fixtures/characterization/v0.1/ 是提交 f75bb76 的 lib 与 example 的逐字节副本；stable.test.mjs 只 import 该副本，锁定 contracts/spec/surfaces.json 列出的保留面（弃用与未验证不入候选、等级过滤、exclude 原因、四个 schema 名）。frozen-files.json 的允许集合恰为：v0.1 副本文件、stable.test.mjs、contracts/spec/**、contracts/golden/** 的 sha256；出现集合外的路径（含 lib/、bin/、config/、scripts/）即失败，且 lib/、bin/、config/ 明列为禁止登记路径。check-frozen-files 在任一登记文件哈希变化时失败，并由 check-fast 执行。defects.json 登记 11 条缺陷及 owner_task、owner_milestone，以及每条 [repro] 段的 sha256；[repro] 与 [fixed] 段落分离。每条缺陷必须有变异 canary：check-defects 用「已修复的 v0.1 变体」跑该缺陷的 repro，必须失败；若 canary 通过（说明 repro 恒真或已失效）则 check-defects 失败，不得静默通过。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-005
- node scripts/check-frozen-files.mjs
- node scripts/check-defects.mjs

测试层级：unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
