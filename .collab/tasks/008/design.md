---
write_scope:
  - lib/cli.mjs
  - lib/output.mjs
  - lib/request.mjs
  - lib/commands/models/select.mjs
  - README.md
  - test/integration/cli-envelope.test.mjs
  - test/unit/request.test.mjs
  - test/characterization/defects/a5-ignored-fields.test.mjs
  - test/traceability/T-008.json
---

# Task 008 设计：CLI 统一 JSON 错误体、退出码与请求解析（T-008，M1）

基准：分支 `task/008`，起点提交 `86ff20e`（`chore(009): mark merged after human permission`）。brief 没有另给验收报告路径。该提交上：

- `node scripts/run-tests.mjs` 全量：`tests 312 / pass 309 / fail 3`，三个失败是基线遗留，不属于本任务：`[AC-073] check-no-collab reports zero references in the repository`、`[AC-013] git check-ignore -v matches ...`、`[AC-006] failures are reported on ctx.stderr and never leave the process`（`test/unit/import-safe.test.mjs:70`）。
- `node scripts/check-fast.mjs` 失败在 `check-no-collab.mjs`（同一批遗留，2 个 violation）。
- `node scripts/check-defects.mjs`、`check-traceability.mjs`、`check-seams.mjs`、`check-unused.mjs` 均 ok。
- `node scripts/run-tests.mjs --ac AC-023` / `--ac AC-024` 输出 `FAIL run.no_match ...`（还没有测试带这两个标签）。
- `node bin/cliworker.mjs models select --level Top --count 1`（有本机配置时）输出 draft 形状、退出码 0。

权威规格：`.collab/blueprint/cliworker-v2/interfaces.md` §1（ModelRequest v1）、§5（注册表与退出码）、§13（CLI）；`contracts/registry.snapshot.json`（运行时经 `lib/contract/registry.mjs` 的 `getCode` 读取，不自己抄一份退出码表）；`contracts/schemas/error-envelope.schema.json`、`request.v1.schema.json`；`lib/contract/views.mjs` 的 `resolveView`。本文不新增任何契约字段、码或 schema 名。

## 1. 范围

- 新增 `lib/output.mjs`：错误体、带码错误、退出码映射、JSON 输出。
- 新增 `lib/request.mjs`：`cliworker.request/v1` 解析与校验、警告、CLI 视图门控。
- 改写 `lib/cli.mjs`：除 `run` 外所有路径的 stdout 都是单个 JSON；错误统一走 `output.mjs`。
- 改写 `lib/commands/models/select.mjs`：用 `request.mjs` 解析、门控后再调 `selectModels`，把警告写进结果。
- 修正 `README.md` 里的请求示例。
- 新增测试 `test/integration/cli-envelope.test.mjs`（`[AC-023]`）、`test/unit/request.test.mjs`（`[AC-024]`）；在 `a5-ignored-fields.test.mjs` 末尾追加 `[fixed]`；新增 `test/traceability/T-008.json`。

### 1.1 不做的事与裁决

1. **`lib/select.mjs`、`lib/index.js`、`lib/commands/usage/*`、`init.mjs`、`paths.mjs` 等不在写域，不改。** `selectModels` 继续只产生 draft 形状；`lib/index.js` 的 HTTP `/cliworker/select` 路由不动（HTTP 门控、会话、AgentLine 视图属 T-022 及后续）。
2. **AgentLine 视图不在本任务。** 请求带 `schema:'cliworker.request/v1'` 且无 `compat:'draft'` 时 `resolveView` 返回 `agentline`；本任务里该分支暂用现有 draft 形状的选模结果输出，**不带** `W_DRAFT_DEPRECATED`，由 T-022 换成真正的 AgentLine 视图。不得为此自造视图字段。
3. **错误体只含 `ok` 与 `error`。** `error-envelope.schema.json` 顶层 `additionalProperties:false`，所以失败输出里不加 `warnings`（含 `W_TEST_CLOCK`）。`W_TEST_CLOCK` 只加在成功结果上，保持现状。
4. **命令文件里抛出的无码 `Error`**（例如 `usage record` 的 `bad --json`、`usage record requires model`）不在写域，不改；`cli.mjs` 把它们映射为 `E_INTERNAL`（退出码 1，stdout 仍是 JSON）。
5. **不带任何参数的 `main([])` 保持旧行为**：`stderr` 写 `ERROR: ${USAGE}\n`，`stdout` 为空，返回 `{exitCode:1}`，`USAGE` 常量一字不改。原因：`test/unit/import-safe.test.mjs`（AC-006，T-003 的测试，不在写域）有两处断言依赖它（`main([])` 与 `bin/cliworker.mjs` 无参数）。AC-023 的「每个命令」指带命令词的调用；`cliworker bogus`、`cliworker models bogus`、`cliworker usage` 都走 `E_UNKNOWN_COMMAND`。该测试里 `/missing/config.json` 的那一半断言（期望退出码 1）在基线就失败，是遗留，不要为它改回 `E_CONFIG` 的退出码 3。
6. **`E_UNSAFE_ARG`、`E_SCHEMA_UNSUPPORTED` 的 CLI 触发不进 AC-023 表**，但 `request.mjs` 对 `schema` 的校验要实现 `E_SCHEMA_UNSUPPORTED`（见 §3）。
7. **令牌与密钥**：错误体的 `message` 只取 `e.message`，不拼 `e.stack`、环境变量或请求原文；`E_INTERNAL` 同样。

## 2. lib/output.mjs

零依赖，只 import `./contract/registry.mjs` 的 `getCode`。导出：

| 导出 | 行为 |
|---|---|
| `codedError(code, message, extra)` | 返回 `Error`，`.code = code`，把 `extra` 里的 `retryable`、`retry_after` 挂上（缺省不挂） |
| `exitCodeFor(code)` | 注册表里该码的 `exit`；不在注册表返回 `1` |
| `errorBody(code, message, extra)` | `{ok:false, error:{code, message, retryable, retry_after}}`；`retryable` 缺省取注册表值，`retry_after` 缺省 `null`；码不在注册表时换成 `E_INTERNAL` |
| `errorBodyFrom(e)` | `e.code` 在注册表里则用它与 `e.message`；否则 `E_INTERNAL` 与 `e.message`（`e` 不是 Error 时用 `String(e)`） |
| `writeJson(ctx, value)` | `ctx.stdout.write(JSON.stringify(value, null, 2) + '\n')`，格式与现状一致 |

错误体的键顺序固定为 `ok`、`error`；`error` 内为 `code, message, retryable, retry_after`。输出必须通过 `contracts/schemas/error-envelope.schema.json`（`lib/contract/validate.mjs` 的 `validate`）。

## 3. lib/request.mjs

导出 `REQUEST_SCHEMA = 'cliworker.request/v1'`、`normalizeRequest(raw)`、`requestFromArgv(argv, ctx)`、`gateView(request)`。

### 3.1 normalizeRequest(raw) → `{request, warnings}`

纯函数，不读文件、环境、时钟。非法输入抛 `codedError`。校验顺序：

1. `raw` 不是普通对象 → `E_REQUEST_INVALID`。
2. `schema` 存在且不等于 `REQUEST_SCHEMA` → `E_SCHEMA_UNSUPPORTED`。
3. `level`：取 `raw.level`，缺失（`undefined`、`null`、空串）时取别名 `raw.tier`；仍缺失 → `E_LEVEL_REQUIRED`；不是字符串或大小写不敏感地不在 Top/High/Middle/Quick → `E_LEVEL_UNKNOWN`；规范成首字母大写形式（`top` → `Top`）。
4. `count`：缺省 `1`；必须是 1..10 的整数，否则 `E_REQUEST_INVALID`。
5. `usage`：缺省 `Normal`；大小写不敏感地取 Heavy/Normal/Light 并规范；其他值 `E_REQUEST_INVALID`。
6. `importance`：缺省 `normal`；只接受精确的 `normal`、`high`；其他任何值（含 `High`、`urgent`、非字符串）`E_REQUEST_INVALID`。
7. 可选字段类型：`request_id` 字符串；`require_readonly` 布尔；`cwd` 字符串；`timeout_ms` 正整数；`exclude_handles` 字符串数组；`view` 必须是 `lib/contract/views.mjs` 的 `VIEW_NAMES` 之一；`compat` 只接受 `'draft'`；违反 → `E_REQUEST_INVALID`。
8. draft 视图仍在读取的三个旧字段 `exclude`、`candidates`、`require_verified` 视为已知字段，原样保留、不警告（`selectModels` 确实在用它们，警告「被忽略」会撒谎）。不校验其类型。

警告（按 `raw` 的键顺序，每个字段至多一条）：

- `tier` 存在 → `{code:'W_FIELD_DEPRECATED', field:'tier'}`（`level` 与 `tier` 同时给时以 `level` 为准，仍给这条警告）。
- 既不在已知集合、也不是 `tier` 的字段 → `{code:'W_FIELD_IGNORED', field:<名>}`。例如 `role`。

已知集合 = `schema, request_id, level, count, usage, importance, require_readonly, cwd, timeout_ms, exclude_handles, view, compat, exclude, candidates, require_verified`。`timeout_ms`、`exclude_handles` 是 v1 契约字段但 draft 选模暂不消费，它们被带进规范化请求，不警告；T-022 接手。

返回的 `request` 是规范化结果：键顺序 `schema`（仅当输入给了）、`request_id`（仅当给了）、`level`、`count`、`usage`、`importance`，其后是给了的可选字段（按 §3.1 第 7、8 条的顺序）；`tier` 与被忽略的字段不进入结果。

### 3.2 requestFromArgv(argv, ctx) → `{request, warnings}`

三种写法等价，来源合并后交给 `normalizeRequest`：

- `--request <json>`：`JSON.parse`，失败 → `E_REQUEST_INVALID`。
- `--request-file <path>`：用 `ctx.fs.readFileSync(path, 'utf8')` 读后 `JSON.parse`，读失败或解析失败 → `E_REQUEST_INVALID`。
- 同时给 `--request` 与 `--request-file` → `E_REQUEST_INVALID`。
- 单项标志：`--level`、`--count`、`--usage`、`--importance`、`--request-id`（映射到 `request_id`）、`--cwd`。标志覆盖 JSON 里的同名字段。`--count` 的值必须匹配 `^\d+$` 才转成数字，否则原样（字符串）交给 `normalizeRequest` 触发 `E_REQUEST_INVALID`。标志缺值（后面没有参数）→ `E_REQUEST_INVALID`。
- 什么都没给时 `raw = {}`，得到 `E_LEVEL_REQUIRED`。

### 3.3 gateView(request) → `{view, warnings}`

调用 `resolveView({transport:'cli', request})`。`error` 为 `E_VIEW_FORBIDDEN` → 抛 `codedError('E_VIEW_FORBIDDEN', ...)`。否则返回 `{view, warnings}`，其中 `draft` 视图的警告为 `[{code:'W_DRAFT_DEPRECATED'}]`，`agentline` 为空（见 §1.1 第 2 条）。`view` 判定读取的是规范化请求里的 `schema`、`compat`、`view`。

## 4. lib/commands/models/select.mjs

`run({argv, ctx, config})`：

1. `requestFromArgv(argv, ctx)` → `{request, warnings}`（校验错误在此抛出，先于视图门控）。
2. `gateView(request)` → `{view, warnings: viewWarnings}`（`view:'full'` 在 CLI 抛 `E_VIEW_FORBIDDEN`，完整视图只在后续任务的 admin select）。
3. 与现在一样取 `providerStatus`、`readUsage`，调 `selectModels(config, request, {status, usage})`。
4. 若 `[...warnings, ...viewWarnings]` 非空，写进结果的 `warnings`；为空则不加该键（`cli.mjs` 之后可能再追加 `W_TEST_CLOCK`）。

`selectModels` 因 `level` 必填而不会再走到 `E_LEVEL_REQUIRED` 分支。成功但无候选（`ok:false, reason:'no_eligible_model'`）仍按现有行为输出、退出码 0，`E_NO_CANDIDATE` 属 T-022。

## 5. lib/cli.mjs

- `ROUTES`、`resolveRoute`、`CONFIG_FREE` 保持。`USAGE` 常量一字不改。
- `argv.length === 0`：保持旧行为（§1.1 第 5 条）。
- 有命令词但没有路由 → `E_UNKNOWN_COMMAND`，`message` 形如 `unknown command: <argv 前两项用空格连接>`，stdout 写错误体，退出码 `exitCodeFor` = 2，stderr 为空。
- 其余抛出的错误统一 `errorBodyFrom(e)` → stdout，退出码 `exitCodeFor(body.error.code)`。删除 `CONFIG_ERROR_CODES` 与 `e.exitCode` 的特判；`E_CONFIG`、`E_CONFIG_EXAMPLE`、`E_CONFIG_EXISTS` 因注册表退出码为 3 而保持原有行为（`config.test.mjs` 的 AC-013/AC-014 用例必须继续通过）。
- 成功路径不变：`warnAboutTestClock` 后用 `writeJson`，退出码 0。
- 任何路径都不向 stderr 写（`main([])` 的 usage 行除外）。

## 6. README.md

- CLI 示例里的 `--request '{"role":"dev","tier":"top","count":2,"importance":"high"}'` 换成不产生任何警告的写法，并展示三种等价形式。
- 约定：README 中的请求示例只有两类，且都必须能被本任务的解析器无警告通过——① 围栏代码块，语言标记写成 ` ```json request `，内容是一个请求 JSON；② 出现在 ` ```bash ` 块里、包含 `models select` 的行（参数按 shell 引号规则拆分，单引号内为一个参数）。两类各至少 1 条，`models select` 行至少 2 条（标志写法与 `--request`/`--request-file` 写法各至少 1 条）。
- 请求 JSON 示例带 `"schema": "cliworker.request/v1"`，`level` 用 `Top` 这类规范写法，不含 `role`、`tier`。
- 在「CLI」之后加一小节说明：错误体 `{ok:false, error:{code, message, retryable, retry_after}}`、退出码按 `contracts/registry.snapshot.json`、未知字段给 `W_FIELD_IGNORED`、`tier` 给 `W_FIELD_DEPRECATED`、不带 `schema` 走 draft 视图并带 `W_DRAFT_DEPRECATED`（0.3.0 移除）。不得复制整张注册表。
- 其余章节不动；README 里不得出现令牌、密钥。

## 7. 测试

| 文件 | AC 标签 | 内容 |
|---|---|---|
| `test/integration/cli-envelope.test.mjs` | `[AC-023]` | 表驱动，经 `main()` + `createFakeContext` 或 `bin/cliworker.mjs` 子进程：① 7 个码各一行 `E_REQUEST_INVALID`、`E_LEVEL_REQUIRED`、`E_LEVEL_UNKNOWN`、`E_UNKNOWN_COMMAND`、`E_CONFIG`、`E_CONFIG_EXAMPLE`、`E_VIEW_FORBIDDEN`：`JSON.parse(stdout)` 得单个值，`ok:false`，`error.code` 相符，退出码等于 `getCode(code).exit`，`retryable` 等于注册表值，body 通过 `error-envelope` schema，stderr 为空；② 成功命令（`providers`、`models list`、`models select`、`models forecast`、`usage summary`、`usage record`、`paths`、`init`）stdout 都能 `JSON.parse`；③ 带 `CLIWORKER_TEST_CLOCK_FILE` 时成功结果 `warnings` 含 `W_TEST_CLOCK`；④ 无码 `Error` 映射为 `E_INTERNAL`、退出码 1 |
| `test/unit/request.test.mjs` | `[AC-024]` | 三种写法等价；`role` → `W_FIELD_IGNORED`/`field:'role'`；`tier` → `W_FIELD_DEPRECATED`；`importance` 非法 → `E_REQUEST_INVALID`；level/count/usage 边界；`schema` 不支持 → `E_SCHEMA_UNSUPPORTED`；README 抽取的每个示例 `warnings` 为 `[]`；`gateView` 对 CLI 的 `full`/draft/agentline 三种结果 |
| `test/characterization/defects/a5-ignored-fields.test.mjs` | `[fixed] [AC-024]` | 文件末尾追加一个顶层 `test('[fixed] [AC-024] ...')`：对 live 的 `requestFromArgv`/`normalizeRequest` 给 `{level:'Quick', role:'dev', importance:'high'}`，断言 `warnings` 恰含 `W_FIELD_IGNORED`/`role`。`[repro]` 块一字不改（`defects.json` 登记了它的 sha256，`defects.json` 不改）；写成顶层 `test(`，不放进 `describe` |
| `test/traceability/T-008.json` | — | `{task:'T-008', milestone:'M1', entries:[{ac:'AC-023', status:'covered', files:['test/integration/cli-envelope.test.mjs']}, {ac:'AC-024', status:'covered', files:['test/unit/request.test.mjs','test/characterization/defects/a5-ignored-fields.test.mjs']}]}` |

测试不得访问真实家目录或真实 provider CLI：用 `createFakeContext`（`test/helpers/ctx.mjs`）或子进程时设置 `CLIWORKER_HOME` 到临时目录、provider 的 `cli` 用不存在的命令名。

## 8. 完成前自检

- `node scripts/run-tests.mjs --ac AC-023` 与 `--ac AC-024` 通过。
- 全量 `node scripts/run-tests.mjs` 的失败集合是基线三条遗留的子集（不得新增失败）。
- `node scripts/check-defects.mjs`、`check-traceability.mjs`、`check-seams.mjs`、`check-unused.mjs` 仍 ok（新文件里不留未导出且无引用的函数）。
- 改动文件都在 front matter 的 `write_scope` 内。
