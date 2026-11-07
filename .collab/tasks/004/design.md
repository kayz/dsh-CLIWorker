---
task: "004"
write_scope:
  - lib/contract/**
  - contracts/registry.snapshot.json
  - contracts/spec/surfaces.json
  - contracts/spec/migration-map.json
  - contracts/golden/**
  - contracts/examples/**
  - contracts/schemas/**
  - contracts/agentline-forbidden.json
  - scripts/snapshot-update.mjs
  - scripts/gen-contract-doc.mjs
  - scripts/check-contract-doc.mjs
  - scripts/check-no-collab.mjs
  - docs/contract.md
  - test/fixtures/no-collab/**
  - test/contract/registry.test.mjs
  - test/contract/examples.test.mjs
  - test/contract/freeze.test.mjs
  - test/contract/scan-canary.test.mjs
  - test/contract/spec-tracked.test.mjs
  - test/traceability/T-004.json
  - contracts/golden/manifest.json
  - scripts/check-golden-frozen.mjs
  - scripts/check-write-scope.mjs
---

# Task 004 设计：契约冻结

本任务把蓝图 interfaces 第 1～17 节中的契约一次性转写成仓库内文件。转写完成后，仓库任何文件都不再引用蓝图目录。下游任务（T-006、T-014、T-022、T-024、T-028 等）只读本任务产出，不改。

本文是实现规格。凡本文给出字面值（码名、触发编号、文件名、测试标题、输出行格式），实现必须逐字照写，不得自行增删改名。本文没有写的字段，不要加。

## 0. 基线与既有设施

- 基线：分支 `task/004`，起点提交 `93ebbb3`。T-001 已合并，已有 `scripts/run-tests.mjs`、`check-fast.mjs`、`check-traceability.mjs`、`milestone-gate.mjs`、`contracts/spec/ac-index.json`、`test/traceability/T-001.json`。
- `run-tests --ac AC-xxx` 的选择规则：枚举 `test/{unit,integration,contract,e2e,smoke,characterization,flows}/**/*.test.mjs`，挑出源码中含字面量 `[AC-xxx]` 的文件。所以每个测试标题必须含对应的 `[AC-xxx]`。
- `check-fast` 会按码点顺序执行 `scripts/check-*.mjs`（不含自身）再跑完整 `npm test`。因此本任务新增的四个检查脚本（`check-contract-doc`、`check-golden-frozen`、`check-no-collab`、`check-write-scope`）无需改 `check-fast` 就自动纳入。直接运行（无参数）时它们都必须在干净仓库上通过。
- `contracts/spec/ac-index.json` 属主是 T-001，本任务不得修改它，但要把它登记进 manifest（见 §6）。
- 本机 `core.autocrlf=true`。凡涉及哈希或逐字节比较，先把 `\r\n` 换成 `\n`（见 §6、§8）。所有本任务写出的文件一律 UTF-8 无 BOM、LF、以换行结尾。
- 本任务不改 `package.json`（不在 write_scope）。`npm run snapshot:update` 仍指向 `run-tests --update-snapshots`，本任务的快照更新入口是 `node scripts/snapshot-update.mjs`。

## 1. 实现顺序

1. `lib/contract/registry.mjs`（嵌入式注册表，无任何 import）。
2. `scripts/snapshot-update.mjs` 生成 `contracts/registry.snapshot.json`（首次，snapshot_version 为 1）。
3. `lib/contract/validate.mjs`，再写 `contracts/schemas/**` 与 `contracts/examples/**`。
4. `contracts/agentline-forbidden.json`、`lib/contract/scan.mjs`、`lib/contract/views.mjs`。
5. `contracts/spec/surfaces.json`、`migration-map.json`，`contracts/golden/**`。
6. `scripts/check-golden-frozen.mjs --write` 生成 `contracts/golden/manifest.json`（此后金标和规格不得再改）。
7. 其余脚本、`docs/contract.md`（由 `gen-contract-doc` 生成）、`test/fixtures/no-collab/**`、五个测试文件、`test/traceability/T-004.json`。
8. 对所有新文件执行 `git add <显式路径>`（AC-073 要求被 git 跟踪，暂存即算）。

## 2. 纯度约束（lib/contract/**）

`lib/contract/*.mjs` 全部是纯函数模块：
- 不导入任何模块（`registry.mjs` 必须零 import，因为测试会把它复制到临时目录动态加载；`validate.mjs`、`scan.mjs`、`views.mjs` 之间允许相互 import 相对路径，但不得 import `node:*`）。
- 不读文件，不取时间，不开定时器。数据（schema、forbidden 配置、catalog）都由调用方作为参数传入。
- 理由：T-003 的 `check-seams` 之后只允许 `lib/context.mjs`、`lib/store.mjs`、`lib/fsx.mjs` 导入 `node:fs`。读文件的辅助代码放在 `scripts/` 与 `test/`。

## 3. 注册表

### 3.1 文件与导出

`lib/contract/registry.mjs` 导出：

| 导出 | 说明 |
|---|---|
| `REGISTRY` | 深度冻结的纯 JSON 数据（只含 string/number/boolean/null/array/object，无 undefined），与快照深相等 |
| `getCode(code)` | 返回码条目或 `null` |
| `compareRegistry(frozen, current)` | 见 §3.5 |
| `checkFrozen(frozen, current)` | 见 §3.5 |
| `WRITE_ROUTE_ORDER` | `['session','readonly','csrf','body']`，与 `REGISTRY.write_route_order` 相同 |
| `decideGate(facts)` | 见 §3.4 |

### 3.2 `contracts/registry.snapshot.json` 结构

顶层键（顺序即写出顺序）：

```
schema: "cliworker.registry/v1"
snapshot_version: 1
codes: [ {code, exit, http_status, retryable, trigger_id, trigger} ... ]   // 30 项，顺序见 §3.3
write_route_order: ["session","readonly","csrf","body"]
warning_codes: ["W_FIELD_IGNORED","W_FIELD_DEPRECATED","W_CONFIG_V1","W_STALE_DATA","W_DRAFT_DEPRECATED","W_MODELS_MANUAL_REQUIRED","W_LEGACY_USAGE","W_TEST_CLOCK"]
reject_reasons:
  v1: ["excluded","level_mismatch","level_unassigned","availability_unverified","availability_blocked","availability_unavailable","availability_stale","deprecated","identity_unverified","identity_mismatch","readonly_unavailable","adapter_unverified","quota_low","quota_unknown_policy","reserve_protected"]
  admin_only: ["not_allowed"]
  draft: ["excluded","not_in_workspace_order","level:<Level>","availability:<state>","identity_unverified","readonly_unavailable","E_FORECAST_EXHAUSTION"]
draft_reason_mapping: [ {draft, v1} ... ]    // 10 项，见 §3.6
forecast_reasons: ["no_samples","capacity_unknown","ledger_capacity_unknown","credits_conversion_missing","usd_samples_missing","reading_stale","window_unknown"]
risk: ["ok","low_reserve","critical","exhausted","unknown"]
risk_basis: ["tasks","usd","fraction","none"]
tasks_left_basis: ["tasks","usd","none"]
thresholds:
  tasks:    [ {risk:"exhausted",op:"<=",value:0}, {risk:"critical",op:"<=",value:2}, {risk:"low_reserve",op:"<=",value:5}, {risk:"ok",op:"else",value:null} ]
  fraction: [ {risk:"exhausted",op:"<=",value:0}, {risk:"critical",op:"<",value:0.05}, {risk:"low_reserve",op:"<",value:0.15}, {risk:"ok",op:"else",value:null} ]
  priority: ["tasks","usd","fraction","unknown"]
availability: ["unverified","callable","blocked","unavailable","deprecated"]
identity: ["verified","unverified","mismatch"]
semantic_change: ["forecast.tasks_left","forecast.risk","handle.cli_removed","draft_reason_mapping","config_v1_to_v2"]
```

阈值表读法：按数组顺序取第一条满足的规则，`else` 兜底。`thresholds.tasks` 同时适用于依据 `tasks` 和 `usd` 的 `tasks_left`。

### 3.3 30 个码（顺序、字面值固定）

`retryable` 为 true 的只有 `E_TIMEOUT`、`E_INSUFFICIENT_QUOTA`、`E_LEASE_EXPIRED`（interfaces 第 5 节的「可重试」只修饰紧邻的码；`E_STATE_LOCKED` 不可重试）。`http_status` 与 `trigger` 文本由本文定稿，interfaces 只给出五个 403 的触发条件。

| # | code | exit | http | retryable | trigger_id | trigger |
|---|---|---|---|---|---|---|
| 1 | E_INTERNAL | 1 | 500 | false | internal_error | Unhandled exception or broken invariant inside CLIWorker |
| 2 | E_REQUEST_INVALID | 2 | 400 | false | request_invalid | Request field has an invalid type or value (level and schema have their own codes) |
| 3 | E_LEVEL_REQUIRED | 2 | 400 | false | level_missing | Request has no level |
| 4 | E_LEVEL_UNKNOWN | 2 | 400 | false | level_not_in_set | level is present but not Top, High, Middle or Quick (case-insensitive) |
| 5 | E_SCHEMA_UNSUPPORTED | 2 | 400 | false | schema_unsupported | schema is present but is not a supported version |
| 6 | E_UNSAFE_ARG | 2 | 400 | false | unsafe_argument | Argument or path rejected by the safe-execution rules |
| 7 | E_UNKNOWN_COMMAND | 2 | 404 | false | command_unknown | CLI command or sub-command is not in the command table |
| 8 | E_VIEW_FORBIDDEN | 2 | 403 | false | select_view_without_admin | select route asked for full or draft view without a valid session; CLI models select with view full |
| 9 | E_CONFIG | 3 | 500 | false | config_invalid | Config file is missing, unreadable or fails validation |
| 10 | E_CONFIG_EXAMPLE | 3 | 500 | false | config_is_example | Config has _example true or deep-equals the bundled example ignoring _example |
| 11 | E_CONFIG_EXISTS | 3 | 409 | false | config_exists | init would overwrite an existing config file |
| 12 | E_CONFIG_SECRET_INLINE | 3 | 400 | false | config_secret_inline | Config holds an inline secret value instead of a SecretRef |
| 13 | E_SECRET_BACKEND | 3 | 500 | false | secret_backend_failed | Secret backend is unavailable or rejected the read or write |
| 14 | E_STATE_LOCKED | 4 | 503 | false | state_lock_timeout | State lock was not acquired within lock_wait_ms |
| 15 | E_TIMEOUT | 4 | 504 | true | call_timeout | run exceeded timeout_ms and its process tree was killed |
| 16 | E_NO_CANDIDATE | 5 | 409 | false | no_candidate_available | No candidate passed the non-quota filters, or the rejections are not all quota-driven |
| 17 | E_INSUFFICIENT_QUOTA | 5 | 429 | true | all_candidates_quota_rejected | At least one candidate passed every non-quota filter and all such candidates were rejected by quota_low, reserve_protected or quota_unknown_policy |
| 18 | E_LEASE_UNKNOWN | 6 | 404 | false | lease_not_found | run was given a lease id that is not in the state directory |
| 19 | E_LEASE_EXPIRED | 6 | 410 | true | lease_past_expiry | Lease expires_at is earlier than now; the caller must request a new lease |
| 20 | E_LEASE_CONSUMED | 6 | 409 | false | lease_already_run | Lease was already used by an earlier run |
| 21 | E_LEASE_CONFIG_MISMATCH | 6 | 409 | false | lease_config_mismatch | --config or --state-dir passed to run differ from the ones recorded in the lease |
| 22 | E_PROVIDER_AUTH | 7 | 502 | false | provider_auth_failed | Provider CLI reported that it is not logged in or the token was rejected |
| 23 | E_PROVIDER_QUOTA | 7 | 429 | false | provider_quota_exhausted | Provider CLI reported that its own quota or rate limit is exhausted |
| 24 | E_PROVIDER_FAILED | 7 | 502 | false | provider_call_failed | Provider CLI exited non-zero for a reason other than auth or quota |
| 25 | E_ADMIN_REQUIRED | 8 | 403 | false | admin_route_no_session | Admin read or write route called without a valid session, including an expired one |
| 26 | E_LOOPBACK_ONLY | 8 | 403 | false | bootstrap_non_loopback | api/session or ui shell failed any of the three loopback checks |
| 27 | E_READONLY | 8 | 403 | false | write_route_readonly | Session is valid, the plugin is readonly, and the route is a write route |
| 28 | E_CSRF | 8 | 403 | false | write_route_csrf_invalid | Session is valid, the plugin is writable, and the csrf header is missing or does not match |
| 29 | E_HEALTH_DEGRADED | 9 | 503 | false | health_check_failed | At least one health check failed |
| 30 | E_SMOKE_DISABLED | 9 | 501 | false | smoke_not_enabled | Smoke command was invoked while smoke is not enabled |

退出码 0 表示成功（含 truncated），不是一个码，不进表。`trigger_id` 匹配 `^[a-z][a-z0-9_]*$`。

### 3.4 `decideGate(facts)`

纯函数，既是 403 五码互斥的参考实现，也是 T-024 之后的对照基准。

```
facts = {
  route: 'public' | 'select' | 'bootstrap' | 'admin_read' | 'admin_write',
  view_full_or_draft: boolean,   // 仅 select 使用
  loopback_ok: boolean,          // 仅 bootstrap 使用
  session_valid: boolean,
  readonly: boolean,
  csrf_valid: boolean
}
返回 null（通过，继续校验请求体）或下列五个码名之一。
```

判定：
- `public`：`null`。
- `select`：`view_full_or_draft && !session_valid` → `E_VIEW_FORBIDDEN`，否则 `null`。
- `bootstrap`：`!loopback_ok` → `E_LOOPBACK_ONLY`，否则 `null`。
- `admin_read`：`!session_valid` → `E_ADMIN_REQUIRED`，否则 `null`。
- `admin_write`：依次 `!session_valid` → `E_ADMIN_REQUIRED`；`readonly` → `E_READONLY`；`!csrf_valid` → `E_CSRF`；否则 `null`。

互斥含义：对 route 与全部布尔组合穷举，返回值至多一个码；五个码各自至少在一种组合下出现；`E_READONLY` 与 `E_CSRF` 只在 `session_valid` 为真时出现，`E_ADMIN_REQUIRED` 只在 `session_valid` 为假时出现。

### 3.5 `compareRegistry` 与 `checkFrozen`

`compareRegistry(frozen, current)` 返回 `{removed: string[], added: string[], changed: string[]}`，元素格式 `"<section>:<key>"`，三个数组各自按码点排序。比较的分区与键：

| section | 键 |
|---|---|
| `codes` | `code`；两侧都有但 `exit/http_status/retryable/trigger_id/trigger` 任一不同 → `changed` |
| `draft_reason_mapping` | `draft`；`v1` 不同 → `changed` |
| `thresholds.tasks`、`thresholds.fraction` | `risk`；`op` 或 `value` 不同 → `changed` |
| `warning_codes`、`reject_reasons.v1`、`reject_reasons.admin_only`、`reject_reasons.draft`、`forecast_reasons`、`risk`、`risk_basis`、`tasks_left_basis`、`availability`、`identity`、`semantic_change` | 元素值本身 |
| `write_route_order`、`thresholds.priority` | 有序列表；内容或顺序不同 → `changed` 且键为 `*` |

示例：删除 `E_CSRF` → `removed:["codes:E_CSRF"]`；把它改名为 `E_CSRF2` → `removed:["codes:E_CSRF"]`、`added:["codes:E_CSRF2"]`。`schema` 与 `snapshot_version` 不参与比较。

`checkFrozen(frozen, current)` 返回 `{ok, errors:[{id, detail}]}`，`id` 取值：
- `freeze.removed`：compareRegistry 的每个 removed 项。
- `freeze.changed`：每个 changed 项。
- `freeze.added`：每个 added 项（含义：注册表新增了条目但快照未更新）。
- `freeze.version`：除 `snapshot_version` 外两者深相等，但版本号不同。
`ok` 当且仅当两者深相等。

### 3.6 draft 到 v1 的原因映射（10 项，顺序固定）

| draft | v1 |
|---|---|
| excluded | excluded |
| not_in_workspace_order | excluded |
| level:<Level> | level_mismatch |
| availability:unverified | availability_unverified |
| availability:blocked | availability_blocked |
| availability:unavailable | availability_unavailable |
| availability:deprecated | deprecated |
| identity_unverified | identity_unverified |
| readonly_unavailable | readonly_unavailable |
| E_FORECAST_EXHAUSTION | quota_low |

一致性规则（测试里断言）：每个 `v1` 值属于 `reject_reasons.v1`；`reject_reasons.draft` 的每个模式都被至少一项覆盖（`level:<Level>` 与 `availability:<state>` 分别由对应前缀的项覆盖）。

### 3.7 `scripts/snapshot-update.mjs`

`node scripts/snapshot-update.mjs [--root <dir>]`，默认 root 为仓库根。从 `<root>/lib/contract/registry.mjs` 动态加载 `REGISTRY`（候选模块只需导出 `REGISTRY`；`compareRegistry` 取自脚本所在仓库自己的 `lib/contract/registry.mjs`），读取 `<root>/contracts/registry.snapshot.json` 作为已冻结版本。

流程与输出（每种情形只输出下面所列的第一行，另可有附加行；退出码固定）：

| 情形 | 行为 | stdout / stderr 首行 | exit |
|---|---|---|---|
| 快照文件不存在 | 仅当 `REGISTRY.snapshot_version === 1` 时写出 | `snapshot-update: wrote snapshot_version 1` | 0 |
| 与快照深相等 | 不写文件 | `snapshot-update: unchanged (snapshot_version N)` | 0 |
| 有 removed 或 changed | 不写文件 | `FAIL snapshot.breaking removed=<n> changed=<n>` | 1 |
| 无 removed/changed、无 added，但不相等 | 不写文件 | `FAIL snapshot.no_semantic_change` | 1 |
| 有 added 且 `REGISTRY.snapshot_version !== 旧版本 + 1` | 不写文件 | `FAIL snapshot.version_not_bumped have=<a> need=<b>` | 1 |
| 有 added 且版本恰为旧版本 + 1 | 写出快照 | `snapshot-update: wrote snapshot_version <N+1>` | 0 |
| 参数错误 | — | usage 信息 | 2 |

写出格式：`JSON.stringify(REGISTRY, null, 2) + "\n"`，键序即 REGISTRY 的书写顺序。开发者新增条目时，先改 `registry.mjs`（含手动把 `snapshot_version` 加 1），再运行本脚本。删除、改名、改值只能走蓝图变更，脚本一律拒绝。

## 4. 校验器 `lib/contract/validate.mjs`

导出：
- `validate(schema, doc, {loadSchema})` → `{ok, errors:[{path, keyword, message}]}`。`loadSchema(fileName)` 由调用方提供，返回已解析的 schema 对象，用于跨文件 `$ref`。
- `checkSchema(schema)` → `string[]`：列出 schema 中不受支持的关键字（形如 `"/properties/a: oneOf"`），空数组表示 schema 只用了支持集。

支持的关键字（其余一律视为不支持，`validate` 遇到直接抛 `TypeError`）：`type`（单个或数组：object/array/string/number/integer/boolean/null）、`enum`、`const`、`required`、`properties`、`additionalProperties`（布尔或 schema）、`items`（单个 schema）、`minItems`、`maxItems`、`uniqueItems`、`minLength`、`maxLength`、`pattern`、`minimum`、`maximum`、`$ref`；注解关键字 `$schema`、`$id`、`title`、`description`、`$defs`、`examples`、`default` 被忽略。不支持 `oneOf/anyOf/allOf/if/not/format`。

`$ref` 形态：`#/$defs/<name>`（本文件内）、`<file>.schema.json`、`<file>.schema.json#/$defs/<name>`（`<file>` 经 `loadSchema` 读取）。递归深度超过 64 抛 `TypeError`。

错误路径用 JSON Pointer（根为空串）：
- `required` 缺失：路径为 `<父路径>/<缺失属性名>`，keyword `required`。
- `additionalProperties:false` 的多余属性：路径为 `<父路径>/<多余属性名>`，keyword `additionalProperties`。
- 其余关键字：路径为被检查的值的位置，keyword 即该关键字名。
- 数组元素用下标，如 `/models/0/call/cwd`。
同一位置的同一违规只报一次；一个文档对一个关键字违规时不得连带产生别的错误（例如缺少必需属性不得再触发 `type`）。

## 5. Schema 与示例

### 5.1 Schema 文件（共 21 个，均在 `contracts/schemas/<name>.schema.json`）

**线上对象（14 个，需要示例）**。字段完全取自 interfaces 对应小节的示例；示例里有值的字段全部 `required`，类型照示例；除特别说明外 `additionalProperties:false`。

| 名称 | 来源 | 要点 |
|---|---|---|
| `request.v1` | 第 1 节 | `required:["schema","level"]`；`schema` const `cliworker.request/v1`；`level` 枚举 Top/High/Middle/Quick；`count` 整数 1..10；`usage` 枚举 Heavy/Normal/Light；`importance` 枚举 normal/high；`exclude_handles` 字符串数组；`additionalProperties:true`（未知字段只给 W_FIELD_IGNORED，不是 schema 错误） |
| `handle.v1` | 第 3 节 | `schema` const `cliworker.handle/v1`；`handle_id` 匹配 `^h_[A-Za-z0-9]+$`；`lease_id` 匹配 `^l_[A-Za-z0-9]+$`；`expires_at` 匹配 ISO-8601 UTC `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$`；`call` 在 `$defs/call`：必需 `command,args,cwd,input,output,timeout_ms`，`args` 恰 8 个字符串，`input` const `stdin`，`output` const `cliworker.event/v1`，`timeout_ms` 整数 ≥1 |
| `handle-full.v1` | 第 3 节完整视图 | `handle.v1` 的全部字段（`$ref` 复用 `$defs/call`）加必需的 `detail`：`model_key,cli,vendor,funding(plan\|paid),pools(字符串数组),forecast(object,允许任意键),direct_call{command,args,cwd,input,env_names}` |
| `selection-ok.v1` | 第 2 节成功 | `ok` const true；`models` 元素 `$ref handle.v1.schema.json`；`calls` 元素 `$ref handle.v1.schema.json#/$defs/call`；`rejected` 元素 `{ref,reason}`，`reason` 取 `reject_reasons.v1` 全部 15 项；`warnings` 元素 `{code(取 warning_codes),ref?,field?}`；`error` const null；`truncated` 布尔；`shortfall`、`count_requested`、`count_returned` 整数 ≥0；`generated_at` ISO |
| `selection-failed.v1` | 第 2 节失败 | `ok` const false；必需 `schema,ok,request_id,models,calls,truncated,shortfall,rejected,error`；`models`、`calls` `maxItems:0`；`truncated` const false；可选 `level,usage,count_requested,count_returned,warnings,generated_at`；`error` 必需 `code(取注册表 30 码),message,retryable,retry_after`，`retry_after` 为字符串或 null |
| `event.v1` | 第 4 节 | 必需 `schema,seq,lease_id,type,at`；`type` 枚举 start/text/usage/result/error；其余 `ok,exit_code,text,usage{input_tokens,output_tokens},code,retryable,message` 全部可选（按 type 的组合约束不在本 schema 内，由 T-003 的事件解析测试负责） |
| `forecast.v1` | 第 7 节 | `additionalProperties:true`（「只加字段」）；必需 `schema,status,model,remaining_mtok,remaining_fraction,pools,tokens_per_task,tasks_left,tasks_left_basis,tasks_left_assumed,burn_mtok_per_hour,eta_exhaust_at,exhausts_before_reset,risk,risk_basis,confidence,reason,burn_per_task,samples`；数值字段允许 null；`status` 枚举 known/unknown；`risk`、`risk_basis`、`tasks_left_basis` 取注册表枚举；`confidence` 枚举 none/low/medium/high；`reason` 为 null 或 `forecast_reasons` 之一 |
| `usage.v1` | 第 9 节 | `additionalProperties:true`；必需第 9 节示例中的全部键；`kind` 枚举 task/probe/manual |
| `pool` | 第 6 节（无 schema 字段） | `kind` 枚举 plan_window/plan_weekly/credits/prepaid_usd；`funding` 枚举 plan/paid；`window.reset_source` 枚举 cli/config/estimated/unknown；`capacity_mtok` 为 map（`additionalProperties` 为 `{value,source,confidence?}`）；`credits_per_mtok` 数值或 null |
| `model.v1` | 第 10 节 | 必需示例中的全部键；`level` 可 null；`availability.state` 取注册表 `availability`；`availability.reason` 与 `availability.evidence` 可 null；`identity` 取注册表 `identity`；`level_source` 为 `{kind(config\|measured\|cli),ref,at}` 或 null；`source.kind` 枚举 subcommand/help/cache/api/manual；`deprecated` 布尔 |
| `inventory.v1` | 第 10 节 | 必需 `schema,generated_at,host,entries`；`entries` 元素必需示例中的全部键；`status` 枚举 present/gone；`auth.state` 枚举 logged_in/logged_out/token_ref/unknown |
| `config.v2` | 第 11 节 | 顶层必需 `schema,state_dir,secrets,discovery,catalog,pools,policy`，可选 `_example`（布尔）；`secrets` 为 map，值 `{ref}`，`ref` 匹配 `^[a-z]+:.+$`；`policy` 必需第 11 节列出的全部键，`unknown_policy` 枚举 after_known/reject，`probe_schedule` 为 null 或字符串；`pools` 元素 `$ref pool.schema.json` |
| `session.v1` | 第 12 节 | 必需 `schema,session,csrf,expires_at`；`session` 与 `csrf` 匹配 `^[A-Za-z0-9_-]+$` 且 `minLength:20` |
| `error-envelope` | 第 13 节 | 必需 `ok`(const false) 与 `error{code(取注册表),message,retryable,retry_after}` |

**规格对象（7 个，用于校验仓库内真实文件，不需要示例）**：`registry-snapshot`（第 3.2 节结构）、`surfaces`（§7.1）、`migration-map`（§7.2）、`golden`（§9.1，所有金标文件共用）、`golden-manifest`（§6）、`ac-index`（第 15 节：`schema` const `cliworker.ac-index/v1`，`acs` 元素 `{ac:^AC-\d{3}$, owner:^T-\d{3}$, milestone:^M\d+$, levels:[unit|integration|contract|e2e|smoke|characterization|flows], baseline:[linux|win32|darwin|real-smoke]}`，`additionalProperties:false`）、`agentline-forbidden`（§5.3）。

每个 schema 文件的顶层可带 `$schema`（值 `"https://json-schema.org/draft/2020-12/schema"`）、`$id`（等于文件名）、`title`。每个 schema 必须通过 `checkSchema`。

### 5.2 示例文件

路径：`contracts/examples/<名称>/valid/<序号>.json` 与 `contracts/examples/<名称>/invalid/<序号>.json`，序号 `01`、`02`…。`<名称>` 只取上面 14 个线上对象名。
- 正例：文件内容就是被校验文档本身。
- 反例：`{"expect":{"path":"<JSON Pointer>","keyword":"<关键字>"},"document":{...}}`。该文档必须恰好产生 1 条错误，且 `path` 与 `keyword` 与声明相等。
- 每个线上 schema 至少 1 个正例、2 个反例。`selection-ok.v1`、`handle.v1`、`handle-full.v1`、`selection-failed.v1` 的正例直接取自 interfaces 第 2、3 节示例（`<node 绝对路径>` 等占位换成合法的占位字符串，如 `C:/Program Files/nodejs/node.exe`）。
- 示例里不得出现令牌样子的字符串：不含 `sk-`、`Bearer `、`ghp_`、`xox`、`AKIA`、40 位以上连续十六进制或 base64 串（`session.v1` 与 `handle.v1` 的 id 用短且明显是假值的串，例如 `session:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"`）。

### 5.3 `contracts/agentline-forbidden.json`

```
{
  "schema": "cliworker.agentline-forbidden/v1",
  "keys": ["model_key","provider","cli","vendor","funding","pools","pool","forecast","direct_call","env_names","prices","quota","aliases","tier","key","availability","capabilities","identity_group","level_source","adapter","api_key","secret","token","authorization","env"],
  "call": {
    "keys": ["command","args","cwd","input","output","timeout_ms"],
    "input": "stdin",
    "output": "cliworker.event/v1",
    "args": ["<bin>","run","--lease","<lease_id>","--state-dir","<state_dir>","--config","<config>"]
  }
}
```

`keys` 全部小写；匹配时对被检键转小写后与之精确相等。故意不收 `detail`、`model`、`requested_model`、`reported_model`、`identity`、`evidence`（T-031 的身份证据对象需要它们对 AgentLine 可见）。

## 6. 金标清单与冻结检查

### 6.1 `contracts/golden/manifest.json`

```
{ "schema": "cliworker.golden-manifest/v1",
  "files": [ {"path": "contracts/golden/b44.json", "sha256": "<64 位小写十六进制>"}, ... ] }
```
- 登记范围：`contracts/spec/**` 与 `contracts/golden/**` 下的全部文件，但不含 `contracts/golden/manifest.json` 自身。包含 `contracts/spec/ac-index.json`（T-001 写入的，原样登记）。
- `path` 为仓库相对路径、正斜杠，列表按码点升序。
- 哈希：读取文件字节，把 `\r\n` 换成 `\n`，再做 SHA-256。
- `contracts/registry.snapshot.json` 不登记、不做哈希冻结（唯一例外，由 snapshot_version 递增与 compareRegistry 约束，见 §3.5、§3.7）。

### 6.2 `scripts/check-golden-frozen.mjs`

`node scripts/check-golden-frozen.mjs [--root <dir>] [--write]`

- 默认：读 manifest，遍历 `contracts/spec/**` 与 `contracts/golden/**` 的实际文件，比对。
- 输出行：`FAIL golden.changed <path>`（哈希不同）、`FAIL golden.missing <path>`（已登记但文件不存在）、`FAIL golden.unregistered <path>`（文件存在但未登记）、`FAIL golden.manifest_invalid <detail>`（manifest 不存在、不是合法 JSON、不满足 `golden-manifest` schema，或登记路径不在 `contracts/spec/` 与 `contracts/golden/` 之下，或登记了 manifest 自身）。
- 成功：`check-golden-frozen: ok (<N> files)`，exit 0；失败：末行 `check-golden-frozen: FAILED (<K> errors)`，exit 1；参数错误 exit 2。
- `--write`：按当前文件重写 manifest（唯一生成入口）。只用于本任务落地与日后蓝图变更，输出 `check-golden-frozen: wrote manifest (<N> files)`。

### 6.3 `scripts/check-write-scope.mjs`

`node scripts/check-write-scope.mjs [--root <dir>] [--base <git-ref>] [--scope <glob>]... [--scope-from <markdown 文件>]`

- 登记检查（始终执行）：`contracts/spec/**`、`contracts/golden/**` 下存在但 manifest 未登记的文件（manifest 自身除外）→ `FAIL write_scope.unregistered <path>`。manifest 不存在则 `FAIL write_scope.manifest_missing`。
- 范围检查（给了 `--scope` 或 `--scope-from` 时执行，此时必须同时给 `--base`，否则 exit 2）：变更集 = `git diff --name-only --no-renames <base>`（含已提交、已暂存、未暂存的跟踪文件变更）并上 `git ls-files --others --exclude-standard`（未跟踪、未忽略文件）。每个变更路径若不匹配任何范围 glob → `FAIL write_scope.outside <path>`。
- `--scope` 可重复，也可与 `--scope-from` 同时给出，所有 glob 取并集。
- glob：`*` 匹配单段内任意字符（不含 `/`），`**` 匹配跨段任意字符，其余字符字面匹配；路径一律用正斜杠比较。
- `--scope-from`：读取 markdown 开头的 YAML front matter（以 `---` 行开始和结束），解析其中 `write_scope:` 下的 `- <glob>` 列表项（只需支持这一种写法）；解析不出任何 glob 则 exit 2。
- 成功：`check-write-scope: ok`，exit 0；失败：末行 `check-write-scope: FAILED (<K> errors)`，exit 1。
- 脚本源码不得出现蓝图目录名；范围来源由调用方（调度器或评审）传参。`check-fast` 无参数运行时只做登记检查。

## 7. 规格文件

### 7.1 `contracts/spec/surfaces.json`

```
{ "schema": "cliworker.surfaces/v1",
  "preserved": [
    {"id":"candidate.deprecated_unverified_excluded","description":"Deprecated models and models with unverified identity never enter the candidate list"},
    {"id":"candidate.level_filter","description":"Candidates are filtered by exact level; no silent downgrade"},
    {"id":"candidate.exclude_reason","description":"A model listed in exclude is rejected with reason excluded"},
    {"id":"schema_names","description":"The four schema name strings are kept","values":["cliworker.selection/v1","cliworker.handle/v1","cliworker.model/v1","cliworker.forecast/v1"]}
  ],
  "semantic_change": [
    {"id":"forecast.tasks_left","description":"tasks_left may be null and comes with tasks_left_basis"},
    {"id":"forecast.risk","description":"risk is derived with risk_basis and the threshold tables in the registry snapshot"},
    {"id":"handle.cli_removed","description":"The duplicate cli key is removed from the handle"},
    {"id":"draft_reason_mapping","description":"Draft rejection reasons are mapped to v1 reasons"},
    {"id":"config_v1_to_v2","description":"Config v1 is migrated in memory to v2"}
  ] }
```
`semantic_change` 的 id 集合必须与注册表 `semantic_change` 完全相等（测试断言）。「四个 schema 名」的取舍：取第 2、3、7、10 节里被 semantic_change 或保留面直接涉及的 selection、handle、model、forecast。

### 7.2 `contracts/spec/migration-map.json`

```
{ "schema": "cliworker.migration-map/v1",
  "draft_to_v1": { "reasons": [ {"id","draft","v1"} ... ], "fields": [ {"id","from","to":[string...],"note"} ... ] },
  "config_v1_to_v2": [ {"id","from","to":[string...],"note"} ... ] }
```
`id` 在整个文件内唯一，供 T-028 的 docs 检查逐项对照。

`reasons`：与 §3.6 的 10 项一一对应（`draft`、`v1` 值逐字相同，顺序相同），`id` 依次为 `draft.reason.excluded`、`draft.reason.not_in_workspace_order`、`draft.reason.level`、`draft.reason.availability_unverified`、`draft.reason.availability_blocked`、`draft.reason.availability_unavailable`、`draft.reason.availability_deprecated`、`draft.reason.identity_unverified`、`draft.reason.readonly_unavailable`、`draft.reason.forecast_exhaustion`。

`fields`（draft 的 0.1 扁平形状到 v1，`to` 为空数组表示不再提供）：

| id | from | to | note |
|---|---|---|---|
| draft.field.key | handle.key | ["detail.model_key"] | Full view only |
| draft.field.provider | handle.provider | ["detail.cli"] | Full view only |
| draft.field.id | handle.id | [] | AgentLine view never exposes the model id |
| draft.field.level | handle.level | ["level"] | Unchanged |
| draft.field.prices | handle.prices | [] | Prices live in model/v1 on admin views |
| draft.field.quota | handle.quota | ["detail.pools"] | Full view only |
| draft.field.forecast | handle.forecast | ["detail.forecast"] | Full view only |
| draft.field.call | handle.call | ["call"] | Wrapped call template |
| draft.field.cli | handle.cli | [] | Removed (handle.cli_removed) |
| draft.field.readonly | handle.readonly | ["readonly"] | Unchanged |
| draft.field.vendor | handle.vendor | ["detail.vendor"] | Full view only |
| draft.field.rejected_key | rejected[].key | ["rejected[].ref"] | Opaque reference |
| draft.field.rejected_forecast | rejected[].forecast | [] | Removed |
| draft.field.reason | reason | ["error.code"] | Mapped to registry codes |
| draft.field.request | request | [] | Echo removed; request_id is kept |

`config_v1_to_v2`：

| id | from | to | note |
|---|---|---|---|
| config.schema | schema (absent or cliworker.config/v1) | ["schema"] | Migrated in memory to cliworker.config/v2 with W_CONFIG_V1 |
| config.models | models | ["catalog.manual","catalog.allow","catalog.levels"] | level_source kind is config |
| config.quotas.remaining_pct | quotas.<provider>.remaining_pct | ["pools"] | Pool with funding plan, used_fraction = 1 - remaining_pct/100 |
| config.quotas.credits | quotas.<provider>.remaining + credits | ["pools"] | Pool of kind credits |
| config.quotas.remaining_usd | quotas.<provider>.remaining_usd | ["pools"] | Pool of kind prepaid_usd |
| config.quotas.tokens | quotas.<provider>.remaining + unit tokens | ["pools"] | Pool with known capacity |
| config.providers | providers | ["discovery.cli_overrides"] | Provider entries become CLI overrides |

## 8. 视图扫描器与视图决策

### 8.1 `lib/contract/scan.mjs`

导出 `scanView(view, {forbidden, catalog, wrapper})` → `{ok, hits}`；`hits` 元素 `{path, kind, match}`，`path` 为 JSON Pointer，`kind` 取 `forbidden_key`、`forbidden_value`、`call_mismatch`；`ok` 即 `hits.length === 0`。参数：
- `forbidden`：`contracts/agentline-forbidden.json` 的解析结果。
- `catalog`：`{models:[{key, id, cli}]}`，`cli` 可为可执行名或路径。可执行名取路径末段、去掉 `.exe/.cmd/.bat/.ps1/.mjs` 扩展、转小写。
- `wrapper`：`{command, bin, state_dir, config}`，用来填充 `forbidden.call.args` 里的 `<bin>`、`<state_dir>`、`<config>`，`<lease_id>` 取该 call 所属的 lease。

规则：
1. 遍历用显式栈（非递归），1000 层嵌套不得抛 `RangeError`。遍历对象、数组的所有层。
2. 键：每个对象键转小写后与 `forbidden.keys` 精确相等 → `forbidden_key`。大小写不敏感，但 `model_keys`、`xmodel_key`、`model-key` 不命中。
3. 值：每个字符串值，以及每个对象键，转小写后对禁用值集合做整词匹配。禁用值集合 = catalog 中全部 `id`、`key` 与可执行名（转小写、去重）。整词匹配：在被检串中找到该禁用值，且其前一个字符和后一个字符都不属于 `[a-z0-9]`（串首、串尾视为边界）。命中 → `forbidden_value`，`match` 为命中的禁用值。同一路径同一禁用值只报一次。非字符串值（数字、布尔、null）不扫。
4. `call` 子树：键名为 `call` 的值，以及顶层数组 `calls` 的每个元素，视为 call 子树。对 call 子树不做第 2、3 条的扫描，改为逐项比较模板，不符报 `call_mismatch`（`path` 指向出错位置，`match` 为字段名如 `command`、`args[3]`、`keys`）：
   - 键集合恰为 `forbidden.call.keys`（缺一个或多一个都报，`path` 指向该 call，`match:"keys"`）。
   - `command === wrapper.command`；`input === "stdin"`；`output === "cliworker.event/v1"`；`cwd` 为字符串；`timeout_ms` 为 ≥1 的整数。
   - `args` 长度为 8，且逐项等于模板：`[wrapper.bin,"run","--lease",<lease>,"--state-dir",wrapper.state_dir,"--config",wrapper.config]`。`<lease>` 取同级 handle 的 `lease_id`（`models[i].call` 用 `models[i].lease_id`，顶层 `calls[i]` 用 `models[i].lease_id`）；找不到同级 lease 时只要求 `args[3]` 匹配 `^l_[A-Za-z0-9]+$`。
   - 因此 `cwd` 中出现模型 id 不算命中。
5. `scanView` 不修改入参，不读环境，不输出被扫文档的内容以外的任何信息。
6. 用途边界：AgentLine 级输出（select 响应、health 等）必须经过 `scanView`；admin/full 视图本来就含禁用键，不经此检查。接线由 T-008、T-022、T-024 完成，本任务只交付函数与 canary。

### 8.2 `lib/contract/views.mjs`

导出 `resolveView({transport, request, hasSession})` → `{view, warnings, error}`：
- `transport` 取 `"cli"` 或 `"http"`；`request` 可含 `schema`、`compat`、`view`。
- `full = request.view === "full"`；`draft = request.schema === undefined || request.compat === "draft"`。优先级 full > draft > agentline。
- `cli`：`full` → `{view:null, warnings:[], error:"E_VIEW_FORBIDDEN"}`；`draft` → `{view:"draft", warnings:[{code:"W_DRAFT_DEPRECATED"}], error:null}`；否则 `{view:"agentline", warnings:[], error:null}`。
- `http`：`(full || draft) && !hasSession` → `{view:null, warnings:[], error:"E_VIEW_FORBIDDEN"}`；有会话时 `full` → `{view:"full", warnings:[], error:null}`，`draft` → 同 cli 的 draft 结果；否则 `agentline`。
再导出常量 `VIEW_NAMES = ["agentline","full","draft"]`。T-031/T-032 之后会在此文件追加，不要把别的逻辑塞进来。

## 9. 金标内容

### 9.1 通用外壳

每个金标文件：

```
{ "schema": "cliworker.golden/v1",
  "kind": "<kind>",
  "description": "<一句话>",
  "cases": [ {"id": "<唯一>", "fn": "<可选>", "input": {...}, "expected": {...}} ... ] }
```
`kind` 枚举：`quota-shapes`、`b44`、`forecast-thresholds`、`forecast-quantiles`、`forecast-confidence`、`forecast-burn-eta`、`capacity`、`policy`。`expected` 是被断言字段的子集：消费测试对 `expected` 的每个键取实际输出同名字段做深相等，不要求输出不含别的键。金标预期值必须手算得出（本文已给出），不得用被测代码生成。时间戳一律 ISO-8601 UTC，`eta_exhaust_at` 这类输出用 `toISOString()` 形式（毫秒三位、`Z`）。

### 9.2 `contracts/golden/quota-shapes.json`（kind `quota-shapes`，AC-015）

`input = {quota, samples, usage}`，`samples` 元素 `{mtok, cost_usd}`（不适用的置 null），`usage` 取 `Normal`。

| id | quota | samples | expected |
|---|---|---|---|
| q-pct-5 | {remaining_pct:5} | [] | remaining_fraction 0.05, remaining_mtok null, risk low_reserve, risk_basis fraction |
| q-pct-4 | {remaining_pct:4} | [] | remaining_fraction 0.04, risk critical, risk_basis fraction |
| q-pct-0 | {remaining_pct:0} | [] | remaining_fraction 0, risk exhausted, risk_basis fraction |
| q-pct-15 | {remaining_pct:15} | [] | remaining_fraction 0.15, risk ok, risk_basis fraction |
| q-credits-no-rate | {remaining:1, unit:"credits"} | [] | risk unknown, risk_basis none, reason credits_conversion_missing |
| q-credits-zero | {remaining:0, unit:"credits"} | [] | risk exhausted |
| q-credits-rate | {remaining:1, unit:"credits", credits_per_mtok:1000} | 3 个 {mtok:0.2, cost_usd:null} | remaining_mtok 0.001, tasks_left 0, tasks_left_basis tasks, risk exhausted, risk_basis tasks |
| q-tokens | {remaining:2000000, unit:"tokens"} | [] | remaining_mtok 2 |
| q-usd | {remaining_usd:3} | 3 个 {mtok:null, cost_usd:0.5} | tasks_left 6, tasks_left_basis usd, risk ok, risk_basis usd |

### 9.3 `contracts/golden/b44.json`（kind `b44`，AC-016）

`input = {now, reading_ttl_s, models, pools, rows}`。`now` 固定 `2026-11-07T10:00:00Z`，`reading_ttl_s` 600。5 小时池：`{id:"claude:plan-5h", window:{start_at:"2026-11-07T07:00:00Z", reset_at:"2026-11-07T12:00:00Z"}, capacity_mtok:{"claude:claude-opus-5-5":2, "claude:claude-sonnet-5-5":10}, reading:null|{value, at}}`。`rows` 元素 `{model, tokens, at}`（`tokens` 已是计费 tokens）。下表中 O=opus、S=sonnet。`expected` 为 `{"<模型 key>": {status, remaining_mtok, reason}}`，`reason` 未列则为 null。

| id | reading | rows | expected |
|---|---|---|---|
| b44-used-0 | null | [] | O 2；S 10（均 known） |
| b44-reading-half | {0.5, 09:55:00Z} | [] | O 1；S 5 |
| b44-ledger-sonnet-1m | null | S 1000000 @08:00:00Z | O 1.8；S 9 |
| b44-reading-then-1m | {0.5, 09:55:00Z} | S 1000000 @09:58:00Z | O 0.8；S 4 |
| b44-fresh-reading-ignores-earlier-rows | {0.5, 09:55:00Z} | S 1000000 @08:00:00Z | O 1；S 5 |
| b44-stale-reading-uses-ledger | {0.5, 09:00:00Z}（已超过 600 秒） | S 1000000 @08:00:00Z | O 1.8；S 9 |
| b44-unknown-capacity-row | null | 模型 `codex:gpt-x`（不在容量表）1000 @08:00:00Z | O 与 S 均 status unknown，remaining_mtok null，reason ledger_capacity_unknown |
| b44-rounding | {0.33333, 09:55:00Z} | [] | O 1.333；S 6.667 |
| b44-two-pools-min | 见下 | [] | S 5 |

`b44-two-pools-min`：`models` 只有 sonnet；两个池：`claude:plan-5h`（容量 sonnet 10，读数 0.5 @09:55:00Z → 5）与 `claude:plan-7d`（window 2026-11-01T00:00:00Z～2026-11-08T00:00:00Z，容量 sonnet 20，读数 0.1 @09:55:00Z → 18），取最小值 5。

### 9.4 `contracts/golden/forecast/*.json`（AC-017，四个文件）

每个 case 带 `fn`。

**`thresholds.json`**（kind `forecast-thresholds`，`fn:"classify_risk"`，`input={tasks_left, tasks_left_basis, remaining_fraction}`，`expected={risk, risk_basis}`）：

| id | tasks_left | basis | fraction | risk | risk_basis |
|---|---|---|---|---|---|
| tasks-minus1 | -1 | tasks | null | exhausted | tasks |
| tasks-0 | 0 | tasks | null | exhausted | tasks |
| tasks-1 | 1 | tasks | null | critical | tasks |
| tasks-2 | 2 | tasks | null | critical | tasks |
| tasks-3 | 3 | tasks | null | low_reserve | tasks |
| tasks-5 | 5 | tasks | null | low_reserve | tasks |
| tasks-6 | 6 | tasks | null | ok | tasks |
| tasks-100 | 100 | tasks | null | ok | tasks |
| usd-0 | 0 | usd | null | exhausted | usd |
| usd-2 | 2 | usd | null | critical | usd |
| usd-6 | 6 | usd | null | ok | usd |
| frac-0 | null | none | 0 | exhausted | fraction |
| frac-0.0001 | null | none | 0.0001 | critical | fraction |
| frac-0.049 | null | none | 0.049 | critical | fraction |
| frac-0.05 | null | none | 0.05 | low_reserve | fraction |
| frac-0.149 | null | none | 0.149 | low_reserve | fraction |
| frac-0.15 | null | none | 0.15 | ok | fraction |
| frac-1 | null | none | 1 | ok | fraction |
| priority-tasks-over-fraction | 10 | tasks | 0.01 | ok | tasks |
| priority-usd-over-fraction | 1 | usd | 0.9 | critical | usd |
| unknown-none | null | none | null | unknown | none |

**`quantiles.json`**（kind `forecast-quantiles`，`fn:"quantile_for_usage"`，`input={samples, usage}`，`expected={value}`；Heavy/Normal/Light 分别取 p90/p50/p25，nearest-rank `sorted[ceil(p*n)-1]`，n<3 时 value 为 null）：

| id | samples | usage | value |
|---|---|---|---|
| n3-heavy / n3-normal / n3-light | [0.1,0.2,0.3] | Heavy / Normal / Light | 0.3 / 0.2 / 0.1 |
| n4-unsorted-heavy / -normal / -light | [0.4,0.1,0.3,0.2] | Heavy / Normal / Light | 0.4 / 0.2 / 0.1 |
| n12-heavy / -normal / -light | [1,2,…,12] | Heavy / Normal / Light | 11 / 6 / 3 |
| n20-heavy / -normal / -light | [1,2,…,20] | Heavy / Normal / Light | 18 / 10 / 5 |
| n2-invalid | [0.1,0.2] | Normal | null |
| n1-invalid | [0.5] | Normal | null |
| n0-invalid | [] | Normal | null |

（表中一行代表三个 case，case id 为「前缀 + 用量」，如 `n3-heavy`。）

**`confidence.json`**（kind `forecast-confidence`，`fn:"confidence"`，`input={n, cv}`，`expected={confidence}`）：n0→none；n1→low；n4→low；n5→medium；n19→medium；n20+cv0.5→high；n20+cv1→high；n20+cv1.01→medium；n50+cv2→medium；n10+cv3→medium；n3+cv5→low。case id：`n0`、`n1`、`n4`、`n5`、`n19`、`n20-cv0.5`、`n20-cv1`、`n20-cv1.01`、`n50-cv2`、`n10-cv3`、`n3-cv5`；`cv` 不适用时为 null。

**`burn-eta.json`**（kind `forecast-burn-eta`）：

| id | fn | input | expected |
|---|---|---|---|
| burn-5.5-over-5h | burn_mtok_per_hour | {used_mtok:5.5, hours_since_window_start:5} | {value:1.1} |
| burn-clamp-zero-hours | burn_mtok_per_hour | {used_mtok:0.3, hours_since_window_start:0} | {value:18} |
| burn-clamp-tiny-hours | burn_mtok_per_hour | {used_mtok:1, hours_since_window_start:0.001} | {value:60} |
| burn-rounding | burn_mtok_per_hour | {used_mtok:2, hours_since_window_start:3} | {value:0.667} |
| burn-zero-used | burn_mtok_per_hour | {used_mtok:0, hours_since_window_start:4} | {value:0} |
| eta-after-reset | eta_exhaust | {now:"2026-11-07T10:00:00.000Z", remaining_mtok:5, burn_mtok_per_hour:2, reset_at:"2026-11-07T12:00:00.000Z"} | {eta_exhaust_at:"2026-11-07T12:30:00.000Z", exhausts_before_reset:false} |
| eta-before-reset | eta_exhaust | {now 同上, remaining_mtok:1, burn_mtok_per_hour:2, reset_at 同上} | {eta_exhaust_at:"2026-11-07T10:30:00.000Z", exhausts_before_reset:true} |
| eta-equal-reset | eta_exhaust | {now 同上, remaining_mtok:1, burn_mtok_per_hour:0.5, reset_at 同上} | {eta_exhaust_at:"2026-11-07T12:00:00.000Z", exhausts_before_reset:false} |
| eta-empty | eta_exhaust | {now 同上, remaining_mtok:0, burn_mtok_per_hour:2, reset_at 同上} | {eta_exhaust_at:"2026-11-07T10:00:00.000Z", exhausts_before_reset:true} |
| round3-0.0625 | round3 | {value:0.0625} | {value:0.063} |
| round3-0.1875 | round3 | {value:0.1875} | {value:0.188} |
| round3-negative | round3 | {value:-0.0625} | {value:-0.063} |
| round3-down | round3 | {value:1.2344} | {value:1.234} |
| round3-zero | round3 | {value:0} | {value:0} |

公式出处：burn = 窗口内已用 Mtok / max(距窗口起点小时数, 1/60)；eta = now + remaining/burn；`exhausts_before_reset` 为 `eta < reset_at`（严格小于）；三位小数四舍五入远离零。

### 9.5 `contracts/golden/capacity.json`（kind `capacity`，`fn:"learn_capacity"`，AC-050）

`input = {readings:[{at,fraction}], rows:[{at,tokens}]}`。配对：相邻两个读数构成一对；Δ = 后者 fraction − 前者 fraction；一对的 tokens = `at` 落在（前者.at, 后者.at] 内的行的 tokens 之和；只有 Δ ≥ 0.01 的对计入；`capacity_mtok = sum(tokens)/sum(Δ)/1e6`；k 为计入的对数；k<3 low，3..9 medium，≥10 high；`source` 恒为 `measured`。`expected = {capacity_mtok, k, confidence, source}`。所有 fraction 取二进制精确值，避免浮点差。

| id | readings（时间均在 2026-11-07，UTC） | rows | expected |
|---|---|---|---|
| cap-k2-low | 08:00 0；09:00 0.25；10:00 0.5 | 08:30 1000000；09:30 1000000 | capacity 4, k 2, low |
| cap-k3-medium | 07:00 0；08:00 0.125；09:00 0.25；10:00 0.375 | 07:30 1000000；08:30 500000；09:30 1500000 | capacity 8, k 3, medium |
| cap-k10-high | 11 个读数，整点 00:00…10:00，fraction 依次 i×0.03125（i=0..10） | 10 行，每行 250000，分别在 00:30、01:30…09:30 | capacity 8, k 10, high |
| cap-discard-small-delta | 08:00 0.5；09:00 0.5078125；10:00 0.7578125 | 08:30 100000；09:30 2000000 | capacity 8, k 1, low（第一对 Δ=0.0078125 被丢弃） |
| cap-reset-pair-ignored | 08:00 0.5；09:00 0.0625；10:00 0.3125 | 08:30 300000；09:30 2000000 | capacity 8, k 1, low（第一对 Δ 为负，被丢弃） |

每个 expected 都含 `source:"measured"`。

### 9.6 `contracts/golden/policy/*.json`（kind `policy`，`fn:"select_policy"`，AC-051，四个文件）

`input = {est_mtok, count, importance, policy:{unknown_policy, reserve_fraction_for_high}, reserve_mtok, pools, candidates}`：所有 case 的 `est_mtok` 为 1，`importance` 为 `high`，`reserve_mtok` 为 0，`reserve_fraction_for_high` 为 0.15。`pools` 元素 `{id, funding, remaining_mtok, cap_mtok, reset_in_h}`（`remaining_mtok` 可为 null 表示未知，`reset_in_h` 不适用为 null）；`candidates` 元素 `{key, pool_ids, price, identity_group}`。`expected = {selected:[{key,funding}], rejected:[{key,reason}]}`，`selected` 按输出顺序，`rejected` 只列被过滤拒选的候选（因 count 截断而未入选的不算拒选），按候选在 input 中的顺序。

| 文件 | case id | pools | candidates | count / unknown_policy | expected |
|---|---|---|---|---|---|
| p1-order.json | p1-order | A{plan,3,cap10,reset 1}；B{plan,8,cap10,reset 4}；C{paid,100,cap100,null} | mA{[A],price 2}；mB{[B],price 1}；mC{[C],price 3}，identity_group 均 null | 3 / after_known | selected: mA plan, mB plan, mC paid；rejected: [] |
| p2-quota-low.json | p2-quota-low | A{plan,0.5,cap10,reset 1}；C{paid,100,cap100,null} | mA{[A],1}；mC{[C],3} | 1 / after_known | selected: mC paid；rejected: mA quota_low |
| p3-unknown.json | p3-after-known | A{plan,3,cap10,reset 1}；U{plan,null,cap10,null}；C{paid,100,cap100,null} | mA{[A],1}；mU{[U],1}；mC{[C],3} | 3 / after_known | selected: mA plan, mU plan, mC paid；rejected: [] |
| p3-unknown.json | p3-reject | 同上 | 同上 | 3 / reject | selected: mA plan, mC paid；rejected: mU quota_unknown_policy |
| p4-identity-group.json | p4-distinct-group | A{plan,10,cap20,reset 2} | m1{[A],1,g1}；m2{[A],2,g1}；m3{[A],3,g2} | 2 / after_known | selected: m1 plan, m3 plan；rejected: [] |
| p4-identity-group.json | p4-fill-same-group | 同上 | m1{[A],1,g1}；m2{[A],2,g1}；m3{[A],3,g1} | 2 / after_known | selected: m1 plan, m2 plan；rejected: [] |

P1 排序依据：A 类按紧迫度 `remaining/max(reset_in_h,0.25)` 降序，A=3、B=2，所以 A 先于 B（即使 mA 更贵）；之后 B 类（未知）、C 类（付费，funding 标 `paid`）。

### 9.7 必需 case id

测试（`[AC-073] golden files hold the required case ids`）核对每个文件至少包含上面各表的全部 case id，且 `kind` 正确、id 唯一。

## 10. 生成文档与检查脚本

### 10.1 `scripts/gen-contract-doc.mjs`

`node scripts/gen-contract-doc.mjs [--root <dir>]` 写出 `<root>/docs/contract.md`，输出 `gen-contract-doc: wrote docs/contract.md (<N> bytes)`。导出 `renderContractDoc(root)` → 字符串（check 脚本复用；`root` 为相对或绝对目录，相对路径按当前工作目录解析）。脚本只在被直接运行时才写文件，被 import 时不得有副作用（沿用 `scripts/run-tests.mjs` 的 `invokedDirectly` 写法）；`check-*.mjs` 与 `snapshot-update.mjs` 同理。内容只依赖仓库文件（快照、manifest、`contracts/schemas` 目录列表），不含时间戳、绝对路径、环境信息。固定结构（标题字面值）：

```
# CLIWorker 契约（自动生成）
> 本文件由 scripts/gen-contract-doc.mjs 生成，请勿手改。snapshot_version: <N>
## 1. 错误码              // 表：code | exit | http_status | retryable | trigger_id | trigger；退出码 0 的说明另起一行
## 2. 403 触发与判定顺序   // 五个 403 类码的 trigger_id 与 write_route_order
## 3. 警告码
## 4. 拒选原因            // v1、admin_only、draft 三组
## 5. draft 到 v1 的原因映射
## 6. forecast 枚举与阈值   // forecast_reasons、risk、risk_basis、tasks_left_basis、两张阈值表、priority
## 7. 可用性与 identity
## 8. semantic_change
## 9. 规格与金标登记清单    // manifest 的 path 与 sha256 表
## 10. 契约 schema 清单     // contracts/schemas 下的文件名，码点升序
```
Markdown 表格单元里的 `|` 转义为 `\|`；输出 LF、UTF-8 无 BOM、末尾恰一个换行；顺序都取快照/manifest 的书写顺序（schema 清单按码点升序）。

### 10.2 `scripts/check-contract-doc.mjs`

`node scripts/check-contract-doc.mjs [--root <dir>]`：重新生成并与 `<root>/docs/contract.md` 比较（两侧先把 `\r\n` 换成 `\n`）。一致：`check-contract-doc: ok`，exit 0；文件不存在：`FAIL contract_doc.missing docs/contract.md`；内容不同：`FAIL contract_doc.stale docs/contract.md`；两种失败末行都是 `check-contract-doc: FAILED (1 errors)`，exit 1。

### 10.3 `scripts/check-no-collab.mjs`

`node scripts/check-no-collab.mjs [--root <dir>]`。扫描 `<root>` 下 `lib`、`scripts`、`test`、`contracts`、`docs` 目录的全部文件（跳过 `node_modules`、`.git`；默认模式额外跳过相对路径以 `test/fixtures/no-collab/` 开头的文件）与 `package.json`，逐行做不区分大小写的子串匹配，匹配目标是一个点加 `collab`（蓝图目录名）。**本脚本、测试、夹具生成代码都必须用拼接方式构造该字面量**（例如 `['.', 'coll', 'ab'].join('')`），否则脚本会扫到自己。输出：命中一行 `FAIL no_collab <相对路径>:<行号>`，按路径码点升序、行号升序；末行失败 `check-no-collab: FAILED (<K> violations)` exit 1；成功 `check-no-collab: ok (scanned <N> files)` exit 0。目录不存在则跳过该目录。

夹具（`test/fixtures/no-collab/`，字节内容固定，每个文件只含下表所述的一处命中；文件名都不以 `.test.mjs` 结尾）：

| 路径 | 内容要点 |
|---|---|
| `violating/lib/a.mjs` | 第 1 行含一个点加 collab 的相对导入路径 |
| `violating/scripts/b.mjs` | 第 2 行是注释，含一个点加 collab 的路径 |
| `violating/test/c.txt` | 第 1 行含该字符串 |
| `violating/contracts/d.json` | 第 2 行的某个字符串值含该字符串 |
| `violating/docs/e.md` | 第 3 行含全大写形式（大小写不敏感的样例） |
| `violating/package.json` | 第 2 行的某个字段值含该字符串 |
| `clean/lib/a.mjs`、`clean/package.json` | 不含该字符串 |

因此 `--root test/fixtures/no-collab/violating` 恰好输出 6 行 `FAIL`：`contracts/d.json:2`、`docs/e.md:3`、`lib/a.mjs:1`、`package.json:2`、`scripts/b.mjs:2`、`test/c.txt:1`；`--root test/fixtures/no-collab/clean` 输出 `check-no-collab: ok (scanned 2 files)`。夹具文件需要显式 `git add`（若被 `.gitignore` 误伤要在设计外另行处理；当前 `.gitignore` 不会命中它们）。

## 11. 测试（五个文件，标题逐字固定）

- 所有测试用 `node:test` 的平铺 `test()`，不用 `describe`。需要临时文件时一律建在 `os.tmpdir()` 下，用完删除；不得在仓库里生成临时文件。
- 需要调用脚本时用 `spawnSync(process.execPath, [script, ...args, '--root', tmp])`，不得在测试里再启动 `run-tests`/`check-fast`（会递归）。
- 需要 git 时在临时目录 `git init`，命令加 `-c user.name=t -c user.email=t@t -c commit.gpgsign=false`。

| 文件 | 标题 |
|---|---|
| `registry.test.mjs` | `[AC-009] REGISTRY deep-equals contracts/registry.snapshot.json` |
| | `[AC-009] every code has exit, http_status, retryable, trigger_id and trigger` |
| | `[AC-009] trigger_id and trigger text are unique across the table` |
| | `[AC-009] codes, exits and retryable flags match the frozen exit-code table` |
| | `[AC-009] the five 403 codes have mutually exclusive triggers` |
| | `[AC-009] write route order is session, readonly, csrf, body` |
| | `[AC-009] resolveView applies the select view rules` |
| | `[AC-009] lib/contract modules are pure and import nothing` |
| `examples.test.mjs` | `[AC-009] every schema uses only supported keywords` |
| | `[AC-009] every valid example passes its schema` |
| | `[AC-009] every invalid example fails with exactly the declared path and keyword` |
| | `[AC-009] every wire schema has one valid and two invalid examples` |
| | `[AC-009] schema enums for codes, warnings and reject reasons equal the registry` |
| | `[AC-009] validator reports the expected path for each supported keyword` |
| | `[AC-009] examples carry no token-like strings` |
| `freeze.test.mjs` | `[AC-010] compareRegistry reports removed for a deleted code` |
| | `[AC-010] compareRegistry reports removed and added for a renamed code` |
| | `[AC-010] compareRegistry reports changed for a modified field` |
| | `[AC-010] compareRegistry reports nothing for identical registries` |
| | `[AC-010] checkFrozen fails for a deleted code, a renamed code and an added code with a stale snapshot` |
| | `[AC-010] snapshot-update is a no-op on an unchanged registry` |
| | `[AC-010] snapshot-update writes the snapshot only when snapshot_version is previous plus one` |
| | `[AC-010] snapshot-update refuses an addition without a version bump` |
| | `[AC-010] snapshot-update refuses removed, renamed or changed entries` |
| | `[AC-010] snapshot holds reject reasons, risk thresholds, availability, warning codes, draft mapping and semantic_change` |
| `scan-canary.test.mjs` | `[AC-011] every forbidden key is detected at depth 1` |
| | `[AC-011] every forbidden key is detected at depth 3` |
| | `[AC-011] forbidden keys are detected inside arrays, warnings, error and rejected` |
| | `[AC-011] forbidden key matching is case-insensitive and exact` |
| | `[AC-011] every forbidden value is detected at depth 1 and depth 3` |
| | `[AC-011] forbidden values match whole words after tokenizing` |
| | `[AC-011] cliworker, config and dsh-CLIWorker are not reported` |
| | `[AC-011] the call subtree skips value scanning but must equal the wrapper template` |
| | `[AC-011] clean examples produce zero hits` |
| | `[AC-011] deeply nested input does not overflow the stack` |
| `spec-tracked.test.mjs` | `[AC-073] snapshot, spec, golden and forbidden files are tracked by git and not ignored` |
| | `[AC-073] every spec and golden file validates against its schema` |
| | `[AC-073] golden files hold the required case ids` |
| | `[AC-073] manifest registers every spec and golden file with its normalized sha256` |
| | `[AC-073] check-golden-frozen fails when a golden file is modified` |
| | `[AC-073] check-golden-frozen fails when a golden file is added` |
| | `[AC-073] check-golden-frozen fails when a golden file is deleted` |
| | `[AC-073] check-write-scope reports an unregistered spec or golden file` |
| | `[AC-073] check-write-scope reports changes outside the write scope` |
| | `[AC-073] check-write-scope reads write_scope from markdown front matter` |
| | `[AC-073] check-no-collab reports zero references in the repository` |
| | `[AC-073] check-no-collab reports the violating fixture and passes the clean fixture` |
| | `[AC-073] gen-contract-doc output equals the committed docs/contract.md` |
| | `[AC-073] check-contract-doc fails on a stale document` |
| | `[AC-073] snapshot contains every code, trigger, threshold, reason, mapping and semantic_change of interfaces section 5` |
| | `[AC-073] new check scripts are discoverable by check-fast` |

各测试要点：
- 标题 4：测试内嵌 30 个 `[code, exit]` 与 retryable 为 true 的三个码，与 §3.3 比对。
- 标题 5：对 `decideGate` 穷举全部 route×布尔组合；断言返回值至多一个码，五个码各至少出现一次，`E_READONLY`/`E_CSRF` 只在 `session_valid` 为真时出现，`E_ADMIN_REQUIRED` 只在其为假时出现；并断言这五个码的 `trigger_id` 为 `select_view_without_admin`、`bootstrap_non_loopback`、`admin_route_no_session`、`write_route_readonly`、`write_route_csrf_invalid`，exit 分别为 2、8、8、8、8，http 均为 403。
- 标题 6：`WRITE_ROUTE_ORDER`、快照 `write_route_order` 与 `decideGate` 的先后（会话无效且 readonly 且 csrf 无效 → `E_ADMIN_REQUIRED`；会话有效、readonly、csrf 无效 → `E_READONLY`；会话有效、可写、csrf 无效 → `E_CSRF`）。
- 标题 8：静态扫描 `lib/contract/*.mjs`：`registry.mjs` 无 import 语句；其余文件无 `node:` 导入、无 `Date.now`/`new Date`/`setTimeout`/`setInterval`/`setImmediate`/`process.env`。
- 标题 14（validator 表驱动）：每个受支持关键字至少一个违规用例，断言 `path` 与 `keyword`（含 `required` 与 `additionalProperties` 的子路径约定、数组下标路径、跨文件 `$ref`）；另断言不支持的关键字（如 `oneOf`）抛 `TypeError`。
- 标题 13：schema 中 `reason`、`warnings[].code`、`error.code` 的 `enum` 与注册表对应列表集合相等。
- 标题 20（freeze）：对 `structuredClone(REGISTRY)` 做删除、改名、新增（版本号不变）三种变更，`checkFrozen` 分别返回含 `freeze.removed`、`freeze.removed`+`freeze.added`、`freeze.added` 的 `ok:false`。
- 标题 21～24：在临时 root 下放一个包装模块 `lib/contract/registry.mjs`（`import { REGISTRY as base } from '<真实 registry.mjs 的 file URL>'` 后导出修改过的 `REGISTRY`）和一份快照文件，运行 `snapshot-update.mjs --root <tmp>`，断言 §3.7 表里的退出码、首行和文件是否被改写；成功路径写出后，用 `checkFrozen(新快照, 新 REGISTRY)` 断言 ok。
- 标题 26～28：遍历 `forbidden.keys` 中每个键，在深度 1（`{ injected: ... }`，即根对象的直接键）和深度 3（`{a:{b:{<key>:1}}}`）注入；28 号在 `warnings[0]`、`error`、`rejected[0]`、数组套数组中各注入一次，断言 `hits` 含 `forbidden_key` 且 `path` 指向注入处。
- 标题 29：`Model_Key`、`MODEL_KEY` 命中；`model_keys`、`xmodel_key`、`model-key` 不命中。
- 标题 30～32：catalog 用 `contracts/examples` 之外的内嵌小目录（模型 id `claude-sonnet-5-5`，key `claude:claude-sonnet-5-5`，cli `claude`/`codex`/`agent`）；断言 id、key、cli 名作为字符串值或对象键、在深度 1 和 3 都命中；`claude-sonnet-5-5-extra`、`use claude here` 命中，`claudette`、`codexes` 不命中；`cliworker`、`config`、`dsh-CLIWorker`、`CLIWorker` 不命中。
- 标题 33：构造合规 call（`wrapper` 用测试内的任意绝对路径）→ 0 命中；`cwd` 含 `claude-sonnet-5-5` → 仍 0 命中；改 `command`、改 `args[3]`（与 lease 不符）、少一个键、多一个键 `model` → 各一个 `call_mismatch`，路径指向出错位置；顶层 `calls[i]` 同样适用。
- 标题 34：`contracts/examples/selection-ok.v1/valid/*`、`handle.v1/valid/*`、`selection-failed.v1/valid/*`、`error-envelope/valid/*` 在 catalog 与 wrapper 取自该样例本身时 0 命中（wrapper 参数从样例的 `call.command`、`args[0]`、`args[5]`、`args[7]` 取）。
- 标题 35：构造 1000 层嵌套对象，断言不抛异常且能在最深处命中禁用键。
- 标题 36：`git ls-files` 列出的集合覆盖 `contracts/registry.snapshot.json`、`contracts/agentline-forbidden.json`、`contracts/spec/*.json`、`contracts/golden/**` 的磁盘文件；每个文件 `git check-ignore -q` 返回 1（未被忽略）。不在 git 仓库内则失败。
- 标题 37：用 `validate` 对每个规格/金标文件做 schema 校验（`registry.snapshot.json`→`registry-snapshot`，`surfaces.json`→`surfaces`，`migration-map.json`→`migration-map`，`ac-index.json`→`ac-index`，`golden/**`（除 manifest）→`golden`，`manifest.json`→`golden-manifest`，`agentline-forbidden.json`→`agentline-forbidden`）；并断言 §3.6 一致性规则、`surfaces.semantic_change` id 集合与注册表相等、`migration-map.reasons` 与 `draft_reason_mapping` 逐项相同、`id` 全局唯一。
- 标题 40～42：把仓库的 `contracts/spec`、`contracts/golden` 复制到临时 root，分别修改一个金标内容、新增一个金标文件、删除一个金标文件，运行 `check-golden-frozen.mjs --root <tmp>`，断言 exit 1 与对应的 `FAIL golden.changed|unregistered|missing <path>`；未改动的副本 exit 0。另在其中一个用例里把 CRLF 版本的金标文件拷入，断言哈希仍通过（归一化）。
- 标题 43：临时 root 带合法 manifest，新增一个 `contracts/spec/x.json` → `FAIL write_scope.unregistered contracts/spec/x.json`，exit 1。
- 标题 44：临时 git 仓库提交基线后，新增 `lib/contract/ok.mjs` 与 `lib/other.mjs`，运行 `--base HEAD --scope 'lib/contract/**'` → 只报 `lib/other.mjs`；`**` 跨段、`*` 单段各一个用例。
- 标题 45：写一个带 front matter 的临时 markdown，`--scope-from` 解析出 glob 后效果与 `--scope` 相同；front matter 缺失 → exit 2。
- 标题 46：对真实仓库根运行 `check-no-collab.mjs`，exit 0。标题 47：两个夹具 root 的 exit 与输出行如 §10.3。
- 标题 48：`renderContractDoc(repoRoot)` 与读取到的 `docs/contract.md` 在 `\r\n`→`\n` 归一后全等，且渲染结果不含 `\r`、BOM。标题 49：临时 root 改动 `docs/contract.md` 一个字符 → `FAIL contract_doc.stale`，exit 1。
- 标题 50：测试内嵌 interfaces 第 5 节的全部列表（30 码名、8 个警告码、15 个 v1 拒选原因、`not_allowed`、7 个 draft 拒选原因、7 个 forecast reason、risk/risk_basis/tasks_left_basis/availability/identity 枚举、5 个 semantic_change、两张阈值表的全部边界）与快照逐项比对。
- 标题 51：`scripts/` 下存在 `check-contract-doc.mjs`、`check-golden-frozen.mjs`、`check-no-collab.mjs`、`check-write-scope.mjs`，且名字匹配 `^check-.*\.mjs$`；不得在测试里运行 check-fast。

## 12. 追踪分片 `test/traceability/T-004.json`

```
{ "task": "T-004", "milestone": "M1", "entries": [
  { "ac": "AC-009", "status": "covered", "files": ["test/contract/registry.test.mjs", "test/contract/examples.test.mjs"] },
  { "ac": "AC-010", "status": "covered", "files": ["test/contract/freeze.test.mjs"] },
  { "ac": "AC-011", "status": "covered", "files": ["test/contract/scan-canary.test.mjs"] },
  { "ac": "AC-073", "status": "covered", "files": ["test/contract/spec-tracked.test.mjs"] } ] }
```
不得声明 baseline。落地后 `node scripts/check-traceability.mjs` 应为 `check-traceability: ok (covered=9 planned=65)`。

## 13. 风险与注意事项

1. **ac-index 漂移**：manifest 登记了 T-001 写入的 `contracts/spec/ac-index.json`。此后任何改动该文件的任务都会让 `check-golden-frozen` 失败，必须同时走蓝图变更并重写 manifest。
2. **`.collab` 字面量**：本任务产出的所有文件（含测试、夹具生成代码、golden 的 `description` 文字）都不得含该字面量；脚本和测试里要用到时拼接构造。
3. **CRLF**：本机 `core.autocrlf=true`，工作区文件可能被检出为 CRLF。哈希与文档比较都先归一化；写文件时一律写 LF。
4. **git 暂存**：AC-073 的「被 git 跟踪」以 `git ls-files` 为准，开发者必须对新文件显式 `git add <路径>`（不使用 `git add -A`，避免带入 `.collab/tasks/004/` 下的运行产物）。
5. **注册表条目的 http_status/trigger 文本**由本文定稿，之后属冻结内容；改动走蓝图变更并递增 snapshot_version。
6. **`views.mjs` 与 `forbidden.json`** 之后被 T-031/T-032/T-022/T-024 使用；`forbidden.keys` 若与它们的视图字段冲突，由那些任务提出蓝图变更，不得绕过本任务的检查。
