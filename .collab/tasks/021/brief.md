# Task 021 — 用量账本、CLI 额度读数、容量学习（只提供数据，不改预测公式）

## 目标

来自 Blueprint 任务图 T-021（M4）。交付：
- lib/usage.mjs（幂等账本）
- lib/usage-readers/**（codex、claude 等）
- lib/capacity.mjs
- lib/commands/usage/**、pools/**、models/forecast.mjs

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/usage.mjs
  - lib/usage-readers/**
  - lib/capacity.mjs
  - lib/commands/usage/**
  - lib/commands/pools/**
  - lib/commands/models/forecast.mjs
  - test/unit/usage-ledger.test.mjs
  - test/unit/usage-readers.test.mjs
  - test/unit/capacity.test.mjs
  - test/fixtures/usage/**
  - test/traceability/T-021.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-049（levels: unit）：同一 idempotency_key 写入两次返回同一个 id，读取只计一次。codex 会话文件夹具和 claude 事件夹具解析出 {used_fraction, reset_at, source:cli, at}；伪时钟 advance 超过 reading_ttl_s 后读数视为过期，forecast 改用账本计算并给 W_STALE_DATA。
- AC-050（levels: unit）：容量学习金标 contracts/golden/capacity.json：Δfraction<0.01 的读数对被丢弃；cap=sum(tokens)/sum(Δfraction)/1e6；k 为 2、3、10 时置信度分别为 low、medium、high；source 为 measured；输出与 expected 深相等。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-049
- node scripts/run-tests.mjs --ac AC-050

测试层级：unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
