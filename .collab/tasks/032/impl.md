# Task 032 实现说明（dev）

## 交付文件

| 文件 | 变更 |
|---|---|
| `lib/session.mjs` | 新建。无状态 session 协议：`startSession`、`resumeSession`、token 编解码、`composeInput`、六种失效检查、角色策略与 `writeRolePolicy`。 |
| `lib/providers/call.mjs` | 新建。描述符校验、argv 构造、session id 四种来源提取、身份四档。 |
| `lib/contract/views.mjs` | 追加 `SESSION_RESULT_SCHEMA`、`SESSION_ACTIONS`、`SESSION_IDENTITY_LEVELS`、`sessionView`；`VIEW_NAMES`/`resolveView` 未改。 |
| `test/contract/session.test.mjs` | 新建，15 个用例。 |
| `test/unit/session-invalidation.test.mjs` | 新建，11 个用例。 |
| `test/integration/session-quota.test.mjs` | 新建，7 个用例。 |

未触碰 `contracts/`、`lib/contract/registry.mjs`、`scripts/`、`test/helpers/`、`package.json`，未新增 `test/traceability/T-032.json`。

## 关键实现决定（与 design.md 对齐）

1. **错误码就地定义，不进注册表。** `SESSION_ERRORS` 九个码全部 `retryable:false`、固定 message；`INVALIDATION_CODES` 按 AC-076 的六项顺序冻结。`error-envelope` 的 `code` 枚举因此保持不变。
2. **token 不透明。** `st_` + base64url(`{v,s,m,p,c,t}`)；`m/p/c` 分别是 `sha256(label + '\n' + value)` 的前 12 位十六进制，`t` 取 `ctx.clock.now()`。token 不出现 provider、CLI 路径或模型 id；解码严格校验键集、类型、id 语法与摘要格式。
3. **resume 先检查后调用。** 顺序固定为 token → target/input → resumable → provider → model → contract → TTL → forecast，前三类检查与额度检查都不触发 `ctx.exec`；只有真正 resume 失败才恰好调用一次。
4. **增量输入白名单。** resume 只接受 `summary/diff/findings/constraints`，`brief/design/docs/prompt` 一律 `E_REQUEST_INVALID` 且不调用 provider；`composeInput` 按 `prompt,summary,diff,findings,constraints` 固定顺序输出 `## <name>\n<text>\n`，段间一个空行。
5. **角色策略与 AgentLine 记录分离。** `writeRolePolicy` 只写 `cliworker.session-policy/v1`；目标文件已是其他 schema（含解析失败）时返回 `written:false, reason:'foreign_schema'` 并且不覆盖。写入走 `.tmp` + `renameSync`，失败时清理临时文件并返回 `E_INTERNAL`。
6. **身份不阻断。** `unverified`/`observed` 照常返回成功与 token；身份对象只含 `level/identity_source/consistent/observed_at`，不含模型名。`observed_at` 来自 `ctx.clock.nowIso()`。
7. **无 IO 副作用。** start/resume 只经 `ctx.exec` 调用 provider；不读写文件、不拉模型列表、不访问 `ctx.fetch`。时间只来自 `ctx.clock`，库内无 `Date` 与模块级状态。

## 自测

已执行：

- `node --test test/contract/session.test.mjs test/unit/session-invalidation.test.mjs test/integration/session-quota.test.mjs`
  → `tests 33 / pass 33 / fail 0 / skipped 0 / todo 0`。
- `node scripts/run-tests.mjs --ac AC-076` → `filtered 3 files`，`fail 0`。
- 全量 `node scripts/run-tests.mjs` → `tests 359 / pass 356 / fail 3`；失败集合恰为基线遗留 `AC-006`、`AC-013`、`AC-073`，无新增。
- `check-defects`、`check-traceability`（`covered=28 planned=46`）、`check-seams`、`check-unused` 均 `: ok`；`check-no-collab` 仍为 `(2 violations)`。
- `check-write-scope --base 040d2e9 --scope-from design.md --scope '.collab/tasks/032/**'` → `ok`；`contracts/`、`scripts/`、`test/helpers/` 与注册表相关文件无 diff、无未跟踪文件。
- 逐条执行 `acceptance.md` 的 A-01～A-19 断言脚本，全部命中期望输出 `AC-076 OK`。

## 已知取舍

- `lib/session.mjs` 的 token 摘要与 AC-076 之外无耦合；provider 的 resume 失败文本一律折叠为 `E_SESSION_RESUME_FAILED`，不解析（brief 非目标）。
- `call.mjs` 的 `runSessionCall` 把 `input` 传给 `ctx.exec` 的选项；真实 exec 转发 stdin 属 T-015，不在本任务范围。
