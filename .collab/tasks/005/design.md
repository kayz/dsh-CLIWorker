---
write_scope:
  - lib/paths.mjs
  - lib/config.mjs
  - lib/index.js
  - lib/cli.mjs
  - lib/commands/paths.mjs
  - lib/commands/init.mjs
  - lib/commands/usage/**
  - .gitignore
  - config/cliworker.example.json
  - test/unit/paths.test.mjs
  - test/unit/config.test.mjs
  - test/unit/gitignore.test.mjs
  - test/integration/paths-entries.test.mjs
  - test/characterization/defects/a4-paths.test.mjs
  - test/characterization/defects/a4-null-config.test.mjs
  - test/traceability/T-005.json
---

# Task 005 设计：路径统一与配置健壮性

本文是实现规格。凡本文给出字面值（码名、文件名、测试标题、输出字段），实现必须逐字照写。本文没有写的字段，不要加。

## 0. 前提与确认结果

- 继承：保留候选 #1 已写好的 §1–§13，以及同目录 `acceptance.md` 里 AC-012 A-1 至 AC-014 C-1 的命令。那些字面值（码名、路径规则、错误原因、gitignore 五行、测试标题、追溯分片）已经按 brief、interfaces 第 11 节和注册表写完，并且按当时的默认选项 A 规定了 `lib/cli.mjs` 的最小路由。人工答复就是选项 A，与该默认一致，所以不推翻这些规格，只把「尚无答复」改成已确认，并补上「两个文件不得改」的验收命令。工作区里 T-005 的任务图已经加入 `lib/cli.mjs`（主仓与本工作区都已改好）。调度器的 state、ledger、notice 不是本角色产物，不改、不回滚。
- 基线：分支 `task/005`，起点提交 `588a697`。T-001～T-004 已合并：已有 `scripts/run-tests.mjs`、`check-fast.mjs`、`check-defects.mjs`、`check-seams.mjs`、`check-traceability.mjs`，`lib/context.mjs`（`ctx.fs/env/platform/stdout/stderr/clock`），`contracts/registry.snapshot.json`，`test/helpers/ctx.mjs`（`createFakeContext`、`fakeFs`）。brief 没有给基准 commit，也没有既有验收报告路径。
- **已确认（选项 A）**：顶部 `write_scope` 在 brief 的清单上增加 `lib/cli.mjs`。该文件只做 §7：为 `paths` 与 `init` 增加路由，这两条不先调用 `loadConfig`；`E_CONFIG`、`E_CONFIG_EXAMPLE`、`E_CONFIG_EXISTS` 向 stdout 写 `{ok:false,error:{code,message,retryable,retry_after}}`，退出码 3。`retryable` 取注册表的 `false`，`retry_after` 为 `null`。通用 JSON 错误体与其余退出码映射仍属 T-008，本任务不建 `lib/output.mjs`。
- `lib/commands/_util.mjs`、`bin/cliworker.mjs` 不改。任务图的 write_scope 还列了 `bin/cliworker.mjs`；本文件顶部的 write_scope 故意不含它，也不含 `_util.mjs`。`bin/cliworker.mjs` 只调用 `lib/cli.mjs` 的 `main`，路由改在 `lib/cli.mjs` 就能到达 CLI。用量文件仍由 `_util.usageFile(config)` 取 `config._home`，所以 `loadConfig` 把 `config._home` 设为 `state_dir` 即可让用量写到 state_dir（§4）。
- 运行时不读 `.collab`、不读 `contracts/golden|spec`。码名与退出码取自 `contracts/registry.snapshot.json`：`E_CONFIG`、`E_CONFIG_EXAMPLE`、`E_CONFIG_EXISTS` 的 exit 均为 3；`W_LEGACY_USAGE` 是已登记的警告码。
- `check-seams` 只扫 `lib/`：`lib/` 下除 `context.mjs`、`store.mjs`、`fsx.mjs`、`exec.mjs` 外不得 import `node:fs` / `node:child_process`。所有读写文件一律走 `ctx.fs`。测试文件不受此限。
- `run-tests --ac AC-xxx` 按源码中的字面量 `[AC-xxx]` 选文件，所以每个测试标题必须含对应的 `[AC-xxx]`。

## 1. 现状缺陷（要修的）

1. `lib/config.mjs` 的 `loadConfig`：配置根为 `null` 时 `raw.schema` 的插值抛出 `TypeError`（无 `code`）；`schema` 不符、缺 `providers`、缺 `models` 的三个 `throw new Error(...)` 都没设 `error.code`。
2. `loadConfig` 返回的 `_home` 取 `defaultHome(ctx.env)`，与配置文件无关：任意两份配置共用同一目录，用量互相混写。
3. `lib/index.js` 的 `createPlugin` 自己再拼一遍配置路径，与 CLI 的路径规则各自独立。
4. `.gitignore` 只有 `config/cliworker.local.json`、`usage.jsonl`、`node_modules/`、`.collab/worktrees/` 四条字面规则。
5. `config/cliworker.example.json` 没有 `_example`、`schema`，codebuddy 的额度没有 `credits_per_mtok`。
6. 没有 `paths`、`init` 命令。

## 2. `lib/paths.mjs`（新建）

导出（具名导出，无默认导出）：

```js
export function resolvePaths({ configPath, env, platform, cwd, homedir, stateDir } = {})
// -> { config, state_dir, home }   三个值都是绝对路径字符串
export function legacyUsageWarnings({ ctx, homedir } = {})
// -> [] 或 [{ code: 'W_LEGACY_USAGE' }]
export function bundledExamplePath()
// -> 随包 config/cliworker.example.json 的绝对路径（由 import.meta.url 推出）
```

`resolvePaths` 规则（interfaces 第 11 节）：

- 默认值：`env = {}`、`platform = process.platform`、`cwd = process.cwd()`、`homedir = os.homedir()`。路径运算用 `P = platform === 'win32' ? path.win32 : path.posix`，这样规则在三个平台上的测试结果一致。
- `home`：`env.CLIWORKER_HOME`，缺省 `P.join(homedir, '.cliworker')`；再 `P.resolve(cwd, ...)`。
- `config`：依次取 `configPath` 参数、`env.CLIWORKER_CONFIG`、`P.join(home, 'config.json')`（第一个非空字符串），再 `P.resolve(cwd, ...)`。
- `state_dir`：
  - 传了 `stateDir`（非空字符串）：`P.resolve(P.dirname(config), stateDir)`，即相对路径按配置文件所在目录解析，绝对路径原样规范化。
  - 否则：`P.join(home, 'state', hash)`，`hash` 是 `config` 的规范化绝对路径（`win32` 时先转小写）的 UTF-8 字节做 sha256 的十六进制前 12 位。
- 纯函数，不读文件系统，不读 `process.env`（只读传入的 `env`）。

`legacyUsageWarnings({ ctx, homedir })`：旧用量文件为 `path.join(homedir ?? os.homedir(), '.cliworker', 'usage.jsonl')`；`ctx.fs.existsSync(旧文件)` 为真时返回 `[{ code: 'W_LEGACY_USAGE' }]`，否则返回 `[]`。`doctor` 命令属 T-024；本任务只提供此函数，T-024 的 doctor 与本任务的 `paths` 输出共用它。

## 3. `lib/config.mjs`

保留导出 `SCHEMA`（值仍为 `'cliworker.config/v1'`）、`defaultHome`、`ensureDir`、`readUsage`、`appendUsage`。`defaultHome(env)` 改为返回 `resolvePaths({ env }).home`（行为不变）。

`loadConfig({ file, ctx })` 的步骤与顺序（每个失败都抛 `Error`，设 `error.code`，`message` 必须含配置文件的绝对路径和原因；格式 `cannot load CLIWorker config <abs path>: <reason>`）：

1. `ctx` 或 `ctx.fs` 缺失仍抛 `TypeError('loadConfig requires ctx.fs')`（这是编程错误，不是配置错误）。
2. `const { config } = resolvePaths({ configPath: file, env: ctx.env, platform: ctx.platform })`。
3. 读文件并 `JSON.parse`。读取失败或非 JSON：`E_CONFIG`，原因取底层错误信息。
4. 根不是普通对象（`null`、数组、数字、字符串、布尔）：`E_CONFIG`，原因 `root must be a JSON object`。
5. 示例识别：根的 `_example === true`，或「根去掉顶层 `_example` 键」与「随包示例去掉顶层 `_example` 键」按 `node:util` 的 `isDeepStrictEqual` 相等：`E_CONFIG_EXAMPLE`，原因 `this is the bundled example; copy it and edit it`。随包示例经 `ctx.fs.readFileSync(bundledExamplePath(), 'utf8')` 读取并解析；读不到或解析失败时跳过深相等判断（只剩 `_example` 标记判断），不抛错。
6. `schema` 存在且不等于 `SCHEMA`：`E_CONFIG`，原因 `unsupported schema <值>`（值用 `String()` 拼接，不得对非对象取属性）。
7. `providers` 缺失或不是普通对象（含数组）：`E_CONFIG`，原因 `providers is required`；`models` 同理，原因 `models is required`。
8. `state_dir` 存在时必须是非空字符串，否则 `E_CONFIG`，原因 `state_dir must be a non-empty string`。
9. 返回 `{ ...raw, _file: <config 绝对路径>, _home: <state_dir 绝对路径> }`。`_home` 的含义从此是 **state_dir**（名字沿用，因为 `_util.usageFile` 读它）；`state_dir` 取 `resolvePaths({ configPath: file, env, platform, stateDir: raw.state_dir }).state_dir`。

不做 v1→v2 迁移、不发 `W_CONFIG_V1`（属后续任务）；不引入新的 npm 依赖。

## 4. 用量落点

`lib/commands/usage/record.mjs`、`summary.mjs` 通过 `usageFile(config, ctx)` 得到 `<config._home>/usage.jsonl`，而 `config._home` 现在就是 state_dir，因此用量写到 state_dir，不同配置互不干扰。这两个文件本任务预期无需改动（写范围内保留，仅在测试证明必须时才改）。`appendUsage` 已 `mkdir -p` 父目录。

## 5. `lib/commands/paths.mjs`（新建）

```js
export async function run({ argv, ctx }) // 不接收 config，不调用 loadConfig
```

- 取 `--config`（`_util.arg`），`resolvePaths({ configPath, env: ctx.env, platform: ctx.platform })` 得 `config`。
- 宽松读取：尝试 `ctx.fs.readFileSync(config)` 并 `JSON.parse`；仅当根是普通对象且 `state_dir` 为非空字符串时，用它再算一次 `resolvePaths(..., { stateDir })`。文件不存在、非 JSON、`_example` 示例等任何情况都不报错（所以 `paths --config config/cliworker.example.json` 成功）。
- 返回（唯一输出形状，不加其它键）：`{ ok: true, config: <abs>, state_dir: <abs>, warnings: legacyUsageWarnings({ ctx }) }`。

## 6. `lib/commands/init.mjs`（新建）

```js
export async function run({ argv, ctx }) // 不接收 config，不调用 loadConfig
```

- 目标文件 = `resolvePaths({ configPath: arg(argv,'--config'), env, platform }).config`。
- `ctx.fs.existsSync(目标)` 为真：抛 `E_CONFIG_EXISTS`，`message` 含目标绝对路径；**不得写入、不得改动该文件**。
- 否则：`ensureDir(目标所在目录, ctx)`，把随包示例的原文（`ctx.fs.readFileSync(bundledExamplePath(), 'utf8')`，读不到抛 `E_CONFIG`）原样写入目标。
- 返回 `{ ok: true, config: <abs>, state_dir: <abs>, warnings: [] }`（`state_dir` 用不带 `stateDir` 的 `resolvePaths`）。
- 刚 init 出的文件带 `_example: true`，所以其它命令加载它会得到 `E_CONFIG_EXAMPLE`；这是预期行为，用户编辑后才能用。

## 7. `lib/cli.mjs`（已确认的最小改动）

- `import * as paths from './commands/paths.mjs'`、`import * as init from './commands/init.mjs'`；`ROUTES` 增加 `{ cmd: 'paths', sub: null, module: paths }`、`{ cmd: 'init', sub: null, module: init }`；`resolveRoute` 对 `paths`、`init` 与 `providers` 一样把 `sub` 置 `null`。`USAGE` 增加 `init | paths`。
- `main`：路由是 `paths` 或 `init` 时不调用 `loadConfig`，以 `config: null` 调 `route.run({ argv, ctx, config: null })`；其它路由照旧先 `loadConfig`。
- 错误处理：捕获到 `e.code` 属于 `E_CONFIG`、`E_CONFIG_EXAMPLE`、`E_CONFIG_EXISTS` 时，向 **stdout** 写 `JSON.stringify({ ok: false, error: { code, message, retryable: false, retry_after: null } }, null, 2) + '\n'`，返回 `{ exitCode: 3 }`，stderr 不写任何内容。其它错误保持现状（文本写 stderr，`exitCode: e.exitCode ?? 1`）；未知命令仍是 `exitCode: 1`。
- `warnAboutTestClock` 对成功结果与 `paths`/`init` 结果照常生效，不改。

## 8. `lib/index.js`

`createPlugin` 删掉自己拼配置路径的那一行，改为：

```js
const { config: file } = resolvePaths({ configPath: s.configPath, env: ctx.env, platform: ctx.platform })
const getConfig = () => loadConfig({ file, ctx })
```

并从 `./paths.mjs` 导入 `resolvePaths`，不再需要从 `config.mjs` 导入 `defaultHome`。`createPlugin` 的返回值 `{ registered, errors }` 与 `getRegistration()` 形状不变。其它路由行为不变。

## 9. `.gitignore`

最终内容（每行一条，UTF-8 无 BOM，LF）：

```
config/*.local.json
state/
*.jsonl
.collab/
node_modules/
```

删去原来的 `config/cliworker.local.json`、`usage.jsonl`、`.collab/worktrees/`（后三者已被通配规则覆盖）。

## 10. `config/cliworker.example.json`

仍是 v1 形状。只做三处修改，其余字节不动，缩进保持 2 空格：

1. 对象最前面新增 `"_example": true,` 与 `"schema": "cliworker.config/v1",` 两个键（这个顺序）。
2. `quotas.codebuddy` 新增 `"credits_per_mtok": 1000`（紧跟在 `"unit": "credits"` 之后；取值与 `contracts/golden/quota-shapes.json` 的示例一致）。
3. 不改 `providers`、`models`。

## 11. 测试（文件、标题、断言）

所有测试用 `node:test`；涉及文件系统的用 `createFakeContext({ files, env, platform })`，需要真实 CLI/真实 git 的才用真实临时目录（`os.tmpdir()` 下，结束删除）。标题逐字如下。

**`test/unit/paths.test.mjs`**
- `[AC-012] resolvePaths takes configPath from the argument, then CLIWORKER_CONFIG, then CLIWORKER_HOME/config.json`
- `[AC-012] resolvePaths derives state_dir from CLIWORKER_HOME/state/<sha256 prefix 12> of the config path`（断言前缀长度 12、十六进制、与手算 sha256 一致）
- `[AC-012] resolvePaths lower-cases the config path before hashing on win32`（`platform: 'win32'`，`C:\A\cfg.json` 与 `c:\a\cfg.json` 同 state_dir；`platform: 'linux'` 下大小写不同则不同）
- `[AC-012] resolvePaths resolves a relative explicit stateDir against the config file directory`
- `[AC-012] two different config paths get disjoint state_dir values`（互不为前缀）
- `[AC-012] legacyUsageWarnings reports W_LEGACY_USAGE only when the legacy usage file exists`

**`test/integration/paths-entries.test.mjs`**（经 `main(argv, ctx)` 与 `createPlugin`，不 spawn 子进程）
- `[AC-012] cliworker paths --config X reports the same config and state_dir as resolvePaths`
- `[AC-012] createPlugin with configPath X reads the same config file that paths reports`（宿主 stub 调 `/cliworker/providers` 处理器，`fakeFs` 访问记录里 `readFileSync` 的路径等于 `paths` 报告的 `config`；`loadConfig` 对同一文件返回的 `_home` 等于 `paths` 报告的 `state_dir`）
- `[AC-012] usage record writes under the state_dir that paths reports`
- `[AC-012] paths reports W_LEGACY_USAGE in warnings when the legacy usage file exists`

**`test/unit/config.test.mjs`**
- `[AC-013] loadConfig rejects _example true with E_CONFIG_EXAMPLE`
- `[AC-013] loadConfig rejects a re-indented copy of the bundled example without the marker with E_CONFIG_EXAMPLE`
- `[AC-013] loadConfig accepts the bundled example after a real edit`（改动任一字段后可加载）
- `[AC-013] init refuses to overwrite an existing file with E_CONFIG_EXISTS and leaves it unchanged`
- `[AC-013] init writes the bundled example when the target is missing`
- `[AC-013] the CLI maps E_CONFIG_EXAMPLE and E_CONFIG_EXISTS to ok false with exit code 3`
- `[AC-014] loadConfig throws E_CONFIG with the absolute path and a reason for null, [], 42, non-JSON, missing providers and missing models`（表驱动，每行断言 `error.code === 'E_CONFIG'`、`message` 含绝对路径、不是 `TypeError`）
- `[AC-014] the CLI prints ok false E_CONFIG on stdout, exits 3 and writes nothing to stderr for each bad config`（表驱动；`ctx.stderr.text() === ''`）

**`test/unit/gitignore.test.mjs`**
- `[AC-013] git check-ignore -v matches config/a.local.json, state/x, a.jsonl and .collab/x`
- `[AC-013] git check-ignore does not match config/cliworker.example.json`

用真实 `git check-ignore -v`（`spawnSync`，`cwd` 为仓库根）；命中时 stdout 每行含 `.gitignore:` 与对应规则，退出码 0；不命中退出码 1 且 stdout 为空。路径用 `--` 之后传入。

**`test/characterization/defects/a4-paths.test.mjs`、`a4-null-config.test.mjs`**：只在文件末尾追加 `[fixed]` 测试，**不得改动已有 `[repro]` 块**（`check-defects` 校验其 sha256）。追加的两条（顶层 `test(...)`，标题以 `[fixed]` 开头）：
- `[fixed] [AC-012] live loadConfig gives two config files disjoint state directories`（对 live `lib/config.mjs`，用真实临时目录与 `CLIWORKER_HOME`；复刻 `[repro]` 的场景，断言 `_home` 不同且都不落在对方配置文件目录内）
- `[fixed] [AC-014] live loadConfig throws E_CONFIG for a null and an empty config`（复刻 `[repro]` 的 `null` 与 `{}`，断言 `code === 'E_CONFIG'` 且不是 `TypeError`）

**`test/traceability/T-005.json`**：

```json
{
  "task": "T-005",
  "milestone": "M1",
  "entries": [
    { "ac": "AC-012", "status": "covered", "files": ["test/unit/paths.test.mjs", "test/integration/paths-entries.test.mjs", "test/characterization/defects/a4-paths.test.mjs"] },
    { "ac": "AC-013", "status": "covered", "files": ["test/unit/config.test.mjs", "test/unit/gitignore.test.mjs"] },
    { "ac": "AC-014", "status": "covered", "files": ["test/unit/config.test.mjs", "test/characterization/defects/a4-null-config.test.mjs"] }
  ]
}
```

## 12. 不做的事

- 不实现 `doctor`（T-024）、v1→v2 迁移与 `W_CONFIG_V1`、`config migrate`、统一 JSON 错误体（T-008）、`E_CONFIG_SECRET_INLINE`。
- 不改 `lib/commands/_util.mjs`、`bin/cliworker.mjs`、`package.json`、`README.md`、`test/characterization/defects.json`、任何 `contracts/**`、`scripts/**`。
- 不改已有 `[repro]` 测试。
- 令牌与密钥不进仓库、日志或输出：错误信息只含配置文件路径与原因，不回显配置内容。

## 13. 已知风险（交下游留意，本任务不处理）

- `.gitignore` 加入 `.collab/` 后，已被跟踪的 `.collab/**` 文件不受影响，但**新建**的 `.collab/tasks/<id>/*` 文件需要 `git add -f` 才能入库。调度器若用普通 `git add`，对新任务的阶段提交会被拒绝。这是 brief 与 AC-013 明确要求的规则，不能回避。
- `*.jsonl` 同理会忽略今后新增的 `.jsonl` 夹具；既有已跟踪文件不受影响。
- `package.json` 的 `files` 不含 `config/`，npm 包里没有随包示例。`loadConfig` 此时跳过深相等判断（§3 第 5 步），`init` 会报 `E_CONFIG`。包内容调整属后续打包任务。
- `credits_per_mtok: 1000` 只是示例值，不代表真实换算。
