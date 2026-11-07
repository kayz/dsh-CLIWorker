# Task 004 评审（review）

## 结论：pass（52/52）

- 验证的 git sha：`7681dc6e4a2b4803cd2ed30102dad09957920a63`（分支 task/004）。
- 执行证据：`.collab/tasks/004/ci-results.json`（passed=52，total=52，ok=true）。52 条结果均 `exitCode=0` 且输出含对应 `AC-xxx OK`。按执行证据口径直接引用，未重跑。
- 通过数/总数：AC-009 10/10，AC-010 6/6，AC-011 5/5，AC-073 31/31。

## 独立只读核对

| 项 | 核对内容 | 结果 |
|---|---|---|
| 注册表 | `contracts/registry.snapshot.json` 的 30 个码与 design §3.3 表逐项比对（exit、http_status、retryable、trigger_id）；顶层键序与 §3.2 一致 | 一致 |
| 冻结规则 | `lib/contract/registry.mjs:434-533` 的 `compareRegistry`、`checkFrozen` 与 §3.5 一致；`decideGate`（:537-557）与 §3.4 一致 | 一致 |
| snapshot-update | `scripts/snapshot-update.mjs:88-134` 的状态机、首行文案、退出码与 §3.7 表逐行一致 | 一致 |
| 校验器 | `lib/contract/validate.mjs` 只支持规定关键字，其余抛 `TypeError`；深度上限 64；错误路径约定与 §4 一致 | 一致 |
| 视图扫描器 | `lib/contract/scan.mjs`：显式栈遍历（无递归）、键小写精确匹配、整词匹配、`call` 子树不做值扫描并逐项比对模板、顶层 `calls` 取 `models[i].lease_id` | 与 §8.1 一致 |
| resolveView | `lib/contract/views.mjs` 优先级 full > draft > agentline，cli 与 http 分支与 §8.2 一致 | 一致 |
| 纯度 | 只有 `registry.mjs` 零 import；其余无 `node:`、时钟、定时器、`process.env` | 满足 |
| 金标清单 | 重算 14 个文件的 CRLF 归一化 SHA-256，mismatch=0；`contracts/spec/**` 与 `contracts/golden/**` 无未登记或缺失文件；不含 manifest 自身与 `registry.snapshot.json` | 满足 |
| 金标手算抽查 | `b44-ledger-sonnet-1m`（O 1.8/S 9）、`b44-reading-then-1m`（O 0.8/S 4）、`cap-k10-high`（2.5M/0.3125=8） | 一致 |
| 无 `.collab` 引用 | 104 个本任务文本文件中，除违规夹具外 0 处该字面量 | 满足 |
| 编码 | 新增文件均为 LF、无 BOM、末尾有换行。`contracts/spec/ac-index.json` 是 T-001 的既有文件，含 CR，哈希已归一化，不算问题 | 满足 |

## Findings

无。

## 备注（非缺陷）

- `impl.md` §2 说明：dev 按用户三次 note（`inputs.jsonl`）把 `acceptance.md` 重写为 runner 契约格式。仓库内实现产物本轮零改动。该改动由用户指令驱动，且 CI 已能提取全部 52 条命令，因此不作为扣分项。
- `node scripts/milestone-gate.mjs --milestone M1` 因其它任务的 AC 未覆盖仍会 BLOCKED，`acceptance.md` 已声明不属于本任务。
- brief.md 未指定验收报告路径，无追加目标。
