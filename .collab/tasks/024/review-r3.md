# Task 024 评审 r3

评审基准 commit：`030fec15758e3182e9b8d26502eb158f236c82f0`（读自 `.git/worktrees/024/HEAD` → `refs/heads/task/024`；未执行 git 命令；工作区另有 `.collab/tasks/024/*` 未提交改动，不影响代码）。

## 结论：needs_revision（通过 0/3）

r2 的三类缺口有明显进展：AC-059 补了 full/draft 有效会话、session 响应 schema/到期、registry 与 envelope 对照、管理读矩阵；AC-060 补了逐写路由的无效/过期会话、csrf 不匹配、超限体；AC-061 补了配置、密钥、目录不可写、活跃锁、探测 TTL 边界、清单/探测缓存损坏、注册失败对照。`ci-results.json`（ran 2026-11-09T03:18:47，3/3，退出 0）显示 AC-059 12 项、AC-060 7 项、AC-061 11 项全通过，fail/cancelled/skipped/todo 均为 0。

但 r2 的 P1-1 未修，且 AC-061 矩阵与 CI 证据仍有缺口，故不能判 pass。

## r2 问题复核

| r2 项 | 状态 | 证据 |
|---|---|---|
| P1-1 五个写路由 E_INTERNAL | **未修复** | `lib/index.js:101` 仍 `return sendError(res, 'E_INTERNAL')`；`lib/index.js:70-96` 只有 pool、manual-model、allow/deny/level/alias 分支，无 discover、enumerate、probe、read-usage、secret。`impl.md` 末段自认“仍未接入生产业务分发” |
| P1-2 AC-061 故障矩阵 | 部分修复 | 见下 P1-2 |
| P1-3 AC-059 细则 | 基本修复 | `plugin-routes.test.mjs` 现有 #4 full/draft 200、#5 registry+envelope、#6 管理读矩阵；`plugin-session.test.mjs` #9 HTTP session schema/到期（CI 第 4/5/6/9 项通过） |
| P2-1 traceability planned | **未修复** | `test/traceability/T-024.json:5-7` 三项仍 `planned`；`impl.md` 自认“三项 AC 仍保持 planned” |
| P2-2 unit 回归/check-fast 无证据 | **未修复** | `ci-results.json` total=3，只含各 AC 首条命令；`impl.md` 自认未运行 unit 全量与 check-fast |

## Findings

### P1-1 discover/enumerate/probe/read-usage/secret 五个管理写路由守卫通过后仍返回 E_INTERNAL（连续第 3 轮）
- 证据：`lib/index.js:101`。生产环境不注入 `deps.handlers`，合法 `POST /cliworker/api/discover` 等得 500 E_INTERNAL。design.md:42 要求“已有目录、池、密钥操作复用现有命令/领域函数”，且 design 的缺口披露只列 snapshot/jobs（T-025），并未把这五个写路由列为范围外。
- 要求：接入对应既有命令/领域函数（含参数校验）；或在 design 变更中如实列为范围外缺口。不能把“合法请求返回内部错误”留作默认行为。

### P1-2 AC-061 故障矩阵仍缺项，HTTP/doctor 一致性仅覆盖少数组
- acceptance.md:74 要求每个单独故障下 doctor 退出 9 且唯一 E_HEALTH_DEGRADED、health 503，并且多故障同时报告。已有：unit 级别配置/密钥/不可写/锁/TTL（`test/unit/health.test.mjs` 6 项）；integration 仅健康、配置缺失、test_clock 非法内容、注册失败对照（`test/integration/health.test.mjs` 5 项）。
- 仍缺：CLIWORKER_TEST_CLOCK_FILE 指向**合法文件**与**不可读文件**（`unit/health.test.mjs:18` 仍用假路径 `secret-path`；integration 仅非法内容）；清单“无效时间”；inject 失败注入；多故障组同时报告并经真实 doctor 退出 9；密钥后端/目录不可写/锁超时/示例/内联秘密在 doctor（CLI）侧的退出 9 + HTTP 503 对照；doctor 故障输出对 `error-envelope.schema.json` 的校验；HTTP 与 doctor 在这些故障组下逐项相等（acceptance.md:75，仅覆盖健康、配置缺失、注册失败）。

### P2-1 T-024.json 三项仍为 planned
- `test/traceability/T-024.json:5-7`。三个 AC 均已有 `[AC-0xx]` 标签测试；planned 时 `check-traceability` 不核对文件与标签，应在上述缺口补齐后改为 `covered`。

### P2-2 unit 回归与 check-fast 无执行证据，无法确认
- acceptance.md 中 `node --test "test/unit/*.test.mjs"`、`check-acceptance`、`scripts/check-fast.ps1` 三条 AC-061 命令在 `ci-results.json` 无记录。unit 测试含间接 git 调用，评审不得执行。请编排方在 CI 中补跑；此项标为“无法确认”，不单独作为 needs_revision 理由，但 AC-061 在补齐前不能判通过。

## 逐条核对

| 验收项 | 结论 | 证据 |
|---|---|---|
| AC-059 | 未通过（仅余 P1-1 的写路由业务缺口，其余已基本满足） | 首条命令退出 0，12/12 通过，计数器全 0；细则项大多有实际断言 |
| AC-060 | 未通过 | 首条命令退出 0，7/7；flows 与首写真实目录变化已证；五个写路由合法请求 500（P1-1），逐端点“合法请求进入业务层”对这五个无法成立 |
| AC-061 | 未通过 | 首条命令退出 0，11/11；矩阵缺项（P1-2）；其余三条命令无 CI 证据（P2-2）；traceability 仍 planned（P2-1） |

通过数/总数：0/3。
