# Task 025 — 模型管理界面（白名单、等级、可用性、余量、刷新时间、实测证据）与实时数据

## 目标

来自 Blueprint 任务图 T-025（M5）。在浏览器打开 `GET /cliworker/ui` 得到一个不含数据的静态外壳：外壳先向 `api/session` 取会话，再带会话头轮询 `api/snapshot`，全程不执行任何 CLI（exec 计数为 0）。界面上白名单、等级、可用性、余量、刷新时间与实测证据都可读；缺失或过期的值显示为 unknown / stale 并附 source 与 at，绝不把缺失数据渲染成 0 或 100%；assumed 显示为「unknown（估计 N，assumed）」。**第一个标签页是「问题」**：CLI 在处理中自报的问题必须上屏、可筛选、可展开证据、重复合并计数、未闭环不消失（AC-077）。刷新与探测走 job 接口；job 失败时保留上次值并标 stale，附 last_error 与 at。交付：
- `ui/index.html`（静态外壳）、`ui/app.mjs`（先签发会话再轮询）、`ui/render.mjs`（纯函数）
- `lib/http/snapshot.mjs`、`lib/http/jobs.mjs`、`lib/http/issues-api.mjs`
- `test/fixtures/ui/**`

## 约束

- 只允许写入以下路径（write_scope，来自 task-graph）：
  - `ui/**`
  - `lib/http/snapshot.mjs`
  - `lib/http/jobs.mjs`
  - `lib/http/issues-api.mjs`
  - `test/unit/ui-render.test.mjs`
  - `test/integration/ui-snapshot.test.mjs`
  - `test/fixtures/ui/**`
  - `test/traceability/T-025.json`
- 仓库级硬约束：不得修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`；新增 CLI 命令一律通过 `export const route = { cmd, sub }` 自注册。
- 不得改 T-024 交付的路由表、会话与 csrf 实现（`lib/http` 其余文件不在本任务 write_scope）；新路由只能由本任务三个数据面文件提供，并经既有注册扩展点接入。
- 验收必须能被 `node scripts/check-acceptance.mjs` 通过（`## AC-0xx` 小节 + 可执行命令 + `<AC-id> OK` 哨兵）。
- **规格来源优先级**：`docs/ui/cliworker-console.html` 是较早的设计稿，只作视觉与布局参考（页面分组、settings 分区、六列表格等），它**尚未包含「问题」标签页**；问题优先页的规格以 `.collab/blueprint/cliworker-v2/design.md` §12 为准，不得因稿子里没有而漏做。
- 界面不得在浏览器侧直接访问本地文件或执行 CLI；数据只来自 HTTP。不引入前端框架、打包器或任何第三方依赖，纯静态 HTML + ESM。
- 快照与问题条目不得含令牌、真实用户名、本机绝对路径或 provider 私密信息；SSE 与响应体同样受 `lib/contract/scan.mjs` 约束。
- 零第三方运行时依赖，Node 20+ / ESM；不改 `.collab/blueprint/**`、其他任务目录与 write_scope 之外的文件；`acceptance.md` 由 design 阶段产出。

## 建议验收方向

由 designer 决定命令形态，以下是必须成立的可观察结论（AC 号与层级取自任务图）。
- AC-062（levels: unit）：`render` 纯函数的测试——六列齐全；缺失或过期的值显示 unknown 或 stale，并附 source 与 at；输出中不出现由缺失数据生成的 0 或 100%；assumed 渲染为「unknown（估计 N，assumed）」。
- AC-063（levels: integration）：界面外壳先请求 `api/session`，再带会话头轮询 `api/snapshot`，期间 exec 计数为 0；会话失效时收到 `E_ADMIN_REQUIRED` 并重新签发；刷新与探测走 job 接口并返回 job_id；job 失败时 snapshot 中该项保留上次的值、标为 stale，并给出 last_error 与 at。
- AC-077（levels: integration）：**问题优先页**。CLI 处理中自报的问题（阻塞、权限被拒、工具失败、契约不满足、额度不足、恢复失败等）必须出现在模型管理界面的首个标签页，而不是只写进日志。每条至少含：任务 ID、角色、模型与 provider、发生时间、错误码或问题分类、一句话摘要、可点开的详情（原始输出片段、证据路径、建议动作）。多个任务并发时按严重度（blocking > major > minor）与时间倒序排序，支持按任务、角色、严重度筛选；同一任务同一问题重复出现必须合并计数而不是刷屏。状态文件变化后 5 秒内必须出现在前端（沿用 SSE）；详情链接可直接跳到对应任务的 `sessions/` 与 `logs/` 证据。客户端自报「无法完成」但 flow 仍继续的情况必须单列为「未闭环」，不因流程继续而在界面上消失。

## 非目标

- 不做设置/凭据编辑入口（凭据写入走 secret 路由，属其他任务）；不做登录、多用户与权限模型（沿用 loopback + 会话）。
- 不改选模、预测与可用性计算，只呈现既有 `model/v1`、`forecast/v1` 与命令的输出。
- 不改 `package.json` 的 `files`/打包清单（`ui/` 是否随包分发由打包清单任务决定）；本任务只交付仓库内可由 `GET /cliworker/ui` 提供的静态外壳。
- 不做前端构建产物、不做 i18n、不写发布门禁（T-030）。

## 验收格式（生成 acceptance.md 时必须遵守，否则 CI 解析失败）

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；**同一 AC 的多条检查放进同一小节**，不要重复同一个 id
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵，runner 按此判定通过
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 每条任务额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/025/acceptance.md`
