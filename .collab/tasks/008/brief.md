# Task 008 — CLI 统一 JSON 错误体、退出码与请求解析（A5 被忽略字段），修正 README 示例

## 目标

来自 Blueprint 任务图 T-008（M1）。交付：
- lib/output.mjs（错误体与退出码映射）
- lib/request.mjs（request/v1 解析、警告、view 门控）
- lib/commands/models/select.mjs
- README.md 示例修正
- defects/a5-ignored-fields 的 [fixed] 部分

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/cli.mjs
  - lib/output.mjs
  - lib/request.mjs
  - lib/commands/models/select.mjs
  - README.md
  - test/integration/cli-envelope.test.mjs
  - test/unit/request.test.mjs
  - test/characterization/defects/a5-ignored-fields.test.mjs
  - test/traceability/T-008.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-023（levels: integration）：除 run 外，每个 CLI 命令的完整 stdout 都能被 JSON.parse 解析为单个值。表驱动覆盖 CLI 可触发的注册表错误码（E_REQUEST_INVALID、E_LEVEL_REQUIRED、E_LEVEL_UNKNOWN、E_UNKNOWN_COMMAND、E_CONFIG、E_CONFIG_EXAMPLE、E_VIEW_FORBIDDEN），每个都是 ok:false、对应 error.code、注册表规定的退出码。
- AC-024（levels: unit）：请求解析：--request、--request-file、--level/--count/--usage/--importance/--request-id 三种写法得到等价的请求；role 产生 W_FIELD_IGNORED 且 field 为 role；tier 产生 W_FIELD_DEPRECATED；importance 非法时返回 E_REQUEST_INVALID。README 中所有请求示例交给解析器后 warnings 都为空。defects/a5-ignored-fields 的 [fixed] 部分通过。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-023
- node scripts/run-tests.mjs --ac AC-024
- node bin/cliworker.mjs models select --level Top --count 1

测试层级：integration, unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
