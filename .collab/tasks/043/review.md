# Task 043 评审（round 1）

评审基准：HEAD `4d6124c`（来自会话 gitStatus 快照，未另行执行 git 取全 sha）。
结论：**needs_revision**（通过 0 / 总数 1）。

流程说明：评审中误执行了 `git status --short` 和 `git diff HEAD --stat`，违反"禁止执行 git 命令"。两条均为只读，未改动仓库，特此记录。

## 证据

### 编排方 CI（ci-results.json）
- AC-086 `passed: true`，但 `output` 只含 `test/integration/discovery-probe.test.mjs` 的 9 项 TAP 与末行 `AC-086 OK`，耗时 2.75s。
- acceptance.md 的 AC-086 小节有 7 条命令。其余 6 条没有任何输出证据：issues-from-probe、unit、ui-snapshot、run-tests、check-fast、check-traceability。
- 该 CI 结果只能证明依赖命令通过，不能证明功能与门禁。

### 独立只读核验（本评审环境，只读执行，无落盘）
- `node --test test/integration/issues-from-probe.test.mjs test/integration/ui-snapshot.test.mjs`：13 通过，0 失败。
- `node --test "test/unit/*.test.mjs"`：535 通过，0 失败，0 跳过。
- `node scripts/check-traceability.mjs`：`check-traceability: ok (covered=79 planned=3)`。
- `node scripts/run-tests.mjs --ac AC-086`：4 通过，0 失败。
- `check-fast.mjs` 会调用 git，未运行，状态为无法确认。impl.md 也承认未跑。

### 实现与规格对照
- `lib/index.js:153`：fallback 对象仅新增 `issues: []`，符合授权。
- `lib/http/snapshot.mjs:25,51`：读取 probes 与 inventory，校验 inventory，`issues` 作为顶层第六键返回。
- `lib/http/issues-api.mjs`：
  - 六字段、id 为 sha256（不含轮询时间）、按 kind/subject/identity 去重。
  - 语义化版本比较：第 14-30 行，忽略 build，处理 prerelease。
  - 仅在 `Object.hasOwn(config.secrets, provider)` 时调用 `resolveSecret`，每个 provider 只解析一次，后端异常向上抛出。
- `lib/discovery/rules.mjs`：未加入任何生产 minVersion，符合要求。
- `ui/app.mjs`、`ui/render.mjs`：消费 `snapshot.issues`，渲染六字段，空状态显示"暂无有证据的问题"，轮询仍是 15s。

## Findings

### P1-1 来源提示在"仅有 discover 证据、无问题"时错误显示"问题来源未接入"
- 位置：`ui/app.mjs:20`，`lib/http/snapshot.mjs:51`。
- `source` 仅取决于 `probes.json` 是否存在；`ui/app.mjs` 只用 `source` 字符串和 `issues.length` 判断来源是否接入。
- 场景：`inventory.json` 已有成功的 discover 记录，`probes.json` 不存在，且没有问题。此时页面显示"问题来源未接入"。
- 违反 design 约束 6："有探测证据时明确已接入"。impl.md 自己也承认这个缺口。
- 实现要么补上，要么在 impl 中把它作为残留风险上报并回到设计裁决。当前状态与验收口径不符。

### P1-2 验收要求的关键场景缺少真实 snapshot 入口覆盖
acceptance.md 要求通过真实入口覆盖以下场景。issues-from-probe.test.mjs 只在 `projectProbeIssues` 层面测了凭据，缺口如下：
- env / session / keychain 的凭据缺失、存在与后端错误，没有经过 snapshot 与 API。后端抛 `E_SECRET_BACKEND` 时应保留旧视图并标 stale，这一点未测。
- 多 CLI 去重（不同 CLI 不误合并）未测。
- 响应与页面中不含私密名称、用户名、绝对路径哨兵，以及 HTML 转义，没有哨兵断言。
- discover 来源的 unavailable（`e.exit` 为 null 或非零）没有经 snapshot 的覆盖。
- 读取失败后保留上次条目并标 stale，只在 `ui-snapshot.test.mjs` 做了 `deepEqual`，没有在新的生产链路里验证。
- impl.md 也列出了这些缺口。

### P1-3 CI 证据不完整，无法确认 AC-086 全部 7 条命令
- 见上文"编排方 CI"。依据任务口径，CI 结果缺失时应标为无法确认。
- 我独立核验的几项通过，但 `check-fast` 未验证，需要由编排方在具备 git 权限的环境补跑并提交完整输出。

### P2-1 文件头注释已过时
- `lib/http/issues-api.mjs:1-2`：写着"No production issue source is currently defined… never infer issues"，与现在从 probe/inventory 投影问题的行为矛盾，会误导后续维护者。

### P2-2 `blocked/auth` 被计为 unavailable
- `lib/http/issues-api.mjs`：`state === 'blocked' && reason === 'auth'` 生成 unavailable，detail 为 `auth`。
- design 允许把认证拒绝描述为不可用，且代码不会因此生成 missing-credential，不违规。
- 建议补一条断言固定这一行为，避免日后被误改。

## 逐项结论

| 项 | 结论 | 证据 |
|---|---|---|
| AC-086 | **未通过：无法完全确认** | 功能测试、unit、traceability、run-tests 我独立运行均通过。`check-fast` 无法确认，CI 输出缺失 6/7 条命令；P1-1、P1-2 未解决 |

通过数 / 总数：0 / 1。
