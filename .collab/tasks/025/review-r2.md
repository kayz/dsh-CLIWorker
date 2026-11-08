# Task 025 评审（第 2 轮）

结论：**needs_revision**。被评审提交：`e1a5b8c85bdedbe791ce4129b2486f178dd4a702`（`.git/worktrees/025/HEAD` 指向 `task/025`，与 gitStatus 的最新提交一致）。通过数 2/3。

第 1 轮的 7 个 P1 基本都已关闭：测试标题带 `[AC-0xx]`、快照形状有断言、失败保留旧值有测试、`deps.handlers` 覆盖 JSON 路由和写守卫有测试、app 的默认“问题”标签与 `问题来源未接入` 有测试、`test/fixtures/ui/issues.json` 和 `test/traceability/T-025.json` 已交付。本轮剩下的问题集中在一处渲染缺陷、一处未披露的旧回归，以及脱敏断言的覆盖面。

## 执行证据

ci-results.json（ranAt 2026-11-09T04:03:15+08:00，passed=3，total=3，ok=true）：

| AC | 命令 | 退出码 | 输出要点 |
| --- | --- | --- | --- |
| AC-062 | `node --test test/unit/ui-render.test.mjs`；`node --test "test/unit/*.test.mjs"` | 0 | 全 unit 485 项，pass 485，fail 0，skipped 0；`AC-062 OK` |
| AC-063 | `node --test test/integration/ui-snapshot.test.mjs` | 0 | 9 项，pass 9，fail 0；`AC-063 OK` |
| AC-077 | 两个测试文件合跑；`check-acceptance` | 0 | 13 项，pass 13，fail 0；`AC-077 OK` |

CI 结果与代码一致，未发现矛盾。以下是本轮只读核对之外的补充执行：

- 渲染探测：`renderModels` 输入 `remaining_fraction: 0.29` 且证据新鲜，余量单元格输出 `28.999999999999996%`。
- 旧集成测试：`node --test test/integration/health.test.mjs paths-entries plugin-guard plugin-routes plugin-session registration`，51 项，pass 49，fail 2。

## 逐条核对

### AC-062（unit）— 未通过

满足的部分：
- 六列表头：`ui/render.mjs:8`；测试 `ui-render.test.mjs:11`。
- 缺失显示 unknown、过期显示 stale、source/at 可读：`:12-17`；`render.mjs:19-23`。
- assumed 文案：`:43`；`render.mjs:16`。
- 真实 0 保留：`:48`；陈旧时 `stale（0）`：`:49`。
- 真实 100% 保留，且带 `source manual；at …`：`:50-54`。
- 输入不变：`:19`；转义：`:15`、`:33`。
- 问题组件：`test/fixtures/ui/issues.json` 存在；`:57-72` 断言排序 `['task-b','task-a','task-c','task-d']`、同任务同类合并计数 2、任务/角色/严重度组合筛选、未闭环保留、详情展开、相对路径不生成链接。

未满足：见 F1。余量单元格对非整百分比输出浮点噪声，余量列不可读。

### AC-063（integration）— 通过

按验收文档六个要点逐项核对：
1. 真实入口服务 UI 和两个 ESM 资源，字节与磁盘一致，Content-Type 正确，非 loopback 403，越界 URL（`..`、`%2e%2e`、反斜线）不返回 200 且不含绝对路径：`ui-snapshot.test.mjs:16-54`；实现 `lib/index.js:88-93`、`:117-128`。资源 403 只断言状态码、没断言 `E_LOOPBACK_ONLY`，该守卫复用既有 bootstrap 检查，且 T-024 的 plugin-routes 测试已覆盖错误码，不单独扣分。
2. `deps.handlers` 优先级：`/cliworker/ui`（`:56-64`）、`/cliworker/api/snapshot` 的 JSON 返回值（`:232-245`）、缺会话和缺 csrf 时不调用 handler（`:237-242`）、响应只结束一次（`lib/index.js:106-115`）。
3. app 先 session 后 snapshot，带 `x-cliworker-session`，推进 15000ms 出现下一轮读取，`clock.pending()===1`，exec 为 0：`:66-118`。
4. 会话过期：`session_ttl_s: 1`，请求序列为 snapshot → session → snapshot（`:100`），新旧 session 不同（`:101`）；持续拒绝只重签一次（`:301`）；写请求网络失败不重放（`:296`）；原数据仍可见并标 stale（`:302-303`）。旧头得到 `E_ADMIN_REQUIRED` 没有被单独断言，只能从序列推断，见 F4。
5. job：缺会话 `E_ADMIN_REQUIRED`、缺 csrf `E_CSRF`（`:129-132`）、readonly `E_READONLY`（`:259`）、注册失败无 job_id 且不排队不执行（`:272-275`）、空 `jobIds` 下具体路径可查、另一实例拿不到（`:138-139`）。
6. job 成功/失败后 snapshot：`:157-230` 用真实 manual 模型 + 池做断言：形状键 `['at','forecast','last_error','models','source']`、availability.evidence 键集合、`cmd_redacted`/`source.ref`/`level_source.ref` 为 null；失败后 `remaining_fraction` 仍 0.5、`availability.at` 仍为原观测时间、`last_error==='E_INTERNAL'`、`failure.at===job.at`、渲染为 stale；再次成功后 `last_error` 为 null，值更新为 0.75；exec 为 0。首轮无历史时 `source:'unknown'`（`:151-153`）。
7. 脱敏：快照断言无 `sk-testtoken123`、`realperson`、`C:\\Users`（`:200`）。失败态快照、job 响应、错误响应以及“会话令牌只在签发响应出现”没有对应断言，见 F3；按代码核对，`jobs.mjs` 的 job 对象只有 `job_id/status/at/last_error`，`last_error` 固定为 `E_INTERNAL`，令牌只来自 `sessions.issue()`，行为上没有泄漏路径。

### AC-077（integration，有限覆盖）— 通过

- 外壳首个且默认选中“问题”标签、含 `问题来源未接入`：`:30-31`；app 驱动下 `issues` 面板可见、`models` 隐藏、`aria-selected` 正确：`:92-96`。
- 推进 15000ms 后来源文本更新：`:98-105`（快照时间变化）。
- 连接失败后状态为 `stale：读取失败`，来源提示含 `unknown`，已有展示保留：`:108-116`；`ui/app.mjs:19`、`:41`。
- 组件 fixture：见 AC-062，覆盖任务/角色/模型/时间/分类/摘要/详情、排序、组合筛选、不同任务不合并、轮询不重复计数、未闭环保留、相对路径只显示文字及“证据链接未接入”、`file:` 不生成链接。
- 本哨兵只证明有限范围；真实 CLI 自报采集、证据 HTTP 直达与 AC 索引登记按本轮授权不在范围内，评审未据此扣分。

## Findings

| 级别 | 编号 | 摘要 | 证据 |
| --- | --- | --- | --- |
| P2 | F1 | 余量百分比未做舍入，非整百分比出现浮点噪声（`remaining_fraction: 0.29` 渲染为 `28.999999999999996%`） | `ui/render.mjs:17` 用 `forecast.remaining_fraction * 100` 直接拼串；本轮执行 `renderModels` 输出 `28.999999999999996%`；forecast 数值已 round3，所以真实数据常见（0.57→`56.99999999999999%`）。测试只覆盖 0.5/1，未发现。建议 `Math.round(x * 1000) / 10` 并补一条 0.29 的断言 |
| P2 | F2 | 旧集成测试被本任务改动打红，impl.md 未披露 | `plugin-routes.test.mjs:29`（[AC-059] bootstrap routes，fakeFs 无 ui 文件，/cliworker/ui 返回 500）和 `plugin-guard.test.mjs:162`（[AC-060] management writes，期望同步返回 `cliworker.inventory/v1`，现在返回 job_id）。design.md 已预告这两类差异并要求“如实报告”，impl.md 只写了 check-pack 失败，没写这两项。本任务不得改这些测试，需要在 impl.md 中列出并交给下游处理，或确认已有放行决定 |
| P2 | F3 | 脱敏断言只覆盖正常快照 | `ui-snapshot.test.mjs:200` 仅检查 `first.body`；失败态快照、job 响应、错误响应、资源响应以及“令牌只在签发响应出现”缺断言（acceptance AC-063 第 7 条）。代码核对无泄漏路径，但应补测试，避免之后回归 |
| P2 | F4 | 会话过期时旧头得到 `E_ADMIN_REQUIRED` 没有被显式断言 | `ui-snapshot.test.mjs:100-101` 由请求序列推断，未检查旧头的响应码和错误码；acceptance AC-063 第 4 条要求“旧头得到 403 E_ADMIN_REQUIRED” |
| P2 | F5 | 余量的 stale 判据借用了可用性探测的 ttl，没有探测时池读数正常也显示 `stale（…）` | `ui/render.mjs:11-12`、`:18`：`stale` 由 `availability.at/ttl_s` 决定并套用到余量。数值不会被伪造，所以是保守偏差；建议余量按 forecast/pool 自己的时间判断，或在 impl.md 中把它记为已知限制 |
| P2 | F6 | impl.md 自述未完成项需要保持与现状一致 | impl.md 仍写“作业失败仍按整体快照标 stale，未实现受影响项隔离”，与 `ui/render.mjs:12` 一致；代码保留整份旧快照，不清空其他项，验收可接受，建议修订 F2 时一并确认这条说明 |

## 下一轮建议

1. 修 `render.mjs:17` 的百分比舍入并加一条非整百分比用例（F1）。
2. 在 impl.md 如实列出 `[AC-059]` plugin-routes 与 `[AC-060]` plugin-guard 的失败及原因，说明未改范围外测试（F2、F6）。
3. 在 `ui-snapshot.test.mjs` 补两处断言：失败态快照与 job 响应无秘密哨兵；会话过期时旧头直接请求得到 `E_ADMIN_REQUIRED`（F3、F4）。
4. F5 可选：按 forecast/pool 时间判断余量陈旧，或记录为限制。
