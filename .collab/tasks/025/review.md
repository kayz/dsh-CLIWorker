# Task 025 评审（第 1 轮）

结论：**needs_revision**。被评审提交：`20cbe69b13c055e66d11f3336498b0661aa26d37`。通过数 0/3（逐条核对 AC；ci-results.json 三条验收命令本身均退出 0）。

## 关于本轮用户输入

用户输入称 CI 为 2/3，AC-063 因找不到 `test/integration/ui-snapshot.test.mjs` 失败。当前 ci-results.json（ranAt 2026-11-09T03:55:18+08:00，passed=3，total=3）已是修复提交之后的结果，该文件已存在，AC-063 命令退出 0（4 项）。这个失败已经消除。但用户同时要求：测试名以 `[AC-063]` 开头、`node scripts/run-tests.mjs --ac AC-063` 退出 0、快照/JSON 端点形状有断言、`deps.handlers` 优先级有覆盖。这些仍未满足，见下。

## 本轮独立执行的检查

| 命令 | 结果 |
| --- | --- |
| `node scripts/run-tests.mjs --ac AC-063` | 输出 `FAIL run.no_match AC-063`，退出码 **1** |
| `node --test "test/unit/*.test.mjs"` | 484 项，pass 484，fail 0，skipped 0 |
| `node scripts/check-acceptance.mjs .collab/tasks/025/acceptance.md` | `acs=3 commands=5`，`warnings=0`，退出 0 |

`run-tests.mjs` 的 `--ac` 过滤（scripts/run-tests.mjs:243-256）只选源码中含字面量 `[AC-063]` 的测试文件。`test/integration/ui-snapshot.test.mjs` 与 `test/unit/ui-render.test.mjs` 中 `[AC-0xx]` 出现次数均为 0，所以按 AC 过滤跑不到这两个文件。

## 逐条核对

### AC-062（unit）— 未通过
- ci-results：命令退出 0，484 项全绿。
- `test/unit/ui-render.test.mjs` 仅 3 项、43 行，覆盖薄：
  - 六列表头、unknown、转义、输入不变、assumed 文案、0 与 stale 已断言（:10-15、:36-43）。
  - 没有任何断言检查 source/at 在单元格中可读，也没有「缺少来源或时间时显式 unknown」的断言。
  - 没有「真实新鲜证据的 100% 保留」的断言；没有「缺失数据不产生 0/100%」的反例遍历。
  - 问题组件：没有 blocking > major > minor 与同严重度时间倒序的断言；没有任务、角色、严重度组合筛选的有效结果断言（:27 只取了一个过滤结果的 unclosed）；没有展开证据详情的断言。
  - design 要求的 `test/fixtures/ui/**` 不存在，测试内联数据。
- 测试名不带 `[AC-062]`，`run-tests.mjs --ac AC-062` 同样会 no_match。

### AC-063（integration）— 未通过
ci-results：命令退出 0，4 项通过。逐条对照 acceptance.md 的六个要点：
1. 真实入口服务 UI 与资源：`ui-snapshot.test.mjs:13-43` 覆盖外壳内容、两个 ESM 资源、非 loopback 403。缺：清单内静态 JSON/样式资源、Content-Type 对 HTML 的断言、越界/`..`/编码/反斜线请求被拒且不泄露绝对路径、资源 403 的错误码为 `E_LOOPBACK_ONLY`（只断言了状态码）。
2. `deps.handlers` 优先级：只有 `/cliworker/ui` 一处（:45-53），验证了非 loopback 时不调用、合法时覆盖且只结束一次。缺：对已有 JSON 路由（如 `/cliworker/api/snapshot`、`/cliworker/api/session`、`/cliworker/health`）的覆盖；handler 返回普通 JSON 值的旧行为；缺会话或 csrf 不合法的写请求不调用 handler。实现在 `lib/index.js:104-113`，逻辑正确，但测试没有证明。
3. 实际 app 先 session 后 snapshot、15000ms 周期：`:55-83` 覆盖，且 `execs===0`、`clock.pending()===1`。缺：连续推进不产生重叠请求的断言；job 查询的 exec 计数。
4. 会话过期：`:76-79` 的请求序列隐含了「旧头被拒后重签一次」，但没有显式断言旧头得到 `E_ADMIN_REQUIRED`，没有「持续拒绝/网络失败不无限重签、不重放写请求」，没有「失败后原数据仍可见且标 stale」。
5. job：`:85-120` 覆盖缺会话 `E_ADMIN_REQUIRED`、缺 csrf `E_CSRF`、具体查询路径、跨实例隔离。缺：readonly 拒绝、注册失败不返回 job_id 且不执行业务、probe/discover/enumerate 的 job_id。
6. job 成功/失败后 snapshot：只验证「首轮失败 → `source:'unknown'`、`last_error:'E_INTERNAL'`」（:116-118）。缺：失败时**保留已有数值、测量时间、标 stale、附 last_error 与失败尝试 at**；成功后显示最新证据；其他项不被清空；旧作业不覆盖新证据。这是验收的核心行为，目前没有任何测试。
7. 脱敏：整个集成文件没有秘密哨兵、真实用户名、绝对路径的泄露断言。

**快照端点形状没有断言**：唯一的快照断言是 `assert.deepEqual(JSON.parse(snapshot.body).models, [])`（:40）——空目录。没有任何测试在有模型数据时检查 `models[]`（等级、allowed、availability）、`forecast[]`（余量）、`source`/`at`（刷新时间）、`availability.evidence`（实测证据）的形状。用户要求的「文档化形状」断言缺失。

测试名不带 `[AC-063]`。

### AC-077（integration，有限覆盖）— 未通过
- ci-results：命令退出 0，7 项通过，但这 7 项即是上面两个文件。
- 验收要求：真实外壳与 app 渲染的第一个且默认选中标签为“问题”；无来源时显示 `问题来源未接入`；推进 15000ms 后页面来源状态更新；连接失败后仍显示 unknown/stale。
  - 集成测试只检查 HTML 里「问题」出现在「模型」之前（:27）。app 测试里用的是 stub 元素（:64-66），没有断言默认选中标签，也没有断言页面出现 `问题来源未接入`，没有断言 15000ms 后状态文本更新，没有连接失败后的 unknown/stale。
  - 用户要求的「AC-077 问题优先页数据」在快照中没有断言。当前 `readSnapshot` 不含问题字段（lib/http/snapshot.mjs:38），design 有意不接入，但页面来源状态与 snapshot 的关系仍应有测试。
- 组件 fixture：排序、组合筛选、不同任务不合并、轮询不重复计数、下一快照暂缺仍保留、相对路径只显示文字——见 AC-062，仅部分覆盖（:22-33）；`projectIssues` 的筛选与排序没有结果断言。

## 交付物缺口

- `test/fixtures/ui/**` 不存在（design 与 brief 都要求交付）。
- `test/traceability/T-025.json` 不存在（design 要求登记 AC-062/063）。
- `impl.md` 仍写「本轮仍未完成」「UI fixture 与追踪分片尚未交付」，并自述作业失败「尚未完成受影响项隔离及并发作业覆盖保护的完整验证」。它承认了覆盖不足，也没有更新反映 CI 修复提交。

## Findings

| 级别 | 摘要 | 证据 |
| --- | --- | --- |
| P1 | 两个测试文件没有任何 `[AC-0xx]` 标签，`run-tests.mjs --ac AC-063` 退出 1 | 本轮实跑输出 `FAIL run.no_match AC-063`；scripts/run-tests.mjs:243-256；grep `[AC-063]` 结果 0 |
| P1 | 快照端点形状未断言，仅断言空目录 `models: []` | ui-snapshot.test.mjs:40 |
| P1 | job 失败保留旧值并标 stale、附 last_error 与失败 at、成功后最新证据等核心行为无测试 | ui-snapshot.test.mjs:109-118 只测首轮失败；lib/index.js:148-154 的保留分支无覆盖 |
| P1 | `deps.handlers` 优先级只测了 `/cliworker/ui`，未覆盖已有 JSON 路由与返回 JSON 值的旧行为、写请求守卫不调用 handler | ui-snapshot.test.mjs:45-53；lib/index.js:104-113 |
| P1 | AC-077 外壳/app 行为未验证：默认选中“问题”标签、`问题来源未接入` 文案、15s 后状态更新、失败后 unknown/stale | ui-snapshot.test.mjs:27、:64-66 为 stub 元素 |
| P1 | AC-062 单元测试缺来源/at、100%、排序、组合筛选、证据展开的结果断言 | ui-render.test.mjs 共 3 项 43 行 |
| P1 | 缺 `test/fixtures/ui/**` 与 `test/traceability/T-025.json` | 两路径均不存在 |
| P2 | 资源越界/编码绕过/反斜线、注册失败、readonly、脱敏哨兵（秘密、用户名、绝对路径）无测试 | ui-snapshot.test.mjs 全文无相关断言 |
| P2 | impl.md 未更新，且自述未完成 | impl.md:3-5 |

## 下一轮建议

1. 给两个测试文件的每个 `test(...)` 标题加前缀 `[AC-062]`/`[AC-063]`/`[AC-077]`（按用途），使 `node scripts/run-tests.mjs --ac AC-063` 退出 0。
2. 在集成测试里用真实模型数据（可用 probes.json 与池/用量账本）断言快照 `models/forecast/source/at/last_error` 的形状，并加一个用例证明 job 失败保留旧值。
3. 增加对已有路由（snapshot 或 session）的 `deps.handlers` 覆盖、JSON 返回值覆盖，以及缺会话写请求不调用 handler 的断言。
4. 补 fixtures、追踪分片，并更新 impl.md。
