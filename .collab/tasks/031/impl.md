# Task 031 — 实现说明

## 改动清单

本次只创建/修改 design.md `write_scope` 内的五个文件：

- 新增 `lib/identity.mjs`：身份证据的唯一实现点。
- 修改 `lib/providers/call.mjs`：重导出来源枚举、转交 Session 精简判定、追加 `callWithIdentity`。
- 修改 `lib/contract/views.mjs`：追加 `identityView`、`callView` 两个纯白名单投影。
- 新增 `test/contract/identity.test.mjs`：AC-075 contract 层，全部经真实 `callWithIdentity` 入口。
- 新增 `test/unit/identity-levels.test.mjs`：AC-075 unit 层，覆盖来源分档、解析边界与脱敏。

未改动 `lib/session.mjs`、`lib/redact.mjs`、注册表、契约文档、追踪分片或既有测试。

## 为什么这样改

### lib/identity.mjs

按 design.md 第 11 节把身份判定集中到一处，避免 Session 与 provider 证据各写一套：

- `IDENTITY_SOURCES` 保留固定六值枚举。
- `resolveIdentity` 是唯一一次原始提取：先判失败（`ok !== true` 或有限整数非零退出码），再按 `descriptor.identity.source` 取证据。`cli_flag` 只证明请求参数、`none`/非法来源/无证据一律 `unverified + none`，因此都不会伪造 `reported_model`。
- stdout 走 `jsonValues`：先整段 JSON，失败后逐非空 JSONL 行；点路径只读自身属性并拒绝 `__proto__`/`constructor`/`prototype`，数字值沿用既有转字符串行为。
- rollout 只读 `identity.file`，相对路径按注入的 `cwd` 解析，全部经注入的 `readFile`；读取抛异常、坏行、空模型都按无证据处理。
- 模型不一致不改变来源等级，也不转成 failed。
- `classifyIdentity` 输出完整对象五字段；`evidence` 始终是 `{ path, at, detail }`，缺失显式为 `null`。`classifySessionIdentity` 输出既有四字段，`consistent` 用脱敏前的原始字符串比较，避免两个不同秘密被同时遮成 `[REDACTED]` 后误判为一致。
- 脱敏先移除 `C:\Users\<name>`、`/Users/<name>`、`/home/<name>`（正反斜杠均可）的用户段，再交给既有 `redactString`/`redact`；`evidence` 整体经 `redact`，`requested_model`、`reported_model` 同样脱敏。没有读取环境变量，也没有新增依赖。

### lib/providers/call.mjs

- 现有导出与签名全部保留：`SESSION_ID_RE`、`validateSessionDescriptor`、`buildSessionCall`、`runSessionCall`、`extractSessionId` 行为不变。
- `IDENTITY_SOURCES` 改为从 `lib/identity.mjs` 重导出。
- 原 `classifyIdentity` 保留为兼容入口，转调 `classifySessionIdentity`，返回四字段形状不变。
- 新增 `callWithIdentity(ctx, spec, text, timeout_ms, options)`：恰执行一次 `runSessionCall`，exec 抛异常也形成一条 failed 记录；用 `ctx.clock` 前后差值算 `latency_ms`（时钟回退或非有限值取 0），用 `ctx.clock.nowIso()` 填 `evidence.at`；`exit_code` 仅接受有限整数，`tokens_in/out` 仅接受非负有限整数并保留真实 0；返回 `{ identity, calls: [一条证据] }`，不重试、不追加候选字段、不保留模块状态。

### lib/contract/views.mjs

- `identityView(identity)` 与 `callView(call)` 只复制 design.md 列出的字段，`evidence` 每次新建对象，未知字段（如 `selected_model`、`retryable`、`exclude`）全部丢弃。
- 未新增 import，不读时间/环境；`sessionView`、`resolveView`、`VIEW_NAMES` 与既有常量保持不变。

## 如何自测

在仓库根目录执行。

1. AC-075 主命令（design.md 指定）：`test/contract/identity.test.mjs` + `test/unit/identity-levels.test.mjs`。

   实测结果：`# tests 22`、`# pass 22`、`# fail 0`、`# cancelled 0`、`# skipped 0`、`# todo 0`，最后打印 `AC-075 OK`，退出码 0。

2. AC-075 Session 兼容回归：`test/contract/session.test.mjs` + `test/unit/session-invalidation.test.mjs`。

   实测结果：`# tests 26`、`# pass 26`、其余计数均为 0，最后打印 `AC-075 OK`，退出码 0。

3. 额外回归子集：`test/contract/{context,examples,freeze,host-stub,registry,scan-canary,session}.test.mjs` 与 `test/unit/{identity-levels,session-invalidation,select,select-draft,import-safe}.test.mjs`。

   实测结果：`# tests 103`、`# pass 103`，fail/cancelled/skipped/todo 均为 0。

4. 只读结构检查逐条执行并全部通过：`check-seams`、`check-unused`、`check-no-model-table`、`check-acceptance`、`check-ci`、`check-contract-doc`、`check-defects`、`check-frozen-files`、`check-golden-frozen`、`check-no-collab`、`check-pack`、`check-traceability`、`check-write-scope`（不带 `--base`，未触发 git）。

5. 未执行 `pwsh -NoProfile -File scripts/check-fast.ps1` 全量链：该链会进入生成测试产物的 runner 与涉及 git 的既有测试（`spec-tracked`、`gitignore`），与本任务「禁止 git、禁止创建其它文件」的约束冲突。上述第 1～4 项已覆盖本任务写域与受影响模块。

## 边界说明

- 本次不接入旧 select、ModelHandle 选模流程，也不修改 `requireVerified` 等旧策略；`callWithIdentity` 及其 `calls[]` 是供下游消费的执行证据入口。
- 新入口的 `calls[]` 与旧 select 根部的命令列表 `calls[]` 无关，未扩大扫描器白名单。
- 输入对象不被修改；同一输入两次调用得到相等但相互独立的 `evidence` 对象。

## 第 2 轮评审修复

按 review.md 第 1 轮的 F1、F2 修复脱敏缺口，范围仍限于 `lib/identity.mjs` 与 `test/unit/identity-levels.test.mjs`：

- **F1（P1）大小写**：`USER_DIR_RE` 增加 `i` 标志。Windows 路径不区分大小写，`c:\users\alice\...` 与 `/HOME/bob/...` 现在都会移除用户名段。
- **F2（P2）含空格的用户名**：用户名部分由 `[^\\/\s]+` 改为 `[^\\/\r\n]+`，不再在空白处截断，而是取到下一个路径分隔符为止；`C:\Users\John Smith\r.jsonl` 现在整段用户名被替换为 `[REDACTED]`。
- 新增测试 `[AC-075] user directory matching ignores case and covers names with spaces`，覆盖小写 `users`、大写 `/HOME`、含空格用户名三种输入。

修复后的独立探针输出（同一 `classifyIdentity` 入口）：

- `c:/users/alice/r.jsonl` → `c:\users\[REDACTED]\r.jsonl`
- `/HOME/bob/r.jsonl` → `/HOME/[REDACTED]/r.jsonl`
- `C:/Users/John Smith/r.jsonl` → `C:\Users\[REDACTED]\r.jsonl`

修复后重新执行验收：

- AC-075 主命令：`# tests 22`、`# pass 22`、fail/cancelled/skipped/todo 均为 0，打印 `AC-075 OK`，退出码 0。
- Session 兼容回归命令：`# tests 26`、`# pass 26`，其余计数均为 0，打印 `AC-075 OK`，退出码 0。两条命令本轮均已实际执行。
- `check-seams`、`check-unused`、`check-no-model-table` 复跑仍为 ok。

F3 属于编排侧的 CI 证据补录，不涉及代码；acceptance.md 的两条命令本轮都已运行，可直接作为下一轮 `ci-results.json` 的补录依据。未修改 review.md、verdict.json、state.json、run.json 等受保护文件。
