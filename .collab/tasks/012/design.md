---
task: T-012
write_scope:
  - test/helpers/leak-scan.mjs
  - test/helpers/flow.mjs
  - test/flows/flow.test.mjs
  - test/flows/steps/select.mjs
  - test/flows/steps/doctor.mjs
  - test/unit/leak-scan-canary.test.mjs
  - test/traceability/T-012.json
---

# T-012 设计：泄露检查共享 harness 与全流程测试框架

对应 AC-031（owner T-012，M2，levels: integration, unit，baseline: darwin/linux/win32）。本任务只新增测试基础设施，不改动 `lib/`、`scripts/`、`bin/`、`contracts/`。

## 0. 前提与边界

- 零第三方依赖，Node 20+，ESM（`.mjs`）。只用 `node:*` 内置模块。
- 任务图的 inputs 列了 `lib/store.mjs`，但它属于 T-011，当前分支不存在。本任务**不得 import `lib/` 下任何文件**（含 `lib/store.mjs`、`lib/redact.mjs`、`lib/contract/scan.mjs`）：leak-scan 是独立的字节级扫描器，与 `lib/contract/scan.mjs`（视图语义扫描）职责不同，不要混用。
- 令牌/哨兵值不得出现在：仓库文件、测试日志（assert 失败消息含 hits 时只能带 label）、扫描结果 JSON、任何子进程 argv。哨兵只经 env 进入子进程。
- 临时目录用 `fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-flow-'))`（不在 OneDrive 仓库内），测试结束一律 `fs.rmSync(root, {recursive:true, force:true})`。
- `test/flows/steps/*.mjs` 不以 `.test.mjs` 结尾，不会被 `scripts/run-tests.mjs` 枚举为测试文件，也不构成 orphan；`test/flows/flow.test.mjs` 会被枚举（`flows` 在 TEST_DIRS 中）。
- 测试标题必须含 `[AC-031]`（`run-tests --ac` 按源码中是否含 `[AC-031]` 过滤文件）。

## 1. `test/helpers/leak-scan.mjs`

纯函数模块，无副作用，不读 env。导出：

```js
export const MIN_SENTINEL_LENGTH = 16
export function makeSentinel(label)              // -> string
export function normalizeSentinels(sentinels)    // -> [{label, value}]
export function scanBytes(data, sentinels)       // -> [{label, encoding, offset}]
export function leakScan(surfaces)               // -> {ok, hits, errors, scanned}
```

### 1.1 哨兵

- `makeSentinel(label)`：`label` 须匹配 `/^[A-Za-z0-9]+$/`，否则抛 `TypeError`；返回 `` `cwsentinel_${label}_${crypto.randomBytes(12).toString('hex')}` ``（长度 ≥ 16，每次调用不同）。
- `normalizeSentinels(list)`：元素可为字符串（label 自动为 `S1`、`S2`…，按序号）或 `{label, value}`。`value` 非字符串或长度 < `MIN_SENTINEL_LENGTH` 抛 `TypeError`（防止短串造成误报/空匹配）；`label` 重复抛 `TypeError`；空列表抛 `TypeError`。

### 1.2 编码

对每个哨兵匹配以下四种字节形式（`Buffer.indexOf`，二进制安全），`hit.encoding` 取值固定为：

| encoding | 目标字节 |
|---|---|
| `raw` | UTF-8 字节 |
| `utf16le` | UTF-16LE 字节 |
| `base64` | 整串 UTF-8 的标准 base64（含 `=` 填充，ASCII） |
| `hex` | 整串 UTF-8 的小写十六进制（ASCII） |

`scanBytes(data, sentinels)`：`data` 为 string（按 UTF-8 转 Buffer）或 Buffer；返回该数据里所有命中（每个 label×encoding 取首次出现的 offset，单位字节）。无命中返回 `[]`。

### 1.3 `leakScan(surfaces)`

入参对象，所有字段可选（缺省的面跳过，不算错误），`sentinels` 必填：

```js
leakScan({
  sentinels,                 // 必填，见 1.1
  stdout,                    // string | Buffer | Array<string|Buffer>（多次调用累积）
  stderr,                    // 同 stdout
  argv,                      // string[][]：每次子进程调用的完整 argv（含命令本身，下标 0）
  http,                      // Array<{method?, url?, status?, headers?, body?}>
  state_dir,                 // string：递归扫描目录
  auditFile,                 // string：审计文件路径，默认 path.join(state_dir, 'audit.jsonl')
})
```

返回：

```js
{
  ok,        // hits.length === 0 && errors.length === 0
  hits,      // [{surface, location, sentinel, encoding, offset?}]
  errors,    // [{surface, location, code}]  扫描自身失败（如文件不可读），code 为 error.code 或 'E_SCAN'
  scanned,   // {stdout, stderr, argv, http, files, audit}  各面实际扫描量
}
```

- `hit.sentinel` 是 **label**，绝不是哨兵值。整个返回值 `JSON.stringify` 后不得含任何哨兵值（canary 会断言）。
- `scanned`：`stdout`/`stderr` 为字节数；`argv` 为扫描的 argv 元素个数；`http` 为条目数；`files` 为 state_dir 下扫描的普通文件数（不含 audit 文件）；`audit` 为审计文件字节数（不存在为 0）。用于证明扫描不是空转。

#### 位置（`location`）格式——固定，canary 与下游任务据此断言

| surface | location |
|---|---|
| `stdout` | `stdout@<byteOffset>`；传数组时为 `stdout[<i>]@<byteOffset>` |
| `stderr` | `stderr@<byteOffset>`；数组 `stderr[<i>]@<byteOffset>` |
| `argv` | `argv[<callIndex>][<argIndex>]@<byteOffset>` |
| `http` | `http[<i>].body@<byteOffset>`、`http[<i>].url@<byteOffset>`、`http[<i>].headers.<lowercased name>@<byteOffset>` |
| `state_dir` | `state_dir:<posix 相对路径>@<byteOffset>`；命中文件名/目录名本身时为 `state_dir:<posix 相对路径>#name` |
| `audit` | `audit:<相对 state_dir 的 posix 路径或 basename>:<行号 1 起>@<行内 byteOffset>` |

- http `body` 为 string/Buffer 直接扫；为对象则先 `JSON.stringify`。`headers` 值逐个扫（数组值逐元素）。
- `state_dir` 递归遍历所有深度；**不跟随符号链接**（跳过，不报错）；二进制文件按字节扫。相对路径统一为 `/` 分隔。
- 审计文件（`auditFile`，默认 `state_dir/audit.jsonl`）只以 `audit` 面报告，且在 `state_dir` 遍历中跳过，同一命中不得重复报告。文件不存在不是错误。
- `state_dir` 不存在视为空目录（0 命中、0 文件、无错误）。
- 返回的 `hits` 顺序稳定：按面顺序 `stdout, stderr, argv, http, state_dir, audit`，面内按位置顺序，目录遍历按 `localeCompare`‑无关的码点升序（`Array.sort()` 默认）。

## 2. `test/helpers/flow.mjs`

全流程测试框架：在**同一个**临时 root/state_dir 与**同一组**哨兵下，依次运行自动发现的步骤，并在结束后调用 `leakScan`。导出：

```js
export const SENTINEL_ENV = 'CW_FLOW_SENTINEL'
export const STEP_ORDER = ['auth','doctor','discover','enumerate','probe','select','run','http-select','http-admin']
export const STEPS_DIR    // 绝对路径：test/flows/steps（由 import.meta.url 推导）
export async function discoverSteps(dir = STEPS_DIR)   // -> [{name, file, mod}]
export function createFlow(options = {})               // -> flow
export async function runFlow({ flow, stepsDir = STEPS_DIR })  // -> {results, leak, ok}
```

### 2.1 步骤模块约定（T-013 及后续任务按此新增 `test/flows/steps/<name>.mjs`）

每个步骤文件导出：

```js
export const name = 'select'          // 必须等于文件 basename（去掉 .mjs）
export const introduced_by = 'T-012'  // 任务号，匹配 /^T-\d{3}$/
export const ac = ['AC-031']          // 非空数组，元素匹配 /^AC-\d{3}$/
export async function run(flow) {}    // 通过 flow API 执行；失败即抛错（可用 node:assert/strict）
```

`discoverSteps(dir)`：

- 读取 `dir` 下所有 `*.mjs`（非递归），动态 `import(pathToFileURL(file).href)`；`.test.mjs` 与非 `.mjs` 忽略。
- 校验导出契约（上面四项）：不满足则抛 `Error`，消息含文件名与具体问题（如 `steps/foo.mjs: name must equal basename`）。`name` 重复同样抛错。
- 排序：先按 `STEP_ORDER` 中的位置，不在 `STEP_ORDER` 中的名字排在最后并按码点升序。
- **本任务不断言步骤集合恰为 9 个**（那是 T-030 的 flow-complete）；本任务仅要求发现到的步骤全部执行。`STEP_ORDER` 之外的名字是允许的（供自测夹具使用）。

### 2.2 `createFlow(options)`

同步创建临时环境并返回 `flow` 对象：

```
<root>/                         mkdtemp 目录
  config.json                   夹具配置
  home/                         CLIWORKER_HOME
  state/                        state_dir（config.state_dir = "state"，不预创建）
  fake-cli/fake-cli.mjs         夹具 CLI，仅打印 "fake-cli 1.2.3\n" 到 stdout 后 exit 0
```

`options`：`{ sentinels?: Array<string|{label,value}> }`；缺省为 `[{label:'FLOW', value: makeSentinel('FLOW')}]`。

夹具配置（JSON，`JSON.stringify(..., null, 2)` 写入，UTF-8 无 BOM）：

```json
{
  "schema": "cliworker.config/v1",
  "state_dir": "state",
  "providers": {
    "fixture": { "cli": "<process.execPath>", "args_prefix": ["<root>/fake-cli/fake-cli.mjs"], "readonly": true }
  },
  "models": {
    "q": { "provider": "fixture", "id": "q", "level": "Quick", "identity": "verified" }
  }
}
```

`flow` 字段：

| 字段 | 含义 |
|---|---|
| `root` | 临时根目录绝对路径 |
| `config_path` | `<root>/config.json` |
| `state_dir` | `<root>/state`（`path.join`，平台原生分隔符） |
| `home` | `<root>/home` |
| `sentinels` | `[{label,value}]`（已 normalize） |
| `sentinel` | `sentinels[0].value`（便捷访问） |
| `env` | 子进程基础 env（见下） |
| `shared` | `{}`，供步骤间传递数据（如 enumerate 产出供 select 使用） |
| `captured` | `{stdout: string[], stderr: string[], argv: string[][], http: object[]}` |

`flow.env` 构造：复制 `process.env`，**删除** `NODE_TEST_CONTEXT` 以及所有以 `CLIWORKER_` 开头的变量（含 `CLIWORKER_TEST_CLOCK_FILE`、`CLIWORKER_CONFIG`、`CLIWORKER_RUN_*`），再设置 `CLIWORKER_HOME=<home>` 与 `[SENTINEL_ENV]=<第一个哨兵值>`；若有多个哨兵，第 i 个（i≥2）放入 `CW_FLOW_SENTINEL_<i>`（i 从 2 起）。哨兵**只**经 env 传递。

方法：

- `flow.spawn(command, args = [], { input, env, timeout } = {})`：`child_process.spawnSync(command, args, { env: {...flow.env, ...env}, input, encoding: 'utf8', timeout: timeout ?? 60000, windowsHide: true })`。把 `[command, ...args]` 追加到 `captured.argv`，stdout/stderr（字符串，空串也记）追加到 `captured.stdout/stderr`。返回 `{code, signal, stdout, stderr, json}`；`json` 为 `JSON.parse(stdout)` 成功时的值，否则 `null`。spawn 自身错误（`result.error`）直接抛。
- `flow.run(args, opts)`：等价 `flow.spawn(process.execPath, [<repo>/bin/cliworker.mjs, ...args], opts)`；`<repo>` 由 `import.meta.url` 推导（`test/helpers` 上两级）。步骤必须用它（或 `flow.spawn`）起进程，保证 argv/stdout/stderr 被记录。
- `flow.recordHttp({method, url, status, headers, body})`：浅拷贝后追加到 `captured.http`（供 T-024 的 http 步骤使用；本任务只提供，不使用）。
- `flow.scan()`：`leakScan({ sentinels: flow.sentinels, stdout: captured.stdout, stderr: captured.stderr, argv: captured.argv, http: captured.http, state_dir: flow.state_dir })`。
- `flow.cleanup()`：`fs.rmSync(root, {recursive:true, force:true})`，幂等。

### 2.3 `runFlow({ flow, stepsDir })`

1. `steps = await discoverSteps(stepsDir)`。
2. 依次 `await mod.run(flow)`；单步抛错记录后**继续**执行后续步骤（不短路）。
3. `results = [{name, introduced_by, ac, ok, error}]`，`error` 为失败时的 `error.message`（字符串；成功为 `null`）。**error 消息不得含哨兵值**：记录前把 message 中出现的每个哨兵值替换为 `<label>`。
4. 全部步骤结束后 `leak = flow.scan()`。
5. 返回 `{ results, leak, ok }`，`ok = results.every(r => r.ok) && leak.ok`。`runFlow` 不调用 `cleanup()`，由调用方（测试的 `finally`/`after`）负责。

## 3. 步骤（最小版）

两个步骤的 `introduced_by = 'T-012'`、`ac = ['AC-031']`。后续任务会整体替换它们（select → v1 版，doctor → T-024 完整版），因此只做最小功能、不引入其它约定。

### `test/flows/steps/doctor.mjs`（最小版）

当前代码库尚无 `doctor` 命令，最小版用已有命令检查环境：

1. `flow.run(['paths','--config',flow.config_path])`：`code === 0`，`json.ok === true`，`json.config` 与 `json.state_dir` 分别等于 `flow.config_path`、`flow.state_dir`（比较前对两侧 `path.resolve`，Windows 上忽略大小写），`json.warnings` 深等于 `[]`。
2. `flow.run(['providers','--config',flow.config_path])`：`code === 0`，`json.schema === 'cliworker.providers/v1'`，`json.providers` 中 `id==='fixture'` 的项 `state === 'callable'` 且 `version === '1.2.3'`。

### `test/flows/steps/select.mjs`（最小版）

`flow.run(['models','select','--config',flow.config_path,'--level','Quick','--request-id','flow-select-1'])`：`code === 0`，`json.ok === true`，`json.models.length === 1`，`json.models[0].key === 'q'`。（当前 CLI 返回 draft 视图并带 `W_DRAFT_DEPRECATED`，最小版不对 warnings 做断言。）

两个步骤都不得把哨兵放进 argv、不得写文件到 state_dir。

## 4. 测试

### `test/unit/leak-scan-canary.test.mjs`（unit，所有标题含 `[AC-031]`）

canary：证明扫描器自身有效。构造临时 state_dir（含 3 层深目录），用 `makeSentinel` 生成哨兵，对每个面单独植入，其余面保持干净：

1. 六个面逐一植入——`stdout`、`stderr`、`state_dir` 深层文件（`a/b/c/deep.bin`，哨兵前后夹随机字节）、`audit`（`audit.jsonl` 第 2 行）、`http`（body；另覆盖 headers 与 url 各一例）、`argv`（`[['node','x.mjs','--token', value]]`）。每例断言：`ok === false`；`hits` 恰有 1 条且 `surface`、`location` 与 §1.3 表一致（精确字符串断言，如 `state_dir:a/b/c/deep.bin@<offset>`、`audit:audit.jsonl:2@<offset>`、`argv[0][3]@0`）；`hit.sentinel` 为 label；`errors` 为空。
2. 干净运行：所有面都填充非空的无关内容，`ok === true`、`hits` 为 `[]`、`errors` 为 `[]`，且 `scanned.files ≥ 1`、`scanned.stdout > 0`（证明非空转）。
3. 编码：在 state_dir 文件中分别植入 utf16le / base64 / hex 形式，各检出且 `encoding` 正确。
4. 多哨兵：两个哨兵分别在 stdout 与 stderr，hits 按 label 区分。
5. 不泄露：对上述所有结果 `JSON.stringify(result)` 不含任何哨兵值。
6. 文件名：文件名含哨兵时报告 `state_dir:<rel>#name`。
7. 输入校验：`makeSentinel('bad label')`、短哨兵（<16）、重复 label、空列表均抛 `TypeError`。
8. `state_dir` 不存在 → `ok === true`、`scanned.files === 0`；audit 不存在 → `scanned.audit === 0`。
9. audit 文件不重复报告：audit 内的命中只出现一次且 surface 为 `audit`。

### `test/flows/flow.test.mjs`（integration，所有标题含 `[AC-031]`）

1. 发现：`discoverSteps()` 至少包含 `doctor`、`select`；全部名字在 `STEP_ORDER` 内；导出契约合法；返回顺序遵循 `STEP_ORDER`。
2. 全链：`createFlow()` → `runFlow({flow})`：每个步骤 `ok`，`leak.ok === true`，`leak.hits` 为空，`leak.scanned.argv > 0` 且 `leak.scanned.stdout > 0`；`results.map(r=>r.name)` 等于 `discoverSteps()` 的名字顺序；所有步骤共享同一个 `flow.state_dir`（`flow.root` 仅一个）。`finally` 里 `flow.cleanup()`，之后 `fs.existsSync(flow.root) === false`。
3. env 提供哨兵：`flow.spawn(process.execPath, ['-e', "process.stdout.write(process.env.CW_FLOW_SENTINEL ? 'present:' + process.env.CW_FLOW_SENTINEL.length : 'absent')"])`（哨兵不得进 argv），断言 stdout 等于 `` `present:${flow.sentinel.length}` ``；并断言 `captured.argv` 中无任何元素包含哨兵值。
4. 自测（夹具步骤目录写在 `os.tmpdir()` 的独立临时目录，由测试自己创建和清理；夹具步骤文件内不 import 任何仓库模块）：
   - 泄露到 stdout 的步骤（`flow.spawn(process.execPath, ['-e', 'console.log(process.env.CW_FLOW_SENTINEL)'])`）→ `leak.ok === false`，`leak.hits` 中有 `surface === 'stdout'`，`ok === false`。
   - 写文件到 `flow.state_dir` 深层的步骤 → `surface === 'state_dir'`。
   - 把哨兵放进 argv 的步骤（`flow.spawn(process.execPath, ['-e', '0', flow.sentinel])`）→ `surface === 'argv'`。
   - 抛错的步骤：`results` 中该步 `ok === false` 且 `error` 不含哨兵值；后续步骤仍被执行。
   - 导出契约不合法的步骤（`name` 与文件名不符）→ `discoverSteps` 抛错，消息含该文件名。
5. 以上自测所用 flow 均在 `finally` 清理。

测试不使用 `sleep`、不断言墙钟。

### 用例标题约定（验收用 `--test-name-pattern` 按标题单独判定）

标题形如 `[AC-031] <描述>`，且描述中须包含下列英文关键词（小写，原样出现）：

- leak-scan-canary：`stdout`、`stderr`、`state_dir`（深层文件）、`audit`、`http`、`argv`、`clean`（干净运行）、`not leak`（结果不含哨兵值）、`input`（输入校验）；其余用例（编码、多哨兵、文件名等）标题自由。
- flow.test：`discover`、`full flow`、`env`、`self-test`（§4.4 的各子用例标题都含 `self-test`）。

## 5. 追踪文件 `test/traceability/T-012.json`

格式同 `test/traceability/T-010.json`：

```json
{
  "task": "T-012",
  "milestone": "M2",
  "entries": [
    { "ac": "AC-031", "status": "covered", "files": ["test/unit/leak-scan-canary.test.mjs", "test/flows/flow.test.mjs"] }
  ]
}
```

## 6. 风险与取舍

- **Windows 路径**：`flow.state_dir`/`json.state_dir` 比较前统一 `path.resolve` 并在 win32 忽略大小写；位置字符串中的相对路径固定 `/`。
- **`lib/store.mjs` 缺失**：见 §0，本任务不依赖；T-011 合并后审计由真实 `lib/audit.mjs` 写入同一个 `audit.jsonl`，leak-scan 无需改动。
- **步骤集合**：只强制“已有步骤全跑”，恰为 9 步的断言留给 T-030，避免 T-013 之前/之后的任务互相阻塞。
- **哨兵不入日志**：所有断言消息只用 label 与位置；`runFlow` 对 error.message 脱敏。
