---
write_scope:
  - lib/context.mjs
  - lib/exec.mjs
  - lib/cli.mjs
  - lib/commands/**
  - bin/cliworker.mjs
  - lib/index.js
  - lib/availability.mjs
  - lib/config.mjs
  - lib/forecast.mjs
  - contracts/host/**
  - contracts/context/**
  - test/helpers/ctx.mjs
  - test/helpers/clock.mjs
  - test/helpers/host-stub.mjs
  - scripts/check-seams.mjs
  - test/fixtures/seams/**
  - test/unit/seams.test.mjs
  - test/unit/import-safe.test.mjs
  - test/unit/clock.test.mjs
  - test/contract/host-stub.test.mjs
  - test/contract/context.test.mjs
  - test/integration/registration.test.mjs
  - test/traceability/T-003.json
---

# Task 003 设计：可注入缝、可推进时钟、import-safe 入口、命令路由骨架、宿主与上下文契约

规格来源：`.collab/blueprint/cliworker-v2/design.md` §3、`interfaces.md` §13、§14、§16、`test-strategy.md`。本文把它们落成可执行的改动清单；与蓝图冲突时以蓝图为准，本文没写的细节不要自行扩展。

## 0. 现状与边界

基准是 HEAD `7f655f7`。在该提交上 `node scripts/check-fast.mjs` 通过：70 个测试、17 个文件，`check-traceability` 为 `covered=6 planned=68`。

现状里违反缝规则的位置，都要在本任务里清掉：

| 位置 | 问题 | 处理 |
|---|---|---|
| `lib/cli.mjs:1` | 导入 `node:fs`（未使用） | 删除 |
| `lib/cli.mjs:9,65` | `process.exit`，且导入时立即执行 `main()` | 改为 `export async function main(argv, ctx)`，返回 `{exitCode}` |
| `lib/cli.mjs:53` | `new Date()` | 改用 `ctx.clock.nowIso()` |
| `lib/availability.mjs:1` | 导入 `node:child_process` | 删除，改用 `ctx.exec` |
| `lib/config.mjs:1` | 导入 `node:fs` | 删除，改用 `ctx.fs` |
| `lib/forecast.mjs:17` | 默认参数 `Date.now()` | 改为 `systemNow()`（来自 `lib/context.mjs`） |
| `lib/index.js:20,73` | 导入时读 `process.env`；`console.error` 吞掉注册错误 | 改为 `createPlugin` 返回报告，不再只写 console |

`lib/select.mjs` 不在 write_scope，保持原样；它不含 fs、child_process、时间或定时器，所以不影响 check-seams。它内部三处 `forecast(...)` 调用没有传 `now`，这一点由 T-007 处理；本任务靠 `forecast.mjs` 的默认值 `systemNow()` 保持行为不变。

不在本任务内：错误体统一为 `{ok:false, error:{code,…}}` 与注册表退出码（T-004 之后）、`init/paths/doctor` 等新命令、`lib/store.mjs`、`lib/fsx.mjs`、`package.json` 的 `files` 字段。`lib/select.mjs` 和 `scripts/` 下除 `check-seams.mjs` 以外的脚本一律不动。

## 1. 文件清单

新增：
- `lib/context.mjs`、`lib/exec.mjs`
- `lib/commands/_util.mjs`
- `lib/commands/providers/list.mjs`
- `lib/commands/models/list.mjs`、`select.mjs`、`forecast.mjs`
- `lib/commands/usage/record.mjs`、`summary.mjs`
- `contracts/host/dsh-host.v1.json`、`contracts/context/context.v1.json`
- `test/helpers/ctx.mjs`、`clock.mjs`、`host-stub.mjs`
- `scripts/check-seams.mjs`
- `test/fixtures/seams/<case>/lib/**`（见 §6）
- 六个测试文件和 `test/traceability/T-003.json`（见 §7）

修改：`lib/cli.mjs`、`bin/cliworker.mjs`、`lib/index.js`、`lib/availability.mjs`、`lib/config.mjs`、`lib/forecast.mjs`。

## 2. `lib/context.mjs`

导出：

```js
export const TEST_CLOCK_ENV = 'CLIWORKER_TEST_CLOCK_FILE'
export function createRealClock({ env, fs }): Clock
export function createContext(overrides = {}): Ctx
export function systemNow(): number   // = createRealClock({ env: process.env, fs }).now()
```

### 2.1 `createContext(overrides)`

返回一个普通对象，成员恰为 `exec, fs, fetch, env, platform, stdout, stderr, random, clock, now` 十个。每个成员先取 `overrides` 里的同名值，没有再取默认：

| 成员 | 默认 |
|---|---|
| `exec` | `lib/exec.mjs` 的 `run` |
| `fs` | `node:fs` 命名空间 |
| `fetch` | `(...a) => globalThis.fetch(...a)` |
| `env` | `process.env`（引用，不复制） |
| `platform` | `process.platform` |
| `stdout` / `stderr` | `process.stdout` / `process.stderr`（创建时取用，只用 `.write`） |
| `random` | `() => Math.random()`，返回 `[0,1)` 的数 |
| `clock` | `createRealClock({ env, fs })`，其中 `env`、`fs` 取上面解析后的值 |
| `now` | 没有被覆盖时为 `() => clock.now()`，所以 `ctx.now()` 恒等于 `ctx.clock.now()` |

`createContext` 本身不读文件、不写输出、不启动定时器。

### 2.2 真实时钟 `createRealClock({ env, fs })`

`Clock` 有且仅有五个方法：`now()`、`nowIso()`、`setTimeout(fn, ms)`、`clearTimeout(handle)`、`sleep(ms)`。真实时钟不得暴露 `setNow`、`advance`、`pending`。

- `now()`：每次调用先看 `env.CLIWORKER_TEST_CLOCK_FILE`。
  - 未设置或为空串：返回 `Date.now()`。
  - 已设置：每次都用 `fs.readFileSync(file, 'utf8')` 重新读取，不缓存。去掉首尾空白后，如果匹配纯数字（可带小数）就按毫秒数取 `Number`，否则按 `Date.parse` 解析 ISO 时间。解析结果不是有限数时抛 `Error`，消息含 `CLIWORKER_TEST_CLOCK_FILE`，不含环境变量里的其它内容。
- `nowIso()`：`new Date(this.now()).toISOString()`。
- `setTimeout`、`clearTimeout`、`sleep`：始终用真实定时器，不受时钟文件影响。
- 因此文件时钟模式下 `now()` 是虚拟的，定时器是真实的，**不支持虚拟推进**。依赖 `advance`/`sleep` 推进的测试（AC-028、AC-029 一类）只能用 `test/helpers/clock.mjs`，不能混用文件时钟。

### 2.3 `systemNow()`

给 `lib/forecast.mjs` 做默认值用，保证 `forecast({...})` 不传 `now` 时行为与原先一致。

## 3. `lib/exec.mjs`

```js
export function run(command, args, { timeout = 20000 } = {}) → { ok, code, stdout, stderr, error }
```

把原 `availability.mjs` 里的 `run` 原样迁入：`spawnSync(command, args, { encoding: 'utf8', timeout, windowsHide: true, shell: process.platform === 'win32' })`，返回形状 `{ ok: status === 0, code: status, stdout, stderr, error: message|null }`，异常时 `{ ok:false, code:-1, stdout:'', stderr:'', error: e.message }`。`shell` 取值保持原样（在 T-010 安全化），不要在这里顺手改。这是 `lib` 下唯一导入 `node:child_process` 的文件。

## 4. 现有模块的接口变化

**`lib/availability.mjs`**：删掉本地 `run` 和 child_process 导入。
- `checkProvider(provider, { probe = true, ctx } = {})`：探测时调用 `ctx.exec(cli, args, { timeout: 20000 })`（版本和认证各一次，参数组装逻辑不变）。`probe` 为真而 `ctx` 或 `ctx.exec` 缺失时抛 `TypeError`。
- `providerStatus(config, opts = {})` 照旧把 `opts` 传给 `checkProvider`。
- 返回值的字段、`state` 取值和 `detail` 文案不变。

**`lib/config.mjs`**：删掉 `node:fs` 导入。
- `defaultHome(env)`：`env.CLIWORKER_HOME || path.join(os.homedir(), '.cliworker')`。
- `loadConfig({ file, ctx })`：用 `ctx.fs.readFileSync` 读文件、`ctx.env.CLIWORKER_CONFIG` 作回退；`_home` 为 `defaultHome(ctx.env)`。错误信息和 `error.code = 'E_CONFIG'` 的行为不变。`ctx` 缺失抛 `TypeError`。
- `ensureDir(dir, ctx)`、`readUsage(file, ctx)`、`appendUsage(file, row, ctx)`：改用 `ctx.fs`，其余语义不变（`readUsage` 出错仍返回 `[]`）。
- 本任务不修 `a4-*` 缺陷（归 T-005），不要顺手改 `raw.schema` 的插值或 `_home` 的计算方式。

**`lib/forecast.mjs`**：只改一处，`now = systemNow()`，并 `import { systemNow } from './context.mjs'`。其余逻辑和导出不变。

## 5. CLI 骨架

### 5.1 `lib/cli.mjs`

```js
export async function main(argv, ctx) → Promise<{ exitCode: number }>
```

- `argv` 是用户参数数组，等价于旧代码的 `process.argv.slice(2)`：`argv[0]` 是命令，`argv[1]` 是子命令。`--config`、`--all`、`--request`、`--model`、`--json` 的取值规则与旧版相同（`argv.indexOf(name)` 后取下一项）。
- 导入 `lib/cli.mjs` 不产生任何副作用：不执行 `main`、不读文件、不写输出。
- 路由表是文件顶部的静态 `ROUTES`，从 `lib/commands/**` 静态导入。解析规则保持旧行为：
  - `providers` → `providers/list`，不看子命令。
  - `models` 子命令缺省或为 `list` → `models/list`；`select` → `models/select`；`forecast` → `models/forecast`。
  - `usage` 子命令 `record` → `usage/record`；`summary` → `usage/summary`。
  - 其他一律走用法错误。
- 流程：先解析路由；解析不到则写 stderr `ERROR: usage: cliworker providers | models list|select|forecast | usage record|summary\n`，返回 `{exitCode: 1}`。解析到再用 `loadConfig({ file: --config 的值, ctx })` 加载配置，然后调用命令模块。这与旧版的唯一差别是未知命令不再先加载配置。
- 命令模块返回一个可 JSON 化的对象；`main` 写 `ctx.stdout.write(JSON.stringify(result, null, 2) + '\n')`，返回 `{exitCode: 0}`。
- 任何抛出的异常（含配置加载失败）：写 `ERROR: <message>\n` 到 `ctx.stderr`，stdout 不写，返回 `{exitCode: e.exitCode ?? 1}`。本任务保持旧版的错误输出，不引入 `E_*` 错误体。
- **W_TEST_CLOCK**：成功输出时，如果 `ctx.env.CLIWORKER_TEST_CLOCK_FILE` 是非空字符串，结果对象的 `warnings` 数组里要有 `{ "code": "W_TEST_CLOCK" }`。结果已有 `warnings` 数组时追加，没有时新增该键。环境变量未设置或为空串时，不添加 `warnings`，输出与迁移前逐字相同。

### 5.2 `lib/commands/**`

每个命令模块导出 `export async function run({ argv, ctx, config })`，返回输出对象，失败时抛 `Error`（可带 `exitCode`）。逻辑照搬旧 `cli.mjs`，只替换注入点：

| 文件 | 输出 schema | 注入点替换 |
|---|---|---|
| `providers/list.mjs` | `cliworker.providers/v1` | `providerStatus(config, { ctx })` |
| `models/list.mjs` | `cliworker.models/v1` | 同上；`--all` 对应 `includeDeprecated` |
| `models/select.mjs` | 沿用 `selectModels` 返回值 | `--request` 解析失败抛 `bad --request JSON: …`；用量取自 `readUsage(…, ctx)` |
| `models/forecast.mjs` | `cliworker.forecast/v1` | 额外传 `now: ctx.now()` |
| `usage/record.mjs` | `cliworker.usage/v1` | `row.at = row.at \|\| ctx.clock.nowIso()`；`appendUsage(…, ctx)`；缺 `model` 抛 `usage record requires model`；`--json` 解析失败抛 `bad --json: …` |
| `usage/summary.mjs` | `cliworker.usage/v1` | `readUsage(…, ctx)` |

`lib/commands/_util.mjs` 提供 `arg(argv, name, fallback)`、`flag(argv, name)`、`usageFile(config, ctx)`（`path.join(config._home || defaultHome(ctx.env), 'usage.jsonl')`）。命令模块之间不互相导入。

### 5.3 `bin/cliworker.mjs`

```js
#!/usr/bin/env node
import { main } from '../lib/cli.mjs'
import { createContext } from '../lib/context.mjs'
const { exitCode } = await main(process.argv.slice(2), createContext())
process.exitCode = exitCode
```

用 `process.exitCode` 而不是 `process.exit`，避免截断 stdout。`lib` 下任何位置（包括注释和字符串）都不得出现 `process.exit` 这个字样。

## 6. `lib/index.js`：宿主注册

导出 `name`、`createPlugin`、`getRegistration`、`apply`。

```js
createPlugin(hostCtx, settings = {}, deps = {}) → { registered: string[], errors: { path: string|null, message: string }[] }
getRegistration() → { status: 'ok'|'failed', registered: string[], errors: [...] }
apply(hostCtx, settings = {}, deps = {})   // 返回 undefined
```

- `deps.ctx` 是 CLIWorker 的 ctx，缺省为 `createContext()`。`settings` 取 `configPath`（缺省为 `ctx.env.CLIWORKER_CONFIG` 或 `<defaultHome(ctx.env)>/config.json`）、`readonly`（缺省 false）、`strict`（缺省 false）。导入模块时不读环境。
- `createPlugin` 调用 `hostCtx.inject(['webServer'], (httpCtx) => …)`，依次注册 `/cliworker/providers`、`/cliworker/models`、`/cliworker/select`、`/cliworker/forecast`，每条用 `httpCtx.effect(() => httpCtx.webServer.register({ kind: 'exact', path, handler }), name)`。
  - 单条路由包在 try/catch 里。成功后才把 path 放进 `registered`；抛错就往 `errors` 放 `{ path, message: String(e.message || e) }`，继续注册其余路由。
  - `hostCtx.inject` 本身抛错，或不是函数：`errors` 放一条 `{ path: null, message }`。
  - 每条错误向 `deps.ctx.stderr` 写一行 `[cliworker] route registration failed: <path>: <message>\n`（`path` 为 null 时写 `(inject)`）。这只是附加提示，**不能代替** `errors`。
  - 返回的 `registered` 与 `errors` 是实时对象；宿主若延后调用 inject 回调，后续注册结果也会进入同一报告。
- `getRegistration()` 返回最近一次 `createPlugin`（或 `apply`）报告的拷贝：`errors` 非空为 `failed`，否则为 `ok`。从未调用过时返回 `{ status: 'failed', registered: [], errors: [{ path: null, message: 'plugin not applied' }] }`。
- `apply` 调 `createPlugin`。`settings.strict === true` 且 `errors` 非空时抛 `Error`，消息以 `cliworker: route registration failed` 开头并列出每个 `path: message`，同时挂 `error.registration = getRegistration()`。非 strict 时不抛，错误只留在报告和 stderr 提示里。
- 四个 handler 沿用现有实现（含 `readBody`、`send`），只替换注入点：配置用 `loadConfig({ file, ctx })`，状态用 `providerStatus(c, { ctx })`，forecast 额外传 `now: ctx.now()`。

## 7. 契约文件

两个 JSON 文件的顶层键固定，测试和验收按这些键断言。

### 7.1 `contracts/context/context.v1.json`

```json
{
  "contract": "cliworker.context",
  "version": 1,
  "members": {
    "exec": "function", "fs": "object", "fetch": "function", "env": "object",
    "platform": "string", "stdout": "stream", "stderr": "stream",
    "random": "function", "clock": "object", "now": "function"
  },
  "stream_methods": ["write"],
  "fs_methods": ["readFileSync", "writeFileSync", "appendFileSync", "mkdirSync", "existsSync", "statSync", "readdirSync", "renameSync", "rmSync"],
  "clock_methods": ["now", "nowIso", "setTimeout", "clearTimeout", "sleep"],
  "fake_clock_extras": ["setNow", "advance", "pending"],
  "test_clock_env": "CLIWORKER_TEST_CLOCK_FILE"
}
```

`test/contract/context.test.mjs` 对真实 `createContext({ env: {} })` 和 `createFakeContext()` 各做同一组断言：成员集合恰为 `members` 的键、类型吻合、`stream` 有 `write`、`fs` 含全部 `fs_methods`、`clock` 含全部 `clock_methods`、`ctx.now()` 与 `ctx.clock.now()` 在同一时刻相等。真实时钟不得出现 `fake_clock_extras`；伪时钟必须全有。

### 7.2 `contracts/host/dsh-host.v1.json`

```json
{
  "contract": "dsh-host",
  "version": 1,
  "host_ctx": { "inject": { "params": ["services", "callback"], "callback_arg": "httpCtx", "callback_timing": "synchronous when the services are present" } },
  "http_ctx": { "effect": { "params": ["fn", "name"], "returns": "result of fn", "on_error": "propagates" }, "webServer": { "register": { "params": ["registration"], "on_error": "throws" } } },
  "registration": { "kind": ["exact"], "path": "string starting with /", "handler": "function(req, res)" },
  "request": { "required": ["socket.remoteAddress", "headers"], "optional": ["method", "url"] },
  "response": { "required": ["statusCode", "setHeader", "end"] },
  "stub_controllable_inputs": ["remoteAddress", "host", "origin"],
  "plugin_exports": {
    "createPlugin": { "returns": ["registered", "errors"] },
    "getRegistration": { "returns": ["status", "registered", "errors"], "status": ["ok", "failed"] },
    "apply": { "strict_throws_on_errors": true }
  }
}
```

`stub_controllable_inputs` 的意义：后续 AC-059 要伪造非 loopback 的 socket 远端地址、Host、Origin，所以 stub 必须让测试能控制这三项。

## 8. 测试助手

### 8.1 `test/helpers/clock.mjs`：`createFakeClock({ start } = {})`

`start` 缺省为 `Date.parse('2026-11-07T00:00:00Z')`。返回对象有 `clock_methods` 的五个方法，加 `setNow`、`advance`、`pending`：

- `now()` / `nowIso()`：返回当前虚拟时间。
- `setNow(t)`：把虚拟时间直接设为 `t`，前后都可以。**不触发任何定时器，也不改变已登记定时器的到期时间。**
- `setTimeout(fn, ms)`：到期时间为 `now() + max(0, ms || 0)`，带自增序号，返回不透明 handle。
- `clearTimeout(handle)`：移除；未知或已触发的 handle 无操作。
- `pending()`：已登记、未触发、未取消的定时器数。
- `advance(ms)`：`ms` 必须是有限的非负数，否则抛 `RangeError`。设目标 `target = now() + ms`，循环取到期时间 ≤ `target` 的定时器中 `(到期时间, 序号)` 最小者：把虚拟时间设为 `max(当前, 到期时间)`，移除它，调用回调，然后 `await Promise.resolve()` 让出微任务。回调里新登记且到期时间 ≤ `target` 的定时器同样在本次触发。循环结束后虚拟时间为 `target`。回调抛出的异常使 `advance` 的 Promise 拒绝，其余定时器保持 pending。
  - 因此回调内看到的 `now()` 等于该定时器的到期时间。
  - `setNow` 把时间拨到某些定时器的到期时间之后，这些定时器在下一次 `advance`（包括 `advance(0)`）时按顺序触发。
- `sleep(ms)`：登记一个定时器并返回在它触发时 resolve 的 Promise，会计入 `pending()`；不调 `advance` 永远不完成。

### 8.2 `test/helpers/ctx.mjs`

导出 `fakeExec`、`fakeFs`、`fakeClock`、`fakeFetch`、`fakeStream`、`createFakeContext`。

- `fakeExec(handler)`：返回函数 `(command, args, opts) → {ok,code,stdout,stderr,error}`。`handler` 缺省时返回 `{ ok:false, code:null, stdout:'', stderr:'', error:'fakeExec: no handler' }`。函数上挂 `.calls`（每次调用一条 `{ command, args, envNames, timeout }`，`envNames` 是 `opts.env` 的键名数组，**不记录值**）和 `.count`。
- `fakeFs(files = {})`：内存实现 `fs_methods` 的九个方法。所有路径先经 `path.resolve` 规范化，包括 `files` 的键，所以 `'/cw/config.json'` 在 Windows 上也能与 `loadConfig` 里 `path.resolve` 后的路径对上。文件不存在抛 `code === 'ENOENT'` 的 `Error`。`readFileSync` 带编码返回字符串，不带返回 `Buffer`。挂 `.files`（Map）和 `.accessed`（每次调用一条 `{ method, path }`）。
- `fakeClock`：即 `createFakeClock`。
- `fakeFetch`：默认返回被拒绝的 Promise（`fakeFetch: no network`），挂 `.calls`（`{ url, init }`）。
- `fakeStream()`：`{ write(chunk), text() }`，`text()` 返回已写内容的拼接。
- `createFakeContext({ files, env, platform, exec, now } = {})`：返回符合 `context.v1.json` 的 ctx。`env` 缺省为 `{}`（不是 `process.env`），`platform` 缺省为 `'linux'`，`exec` 是 `fakeExec` 的 handler，`now` 是伪时钟起点毫秒数，`random` 为确定性序列。`stdout`、`stderr` 是 `fakeStream()`。返回对象的成员恰为 `context.v1.json` 的十个键，检查句柄都挂在成员自身上（如 `ctx.exec.calls`、`ctx.fs.accessed`、`ctx.stdout.text()`），不另加顶层键。

### 8.3 `test/helpers/host-stub.mjs`：`createHostStub({ failPaths = [], failInject = false, failMessage = 'stub register failed' } = {})`

返回 `{ ctx, registered, effects, injectCalls, handlerFor(path), request(path, opts) }`：

- `ctx.inject(services, cb)`：记录 `services` 到 `injectCalls`；`failInject` 为真时抛 `Error`；否则同步调用 `cb(httpCtx)`。
- `httpCtx.effect(fn, name)`：记录 `name` 到 `effects`，同步调用 `fn()`，返回其结果，抛错则原样抛出。
- `httpCtx.webServer.register(reg)`：按 `dsh-host.v1.json` 的 `registration` 校验，`kind` 不是 `exact`、`path` 不以 `/` 开头、`handler` 不是函数都抛 `TypeError`；`path` 在 `failPaths` 中（`'*'` 表示全部）抛 `Error(failMessage + ': ' + path)`；否则记入 `registered`（元素 `{ kind, path }`）。
- `request(path, { method = 'GET', url = path, headers = {}, remoteAddress = '127.0.0.1', host = 'localhost', origin, body } = {})`：构造 `req`（`method`、`url`、`headers`（`host` 与 `origin` 写入其中）、`socket.remoteAddress`，并能被 `readBody` 的 `on('data'/'end'/'error')` 读到 `body`）和 `res`（`statusCode`、`setHeader`、`end`），调用已注册 handler 并等待其完成，返回 `{ statusCode, headers, body }`（`body` 为字符串）。未注册的 path 抛 `Error`。

## 9. `scripts/check-seams.mjs`

用法：`node scripts/check-seams.mjs [--root <dir>] [--json]`。默认 `--root` 是仓库根。只扫描 `<root>/lib/**` 下的 `.mjs`、`.js`、`.cjs` 文件。

输出：
- 默认：每条违规一行 `FAIL <rule> <file>:<line>`（`file` 为相对 root 的 `/` 分隔路径，`line` 从 1 起），最后一行 `check-seams: FAILED (<n> violations)` 或 `check-seams: ok (files=<n>)`。
- `--json`：单个 JSON `{ "ok": boolean, "files": number, "violations": [{ "rule", "file", "line" }] }`，不输出其它文字。
- 退出码：无违规 0，有违规 1，参数错误 2（stderr 含 `usage:`）。
- 以模块导入时无副作用，导出 `scanRoot({ root })` 返回 `{ files, violations }`，沿用其它 `scripts/check-*.mjs` 的 “仅直接运行才执行” 写法。

规则与允许清单（按相对路径精确匹配，`lib/commands/exec.mjs` 之类不算在内）：

| rule | 触发 | 允许的文件 |
|---|---|---|
| `seams.child_process` | 导入 `node:child_process` 或 `child_process`（`import … from`、`import 'x'`、`import('x')`、`require('x')`、`export … from`） | `lib/exec.mjs` |
| `seams.fs` | 导入 `node:fs`、`fs`、`node:fs/promises`、`fs/promises` | `lib/context.mjs`、`lib/store.mjs`、`lib/fsx.mjs` |
| `seams.date_now` | `Date.now`（调用或当作值引用） | `lib/context.mjs` |
| `seams.new_date` | 不带参数的 `new Date()` 或 `new Date`；`new Date(x)` 不算 | `lib/context.mjs` |
| `seams.set_timeout` | 裸标识符 `setTimeout`，或 `globalThis/global/window.setTimeout`；`obj.setTimeout` 不算 | `lib/context.mjs` |
| `seams.set_interval` | 同上，对象为 `setInterval` | `lib/context.mjs` |
| `seams.set_immediate` | 同上，对象为 `setImmediate` | `lib/context.mjs` |
| `seams.node_timers` | 导入 `node:timers`、`timers`、`node:timers/promises`、`timers/promises` | `lib/context.mjs` |
| `seams.wall_clock` | `performance.now`、`process.hrtime`、`hrtime.bigint` | `lib/context.mjs` |
| `seams.process_exit` | `process.exit` | 无 |

非导入类规则先去掉注释、字符串字面量和模板字面量的文本部分再匹配，且保留换行以保证行号准确；导入类规则只去注释。所以注释和字符串里提到 `Date.now()` 或 `node:fs` 不算违规。

自测夹具在 `test/fixtures/seams/<case>/lib/…`，用 `--root test/fixtures/seams/<case>` 扫描。默认扫描的是仓库 `lib/`，夹具目录天然不在范围内，不需要额外排除逻辑。

验收里有一个不依赖 check-seams 实现的文本探针（V-007-6），所以 `lib` 的注释里也不要写出 `child_process`、`Date.now`、`new Date()`、`node:timers` 这几个字面量；`lib/exec.mjs` 与 `lib/context.mjs` 自身不受此限。`process.exit` 字样则在 `lib` 全树（含这两个文件和注释）都不能出现。

| case 目录 | 内容 | 期望 |
|---|---|---|
| `clean` | 一个文件：只用 `ctx.clock.setTimeout`、`ctx.clock.now()`、`new Date(0)`、`new Date(x)`、`obj.setTimeout()`、`clearTimeout(h)`；注释和字符串里写满 `Date.now()`、`setTimeout(`、`node:fs`、`process.exit` | 0 违规 |
| `allowed` | `lib/exec.mjs` 导入 child_process；`lib/context.mjs` 导入 fs、node:timers 并用到全部时间原语；`lib/store.mjs`、`lib/fsx.mjs` 导入 fs | 0 违规 |
| `child-process` | `lib/exec.mjs`（合法）加 `lib/bad.mjs` 导入 `node:child_process` | 只有 `lib/bad.mjs` 报 `seams.child_process` |
| `fs` | `lib/context.mjs`、`lib/store.mjs`、`lib/fsx.mjs`（合法）加 `lib/bad.mjs` 导入 `node:fs/promises` | 只有 `lib/bad.mjs` 报 `seams.fs` |
| `date-now` | `lib/bad.mjs` 调用 `Date.now()` | 只报 `seams.date_now` |
| `new-date` | `lib/bad.mjs` 写 `new Date()` | 只报 `seams.new_date` |
| `set-timeout` | `lib/bad.mjs` 调用全局 `setTimeout(` | 只报 `seams.set_timeout` |
| `set-interval` | 同上，`setInterval(` | 只报 `seams.set_interval` |
| `set-immediate` | 同上，`setImmediate(` | 只报 `seams.set_immediate` |
| `node-timers` | `lib/bad.mjs` 导入 `node:timers/promises` | 只报 `seams.node_timers` |
| `wall-clock` | `lib/bad.mjs` 调用 `performance.now()` | 只报 `seams.wall_clock` |
| `process-exit` | `lib/bad.mjs` 调用 `process.exit(1)` | 只报 `seams.process_exit` |

“只报”指 `violations` 非空、全部属于该 rule、且 `file` 全为 `lib/bad.mjs`。夹具文件不得以 `.test.mjs` 结尾。

## 10. 测试与追踪

测试标题规则（`run-tests --ac` 与 `check-traceability` 都按这个找）：每个测试用 `test('[AC-xxx] …')`，不用 `test.skip/todo/only`。测试里不用真实 `sleep`、不断言墙钟，临时文件建在 `os.tmpdir()` 下并清理。

| 文件 | AC | 内容 |
|---|---|---|
| `test/unit/import-safe.test.mjs` | AC-006 | 子进程 import `lib/cli.mjs`、`lib/index.js`，stdout/stderr 都为 0 字节且退出码 0；`main` 返回 `{exitCode}` 且输出进 `ctx.stdout`；`lib` 全树无 `process.exit`；`bin/cliworker.mjs` 子进程能输出 JSON |
| `test/unit/seams.test.mjs` | AC-007 | 真实 `lib` 扫描 0 违规；§9 表里每个 case 逐条断言；CLI 退出码与参数错误 |
| `test/unit/clock.test.mjs` | AC-072 | §8.1 的全部语义；真实时钟读时钟文件、每次重读、ISO 与毫秒两种格式、非法内容抛错；`main()` 在设置/未设置时钟文件时 `warnings` 的有无 |
| `test/contract/context.test.mjs` | AC-072 | §7.1 对真实 ctx 与 fake ctx 的断言 |
| `test/contract/host-stub.test.mjs` | AC-008 | stub 符合 `dsh-host.v1.json`：校验、`failPaths`、`failInject`、`request` 能控制三项输入 |
| `test/integration/registration.test.mjs` | AC-008 | `createPlugin` 成功/部分失败/inject 失败、`getRegistration`、`apply` 的 strict 与非 strict、报告之外还有 stderr 提示、一个 handler 的往返 |

`test/traceability/T-003.json`：

```json
{
  "task": "T-003",
  "milestone": "M1",
  "entries": [
    { "ac": "AC-006", "status": "covered", "files": ["test/unit/import-safe.test.mjs"] },
    { "ac": "AC-007", "status": "covered", "files": ["test/unit/seams.test.mjs"] },
    { "ac": "AC-008", "status": "covered", "files": ["test/contract/host-stub.test.mjs", "test/integration/registration.test.mjs"] },
    { "ac": "AC-072", "status": "covered", "files": ["test/unit/clock.test.mjs", "test/contract/context.test.mjs"] }
  ]
}
```

`test/contract` 与 `test/integration` 目录目前不存在，新建即可，`run-tests` 会自动发现。

## 11. 实施顺序

1. `lib/exec.mjs`、`lib/context.mjs`。
2. 改 `availability.mjs`、`config.mjs`、`forecast.mjs`；`node scripts/run-tests.mjs --ac AC-004` 仍应通过，并确认 `test/unit/select.test.mjs` 无需改动。
3. `lib/commands/**`、`lib/cli.mjs`、`bin/cliworker.mjs`。
4. `lib/index.js`。
5. 两份契约 JSON，`test/helpers/*`。
6. `scripts/check-seams.mjs` 与夹具。
7. 六个测试文件与 `T-003.json`。
8. 收尾：`pwsh -NoProfile -File scripts/check-fast.ps1` 退出码 0。

## 12. 风险与取舍

- **未知命令的行为变化**：旧版先加载配置，配置有问题时先报配置错；新版先判路由，未知命令一律报用法错。这是有意的，在 §5.1 写明。
- **`select.mjs` 的 forecast 时间**：在 T-007 之前它使用 `systemNow()`；即使 `main` 的 ctx 带伪时钟，`models select` 里的 forecast 仍取系统时间。设置时钟文件的子进程场景不受影响，因为 `systemNow()` 同样读该变量。
- **宿主延后调用 inject 回调**：报告是实时对象，`getRegistration()` 每次取最新；strict 模式只能在 `apply` 返回时判定，延后到达的失败不会补抛。当前 stub 与契约按同步调用写，真实 DSH 若延后，需要后续任务补充。
- **规则范围**：`seams.wall_clock` 和 `seams.process_exit` 超出 AC-007 原文的清单，来自 test-strategy 与 AC-006；其它规则不得再加。
- **令牌与密钥**：`fakeExec` 只记 env 的键名；`createContext` 不输出 `env`；`W_TEST_CLOCK` 警告和时钟文件错误信息里不带环境变量内容。
