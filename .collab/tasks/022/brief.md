# Task 022 — 选模策略与租约：计划内优先、付费兜底、用足窗口、储备、truncated、并发与幂等、AgentLine 视图（A5 无缓存）

## 目标

来自 Blueprint 任务图 T-022（M4）。交付：
- lib/policy.mjs
- lib/leases.mjs（expires_at 按位置递延，经 ctx.clock）
- lib/select.mjs（v1 编排，只读缓存）
- lib/commands/admin/select.mjs
- lib/commands/models/select.mjs（视图门控）
- test/perf/select.perf.mjs
- test/flows/steps/select.mjs（换成 v1 版）
- defects/a5-nocache 的 [fixed] 部分

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/policy.mjs
  - lib/leases.mjs
  - lib/select.mjs
  - lib/commands/admin/**
  - lib/commands/models/select.mjs
  - test/unit/select-policy.test.mjs
  - test/unit/select-reserve.test.mjs
  - test/unit/select-noexec.test.mjs
  - test/contract/selection-shape.test.mjs
  - test/contract/selection-view.test.mjs
  - test/integration/select-concurrency.test.mjs
  - test/perf/**
  - test/flows/steps/select.mjs
  - test/characterization/defects/a5-nocache.test.mjs
  - test/traceability/T-022.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-051（levels: unit）：策略金标 contracts/golden/policy/*.json 的输出顺序与 expected 深相等。P1：计划内池 A 剩余 3、1 小时后重置，计划内池 B 剩余 8、4 小时后重置，付费池 C，est=1，顺序为 A、B、C，C 标 funding paid。P2：A 剩余 0.5<est，A 以 quota_low 拒选，选中 C。P3：计划内剩余未知、策略 after_known 时排在已知可完成的之后，策略 reject 时以 quota_unknown_policy 拒选。P4：count=2 时优先选不同的 identity_group。
- AC-052（levels: unit）：储备：cap 10、reserve_fraction 0.15、remaining 2、est 1 时，normal 以 reserve_protected 拒选，high 被选中；储备比例取自配置。
- AC-053（levels: contract, unit）：可用数小于 count 时返回 ok:true、truncated:true，shortfall 等于差额。一个都没有时，按 interfaces 第 2 节规则返回 E_INSUFFICIENT_QUOTA 或 E_NO_CANDIDATE（两个夹具各对应唯一结果），retry_after 等于被额度拒选的池中最早的 reset_at。models 与 calls 一一对应且深相等。每个 handle 都满足：call 非空、callable 未过 TTL、额度通过。
- AC-054（levels: integration）：50 个进程等文件屏障打开后同时选模：每个池的有效预留之和 <= 剩余量；用相同 request_id 重放返回深相等的 handle，预留不增加；用 exclude_handles 再次申请能补足数量且不重复。全程不用 sleep。
- AC-055（levels: unit）：在 50 个白名单模型的夹具上，选模过程中注入的 exec 与 fetch 计数都为 0。defects/a5-nocache 的 [fixed] 部分通过。p95 只由 npm run perf 测量并作为报告产出，不作门禁。
- AC-056（levels: contract）：所有 contracts/examples，以及 AC-051..053 各夹具在 AgentLine 视图下的实际输出，经 lib/contract/scan.mjs 检查都是 0 命中；models select 带 view:full 返回 E_VIEW_FORBIDDEN（退出码 2）；admin select 返回含 detail 的完整视图；CLI 的 compat:draft 返回 draft 形状并带 W_DRAFT_DEPRECATED。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-051
- node scripts/run-tests.mjs --ac AC-052
- node scripts/run-tests.mjs --ac AC-053
- node scripts/run-tests.mjs --ac AC-054
- node scripts/run-tests.mjs --ac AC-055
- node scripts/run-tests.mjs --ac AC-056
- npm run perf

测试层级：contract, integration, unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
