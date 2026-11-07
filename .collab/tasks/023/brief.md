# Task 023 — 执行器 run --lease：注入令牌、归一事件、前后记账、幂等、超时、失败回写、配置核对

## 目标

来自 Blueprint 任务图 T-023（M4）。交付：
- lib/runner.mjs
- lib/events.mjs
- lib/commands/run.mjs
- test/flows/steps/run.mjs

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/runner.mjs
  - lib/events.mjs
  - lib/commands/run.mjs
  - test/integration/runner.test.mjs
  - test/integration/runner-errors.test.mjs
  - test/flows/steps/run.mjs
  - test/traceability/T-023.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-057（levels: integration）：run --lease 的 stdout 每行都通过 event/v1 校验，最后一行是带 usage 的 result；账本有 <lease>:pre 和 <lease>:post 两行并带池读数；stdin 透传给 fake-cli，fake-cli 记录的 cwd 等于 handle 的 cwd。
- AC-058（levels: integration）：已成功的租约再次 run 返回 E_LEASE_CONSUMED、退出码 6，账本行数不变。fake-cli 为 auth 或 quota 模式时返回 E_PROVIDER_AUTH 或 E_PROVIDER_QUOTA，可用性置为 blocked，下一次选模以 availability_blocked 拒选。timeout 模式时整棵进程树被杀并返回 E_TIMEOUT。伪时钟 setNow 越过 expires_at 后，未开始的租约返回 E_LEASE_EXPIRED。--config 与租约记录的配置摘要不一致时返回 E_LEASE_CONFIG_MISMATCH。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-057
- node scripts/run-tests.mjs --ac AC-058
- node scripts/milestone-gate.mjs --milestone M4

测试层级：integration

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
