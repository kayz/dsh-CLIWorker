# Task 008 实现说明

分支 `task/008`，起点 `86ff20e`。全部改动都在 `design.md` front matter 的 `write_scope` 内；没有触碰 `brief.md`、`design.md`、`acceptance.md`、`defects.json`、`contracts/`、`lib/select.mjs`、`lib/index.js`、`lib/contract/*`。

## 改了什么

### 新增 `lib/output.mjs`

错误体与退出码的唯一出口，只 import `lib/contract/registry.mjs` 的 `getCode`，退出码表不复制。

- `codedError(code, message, extra)`：带 `.code` 的 `Error`，`extra` 只挂 `retryable` / `retry_after`（缺省不挂）。
- `exitCodeFor(code)`：注册表 `exit`，未知码回落 1。
- `errorBody(code, message, extra)`：`{ok, error:{code, message, retryable, retry_after}}`，键顺序固定；码不在注册表时换成 `E_INTERNAL`，`retryable` 缺省取注册表值，`retry_after` 缺省 `null`。
- `errorBodyFrom(e)`：已知码原样用；否则 `E_INTERNAL` + `e.message`（非对象用 `String(e)`）。不拼 stack、环境变量或请求原文，令牌不会进入错误体。
- `writeJson(ctx, value)`：`JSON.stringify(value, null, 2) + '\n'`，与旧输出格式逐字节一致。

### 新增 `lib/request.mjs`

`REQUEST_SCHEMA`、`normalizeRequest`、`requestFromArgv`、`gateView`。纯函数（只有 `--request-file` 走注入的 `ctx.fs`），没有 `node:fs`、时钟或环境读取，`check-seams` 通过。

- 校验顺序与 design §3.1 一致：非对象 → `E_REQUEST_INVALID`；`schema` 不支持 → `E_SCHEMA_UNSUPPORTED`；`level`（`level` 优先，空值回落 `tier`）缺失 → `E_LEVEL_REQUIRED`、非法 → `E_LEVEL_UNKNOWN` 并规范成 `Top/High/Middle/Quick`；`count` 1..10 整数；`usage` 大小写不敏感规范成 `Heavy/Normal/Light`；`importance` 只接受精确 `normal`/`high`；可选字段逐项类型检查。
- 警告按输入键顺序、每字段至多一条：`tier` → `W_FIELD_DEPRECATED`，其他不在已知集合的字段（如 `role`）→ `W_FIELD_IGNORED`。`exclude`、`candidates`、`require_verified` 是 draft 仍在读的旧字段，保留且不警告；`timeout_ms`、`exclude_handles` 是 v1 字段，带进结果、不警告，留给 T-022。
- `requestFromArgv`：`--request` / `--request-file` 互斥，两者都缺时 `raw = {}` → `E_LEVEL_REQUIRED`；`--level/--count/--usage/--importance/--request-id/--cwd` 覆盖 JSON 同名字段；`--count` 只在匹配 `^\d+$` 时转数字，否则原样交给 `normalizeRequest` 报错；标志缺值、读文件失败、坏 JSON 都是 `E_REQUEST_INVALID`。
- `gateView`：调 `resolveView({transport:'cli'})`，`E_VIEW_FORBIDDEN` 抛同码错误，`draft` 视图带 `W_DRAFT_DEPRECATED`，`agentline` 不带警告。

### 改写 `lib/cli.mjs`

- `ROUTES`、`resolveRoute`、`CONFIG_FREE`、`USAGE` 常量不变。
- 无参数仍是旧行为：`stderr` 写 `ERROR: ${USAGE}`，`stdout` 空，退出码 1（`import-safe.test.mjs` 与 `bin/cliworker.mjs` 的无参数断言依赖它）。
- 有命令词但无路由 → `errorBody('E_UNKNOWN_COMMAND', 'unknown command: <前两项>')` 写 stdout，退出码 2，stderr 空。
- `try` 块里的所有异常统一 `errorBodyFrom(e)` → stdout + `exitCodeFor`。删掉了 `CONFIG_ERROR_CODES` 与 `e.exitCode` 特判；`E_CONFIG`/`E_CONFIG_EXAMPLE`/`E_CONFIG_EXISTS` 靠注册表 `exit=3` 保持原行为，`config.test.mjs` 的 AC-013/AC-014 用例继续通过。
- 不再向 stderr 写任何错误（`main([])` 的 usage 行除外）。

### 改写 `lib/commands/models/select.mjs`

`requestFromArgv` → `gateView` → `providerStatus` / `readUsage` → `selectModels`；字段警告与视图警告合并非空时才写进结果的 `warnings`（不覆盖 `cli.mjs` 之后的 `W_TEST_CLOCK`）。`selectModels` 与 draft 形状未改。

### `README.md`

- `models select` 示例改成三种等价写法：单项标志、`--request` 内联 JSON、`--request-file`；删掉 `role` / `tier` 请求字段。
- 新增一个 ` ```json request ` 围栏块（带 `"schema": "cliworker.request/v1"`、规范 `level`）。
- 在「CLI」后加「输出与错误」小节：错误体形状、退出码取自 `contracts/registry.snapshot.json`、`W_FIELD_IGNORED`、`W_FIELD_DEPRECATED`、draft 视图的 `W_DRAFT_DEPRECATED`（0.3.0 移除）。没有复制整张注册表，没有令牌/密钥。

### 测试

- `test/integration/cli-envelope.test.mjs`（`[AC-023]`）：7 个注册表码 + 两种 `E_UNKNOWN_COMMAND` 构成表驱动，逐个校验 stdout 是单个值、顶层键 `ok,error`、`error` 键 `code,message,retryable,retry_after`、`retryable`/退出码等于注册表、`retry_after` 为 `null`、stderr 空、通过 `error-envelope` schema；8 个成功命令（`providers`、`models list`、`models select` 两种写法、`models forecast`、`usage summary`、`usage record`、`paths`、`init`）逐个 `JSON.parse` 成功且 stderr 空；`CLIWORKER_TEST_CLOCK_FILE` 时成功结果含 `W_TEST_CLOCK` 而错误体仍只有 `ok,error`；无码 `Error` → `E_INTERNAL` / 退出码 1；无参数保留 usage 旧行为。全部走 `main()` + `createFakeContext`，不接触真实家目录或 provider CLI。
- `test/unit/request.test.mjs`（`[AC-024]`）：三种写法深相等且默认值正确、标志覆盖 JSON、`role`/`tier`/未知字段警告与顺序、v1 未消费字段不警告、非法值映射到注册表码、argv 错误码、README 全部示例 `warnings` 为 `[]`、`gateView` 的 draft/agentline/forbidden。
- `test/characterization/defects/a5-ignored-fields.test.mjs`：只在文件末尾追加顶层 `test('[fixed] [AC-024] …')`，对 live 的 `normalizeRequest` 与 `requestFromArgv` 断言 `warnings` 恰为 `[{code:'W_FIELD_IGNORED', field:'role'}]`；`[repro]` 块一字未改，`check-defects` 的 `repro_sha256` 校验通过。
- `test/traceability/T-008.json`：AC-023、AC-024 均 `covered`，文件列表如设计。

## 为什么

- 之前 `main` 把无路由、无码错误写到 stderr 并退出 1，stdout 不是 JSON，调用方无法按契约解析；`select` 直接 `JSON.parse(--request)` 并把 `role`/`tier` 静默丢掉，错误码也不进注册表体系。
- 把错误体、退出码、请求规范化各收到一个模块，`cli.mjs` 只剩路由与统一兜底，退出码全部由冻结注册表决定，避免两处各抄一份表。

## 如何自测

按 `acceptance.md` 的 18 条命令逐条跑（PowerShell 7），全部退出码 0 且各自打印 `AC-0xx OK`：

- AC-023：A-01（`--ac AC-023` 过滤，`fail 0` / `filtered 1 files`）、A-02（9 个错误调用）、A-03（schema 校验）、A-04（9 个成功命令）、A-05（无参数 vs `usage`）、A-06（`W_TEST_CLOCK`）、A-07（select 的 draft 与两种警告）、A-16（全量回归）、A-18（辅助检查）。
- AC-024：A-08（`--ac AC-024` 过滤，`fail 0` / `filtered 2 files`）、A-09…A-15、A-17（`config`/`paths-entries`/`clock` 全绿，`import-safe` 保持基线 `pass 4 / fail 1` 且失败仍是第 3 个用例）。

全量 `node scripts/run-tests.mjs`：`tests 326 / pass 323 / fail 3`，失败集合与基线三条遗留完全一致（`AC-073 check-no-collab`、`AC-013 git check-ignore`、`AC-006 ctx.stderr`），未新增失败。

`check-defects` / `check-traceability`（`covered=28 planned=46`）/ `check-seams` / `check-unused` / `check-golden-frozen` / `check-frozen-files` / `check-contract-doc` 均为 ok。
