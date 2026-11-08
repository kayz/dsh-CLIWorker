# Task 024 — DSH 插件路由分级、会话自举（loopback 例外）、csrf 签发、固定判定顺序、健康检查与 doctor

## 目标

来自 Blueprint 任务图 T-024（M5）。插件注册的每条路由都有明确级别（AgentLine / 自举例外 / 公共 / 管理读 / 管理写），在没有会话、会话过期、非 loopback、只读、csrf 缺失等条件下，每条路由只返回注册表规定的唯一错误码。管理会话可以从 loopback 自举：一次 `api/session` 响应同时拿到 session 与 csrf，首个写请求即可成功。`doctor` 与 `/cliworker/health` 对同一组事实（配置、状态目录、锁、密钥后端、清单年龄、过期探测、注册状态、test_clock）给出一致结论，故障时以 `E_HEALTH_DEGRADED` 收口。交付：
- `lib/http/**`：路由表、loopback 三项校验、会话与 csrf、只读门控、固定判定顺序
- `lib/health.mjs`、`lib/commands/doctor.mjs`
- `lib/index.js` 接入（注册返回值与错误上报）
- flows 步骤 `http-select`、`http-admin`、`doctor`（完整版）

## 约束

- 只允许写入以下路径（write_scope，来自 task-graph）：
  - `lib/index.js`
  - `lib/http/**`
  - `lib/health.mjs`
  - `lib/commands/doctor.mjs`
  - `test/integration/plugin-routes.test.mjs`
  - `test/integration/plugin-guard.test.mjs`
  - `test/integration/plugin-session.test.mjs`
  - `test/integration/health.test.mjs`
  - `test/unit/health.test.mjs`
  - `test/flows/steps/http-select.mjs`
  - `test/flows/steps/http-admin.mjs`
  - `test/flows/steps/doctor.mjs`
  - `test/traceability/T-024.json`
- 仓库级硬约束：不得修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`（命令路由与 ctx/clock 已冻结）。
- 新增 CLI 命令一律通过 `export const route = { cmd, sub }` 自注册，不得靠改 `lib/routes.mjs` 或 `lib/cli.mjs`；本任务的 `doctor` 走这条路。
- 验收必须能被 `node scripts/check-acceptance.mjs` 通过（`## AC-0xx` 小节 + 可执行命令 + `<AC-id> OK` 哨兵）。
- `contracts/**`（注册表、规格、金标）只读；需要新码或新触发条件时走蓝图变更，不在本任务内私自加码。
- 会话只存内存、只走请求头 `x-cliworker-session` / `x-cliworker-csrf`，不用 cookie；进程重启后全部失效。loopback 三项校验（socket 远端、Host、Origin）缺一不可。
- HTTP 响应与 CLI 输出共用 `lib/contract/scan.mjs`；AgentLine 视图 0 命中。
- 零第三方运行时依赖，Node 20+ / ESM；令牌与密钥不得进入日志、响应体或审计之外的任何输出。
- 不改 `.collab/blueprint/**`、其他任务目录与 write_scope 之外的文件；`acceptance.md` 由 design 阶段产出，不在 dev 的 write_scope 内。

## 建议验收方向

由 designer 决定命令形态，以下是必须成立的可观察结论（AC 号与层级取自任务图）。
- AC-059（levels: integration）：逐条路由断言唯一状态与码。`POST /cliworker/select` 不带 view 返回 200 的 AgentLine 视图且 scan 0 命中；带 `view:'full'` 或 `compat:'draft'` 而无有效会话返回 403 `E_VIEW_FORBIDDEN`；有效会话时返回 200 完整或 draft 视图。`GET api/session` 与 `GET ui` 在「非 loopback 远端、非 loopback Host、非 loopback Origin」三种伪造下各返回 403 `E_LOOPBACK_ONLY`；loopback 下 `api/session` 返回 200 且含 session、csrf、expires_at。`GET providers`、`models`、`forecast`、`api/snapshot`、`api/jobs/<id>` 无会话或会话过期（伪时钟 advance 越过 `session_ttl_s`）返回 403 `E_ADMIN_REQUIRED`，带有效会话返回 200。HTTP 响应与 CLI 输出由同一个 scan 函数检查。
- AC-060（levels: integration）：写路由判定顺序固定为会话 > readonly > csrf > 请求体。无会话时即使 readonly 且缺 csrf 也返回 `E_ADMIN_REQUIRED`；会话有效且 readonly 时即使缺 csrf 也返回 `E_READONLY`；会话有效、可写、csrf 缺失或不匹配返回 `E_CSRF`；用同一次 `api/session` 响应里的 session 与 csrf 发出的首个写请求成功。`http-select` 与 `http-admin` 步骤中 leak-scan 对 HTTP 响应体的哨兵检查 0 命中。
- AC-061（levels: integration, unit）：`doctor` 与 `/cliworker/health` 都报告配置有效性、state_dir 可写性、锁状态、密钥后端、清单年龄、过期探测数量、注册状态、test_clock。注入任一故障（含设置 `CLIWORKER_TEST_CLOCK_FILE`）时 `doctor` 以 `E_HEALTH_DEGRADED` 退出（退出码 9），health 返回 `status: degraded` 并列出故障项。

## 非目标

- 不做界面与 snapshot/jobs/issues 数据面（T-025），不做跨进程 e2e（T-026）。
- 不新增错误码、不改注册表；403 五个码的触发互斥与判定顺序按 `contracts/registry.snapshot.json` 原样实现。
- 不做反向代理或非 loopback 场景下的鉴权（design §9 待确认项，由宿主自理）。
- 不改 `doctor` 之外的任何 CLI 命令行为，不做发布门禁（T-030）。

## 验收格式（生成 acceptance.md 时必须遵守，否则 CI 解析失败）

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；**同一 AC 的多条检查放进同一小节**，不要重复同一个 id
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵，runner 按此判定通过
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 每条任务额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/024/acceptance.md`
