# Task 022 评审 r2（review）

评审对象：HEAD `f92a35664fb1a53c4b107f002609aa6acc94913a`（task/022）。
结论：**needs_revision**。AC-051..055 满足（5/6）；AC-056 的功能测试已补齐，但其补充完成检查（check-fast）仍为红，另有追踪状态与 impl.md 未收束。

证据口径：功能项引用 `ci-results.json`（ranAt 2026-11-09T01:47:49+08:00，6/6，ok=true）；其余用只读方式独立运行/读文件核对。

## r1 五项问题的复核

| # | r1 问题 | 结果 | 证据 |
|---|---------|------|------|
| 1 | AC-056 测试覆盖不足 | **已修复** | `test/contract/selection-view.test.mjs` 现 220 行、7 个测试：L72 真实 CLI（full 门控 exit 2 且无 leases.json、truncated、admin detail、draft、legacy、密钥哨兵、递归扫 state）；L102 静态 AgentLine 示例带 wrapper 扫描；L117 六个策略金标逐例驱动真实 CLI 并 scanView，p1 另跑 admin 断言 `detail.funding==='paid'`；L153 两个零候选 CLI 均 exit 5 且错误码唯一；L177 request/model/pool 示例驱动真实 CLI；L206 示例 schema 校验；L219 select 流程步骤。 |
| 2 | 追踪分片 planned | **部分修复** | `test/traceability/T-022.json`：AC-054、AC-055 已 covered；**AC-056 仍为 `planned`**（行 9）。验收要求 covered。 |
| 3 | AC-023 回归 | **未修复，且发现第二个同源回归** | 见 F-1。 |
| 4 | impl.md 未收束 | **未修复** | impl.md 第 3 行仍写“本次工作尚未完成，不能作为 T-022 验收通过的依据”，末段仍写“不能声称 check-fast: ok”“仍需覆盖 AC-056…”，与最新代码状态不一致。 |
| 5 | AC-054 稳定性证据 | **已满足** | 本次独立连续运行 `node --test test/integration/select-concurrency.test.mjs` 3 次，均 `pass 3 / fail 0`；impl.md 另记连续 4 次通过；dev-r2 日志中亦有通过记录。 |

## 逐条验收

- AC-051 pass：ci-results exit 0，11 测试，fail/cancelled/skipped/todo=0，`AC-051 OK`。
- AC-052 pass：exit 0，6 测试，计数全 0，`AC-052 OK`。
- AC-053 pass：exit 0，计数全 0，`AC-053 OK`。
- AC-054 pass：exit 0，3 测试（50 进程/到期/损坏状态），`AC-054 OK`；测试中无 sleep；本次另跑 3 次均通过。
- AC-055 pass：exit 0，noexec + a5-nocache 通过；perf 输出含 `models=50 warmup=5 samples=30 p95=… ms`。
- AC-056 **fail**：filtered 运行 exit 0（ci-results），但验收中“补充检查”`check-fast` 不通过，且追踪分片仍 planned。

通过 5 / 总数 6。

## 独立核对结果

- `node --test "test/unit/*.test.mjs"`：471 测试，pass 471，fail 0。
- `node scripts/check-traceability.mjs`：`ok (covered=55 planned=20)`（AC-056 仍计入 planned）。
- `node scripts/check-fast.mjs`：**FAILED step npm test (exit 1)**，三个失败：
  1. `[AC-023] every successful command writes one JSON value…`（`test/integration/cli-envelope.test.mjs:106`）：`models select --config /cw/config.json --level Quick` 期望 0，实际 5。
  2. `[AC-047] the production select command loads probes.json and rejects a stale record`（`test/integration/probe.test.mjs:161`）：期望命令返回 `{ok:false, models:[], rejected:[…availability_stale]}`，实际抛 `E_NO_CANDIDATE`。**这是 r1 与 impl.md 都未提及的新回归**。
  3. `[AC-029] lock-counter: five processes increment one counter under the lock`：全量并行时失败；单独运行 `store-concurrency.test.mjs` 为 pass 2 / fail 0，疑为负载下的偶发（Windows 锁文件 EPERM 类），需确认并发测试加的重试是否影响，或另行记录。
- `ci-results.json` 只有 6 条 AC 命令，没有 check-fast 结果，故补充检查无编排方证据，以上独立运行为准。

## Findings

### F-1（P1）零候选改为抛错使两个既有套件变红，check-fast 不过
`lib/commands/models/select.mjs:20-25` 对所有 `!result.ok` 一律 `throw codedError`，包括 draft（`--level Quick` 旧式调用）。结果：`cli-envelope.test.mjs` 的 [AC-023] 第一个用例（`--level Quick`，无缓存）与 `probe.test.mjs` 的 [AC-047] 同时失败。AC-056 只要求 **v1 请求** 的零候选 CLI 退出 5；`gated.view === 'draft'`（无 schema/legacy 扁平请求）的失败路径并未被要求改为抛错。可行方案（写域内）：draft 视图失败时仍返回旧版失败形状（`ok:false, models:[], rejected:[…]`，退出 0，并带 W_DRAFT_DEPRECATED），v1 视图保持抛 E_NO_CANDIDATE / E_INSUFFICIENT_QUOTA。需确认 AC-023 第二个用例（`--request-file`，schema v1，Quick）是否因同样无候选而失败——若失败，则属规格与既有测试的真实冲突，须由编排方调整规格或放行对该测试的修改，不能让套件保持红色。impl.md 把冲突归因于“写域外测试”，但并未尝试 draft 路径的兼容方案。

### F-2（P1）AC-056 追踪状态仍为 planned
`test/traceability/T-022.json`：AC-056 `status: "planned"`。相应真实测试已存在且通过，应改为 covered（check-fast 通过后）。

### F-3（P2）impl.md 与最终状态不一致
impl.md 仍声明“尚未完成”“AC-054 不稳定”“check-pack 失败”等，且未记录最终验证结果（单元 471 通过、六条 AC 通过、AC-054 重复运行、剩余的三个全套件失败）。应更新为最终已验证状态。

### F-4（P2）AC-029 lock-counter 全套件内失败
check-fast 全量运行中失败一次，单独运行通过。需判断是否为本任务对锁/重试改动引入或仅为并行负载下偶发，并在 impl.md 如实记录；`check-fast` 需连续通过。

### F-5（P2，信息）扫描器与真实模型名碰撞
impl.md 记录：假模型名 `unknown` 与注册原因 `quota_unknown_policy` 触发扫描器命中，已改夹具名绕过。扫描器在写域外，边界风险已知；建议在 impl.md 保留并交由后续任务处理。非阻塞。

## 结论
needs_revision。修复 F-1（并使 check-fast 全绿）、F-2、F-3，澄清 F-4 后再提交 r3。
