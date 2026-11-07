# Task 005 — 路径统一与配置健壮性：resolvePaths、state_dir、.gitignore（含 .collab/）、示例识别、null 配置（A4）

## 目标

来自 Blueprint 任务图 T-005（M1）。交付：
- lib/paths.mjs
- lib/config.mjs（所有错误补 E_CONFIG，_example 与深相等识别）
- lib/commands/paths.mjs、init.mjs
- .gitignore 通配规则
- example 带 _example、schema 与 credits_per_mtok
- defects/a4-paths 与 a4-null-config 的 [fixed] 部分

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/paths.mjs
  - lib/config.mjs
  - lib/index.js
  - lib/commands/paths.mjs
  - lib/commands/init.mjs
  - lib/commands/usage/**
  - .gitignore
  - config/cliworker.example.json
  - test/unit/paths.test.mjs
  - test/unit/config.test.mjs
  - test/unit/gitignore.test.mjs
  - test/integration/paths-entries.test.mjs
  - test/characterization/defects/a4-paths.test.mjs
  - test/characterization/defects/a4-null-config.test.mjs
  - test/traceability/T-005.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-012（levels: integration, unit）：resolvePaths 规则按 interfaces 第 11 节。cliworker paths --config X 与 createPlugin 使用 configPath X 时，报告完全相同的 config 绝对路径和 state_dir；两份不同的配置得到不相交的 state_dir；usage 写到该 state_dir；存在旧的 ~/.cliworker/usage.jsonl 时，doctor 给出 W_LEGACY_USAGE。defects/a4-paths 的 [fixed] 部分通过。
- AC-013（levels: unit）：git check-ignore -v 命中 config/a.local.json、state/x、a.jsonl、.collab/x，不命中 config/cliworker.example.json。加载带 _example:true 的配置返回 E_CONFIG_EXAMPLE、退出码 3；加载重新缩进过的 example 副本（无该标记）同样返回 E_CONFIG_EXAMPLE。init 遇到已存在的目标文件时返回 E_CONFIG_EXISTS，且文件不变。
- AC-014（levels: unit）：配置根为 null、[]、42、非 JSON，或缺 providers、缺 models 时，CLI 输出 ok:false、error.code 为 E_CONFIG、退出码 3，message 含配置文件绝对路径和原因；stderr 中没有 TypeError。defects/a4-null-config 的 [fixed] 部分通过。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-012
- node scripts/run-tests.mjs --ac AC-013
- node scripts/run-tests.mjs --ac AC-014
- node bin/cliworker.mjs paths --config config/cliworker.example.json

测试层级：integration, unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
