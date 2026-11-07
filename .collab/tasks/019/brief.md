# Task 019 — 模型目录：白名单、四档等级与来源、别名、弃用、能力、价格

## 目标

来自 Blueprint 任务图 T-019（M3）。交付：
- lib/catalog.mjs
- lib/commands/models/list.mjs、allow.mjs、deny.mjs、level.mjs、alias.mjs

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/catalog.mjs
  - lib/commands/models/list.mjs
  - lib/commands/models/allow.mjs
  - lib/commands/models/deny.mjs
  - lib/commands/models/level.mjs
  - lib/commands/models/alias.mjs
  - test/unit/catalog.test.mjs
  - test/unit/catalog-levels.test.mjs
  - test/traceability/T-019.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-045（levels: unit）：不在白名单的模型不出现在候选、AgentLine 视图的 rejected、探测队列和 forecast 输入中（注入计数器为 0）；管理视图中可见，标为 not_allowed。
- AC-046（levels: unit）：等级来源优先级 config > measured > cli，并记录 level_source 的 kind、ref、at；白名单中没有等级的模型以 level_unassigned 拒选；别名解析到同一个 key；弃用模型可用性为 deprecated，并以 deprecated 拒选。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-045
- node scripts/run-tests.mjs --ac AC-046

测试层级：unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
