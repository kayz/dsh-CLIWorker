# Task 011 — 状态存储、文件锁（伪时钟可测）、审计日志与脱敏

## 目标

来自 Blueprint 任务图 T-011（M2）。交付：
- lib/store.mjs（原子写、JSONL 追加）
- lib/lock.mjs（等锁循环经 ctx.clock.sleep）
- lib/audit.mjs
- lib/redact.mjs

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/store.mjs
  - lib/lock.mjs
  - lib/audit.mjs
  - lib/redact.mjs
  - test/unit/store.test.mjs
  - test/unit/lock.test.mjs
  - test/unit/redact.test.mjs
  - test/unit/audit.test.mjs
  - test/integration/store-concurrency.test.mjs
  - test/fixtures/store/**
  - test/traceability/T-011.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-029（levels: integration, unit）：20 个进程各追加 50 行后，1000 行全部可解析且 id 唯一。ctx.fs 在改名前抛错时原文件字节不变。伪时钟下：持有 pid 已死的锁立即被回收；活锁在 advance 超过 lock_stale_ms 后被回收；活锁且未陈旧时，等锁循环在虚拟耗时达到 lock_wait_ms 后返回 E_STATE_LOCKED，重试次数等于 ceil(lock_wait_ms/lock_poll_ms)。不使用 sleep。
- AC-030（levels: unit）：redact 对 sk- 前缀、Bearer、三段 base64url 形状的 JWT、已登记的密钥值（包括嵌套对象和 error.message 里的）全部打码。audit.jsonl 每行有 at、entry（cli 或 http）、action、result；select、lease、run、probe、白名单与等级变更、密钥设置各写一行；用 leak-scan 检查不含已登记的密钥。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-029
- node scripts/run-tests.mjs --ac AC-030

测试层级：integration, unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
