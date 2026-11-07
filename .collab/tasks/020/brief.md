# Task 020 — 小 token 真实探测与可用性状态机（TTL 经 ctx.clock，探测消耗入账）

## 目标

来自 Blueprint 任务图 T-020（M3）。交付：
- lib/probe.mjs
- lib/availability.mjs（状态机与缓存）
- lib/commands/models/probe.mjs
- test/flows/steps/probe.mjs

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/probe.mjs
  - lib/availability.mjs
  - lib/commands/models/probe.mjs
  - test/integration/probe.test.mjs
  - test/integration/probe-ledger.test.mjs
  - test/flows/steps/probe.mjs
  - test/traceability/T-020.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-047（levels: integration）：fake-cli 各模式的探测结果：ok 为 callable，auth 为 blocked(auth)，quota 为 blocked(quota)，timeout 与 enoent 为 unavailable，deprecated 为 deprecated，mismatch 为 identity mismatch 且 blocked。只有 timeout 时 exec 计数为 2，其他都为 1。evidence 字段齐全并带 nonce_ok。伪时钟 advance 超过 probe_ttl_s 后，该 callable 在选模时以 availability_stale 拒选。
- AC-048（levels: integration）：只有白名单模型被探测；每次探测写一行 kind 为 probe、幂等键为 probe:<probe_id> 的用量记录，并计入所属池的 used；同一次探测重放不会重复计入。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-047
- node scripts/run-tests.mjs --ac AC-048
- node scripts/milestone-gate.mjs --milestone M3

测试层级：integration

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
