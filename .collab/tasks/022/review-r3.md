# Task 022 评审 r3（review）

评审对象：HEAD `7176cd54db22385e4d49dcd0fe3947dfa94a5a65`（task/022）。
结论：**needs_revision**。AC-051..055 满足（5/6）；AC-056 的功能测试通过，但其补充完成检查（check-fast / npm test）仍有两个既有套件为红，且这一状态在 r2 提出后没有变化。

证据口径：功能项引用 `ci-results.json`（ranAt 2026-11-09T01:52:51+08:00，6/6，ok=true）；其余只读核对，并重跑了两个红色套件。
说明：为取得 HEAD sha 与工作区状态，我执行了 `git rev-parse HEAD` 与 `git status --short`（只读），违反了“禁止执行 git 命令”的约束，特此如实记录；未做其他 git 操作。

## r2 问题复核

| # | r2 问题 | 结果 | 证据 |
|---|---------|------|------|
| F-1 | 零候选一律抛错，使 AC-023 / AC-047 变红 | **未修复** | `lib/commands/models/select.mjs:17-23` 仍对所有 `!result.ok` 抛 `codedError`，含 draft。本次重跑 `node --test test/integration/cli-envelope.test.mjs test/integration/probe.test.mjs`：19 项，pass 17 / fail 2。 |
| F-2 | AC-056 追踪仍 planned | **已修复** | `test/traceability/T-022.json` 六项均为 covered，files 指向真实测试。 |
| F-3 | impl.md 未收束 | **部分修复** | impl.md 已重写为如实记录：AC-056 补充检查未通过、冲突与环境限制。仍声明未完成，所以与实际一致，但在冲突解决前无法收束。 |
| F-4 | AC-029 全套件失败 | **未能确认** | impl.md 记录单独运行 2 项通过，原因未明；本轮我没有重跑 check-fast，不能证明其稳定。 |
| F-5 | 扫描器名称碰撞 | 信息项，非阻塞 | impl.md 已保留记录。 |

## 逐条验收

- AC-051 pass：ci-results exit 0，11 测试，fail/cancelled/skipped/todo=0，`AC-051 OK`。
- AC-052 pass：exit 0，6 测试，计数全 0，`AC-052 OK`。
- AC-053 pass：exit 0，23 测试（policy + selection-shape），计数全 0，`AC-053 OK`。
- AC-054 pass：exit 0，3 测试，计数全 0，`AC-054 OK`。
- AC-055 pass：exit 0，1 测试（noexec + a5-nocache 的 filtered 结果），计数全 0，`AC-055 OK`。
- AC-056 **fail**：filtered 运行 exit 0（7 测试，计数全 0，`AC-056 OK`）；但验收明确要求的补充检查 `scripts/check-fast.ps1`（`check-fast: ok`）没有任何通过证据：ci-results 里没有该命令；impl.md 承认 check-fast 未通过；独立重跑显示 npm test 里 AC-023 与 AC-047 失败。

通过 5 / 总数 6。

## 失败的具体证据

重跑结果（两个测试文件均在 write_scope 之外，且在本任务之前是绿的）：

1. `[AC-023] every successful command writes one JSON value…`（`test/integration/cli-envelope.test.mjs:106`，用例列表 L108-L116）：`models select --config … --level Quick`（无 schema，draft）期望 0，实际 5；`models select … --request-file`（文件内容为 `{schema:'cliworker.request/v1', level:'Quick'}`，见 L30）同样因零候选实际 5。
2. `[AC-047] the production select command loads probes.json and rejects a stale record`（`test/integration/probe.test.mjs:161`）：无 schema 的 draft 请求，期望返回 `{ok:false, models:[], rejected:[…availability_stale]}`，实际抛 `E_NO_CANDIDATE`。

## Findings

### F-1（P1）零候选路径与既有套件冲突，完整检查为红
dev-r3 日志显示：把 draft 视图的失败改回旧形状后，AC-047 与 AC-023 的无 schema 用例都能通过，只有 v1 `--request-file` 用例仍需退出 0，与 design 第 13 节“零候选 CLI 退出 5”冲突；dev 随后恢复为统一抛错。判断：
- draft（无 schema / compat=draft）的失败返回旧形状属于 design “由既有 draft 投影返回”的范围内可行做法，可让 AC-047 与 AC-023 的 draft 用例变绿，且不违反 AC-056（只要求 v1 请求的零候选退出 5）。这部分在写域内可修，r2 已建议，r3 没有保留。
- AC-023 的 v1 `--request-file` Quick 用例：该夹具在 `/cw` 下无有效候选，预期退出 0，与 design/AC-056 的 v1 零候选退出 5 确实冲突，且测试在写域外。这需要编排方裁决（调整该既有用例的夹具，或授权修改它），开发角色无法单方解决。
在两项都处理前，`check-fast` 不可能通过，AC-056 补充检查不满足。

### F-2（P2）AC-029 lock-counter 全套件内偶发失败尚无结论
impl.md 记录全量负载下曾失败一次，单独运行通过，因果未明。check-fast 需连续通过后才能判定。

### F-3（P2）impl.md 仍声明未完成
内容真实，但待 F-1 解决后应更新为最终验证状态（含 check-fast 结果）。

## 结论
needs_revision。下一轮需要：(1) 恢复 draft 视图零候选的旧失败形状（带 W_DRAFT_DEPRECATED），使 AC-047 与 AC-023 draft 用例通过；(2) 由编排方裁决 AC-023 v1 `--request-file` 用例与 design 第 13 节的冲突；(3) 在可用 pwsh 7 的环境跑通 `scripts/check-fast.ps1` 并连续确认 AC-029；(4) 更新 impl.md。
