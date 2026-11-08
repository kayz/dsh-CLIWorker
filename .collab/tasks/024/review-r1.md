# Task 024 评审 r1

评审基准 commit：`f2e047130599445efab5053f818566329d4c7803`（分支 task/024 的 ref 值；工作区另有 `.collab/tasks/024/*` 未提交改动）。

## 结论：needs_revision（通过 0/3）

ci-results.json 的 3 项（AC-059、AC-060、AC-061）全部退出 0。但这 3 项只对应 acceptance.md 中每个 AC 的第一条命令（只跑部分测试文件）。AC-061 之后的 unit 回归、check-acceptance、`scripts/check-fast.ps1` 三条命令，CI 里没有结果。更重要的是，设计要求的多项交付物不存在或明显不完整，impl.md 自己也承认“尚未完成，不能发布为完成的实现”。我读代码后确认这一点属实。

## Findings

### P0-1 flows 步骤 http-select、http-admin 不存在
- 证据：`test/flows/steps/` 下只有 auth/doctor/enumerate/probe/run/select，没有 `http-select.mjs`、`http-admin.mjs`。
- 影响：AC-060 要求 plugin-guard.test.mjs 实际执行这两个步骤的 `run(flow)`，并通过 `flow.recordHttp` / `flow.scan()` 做 HTTP 秘密哨兵扫描、首写、拒绝矩阵。这部分完全缺失。ci-results 中 AC-060 的 3 项测试是基础模块测试，没有这些内容。

### P0-2 管理写路由通过守卫后没有业务分发
- 证据：`lib/index.js:73` 对 `/api/discover`、`/api/enumerate`、`/api/probe`、`/api/read-usage`、`/api/allow`、`/api/deny`、`/api/level`、`/api/alias`、`/api/manual-model`、`/api/pool`、`/api/secret` 等未注入处理器的路径一律 `sendError(res, 'E_INTERNAL')`。只有 providers/models/forecast 有生产实现。
- 影响：design 与 AC-060 要求“同一次 api/session 响应的首个写请求成功，并有至少一个真实目录操作的状态变化”。当前首写必然得到 E_INTERNAL，该要求无法满足。

### P0-3 doctor 步骤仍是 T-012 的最小版，未替换为完整版
- 证据：`test/flows/steps/doctor.mjs:1-2,8-9` 仍是 `introduced_by = 'T-012'`、`ac = ['AC-031']`，只检查 `paths` 与 `providers`，没有执行 CLI `doctor`，也没有核对八项事实。
- 影响：brief 与 design 明确要求交付“完整版 doctor 步骤”，当前未交付。

### P0-4 缺少 T-024 traceability 分片
- 证据：`test/traceability/T-024.json` 不存在（目录里只有 T-001…T-023、T-036）。
- 影响：设计要求登记 AC-059/060/061，`scripts/check-fast.ps1` 依赖该分片，该门禁无法通过。

### P1-1 健康故障矩阵与时钟/一致性覆盖严重不足
- 证据：`test/unit/health.test.mjs` 共 26 行、`test/integration/health.test.mjs` 共 23 行，ci-results 中 AC-061 仅 3 项测试，覆盖健康 / 缺配置 / 路径不泄露。
- 影响：acceptance AC-061 要求逐项注入故障并核对，涉及：示例/内联秘密配置、目录不可写、活跃锁超时、密钥后端不可达、清单损坏/无效时间、过期探测与边界、register/inject 失败、`CLIWORKER_TEST_CLOCK_FILE` 的合法/不可读/非法三种情形、多故障同时报告、HTTP 与 doctor 报告逐项相等、`error.message` 内含 W_TEST_CLOCK、error-envelope schema 校验、真实 CLI 进程分发与退出码 9。这些均无对应测试。

### P1-2 AC-059 测试覆盖远低于验收描述
- 证据：plugin-routes（含 registration）与 plugin-session 共 8 项测试。
- 缺口：
  - 缺少 select 的 AgentLine 200 路径，包括 scanView 对真实目录/禁用键/wrapper 的 0 命中，以及与 CLI v1 输出的对照。
  - 缺少 full/draft 在有效会话下的 200 视图断言。
  - session 响应缺少对 schema、32 字节 session、HMAC csrf、精确 expires_at、no-store、无 cookie 的验证。
  - 缺少 ui 的 loopback 逐项伪造覆盖。
  - 缺少 snapshot/jobs 的有效会话成功用例。
  - 缺少所有 403 错误与 registry 的 http_status/retryable 及 error envelope 校验。

### P1-3 CI 缺少剩余验收命令的结果
- 证据：ci-results.json 的 `total: 3`，没有 unit 回归（`node --test "test/unit/*.test.mjs"`）、`check-acceptance`、`check-fast.ps1` 的记录。
- 影响：这些项只能标为“无法确认”。impl.md 也说明未执行 check-fast。

### P2-1 管理读的已知 jobs id 与 snapshot 依赖测试注入
- 证据：`lib/index.js` 中 jobs 路径仅在 `deps.jobIds` 提供时展开。
- 说明：这符合 design 披露的 T-025 接入缺口，不单独扣分。但在上面 P1-2 补齐测试前，该项未得到证实。

## 逐条核对

| 验收项 | 结论 | 证据 |
|---|---|---|
| AC-059 | 未通过 | 命令退出 0（ci-results：8 项通过），但验收细则大量未覆盖，见 P1-2；路由级业务分发缺失见 P0-2 |
| AC-060 | 未通过 | 命令退出 0（3 项通过），但 http-select / http-admin 步骤缺失（P0-1），首写无法成功（P0-2） |
| AC-061 | 未通过 | 第一条命令退出 0（3 项通过），故障矩阵缺失（P1-1），doctor 步骤未替换（P0-3），traceability 缺失（P0-4），其余 4 条命令无 CI 结果（P1-3） |

通过数/总数：0/3。
