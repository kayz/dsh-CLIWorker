---
task: "010"
write_scope:
  - lib/exec.mjs
  - lib/availability.mjs
  - test/unit/exec.test.mjs
  - test/integration/exec-native.test.mjs
  - test/integration/exec-tree.test.mjs
  - test/fixtures/exec/**
  - test/characterization/defects/a5-shell.test.mjs
  - test/traceability/T-010.json
---

# Task 010 设计：安全进程执行层（T-010，M2，AC-026 / AC-027 / AC-028）

规格来源：`.collab/blueprint/cliworker-v2/` 的 design.md §3、interfaces.md §16、risks.md R5 / R17、task-graph.json 的 T-010 与 AC-026..028。本文件只在这些规格之内补足可执行细节。

## 1. 现状与约束

- `lib/exec.mjs` 现为 T-003 迁入版：同步 `run(command, args, {timeout})`，内部 `spawnSync(..., {shell: process.platform === 'win32'})`，返回 `{ok, code, stdout, stderr, error}`。`lib/context.mjs` 把它作为默认 `ctx.exec`；`lib/availability.mjs` 通过 `ctx.exec` 同步调用；`lib/commands/**`、`lib/index.js` 同步消费 `providerStatus`。
- `lib/context.mjs`、`lib/commands/**`、`lib/index.js` 不在本任务 write_scope。因此：
  - 模块级导出的 `run` **保持同步**，签名与返回形状向后兼容（只增字段），`context.mjs` 不改也能继续工作。
  - 异步执行（ctx.clock 超时、杀进程树、并发上限）通过新导出 `createExec(deps)` 提供；把它接入 `ctx.exec` 是后续任务的事，本任务不做。
- `check-seams`：`lib/exec.mjs` 只允许导入 `node:child_process`，**不得**导入 `node:fs`，不得出现全局 `setTimeout/setInterval/setImmediate`、`Date.now`、无参 `new Date`、`performance.now`、`process.hrtime`、`process.exit`。文件系统通过依赖注入（`deps.fs`，形状同 `ctx.fs` 的 `existsSync/readFileSync`），定时器只用 `deps.clock.setTimeout/clearTimeout`。
- 令牌与密钥不得进入日志/JSON 输出：错误消息只写参数下标与命令基名，**不得回显参数值或 env 值**。

## 2. `lib/exec.mjs` 公共接口

```
export const DEFAULT_TIMEOUT_MS = 20_000
export const DEFAULT_MAX_CONCURRENT = 4
export const SAFE_ARG_RE = /^[A-Za-z0-9_@+=:,./\\-]+$/      // cmd 回退路径的参数白名单（非空）
export function checkCmdArgs(args)  // -> {ok:true} | {ok:false, index}
export function resolveShim(shimPath, { fs, nodePath })      // -> {node, script} | null
export function createExec(deps)    // -> {runSync, runAsync}
export function run(command, args = [], opts = {})           // 同步，= 默认依赖的 runSync
```

`deps`（全部可选，除标注外）：`spawn`、`spawnSync`（默认取 `node:child_process`）、`platform`（默认 `process.platform`）、`env`（默认 `process.env`，仅用于 PATH/ComSpec 查找）、`fs`（`{existsSync, readFileSync}`，缺省则 win32 上不做 PATH 搜索、不解析垫片）、`nodePath`（默认 `process.execPath`）、`kill`（默认 `process.kill`）、`clock`（**`runAsync` 必需**，`{setTimeout, clearTimeout}`；缺省时 `runAsync` 抛 `TypeError('createExec requires clock for runAsync')`）、`maxConcurrent`（默认 4，必须是 ≥1 的整数，否则构造时抛 `RangeError`）。`createExec` 也接受把 `ctx` 展开传入（多余键忽略）。

`opts`：`timeout`（毫秒，非有限正数时取 20000）、`cwd`、`env`（子进程环境）、`lookup`（仅 `run`/`runSync` 使用：`{fs, env, platform}`，覆盖对应 deps，供未改 context 的调用方提供 fs；`lookup` 不进入子进程环境）。

返回值（`runSync` 同步返回，`runAsync` 返回 Promise，**永不 reject**）：
`{ok, code, stdout, stderr, error, error_code}`。`ok = (exit code === 0 且无 error)`；`code` 为子进程退出码，进程未启动或被信号终止时为 `null`；`error` 为字符串或 `null`（旧字段，保持）；新增 `error_code`：`'E_UNSAFE_ARG' | 'E_TIMEOUT' | null`，只用注册表已有的两个码，其余失败（如 ENOENT）`error_code` 为 `null`、`error` 为系统消息。stdout/stderr 为 utf8 字符串，每路上限 4 MiB，超出部分丢弃。

## 3. 执行规划（win32 与其他平台）

所有 spawn 一律 `shell: false`（严格布尔 false），`windowsHide: true`；异步路径在非 win32 上 `detached: true`（使子进程成为进程组组长以便整组杀）。

1. **非 win32**：`command`、`args` 原样直接 spawn，不查找、不校验。
2. **win32，解析可执行文件**（需要 `fs`）：命令含路径分隔符或盘符则只试它本身（无扩展名时依次补 `.exe .com .cmd .bat`）；否则按 `env.Path`/`env.PATH` 的每个目录同样依次试。取第一个 `fs.existsSync` 为真者；都不存在则保持原命令（spawn 自然报 ENOENT）。不使用 PATHEXT，顺序固定。
3. **解析结果不是 `.cmd/.bat`（大小写不敏感）**：原样直接 spawn，参数不校验。
4. **解析结果是 `.cmd/.bat`**：
   - a. 若 `checkCmdArgs(args).ok`：先直接 spawn 该文件（shell:false）。成功则结束；若 spawn 抛出或返回 `code === 'EINVAL'`（Node ≥ 20.12 对批处理的拒绝，CVE-2024-27980），转入 b。
   - b. `resolveShim(file, {fs, nodePath})` 成功 → spawn `node` 直接执行：`spawn(node, [script, ...args])`，**参数原样传递、不校验**（node 经 libuv 正确引用，不经 cmd）。a 被跳过的情形（参数不安全）也从这里开始。
   - c. 垫片不可解析且 `checkCmdArgs(args).ok` 且文件路径本身只含白名单字符加空格以外的安全字符（即不含 `" & | < > ^ % ! ; \` ` 换行）→ spawn `cmd.exe`（`env.ComSpec` 为绝对路径则用之，否则 `'cmd.exe'`），`args = ['/d','/s','/c', '"' + '"' + file + '"' + ' ' + args.join(' ') + '"']`，`windowsVerbatimArguments: true`，仍是 `shell:false`。
   - d. 其余 → 不 spawn，返回 `{ok:false, code:null, stdout:'', stderr:'', error:'E_UNSAFE_ARG: unsafe argument at index N', error_code:'E_UNSAFE_ARG'}`（N 为首个不合格参数下标；文件路径不合格时写 `command`）。

`checkCmdArgs`：每个参数必须匹配 `SAFE_ARG_RE`（非空，仅 `A-Z a-z 0-9 _ @ + = : , . / \ -`）。10 个敌意参数 `&` `|` `;` `^` `%` `!` 空格 `"` 换行 `` ` `` 全部不匹配，空串也不匹配。

## 4. 垫片解析 `resolveShim`

- 以 `path.win32` 处理路径（单测在 linux/macOS 上也要对 win32 路径生效，不得用平台 `path`）。读取 `fs.readFileSync(shimPath, 'utf8')`，按 `\r?\n` 分行，逐行匹配（大小写不敏感）：

  ```
  ^\s*@?\s*(?:.*&\s*)?(?:"%_prog%"|"%~dp0\\?node\.exe"|"%dp0%\\?node\.exe"|node(?:\.exe)?)\s+"([^"]+\.(?:c|m)?js)"\s+%\*\s*$
  ```
  取第一个匹配行的脚本路径。
- 把 `%~dp0` 与 `%dp0%` 替换为 `<shim 所在目录>\`，再 `path.win32.normalize`。结果仍含 `%` 或 `"`、或 `fs.existsSync` 为假 → 返回 `null`（失败即关闭）。`%*` 后或脚本后还有额外参数的垫片不匹配，返回 `null`。
- `node`：垫片目录下存在 `node.exe`（`fs.existsSync`）则用它，否则用 `deps.nodePath`。返回 `{node, script}`。

## 5. 异步路径 `runAsync`

- **并发上限**：`createExec` 实例内置计数信号量，`maxConcurrent` 默认 4；超限的调用排队，FIFO；任一调用结算（成功/失败/超时）后释放名额。**超时只计运行期，不含排队等待。**
- **超时**：子进程 spawn 成功后，用 `clock.setTimeout(onTimeout, timeout)` 注册唯一一个定时器；任何非超时的结算路径都必须 `clock.clearTimeout`，保证结束后伪时钟 `pending() === 0`。
- **杀进程树**（`onTimeout`）：
  - 非 win32：`kill(-pid, 'SIGKILL')`（进程组）；失败则退回 `child.kill('SIGKILL')`。
  - win32：经同一 `spawn` 依赖执行 `taskkill`，参数 `['/PID', String(pid), '/T', '/F']`，`shell:false`、`windowsHide:true`，等其结束；失败退回 `child.kill()`。
  - 之后等子进程 `exit`（不等 stdio `close`，并销毁 stdout/stderr 流）再结算为 `{ok:false, code:null, ..., error:'E_TIMEOUT: timed out after <timeout>ms', error_code:'E_TIMEOUT'}`；kill 抛 `ESRCH`（已退出）则立即结算。
- spawn 抛错（含 `EINVAL`）按第 3 节转入下一步；`'error'` 事件 → 结算为带 `error` 字符串的失败。
- 同一调用只结算一次。

## 6. `runSync`

- 用注入的 `spawnSync(file, args, {encoding:'utf8', timeout, windowsHide:true, shell:false, cwd, env, maxBuffer})`；规划同第 3 节。`r.error?.code === 'ETIMEDOUT'` → `error_code:'E_TIMEOUT'`。
- **已知限制（写入代码注释以外的文档即可，本文件为准）**：同步超时只能杀直接子进程，不保证杀整棵树；杀树保证只在 `runAsync` 路径。可用性探测（`--version`、auth status）是短命令，可接受。同步路径的超时不经 `ctx.clock`（`spawnSync` 原生超时）。

## 7. `lib/availability.mjs`

- 仍经 `ctx.exec(...)` 调用（不导入 `child_process`）；两处调用改为带上 `lookup`：
  `ctx.exec(cli, args, { timeout: 20_000, lookup: { fs: ctx.fs, env: ctx.env, platform: ctx.platform } })`。
- 结果处理保持：`error` 非空 → `state:'unavailable'`，`detail` 为错误串（含 `E_UNSAFE_ARG` / `E_TIMEOUT` 前缀，已被 200 字符截断）；其余逻辑、返回形状不变。不改 `providerStatus` 的同步性。

## 8. 测试夹具 `test/fixtures/exec/**`

| 文件 | 内容 |
|---|---|
| `shims/npm-v6.cmd.txt` | npm v6 形态：`@IF EXIST "%~dp0\node.exe" (` / `  "%~dp0\node.exe"  "%~dp0\node_modules\foo\bin\foo.js" %*` / `) ELSE (` / `  @SETLOCAL` / `  @SET PATHEXT=%PATHEXT:;.JS;=;%` / `  node  "%~dp0\node_modules\foo\bin\foo.js" %*` / `)` |
| `shims/npm-v7.cmd.txt` | npm v7+ 形态：`@ECHO off` / `GOTO start` / `:find_dp0` / `SET dp0=%~dp0` / `EXIT /b` / `:start` / `SETLOCAL` / `CALL :find_dp0` / `IF EXIST "%dp0%\node.exe" (` `  SET "_prog=%dp0%\node.exe"` `) ELSE (` `  SET "_prog=node"` `  SET PATHEXT=%PATHEXT:;.JS;=;%` `)` / `endLocal & goto #_undefined_# 2>NUL \|\| title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\foo\bin\foo.js" %*` |
| `shims/pnpm.cmd.txt` | pnpm 形态：`@SETLOCAL` / NODE_PATH 的 `IF NOT DEFINED` 块 / `@IF EXIST "%~dp0\node.exe" (` `@SET "_prog=%~dp0\node.exe"` `) ELSE (` `@SET "_prog=node"` `)` / `"%_prog%"  "%~dp0\..\foo\bin\foo.js" %*` |
| `shims/bun.cmd.txt` | bun 代表样本：`@ECHO off` / `node "%~dp0..\foo\bin\foo.js" %*`（`%~dp0` 后无反斜杠） |
| `shims/plain-batch.cmd.txt` | 非垫片批处理：`@echo off` / `echo hello %*`（`resolveShim` 必须返回 `null`） |
| `argv-recorder.mjs` | 把 `JSON.stringify(process.argv.slice(2))` 写到 stdout |
| `spawn-grandchild.mjs` | 用 `spawn(process.execPath,[sleep-forever.mjs],{stdio:'ignore'})` 派生孙进程（不 detached、不 unref 之外无特殊处理），把 `{"child":process.pid,"grandchild":<pid>}` 先写临时文件再 `rename` 为参数 1 目录下的 `pids.json`（屏障文件），然后保持存活 |
| `sleep-forever.mjs` | 保持存活（长间隔 `setInterval`）的孙进程脚本 |
| `slot-task.mjs` | 参数：目录、任务 id。以 `wx` 创建 `running-<id>`；数目录中 `running-*` 的个数并追加一行到 `observed.log`；休眠约 150ms；删除 `running-<id>` 后退出 |

`.cmd.txt` 后缀避免被当作批处理/被换行规范化；测试读取文本后注入 `fakeFs`，路径用 `C:\tools\bin\<name>.cmd`。预期解析：npm-v6、npm-v7 → script `C:\tools\bin\node_modules\foo\bin\foo.js`；pnpm、bun → `C:\tools\foo\bin\foo.js`；node 为 `deps.nodePath`，或在 fakeFs 含 `C:\tools\bin\node.exe` 时为该路径。

## 9. 测试方案与 AC 映射

- `test/unit/exec.test.mjs`（三平台都跑，注入 spawn/spawnSync/fs/platform，用 `test/helpers/ctx.mjs` 的 `fakeFs` 和 `test/helpers/clock.mjs` 的伪时钟）：
  - `[AC-026]` 每次注入的 spawn/spawnSync 调用 `options.shell === false`（含直接、node、cmd.exe、taskkill 各路径）。
  - `[AC-026]` 10 个敌意参数：直接执行（linux；win32 的 `.exe`）原样传递（`deepEqual`）；win32 + `plain-batch` 上每个参数各自返回 `E_UNSAFE_ARG`、且批处理文件没有被 spawn；win32 + 可解析垫片时同样的参数原样传给 node。
  - `[AC-026]` 四种垫片 `resolveShim` 得到预期 `{node, script}`；`plain-batch` 得到 `null`。
  - `[AC-026]` 注入 spawn 对 `.cmd` 抛 `EINVAL`（及 spawnSync 返回 `error.code==='EINVAL'`）后，后续调用是 node + script。
  - `[AC-028]` 异步路径单元：伪 spawn 下并发峰值恰为 4（10 个任务，手动放行）；定时器登记在伪时钟上（运行中 `pending()===1`，正常结束后 `0`）；`advance(timeout)` 触发 `taskkill`/进程组 kill 调用并得到 `E_TIMEOUT`；排队任务在出队前不登记定时器。
  - 错误消息不含参数值。
- `test/integration/exec-native.test.mjs`：`platformTest('[AC-027] ...', {ac:'AC-027', requires:'win32', file: import.meta.url}, ...)`。测试用 `fs.mkdtempSync(os.tmpdir())` 建临时目录，写 npm v7+ 形态 `foo.cmd`（在 `npm-v7.cmd.txt` 基础上额外一行 `ECHO ran> "%dp0%\cmd-ran.marker"` 作为"批处理被执行过"的探针）和 `node_modules\foo\bin\foo.mjs`（复制 `argv-recorder.mjs`）；用 `createExec({platform:'win32', fs: node fs 的最小适配, env: {...process.env, Path: 临时目录}, spawnSync/spawn: 对真实函数的记录包装})`，以 `['a&b','two words','p|q','c^d','50%','bang!','say "hi"','semi;colon','back`tick']` 调用 `runSync` 与 `runAsync`；断言：`stdout` 解析出的 argv 与传入完全一致；记录到的 spawn 调用只有一个且 `file === nodePath`，无任何 basename 为 `cmd.exe`；`cmd-ran.marker` 不存在。非 win32 由 `platformTest` 写跳过记录。
- `test/integration/exec-tree.test.mjs`（三平台都跑，真实 spawn，伪时钟）：
  - `[AC-028]` 超时：`timeout: 60_000`，运行 `spawn-grandchild.mjs`；用真实短轮询（上限 10 秒）等 `pids.json` 出现；`await clock.advance(60_000)`；结果 `error_code === 'E_TIMEOUT'`；随后轮询（上限 5 秒）直到对 `child` 与 `grandchild` 的 `process.kill(pid, 0)` 都抛 `ESRCH`；`clock.pending() === 0`。不断言墙钟时间。
  - `[AC-028]` 并发：`createExec({maxConcurrent:4, clock})` 同时发起 10 个 `slot-task.mjs`；全部 `ok`；`observed.log` 恰 10 行且最大值 ≤ 4。
- `test/characterization/defects/a5-shell.test.mjs`：**保留现有 `[repro]` 用例原文不动**（check-defects 对其做哈希）；追加 plain 标题 `[fixed] [AC-026] ...` 的用例：对 live `lib/availability.mjs` + `createExec({...,spawnSync: 记录器, platform:'win32'}).runSync` 作为 `ctx.exec`，断言每次 spawn 的 `options.shell === false`；并断言 `lib/exec.mjs` 源码不含 `shell: process.platform`。
- `test/traceability/T-010.json`：`{"task":"T-010","milestone":"M2","entries":[...]}`，三条 `covered`：AC-026 → `test/unit/exec.test.mjs`、`test/characterization/defects/a5-shell.test.mjs`；AC-027 → `test/integration/exec-native.test.mjs`；AC-028 → `test/integration/exec-tree.test.mjs`、`test/unit/exec.test.mjs`。每个列出的文件至少有一个 plain 标题含对应 `[AC-0xx]`。

## 10. 禁止与注意

- 不改 `lib/context.mjs`、`lib/cli.mjs`、`lib/commands/**`、`lib/index.js`、`contracts/**`、`scripts/**`、`test/helpers/**`、`test/characterization/defects.json`。
- `test/fixtures/exec/**` 下不放 `*.test.mjs`；测试临时文件只建在 `os.tmpdir()`，测试结束清理，不在仓库内生成大量临时文件。
- 文本文件 UTF-8 无 BOM。
