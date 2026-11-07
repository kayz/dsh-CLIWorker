# Task 006 — 额度池归一与预测引擎定稿（A1，纯函数，最终公式，以仓库金标为预期值）

## 目标

来自 Blueprint 任务图 T-006（M1）。交付：
- lib/pools.mjs（四种形状归一、多池、重置时间优先级）
- lib/forecast.mjs（remaining、used、分位数、阈值表、置信度、burn、eta、assumed 语义，只经 ctx.clock 取时）
- defects/a1-quota 的预测部分 [fixed]

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/pools.mjs
  - lib/forecast.mjs
  - test/unit/pools.test.mjs
  - test/unit/forecast-engine.test.mjs
  - test/unit/forecast-unknown.test.mjs
  - test/unit/reset.test.mjs
  - test/traceability/T-006.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-015（levels: unit）：额度形状金标 contracts/golden/quota-shapes.json：{remaining_pct:5} 且无容量时 remaining_fraction 0.05、remaining_mtok null、risk low_reserve、risk_basis fraction；pct 为 4 时 critical，0 时 exhausted，15 时 ok。{remaining:1, unit:credits} 无换算率时 risk unknown、reason credits_conversion_missing；remaining 为 0 时 exhausted。{remaining:1, unit:credits, credits_per_mtok:1000} 加 3 个各 0.2 Mtok 的样本、usage Normal 时 remaining_mtok 0.001、tasks_left 0、risk exhausted、basis tasks。{remaining:2000000, unit:tokens} 时 remaining_mtok 2。{remaining_usd:3} 加每任务 0.5 USD 的样本时 tasks_left 6、basis usd。实际输出与金标深相等。
- AC-016（levels: unit）：B.4.4 金标 contracts/golden/b44.json：5h 池 opus 容量 2、sonnet 容量 10；used 为 0 时剩余 2 和 10，读数 0.5 时剩余 1 和 5；账本窗口内有 sonnet 的 1,000,000 tokens 时 used 0.1，剩余 1.8 和 9；读数 0.5 之后再有 1,000,000 tokens 时剩余 0.8 和 4；窗口内有容量未知模型的行时为 unknown(ledger_capacity_unknown)；一个模型挂两个池时取最小值；输出保留 3 位小数。
- AC-017（levels: unit）：contracts/golden/forecast/*.json 的输入在伪时钟 setNow 指定的 now 下，输出与 expected 深相等，覆盖：tasks 与 fraction 两张阈值表的全部边界值；nearest-rank 分位数且 n<3 时无效；置信度的全部区间与变异系数降级；burn_mtok_per_hour、eta_exhaust_at、exhausts_before_reset；Heavy、Normal、Light 分别取 p90、p50、p25。
- AC-018（levels: unit）：unknown 语义：没有样本时 tasks_left 为 null，tasks_left_assumed 按 usage_estimate_mtok 算出，basis 为 assumed，confidence 为 none；此时有剩余比例则 risk 只取 fraction 依据，否则为 unknown；任何测试都不能从 assumed 得到 ok、critical 等 risk。既无容量也无比例时 status 与 risk 都为 unknown，reason 属于注册表枚举。
- AC-019（levels: unit）：reset_at 按 cli > config > estimated（滚动窗口为最早样本 + 窗口长度）> unknown 取值并标注 reset_source。同一测试内用伪时钟 setNow 先置于 reset_at 前 1 秒，断言 used_fraction 保持；再 advance 2 秒，断言 used_fraction 归零。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-015
- node scripts/run-tests.mjs --ac AC-016
- node scripts/run-tests.mjs --ac AC-017
- node scripts/run-tests.mjs --ac AC-018
- node scripts/run-tests.mjs --ac AC-019

测试层级：unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
