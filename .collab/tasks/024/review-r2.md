# Task 024 评审 r2

评审基准 commit：`4a8937ff188d36a15ce2a76a0ea98b7bbbf94df8`（task/024 的 ref 值，读自 `.git/refs/heads/task/024`；工作区另有 `.collab/tasks/024/*` 未提交改动，不影响代码）。

## 结论：needs_revision（通过 0/3）

r1 的 4 个 P0 已修复：T-024.json、http-select、http-admin、完整版 doctor 步骤都已存在。代码层面仍有三类缺口，使 acceptance.md 的细则没有被证实。CI（`ci-results.json`）AC-059/060/061 首条命令全部退出 0（8/6/7 项通过，fail/cancelled/skipped/todo 均为 0），这是有效运行证据，但 `total: 3`，只覆盖每个 AC 的第一条命令。

## r1 问题修复情况

| r1 项 | 状态 | 证据 |
|---|---|---|
| T-024.json | 已创建，但三项仍是 `planned` | `test/traceability/T-024.json:5-7`；本轮 `node scripts/check-traceability.mjs` 退出 0（covered=58 planned=17） |
| http-select / http-admin | 已创建且被 plugin-guard 实际执行 | `test/flows/steps/http-select.mjs`（58 行）、`http-admin.mjs`（42 行）；`plugin-guard.test.mjs` 最后一项 `[AC-060] HTTP flow steps…` 在 CI 中通过，断言 `scanned.http > 0` 且 hits=[] |
| 管理写路由业务分发 | 部分完成 | pool、manual-model、allow、deny、level、alias 已接入（`lib/index.js` 约 76-96 行），真实改写配置的测试通过；discover、enumerate、probe、read-usage、secret 仍落到末尾 `sendError(res, 'E_INTERNAL')` |
| doctor 步骤 | 已替换 | `test/flows/steps/doctor.mjs:5` 为 `introduced_by='T-024'`，调用真实 CLI，核对八项 id、registration、test_clock、`not generated`/0 |
| 缺失测试 | 部分补齐 | 见 P1-2、P1-3 |
| 补 acceptance 命令 | acceptance.md 已含 6 条命令，本轮 `check-acceptance` 通过（acs=3 commands=6 warnings=0）；但 CI 仍只跑 3 条 | `ci-results.json total=3` |
| jobs 缺口 | 已按 T-025 缺口披露，已知 id 用 exact 注册并有守卫测试 | `plugin-routes.test.mjs` 第三项；design 已写明，接受 |

## Findings

### P1-1 五个管理写路由通过守卫后仍返回 E_INTERNAL
- 路由：`/api/discover`、`/api/enumerate`、`/api/probe`、`/api/read-usage`、`/api/secret`。
- 证据：`lib/index.js` dispatch 对这些路径没有分支，除非 `deps.handlers[path]` 注入，否则命中末尾 `return sendError(res, 'E_INTERNAL')`。生产环境没有注入，所以合法请求返回 500。
- 说明：design 允许“业务分发接缝”，且首写已由真实目录操作证明。但用户 r1 note 明确要求把每条文档化管理写路由接到真实处理器；secret 还涉及密钥操作。请接入已有命令/领域函数，或在 design.md 中把这五个路由作为范围外缺口写明并说明为何不返回 E_INTERNAL。现在两样都没有。

### P1-2 AC-061 健康故障矩阵仍不完整
- 已覆盖：健康基线（单元和集成）、配置缺失（HTTP/doctor 对比，退出码 9、E_HEALTH_DEGRADED）、注册失败（health）、清单年龄随 `advance` 变化、清单和探测缓存损坏、`CLIWORKER_TEST_CLOCK_FILE` 设为无效文件时 doctor 报告 W_TEST_CLOCK。
- 未覆盖（`test/unit/health.test.mjs`、`test/integration/health.test.mjs` 中无对应用例）：state_dir 不可写；活跃锁超时；所需密钥后端不可访问；示例配置/内联秘密配置；过期探测数量及 TTL 边界前后；清单无效时间；`inject` 失败；doctor 注册失败对照；时钟文件合法/不可读两种情形；多故障同时报告；doctor 故障输出通过 `error-envelope.schema.json` 校验；HTTP 与 doctor 在故障组下逐项相等（现只对比“配置缺失”一组）。
- 另：`unit/health.test.mjs:21` 的 test_clock 用例用 env 路径 `secret-path` 的假值，未走真实时钟文件。

### P1-3 AC-059 细则缺测试
- select 有效会话下 full / draft 返回 200 及视图内容：无用例（`plugin-routes.test.mjs` 只测 403）。
- `GET api/session` 的 HTTP 响应：未对照 `session.v1.schema.json`，未断言只有四个字段、无 `set-cookie`、`cache-control: no-store`；`plugin-session.test.mjs` 只在 `createSessions` 层断言长度、expires_at、跨会话。
- 过期会话：只有 `createSessions` 层，没有通过 HTTP 用 `fakeClock.advance` 越过 `session_ttl_s` 后管理读/写返回 403 的用例；未知/伪造会话头也无 HTTP 断言。
- 管理读成功：只有 providers 与已知 jobs id；models、forecast、snapshot 有效会话成功无用例。
- 403 码与 `registry.snapshot.json` 的 `http_status`/`retryable` 对照，以及严格 error envelope 校验：未见。
- 每个管理写端点的“不匹配 csrf”“无效/过期会话”“超限体 400”：`[AC-060] registered write routes…` 只测无会话、缺 csrf、畸形体；csrf 不匹配只在 `gateRequest` 层。
- 这些在 acceptance.md AC-059/AC-060 的“期望输出”里都是必须有实际断言的项。

### P2-1 traceability 条目仍为 planned
- 证据：`test/traceability/T-024.json:5-7`。三个 AC 都已有带 `[AC-0xx]` 标签的测试，用户 note 要求为 covered。`planned` 时 `check-traceability` 不核对文件和标签。P1-2/P1-3 补齐后改为 `covered`。

### P2-2 剩余验收命令缺少 CI 证据
- unit 回归（`node --test "test/unit/*.test.mjs"`）与 `scripts/check-fast.ps1` 在 `ci-results.json` 无记录；impl.md 称 unit 475 通过、1 跳过，但这是 dev 自报，且 unit 测试会间接调用 git，我不能在评审里执行。这两项标为无法确认，请由编排方在 acceptance 的 CI 中补跑。
- 我自己只读验证了 `check-acceptance`（通过）与 `check-traceability`（通过）。

## 逐条核对

| 验收项 | 结论 | 证据 |
|---|---|---|
| AC-059 | 未通过 | 首条命令退出 0（8 项通过）；细则缺口见 P1-3；管理写 E_INTERNAL 见 P1-1 |
| AC-060 | 未通过 | 首条命令退出 0（6 项通过），flows 与首写真实目录变化已证实；缺 csrf 不匹配/过期/超限的逐端点用例，五个写路由无业务（P1-1、P1-3） |
| AC-061 | 未通过 | 首条命令退出 0（7 项通过）；故障矩阵缺口见 P1-2；unit 回归与 check-fast 无 CI 证据（P2-2） |

通过数/总数：0/3。
