# Task 007 — 选模卫生与 draft 兼容：去掉重复 cli、forecast 记忆化、Heavy 拒选、check-unused（A1、A5）

## 目标

来自 Blueprint 任务图 T-007（M1）。交付：
- lib/select.mjs（按模型记忆化，forecast 经 ctx 调用）
- lib/select-draft.mjs（draft 视图与 Heavy 拒选）
- scripts/check-unused.mjs 及自测夹具
- defects/a5-dup-call、a5-forecast-x3、a5-unused 的 [fixed] 部分，a1-quota 的 draft 部分 [fixed]

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/select.mjs
  - lib/select-draft.mjs
  - scripts/check-unused.mjs
  - test/fixtures/unused/**
  - test/unit/select-draft.test.mjs
  - test/unit/check-unused.test.mjs
  - test/characterization/defects/a5-dup-call.test.mjs
  - test/characterization/defects/a5-forecast-x3.test.mjs
  - test/characterization/defects/a5-unused.test.mjs
  - test/traceability/T-007.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-020（levels: unit）：draft handle 只有 call，没有 cli 键。在 12 个模型的夹具上，注入的 forecast 计数器（统计调用次数）等于通过前置过滤的模型数，与排序比较器的调用次数无关。defects/a5-dup-call 与 a5-forecast-x3 的 [fixed] 部分通过。
- AC-021（levels: unit）：draft 视图在 usage 为 Heavy 时，用 AC-015 的金标输入，risk 为 exhausted、critical 或 low_reserve 的模型全部进入 rejected，原因为 E_FORECAST_EXHAUSTION；Normal 和 Light 不因此拒选。只断言拒选集合与原因，不断言排序。defects/a1-quota 的 [fixed] 部分通过。
- AC-022（levels: unit）：check-unused 对 lib 报告 0 个未使用的导入和顶层函数；对 test/fixtures/unused 恰好报告其中声明的未使用导入和未使用函数。defects/a5-unused 的 [fixed] 部分通过。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-020
- node scripts/run-tests.mjs --ac AC-021
- node scripts/check-unused.mjs

测试层级：unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
