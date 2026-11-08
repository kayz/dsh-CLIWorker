---
write_scope:
  - lib/session.mjs
  - lib/providers/call.mjs
  - lib/contract/views.mjs
  - test/contract/session.test.mjs
  - test/unit/session-invalidation.test.mjs
  - test/integration/session-quota.test.mjs
---

# Task 032 设计：Session 协议（T-032，M2）

基准：分支 `task/032`，起点提交 `040d2e9`（`chore(008): mark merged after human permission`）。brief 没有另给验收报告路径。该提交上的基线事实：

- `node scripts/run-tests.mjs` 全量：`tests 326 / pass 323 / fail 3`。三个失败是基线遗留，不属于本任务：`[AC-006] failures are reported on ctx.stderr and never leave the process`、`[AC-013] git check-ignore -v matches config/a.local.json, state/x, a.jsonl and .collab/x`、`[AC-073] check-no-collab reports zero references in the repository`。
- `node scripts/check-defects.mjs`、`check-traceability.mjs`（`covered=28 planned=46`）、`check-seams.mjs`、`check-unused.mjs` 均 ok；`check-no-collab.mjs` 失败（同一批遗留，2 个 violation）。
- `lib/session.mjs`、`lib/providers/` 都不存在；`lib/contract/views.mjs` 只有 `VIEW_NAMES` 与 `resolveView`。
- `node scripts/run-tests.mjs --ac AC-076` 输出 `FAIL run.no_match AC-076`。

权威规格：`SESSION-MANAGEMENT.md`；`.collab/blueprint/cliworker-v2/task-graph.json` 里 AC-076 的正文；`interfaces.md` §11（`policy.session_ttl_s` 默认 43200）、§16（时钟）；`design.md`（蓝图）§11（身份四档）；`contracts/agentline-forbidden.json`；`lib/contract/scan.mjs`。本文不新增 `contracts/` 下任何文件。

## 1. 范围与已知的规格冲突

交付：

- `lib/session.mjs`：无状态的 session 协议——`startSession`、`resumeSession`、token 编解码、六种失效条件检查、增量输入拼装、角色策略与其落盘。
- `lib/providers/call.mjs`（新建）：session 描述符校验、调用描述构造、session id 提取、身份分档。只含 session 需要的函数；`T-015`、`T-031` 以后在同一文件追加，不要改动本任务导出的签名。
- `lib/contract/views.mjs`：追加纯函数 `sessionView` 与常量；`resolveView`、`VIEW_NAMES` 一字不改。
- 三个测试文件，全部用例标题以 `[AC-076]` 开头。

### 1.1 本任务的裁决（遇到冲突时以此为准）

1. **错误码以 AC-076 正文为准，而不是 `SESSION-MANAGEMENT.md` §8。** 正文给出 `E_SESSION_NOT_SUPPORTED`（文档里叫 `E_SESSION_UNSUPPORTED`）、`E_SESSION_PROVIDER_CHANGED`（文档没有）、`E_SESSION_QUOTA_EXHAUSTED`（文档没有）。文档里的 `E_SESSION_NOT_FOUND` 不由 CLIWorker 产生：resume 失败一律是 `E_SESSION_RESUME_FAILED`，不解析 provider 的失败文本（brief 非目标）。`E_SESSION_ID_MISSING`、`E_SESSION_START_FAILED` 保留（start 路径需要）。
2. **这些码不进注册表。** `lib/contract/registry.mjs`、`contracts/registry.snapshot.json`、`contracts/schemas/error-envelope.schema.json` 都不在 write_scope，且注册表按 R7 冻结，新码只能走蓝图变更。所以本任务的 session 码只在 `lib/session.mjs` 的 `SESSION_ERRORS` 里定义，错误对象的形状与错误体一致（`{code, message, retryable, retry_after}`），但**不声称**通过 `error-envelope.schema.json`（其 `code` 枚举不含它们）。`E_REQUEST_INVALID` 是注册表里已有的码，输入校验失败用它。把 session 码登记进注册表是后续蓝图变更，不属于本任务。
3. **`sessions/<role>.json` 由 CLIWorker 写的只是「角色策略」，不是 session 记录。** `SESSION-MANAGEMENT.md` §4 把同一路径给了 AgentLine 的 `agentline.session/v1` 记录（含 `session_id`），而 AC-076 要求「角色策略落盘到 `.collab/tasks/<id>/sessions/<role>.json`」，brief 又禁止 CLIWorker 保存 `session_id`。裁决：CLIWorker 只在该路径写 `cliworker.session-policy/v1`（§6），且只在文件不存在或已是该 schema 时写；若文件已是别的 schema（AgentLine 的记录），不覆盖，返回 `written:false`。该文件不含 `session_id`、不含 token。
4. **start/resume 在库层交付，不接 CLI 与 HTTP。** 路由与命令不在 write_scope。`target`（含 provider、模型 id、CLI 版本、session 描述符）由 CLIWorker 内部调用方提供，不经 AgentLine 视图；`T-015`/`T-022` 负责把它接到租约与选模上。
5. **`lib/exec.mjs` 不转发 stdin**（不在 write_scope）。`call.mjs` 以 `ctx.exec(command, args, {cwd, input, timeout})` 调用，`input` 是 stdin 文本；测试用的伪 exec 能看到它。真实 exec 转发 stdin 属 T-015，不属本任务。
6. **身份对象只给 `level`、`identity_source`、`consistent`、`observed_at`，不含模型名。** AC-076 要求 session 输出不含模型 id，而 `scan.mjs` 会对所有字符串值做整词匹配；`requested_model`/`reported_model` 的完整对象由 T-031 的 `lib/identity.mjs` 负责，T-032 不依赖它（T-032 只依赖 T-004）。
7. **`reply` 是唯一透传字段**：provider 的原始 stdout 文本，原样放进结果，不参与泄露约束（模型自己的输出可能提到自己的名字）。除 `reply` 外，结果里不得出现 provider 名、CLI 命令/路径、模型 id、`model_key`。
8. **非目标（不做，也不要为它们加字段）**：并发同一 session 的互斥、usage/cache 记账、`session_id` 持久化、轮次状态、AgentLine 侧的 `agentline.session/v1` 记录、provider 的 resume 参数以外的行为解析、真实 provider 的描述符数据（`config.v2` schema 不在 write_scope）。

## 2. lib/contract/views.mjs 追加

保持纯：不 import、不用 `node:`、`Date`、定时器、`process.env`（`test/contract/registry.test.mjs` 的纯度测试会扫）。追加导出：

| 导出 | 内容 |
|---|---|
| `SESSION_RESULT_SCHEMA` | `'cliworker.session-result/v1'` |
| `SESSION_ACTIONS` | `['start', 'resume']` |
| `SESSION_IDENTITY_LEVELS` | `['verified', 'observed', 'unverified', 'failed']` |
| `sessionView(fields)` | 按白名单组装结果，见下 |

`sessionView({action, session_token, identity, reply, error})`：

- 成功（`error` 缺省或 `null`）：返回键顺序固定的 `{schema, ok:true, action, session_token, identity, reply}`。`session_token` 缺省为 `null`；`identity` 缺省为 `null`；`reply` 缺省为 `''`。
- 失败（`error` 是 `{code, message, retryable, retry_after}`）：返回 `{schema, ok:false, action, error}`；当 `identity` 不是 `null`（说明 provider 调用已执行）时，在 `error` 后追加 `identity`。`error` 只保留这四个键，`retry_after` 缺省 `null`。
- `action` 不在 `SESSION_ACTIONS` 时抛 `TypeError`。任何输入里的其他键一律丢弃（这是防泄露的白名单，不是透传）。

## 3. lib/providers/call.mjs

零依赖，只 import `node:path`。导出：

### 3.1 描述符（`SESSION-MANAGEMENT.md` §3 的 `session` 对象）

```
{ supported, start:{command,args,input,cwd}, resume:{command,args,input,cwd},
  id_from, id_path, id_pattern, id_file, reset_on, supports_resume, reason,
  identity:{source, model_path, file} }
```

`id_pattern`（正则源码，第 1 个捕获组是 id）与 `id_file` 是为 `stdout_regex`/`stderr_regex`/`sidecar_file` 补的字段（文档只规定了 `id_path` 用于 JSON 路径）；`identity` 整块可选。`reset_on` 原样保留、不解释。

`validateSessionDescriptor(descriptor)` → `{ok, resumable, problems}`（`problems` 是固定字符串数组，不含任何描述符内容）：

- `ok` = `supported === true` 且 `problems` 为空。`supported` 不是 `true` 时 `ok:false`，`problems` 含 `'unsupported'`。
- `start.command` 非空字符串；`start.args` 是字符串数组；`start.input === 'stdin'`。
- `id_from` ∈ `['stdout_json','stdout_regex','stderr_regex','sidecar_file']`；`stdout_json` 需要字符串 `id_path`；两个 regex 模式需要能编译且含捕获组的 `id_pattern`；`sidecar_file` 需要字符串 `id_file`（可再带 `id_path`，则文件内容按 JSON 取路径）。
- `supports_resume` 必须是布尔。为 `false` 时必须有非空字符串 `reason`；为 `true` 时 `resume.command`、`resume.args`、`resume.input === 'stdin'` 同样合法，且 `resume.args` 里至少一个元素含子串 `{session_id}`。
- `identity` 若存在：`source` ∈ `IDENTITY_SOURCES`，`model_path` 是字符串；`source === 'rollout-file'` 时需要字符串 `file`。
- `resumable` = `ok && supports_resume === true`。

`IDENTITY_SOURCES` = `['stdout.modelUsage','stdout.event.model','stats.models','rollout-file','cli_flag','none']`（蓝图 §11.2）。

### 3.2 调用构造与执行

`buildSessionCall(descriptor, {mode, session_id, cwd})` → `{command, args, cwd, input:'stdin'}`：

- `mode` 为 `'start'` 用 `descriptor.start`，为 `'resume'` 用 `descriptor.resume`；其他值抛 `TypeError`。
- `args` 逐元素处理：把元素里的 `{session_id}` 子串替换为 `session_id`；绝不拼接成 shell 字符串，返回的仍是数组。`mode:'start'` 时不替换。
- `session_id` 必须匹配 `SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/`，否则抛 `TypeError`（含空格、引号、分号、`$`、反引号、换行都被拒；`session.mjs` 在把 id 放进 token 之前已经校验，所以正常路径不会走到这里）。
- `cwd` 取参数值，不用描述符里的 `<workspace>` 占位。

`runSessionCall(ctx, spec, text, timeout_ms)` → `ctx.exec(spec.command, spec.args, {cwd: spec.cwd, input: text, timeout: timeout_ms})` 的返回值原样返回；只调用一次，不重试。

### 3.3 session id 提取

`extractSessionId(descriptor, {stdout, stderr}, readFile)` → 字符串或 `null`（`readFile(file)` 由调用方传入，内部用 `ctx.fs.readFileSync(path.resolve(cwd, id_file), 'utf8')`）：

- `stdout_json`：先把整段 stdout 当一个 JSON 解析；失败则逐个非空行解析；按点分隔的 `id_path` 在每个解析结果里取值，取第一个非空字符串（数字转字符串）。路径段为 `__proto__`、`constructor`、`prototype` 时视为取不到。
- `stdout_regex`/`stderr_regex`：`new RegExp(id_pattern)` 在对应流上 `exec`，取第 1 个捕获组。
- `sidecar_file`：读 `id_file`；有 `id_path` 则按 JSON 取路径，否则 `trim()` 后整段作为 id；读失败返回 `null`。
- 结果必须匹配 `SESSION_ID_RE`，否则返回 `null`。

### 3.4 身份分档

`classifyIdentity({descriptor, result, requested_model, readFile, cwd, observed_at})` → `{level, identity_source, consistent, observed_at}`：

1. `result.ok !== true` → `{level:'failed', identity_source:'none', consistent:null}`。
2. 无 `descriptor.identity`，或取不到报告的模型 → `{level:'unverified', identity_source:'none', consistent:null}`。
3. 报告的模型：`source === 'rollout-file'` 时从 `identity.file` 读取（逐行 JSON，取 `model_path`），其余来源从 `result.stdout` 取 `model_path`（取法同 §3.3）。
4. 分档：`stdout.modelUsage`、`stdout.event.model`、`stats.models` → `verified`；`rollout-file` → `observed`；`cli_flag`、`none` → `unverified`。`identity_source` 回填描述符声明的 `source`（取不到报告模型时见第 2 条）。
5. `consistent` = 报告的模型是否等于 `requested_model`（`true`/`false`）；没有报告的模型时 `null`。不一致只是如实报告，不改变档位，不拒绝（蓝图 §10.1：明确冲突由 AgentLine 处理）。

`unverified` 与 `observed` 不阻断：照常返回成功结果（蓝图 §11.1）。

## 4. lib/session.mjs

只 import `node:crypto`（`createHash`）、`node:path`、`./providers/call.mjs`、`./contract/views.mjs`、`./output.mjs`（`errorBody`，仅用于 `E_REQUEST_INVALID`）。不保存任何模块级状态；不读环境变量；时间只取 `ctx.clock.now()` / `ctx.clock.nowIso()`；`start`/`resume` 过程中**不写任何文件**（`ctx.fs` 只有 `writeRolePolicy` 会写）。函数全部同步（`ctx.exec` 是同步契约）。

### 4.1 错误表

导出 `SESSION_ERRORS`（冻结）。每项 `{code, retryable, message}`，`message` 是固定字符串，**不拼接** stderr、argv、provider、模型、路径、token：

| code | retryable | 条件 |
|---|---|---|
| `E_SESSION_MODEL_CHANGED` | false | token 绑定的模型与 `target.model_key` 不同 |
| `E_SESSION_PROVIDER_CHANGED` | false | token 绑定的 provider 与 `target.provider` 不同 |
| `E_SESSION_CONTRACT_CHANGED` | false | CLI 版本或契约版本变化 |
| `E_SESSION_EXPIRED` | false | token 签发（或上次 resume）距今超过 `ttl_s` |
| `E_SESSION_RESUME_FAILED` | false | resume 的 provider 调用失败 |
| `E_SESSION_NOT_SUPPORTED` | false | 描述符 `supported` 不为 `true`、非法，或 resume 时 `supports_resume` 不为 `true` |
| `E_SESSION_QUOTA_EXHAUSTED` | false | 传入的 forecast 的 `risk` 为 `critical` 或 `exhausted` |
| `E_SESSION_START_FAILED` | false | start 的 provider 调用失败 |
| `E_SESSION_ID_MISSING` | false | start 成功但按 `id_from` 取不到合法 session id |

导出 `INVALIDATION_CODES`，顺序固定为 AC-076 的写法：`['E_SESSION_MODEL_CHANGED','E_SESSION_PROVIDER_CHANGED','E_SESSION_CONTRACT_CHANGED','E_SESSION_EXPIRED','E_SESSION_RESUME_FAILED','E_SESSION_NOT_SUPPORTED']`。全部 `retryable:false` 的含义：CLIWorker 内部**不会**自动重试，调用方的补救动作是新建 session（额度耗尽时先换模型）。`retry_after` 恒为 `null`。

### 4.2 token

`session_token` = `'st_'` + base64url（无填充）( `JSON.stringify({v:1, s, m, p, c, t})` )：

- `s`：provider 给的 session id（`SESSION_ID_RE`）。这是 token 里唯一来自 provider 的字段，CLIWorker 不另存。
- `m`、`p`、`c`：`sha256(label + '\n' + value)` 十六进制的前 12 位。`m` 的 label 是 `model`，值为 `target.model_key`；`p` 的 label 是 `provider`，值为 `target.provider`；`c` 的 label 是 `contract`，值为 `` `${cli_version ?? 'unknown'}\n${contract_version}` ``，其中 `contract_version` 缺省为 `SESSION_RESULT_SCHEMA`。
- `t`：签发时刻 `ctx.clock.now()`（整数毫秒）。

token 不含 provider 名、CLI 路径、模型 id（只有摘要与 provider 自己的 session id）。解码失败（前缀不对、不是 base64url、JSON 非法、字段缺失或类型不对、`s` 不合 `SESSION_ID_RE`、`m/p/c` 不是 12 位十六进制、`t` 不是有限整数）→ `E_REQUEST_INVALID`，`message` 为固定字符串 `session_token is malformed`，不回显 token。

导出 `issueToken(ctx, target, session_id)`、`decodeToken(token)`（失败返回 `null`）。

### 4.3 target、输入、描述符

`target` = `{model_key, provider, model_id, cli_version, contract_version?, cwd, session}`。`model_key`、`provider`、`model_id`、`cwd` 必须是非空字符串，`session` 是描述符，否则 `E_REQUEST_INVALID`（`message` 固定为 `target is invalid`）。

增量输入 `input`：

- start 允许键：`prompt`、`summary`、`diff`、`findings`、`constraints`。
- resume 允许键：`summary`、`diff`、`findings`、`constraints`。**出现其他任何键**（尤其 `brief`、`design`、`docs`、`prompt`）→ `E_REQUEST_INVALID`，`message` 固定为 `resume accepts only summary, diff, findings, constraints`（start 为 `input has an unsupported key`）；provider 不会被调用。
- 值必须是非空字符串，或元素都是字符串的非空数组（用 `\n` 连接）。至少要有一个键，否则 `E_REQUEST_INVALID`（`message` 为 `input is empty`）。
- 拼装 `composeInput(input)`（导出）：按 `prompt, summary, diff, findings, constraints` 的固定顺序，每段为 `` `## ${name}\n${text}\n` ``，段间用 `\n` 连接；没给的键不出现。这就是传给 `ctx.exec` 的 `input`。

### 4.4 startSession(ctx, {target, input, timeout_ms})

`timeout_ms` 缺省 `1800000`。按顺序：

1. 校验 `target`、`input`（start 规则）。失败 → `E_REQUEST_INVALID`，**不调用 provider**。
2. `validateSessionDescriptor`：`ok` 为 `false` → `E_SESSION_NOT_SUPPORTED`，不调用 provider。
3. `buildSessionCall(..., {mode:'start', cwd: target.cwd})`；`runSessionCall` 恰好一次。
4. 调用失败（`result.ok !== true`）→ `E_SESSION_START_FAILED`，带 `classifyIdentity` 得到的 `failed` 身份，不重试。
5. `extractSessionId` 为 `null` → `E_SESSION_ID_MISSING`，带身份。
6. 成功：`identity = classifyIdentity(...)`；`session_token`：`resumable` 时为 `issueToken(...)`，否则为 `null`（该 provider 只能每次新建）；`reply = result.stdout`。

### 4.5 resumeSession(ctx, {target, token, input, forecast, ttl_s, timeout_ms})

`ttl_s` 缺省 `DEFAULT_SESSION_TTL_S = 43200`（导出，等于 `policy.session_ttl_s` 的默认值）；`forecast` 可选，是该次选中模型的 `cliworker.forecast/v1`。检查顺序固定，**第一个命中即返回，且在第 9 步之前 provider 不会被调用**：

1. `decodeToken(token)` 为 `null` → `E_REQUEST_INVALID`。
2. 校验 `target`、`input`（resume 规则）→ `E_REQUEST_INVALID`。
3. 描述符不是 `resumable`（`supported` 不为 `true`、非法，或 `supports_resume` 不为 `true`）→ `E_SESSION_NOT_SUPPORTED`。
4. `p` 与 `target.provider` 的摘要不同 → `E_SESSION_PROVIDER_CHANGED`。（provider 先于模型检查：`model_key` 通常随 provider 一起变，要让 provider 变化得到自己的码。）
5. `m` 与 `target.model_key` 的摘要不同 → `E_SESSION_MODEL_CHANGED`。
6. `c` 与当前 `cli_version`/`contract_version` 的摘要不同 → `E_SESSION_CONTRACT_CHANGED`。
7. `ctx.clock.now() - t > ttl_s * 1000` → `E_SESSION_EXPIRED`（恰好等于 `ttl_s` 不算过期，多 1 毫秒才算）。
8. `forecast` 存在且 `forecast.risk` 为 `'critical'` 或 `'exhausted'` → `E_SESSION_QUOTA_EXHAUSTED`。`low_reserve`、`ok`、`unknown`、没有 forecast 都放行。只读传入的 forecast，resume 内部不拉取模型列表，也不调用任何额外命令。
9. `buildSessionCall(..., {mode:'resume', session_id: s, cwd})`；`runSessionCall` 恰好一次。失败 → `E_SESSION_RESUME_FAILED`，带 `failed` 身份，不重试。
10. 成功：`identity = classifyIdentity(...)`；返回 **新** token（同一 `s`、`t = now`），`reply = result.stdout`。resume 不重新提取 session id。

### 4.6 角色策略

`ROLE_POLICIES`（冻结，键即角色名；`SESSION-MANAGEMENT.md` §2）：

| role | mode | shares_with | 含义 |
|---|---|---|---|
| `design` | `reuse` | `null` | 同一任务跨轮复用 |
| `design_prereview` | `reuse` | `design` | 复用 design 的 session，只算作者自检 |
| `dev` | `reuse` | `null` | 同一任务跨轮复用；修 bug 回原 session |
| `review` | `new_each_round` | `null` | 每次 review 新建独立 session；不得复用 design/dev 的 session |
| `test_architect` | `configurable` | `null` | 缺省每轮新建，由流程用 `reuse:true` 打开复用 |

- `rolePolicy(role)`：返回上表对应项的拷贝；未知角色抛 `TypeError`。
- `nextAction(role, {hasActiveRecord, reuse})` → `'start'` 或 `'resume'`：`reuse` 模式在 `hasActiveRecord === true` 时为 `resume`，否则 `start`；`new_each_round` 恒为 `start`；`configurable` 在 `reuse === true && hasActiveRecord === true` 时为 `resume`，否则 `start`。
- `writeRolePolicy(ctx, {taskDir, task, role, ttl_s})`：见 §6。

## 5. 统一的结果形状

所有 start/resume 返回值都经 `sessionView` 组装（§2）。成功示例：

```json
{ "schema": "cliworker.session-result/v1", "ok": true, "action": "resume",
  "session_token": "st_…",
  "identity": { "level": "verified", "identity_source": "stdout.event.model", "consistent": true, "observed_at": "2026-11-08T00:00:00.000Z" },
  "reply": "…" }
```

失败示例（provider 调用已执行时才有 `identity`）：

```json
{ "schema": "cliworker.session-result/v1", "ok": false, "action": "resume",
  "error": { "code": "E_SESSION_RESUME_FAILED", "message": "…", "retryable": false, "retry_after": null },
  "identity": { "level": "failed", "identity_source": "none", "consistent": null, "observed_at": "…" } }
```

除 `reply` 外，结果必须能通过 `scanView`（`contracts/agentline-forbidden.json`，catalog 含该 target 的 `key`/`id`/`cli`）零命中；结果里没有 `forecast`、`provider`、`cli`、`model_key`、`token`（精确键名，`session_token` 不是被禁键）。

## 6. 角色策略落盘

`writeRolePolicy(ctx, {taskDir, task, role, ttl_s})`：

- `role` 必须在 `ROLE_POLICIES` 里（同时挡住路径穿越）；`task` 匹配 `^[A-Za-z0-9._-]+$`；`taskDir` 非空字符串；否则返回 `E_REQUEST_INVALID` 的结果形状（`{ok:false, error}`，不写文件）。
- 目标路径 `path.join(taskDir, 'sessions', role + '.json')`；先 `ctx.fs.mkdirSync(dir, {recursive:true})`。
- 若目标已存在且 JSON 的 `schema` 不是 `cliworker.session-policy/v1`（含解析失败）→ 不动它，返回 `{ok:true, written:false, reason:'foreign_schema', path}`。
- 否则原子写：`JSON.stringify(value, null, 2) + '\n'` 写到 `<path>.tmp`，再 `ctx.fs.renameSync`。写或改名抛错时，`rmSync` 清掉临时文件并返回 `{ok:false, error}`（`E_INTERNAL`，`message` 固定为 `failed to write session policy`），目标文件保持原样，不留半截文件。
- 内容（键顺序固定）：

```json
{
  "schema": "cliworker.session-policy/v1",
  "task": "032",
  "role": "dev",
  "mode": "reuse",
  "shares_with": null,
  "ttl_s": 43200,
  "invalidate_on": ["E_SESSION_MODEL_CHANGED", "E_SESSION_PROVIDER_CHANGED", "E_SESSION_CONTRACT_CHANGED", "E_SESSION_EXPIRED", "E_SESSION_RESUME_FAILED", "E_SESSION_NOT_SUPPORTED"]
}
```

`invalidate_on` 即 `INVALIDATION_CODES`；`ttl_s` 缺省为 `DEFAULT_SESSION_TTL_S`。成功返回 `{ok:true, written:true, path}`。文件内容不含 `session_id`、`session_token`、`st_`、provider、模型。

## 7. 测试

所有 `test(` 标题以 `[AC-076]` 开头。伪 exec/时钟/fs 用 `test/helpers/ctx.mjs` 与 `test/helpers/clock.mjs`；integration 里要写真实文件时用 `fs.mkdtempSync(path.join(os.tmpdir(), 's032-'))`，结束 `rmSync`；不访问真实家目录与真实 provider。提取 id 的四种模式、四档身份各至少一例；所有 `target` 用不存在的 CLI 名。

| 文件 | 内容 |
|---|---|
| `test/contract/session.test.mjs` | 错误表（9 个码、`retryable:false`、固定 message、`INVALIDATION_CODES` 顺序）；注册表未被改动（`getCode` 查不到 `E_SESSION_*`，且 `contracts/registry.snapshot.json` 与 `REGISTRY` 仍深相等）；`sessionView` 的键顺序与白名单（多余键被丢弃）；start/resume 成功与失败的结果形状；token 前缀、解码键集、不含 provider/CLI/模型 id；`scanView` 零命中（`reply` 置空后）；start/resume 过程中 `ctx.fs` 无写入（用 `fakeFs().accessed` 断言）；`validateSessionDescriptor`；`buildSessionCall` 的数组/不拼 shell/`{session_id}` 替换/非法 id 抛错；`extractSessionId` 四种 `id_from`；`ROLE_POLICIES` 表与 `nextAction`；`views.mjs` 仍满足纯度扫描 |
| `test/unit/session-invalidation.test.mjs` | 六种失效条件各返回固定码、`retryable:false`、`exec` 调用次数（前置检查 0 次，`RESUME_FAILED` 恰好 1 次）；检查顺序（provider 与模型同时变 → `PROVIDER_CHANGED`）；固定时钟下的过期边界（`ttl_s*1000` 不过期，`+1` 毫秒过期）；resume 成功重新签发 token 且 `t` 更新；增量输入白名单与 `composeInput` 字节级输出；`brief`/`design` 被拒且 provider 未被调用；身份四档；`supports_resume:false` 的 start 返回 `session_token:null` |
| `test/integration/session-quota.test.mjs` | 用真实 `lib/forecast.mjs` 的 `buildForecast({model, quota:{remaining_pct}, now})` 产出 forecast（基线实测：`remaining_pct:80` → `risk:'ok'`，`3` → `critical`，`0` → `exhausted`）：额度充足时 resume 成功；把 `remaining_pct` 降到 `0`（或 `3`）后同一 token 得到 `E_SESSION_QUOTA_EXHAUSTED`，provider 未被调用；调用方换另一个 `target` 用 `summary + diff` 新建成功，新 token 与旧 token 不同，且送给 provider 的 stdin 恰为 `composeInput({summary, diff})`；design/dev 跨轮复用（`nextAction` + 连续 resume）；review 每轮 `start`，token 彼此不同；`writeRolePolicy` 在临时目录落盘五个角色文件、已有外来 schema 时不覆盖、改名失败时无半截文件；整个过程中 `ctx.exec` 只出现 session 调用（不拉模型列表）、`ctx.fetch` 调用 0 次 |

## 8. 完成前自检

- `node --test test/contract/session.test.mjs test/unit/session-invalidation.test.mjs test/integration/session-quota.test.mjs` 通过；`node scripts/run-tests.mjs --ac AC-076` 通过且 `filtered 3 files`。
- 全量 `node scripts/run-tests.mjs` 的失败集合是基线三条遗留的子集（不得新增失败）。
- `node scripts/check-defects.mjs`、`check-traceability.mjs`、`check-seams.mjs`、`check-unused.mjs` 仍 ok（不使用 `Date.now`、`new Date`、全局定时器；新文件里不留未导出且无引用的函数或 import）。
- `git diff --name-only 040d2e9` 与未跟踪文件都在 front matter 的 `write_scope` 内（外加 `.collab/tasks/032/**` 的流程产物）；`contracts/`、`lib/contract/registry.mjs` 没有改动。
- 不新增 `test/traceability/T-032.json`（不在 write_scope；AC-076 也不在 `contracts/spec/ac-index.json` 里，记录为后续蓝图变更）。
