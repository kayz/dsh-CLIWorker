# Task 010 实现说明（dev）

实现范围严格按 `design.md` 顶部 `write_scope`。规格以 `design.md` / `acceptance.md` 为准，未新增字段、版本号或章节名。

## 1. 改动清单

### 修改

| 文件 | 改动 |
|---|---|
| `lib/exec.mjs` | 重写为安全执行层：所有 spawn `shell:false`；win32 可执行文件解析（同名 + `.exe .com .cmd .bat`）；`.cmd/.bat` 先直连、`EINVAL` 后解析垫片跑 node、最后才 `cmd.exe`；`E_UNSAFE_ARG` 白名单；`createExec(deps)` 提供 `runSync/runAsync`（时钟超时、杀进程树、并发上限）；`run` 保持同步签名与旧字段 |
| `lib/availability.mjs` | 两处 `ctx.exec(...)` 带上 `lookup: {fs, env, platform}`；其余逻辑与返回形状不变，不导入 `child_process` |
| `test/characterization/defects/a5-shell.test.mjs` | `[repro]` 原文一字未动（哈希不变），追加一条 `[fixed] [AC-026]` 用例 |

### 新建

- `test/unit/exec.test.mjs`（AC-026 / AC-028 纯单测，注入 spawn/spawnSync/fs/clock，三平台都跑）
- `test/integration/exec-native.test.mjs`（AC-027，`platformTest` 绑 win32，其他平台写 `cliworker.skip/v1`）
- `test/integration/exec-tree.test.mjs`（AC-028，真实 spawn + 伪时钟）
- `test/traceability/T-010.json`（AC-026/027/028 均 covered）
- `test/fixtures/exec/shims/{npm-v6,npm-v7,pnpm,bun,plain-batch}.cmd.txt`
- `test/fixtures/exec/{argv-recorder,sleep-forever,spawn-grandchild,slot-task}.mjs`

## 2. 关键实现决定（以及为什么）

1. **`run` 仍是同步函数**。`lib/context.mjs` 把它当默认 `ctx.exec`，而 `context.mjs`、`lib/commands/**` 不在本任务 write_scope。所以模块级 `run` 复用默认 `createExec({})` 的 `runSync`，返回形状只增 `error_code`，旧调用方零改动。异步能力只通过新导出 `createExec` 暴露，接入 ctx 留给后续任务。
2. **`lookup` 只覆盖 deps 的 `fs/env/platform`**，不进入子进程环境；`undefined` 的键被忽略，因此老调用方不传也不会把默认值覆盖成 `undefined`。这是 `availability` 在不改 context 的前提下就能做 win32 路径/垫片解析的原因。
3. **只有 `EINVAL` 才降级**。`runSync`/`runAsync` 只有在 spawn 同步抛错、或 `error.code === 'EINVAL'`（Node ≥ 20.12 拒绝直接执行批处理）时才继续下一个 attempt。文件真不存在时第一个 attempt 就是 `ENOENT`，直接返回，不会误入 `cmd.exe`——与 design §3.2「保持原命令，spawn 自然报 ENOENT」一致。
4. **`cmd.exe` 兜底是最后一步且参数已白名单**，命令串为 `""<file>" <args.join(' ')>"` + `windowsVerbatimArguments: true`，仍然 `shell:false`。文件路径自身含 `" & | < > ^ % ! ;` 反引号或换行时直接返回 `E_UNSAFE_ARG`，第 4 参数位置写 `command`。
5. **错误消息只含下标与命令基名**，不回显参数值或 env 值（`E_UNSAFE_ARG: unsafe argument at index N`）。
6. **超时只计运行期**：`clock.setTimeout` 在 spawn 成功后才登记，且排队期间不登记；任何非超时结算路径都 `clock.clearTimeout`，所以正常结束后 `pending() === 0`。超时路径先杀树（POSIX `kill(-pid,'SIGKILL')` 退回 `child.kill`；win32 经同一 `spawn` 依赖跑 `taskkill /PID <pid> /T /F` 再退回 `child.kill()`），再等 `exit`（不等 stdio `close`，并销毁管道）后结算 `E_TIMEOUT`。
7. **`node:path` 的引入**。design §4 要求用 `path.win32` 处理垫片路径（单测在 linux/macOS 上也要解析 win32 路径），这只能来自 `node:path`；它不是 `check-seams` 的缝（无 I/O、无时钟），`lib/exec.mjs` 依然不导入 `node:fs`、不出现全局定时器/墙钟/`process.exit`。
8. **`runAsync` 缺 clock 时同步抛 `TypeError`**，返回的 Promise 本身永不 reject（design 两处要求同时满足）。`maxConcurrent` 非 ≥1 整数时构造即抛 `RangeError`。
9. **同步路径的已知限制**（design §6 已注明）：`spawnSync` 原生超时只能结束直接子进程，不保证杀树，也不经 `ctx.clock`；可用性探测是短命令，可接受。代码注释里也写明了。

### 一处与 design 文字的偏差（有意，已最小化）

AC-027 的临时垫片由 `npm-v7.cmd.txt` 生成，而样例里的脚本名是 `foo.js`；design §8 要求临时脚本叫 `node_modules\foo\bin\foo.mjs`（复制 `argv-recorder.mjs`）。测试在生成垫片时把该样例中的 `foo.js` 替换为 `foo.mjs`（`exec-native.test.mjs` 内一行 `.replace`），使「垫片指向真实存在的夹具脚本」成立；其余内容与样例逐字一致。仓库里的四份样例本身保持 design §8 的 `foo.js`，单测按 `foo.js` 断言。

## 3. 自测（本机 Windows / Node 22.23.3，仓库根执行）

| 验收项 | 命令 | 结果 |
|---|---|---|
| A1 | `node scripts/run-tests.mjs --ac AC-026` | exit 0，`filtered 2 files`，16 用例全过 |
| A2 | `node --test test/unit/exec.test.mjs` | exit 0，14 用例全过：`[AC-026]` 覆盖 shell:false（直接/node/cmd.exe/taskkill）、10 个敌意参数直通、cmd 回退 `E_UNSAFE_ARG`、四种垫片解析、`EINVAL` 转入解析；`[AC-028]` 覆盖并发峰值 4、定时器登记/清理、advance 触发杀树 |
| A3 | `node --test test/characterization/defects/a5-shell.test.mjs` | exit 0，`[repro]` 与 `[fixed] [AC-026]` 同时通过 |
| A4 | `node scripts/check-defects.mjs --milestone M2` | `check-defects: ok`，exit 0（含 `[repro]` 哈希校验与 canary 反证） |
| A5 | 源码无 `shell: process.platform` / `shell: true` | exit 0 |
| B1 | `node scripts/run-tests.mjs --ac AC-027`（win32） | exit 0，1 用例通过且非 skip |
| B2/B3 | 非 win32 跳过 + `skips.jsonl` | 本机是 win32，无法执行；用例用 `platformTest(..., {requires:'win32', ac:'AC-027'})`，跳过分支由 `test/helpers/platform-gate.mjs` 统一写 `cliworker.skip/v1`（该分支已被 `runner-selftest` 用例覆盖） |
| C1 | `node scripts/run-tests.mjs --ac AC-028` | exit 0，`filtered 2 files`，16 用例全过 |
| C2 | `node --test test/integration/exec-tree.test.mjs` | exit 0：超时用例 `error_code === 'E_TIMEOUT'`、child 与 grandchild 均在 5 秒内 `ESRCH`、`pending() === 0`；并发用例 10 个全 ok、`observed.log` 10 行、峰值 ≤ 4 |
| C3 | `node --test test/unit/exec.test.mjs` | 同 A2 |
| D1 | `node scripts/check-seams.mjs` | `check-seams: ok (files=26)` |
| D2 | `node scripts/check-traceability.mjs` | `check-traceability: ok (covered=31 planned=43)` |
| D3 | `node scripts/milestone-gate.mjs --milestone M2` | 见下「基线阻断项」：阻断全部来自 T-011/T-012/T-013/T-014/T-015 的 AC-029..035，**T-010 的三条 AC 无阻断项** |
| D4 | `node scripts/check-write-scope.mjs --base 040d2e9 ...` | 仅报 `.collab/tasks/010/{acceptance,design,run,state}` 四个流程文件（脚本把未跟踪的流程文件也算作改动）；T-010 的代码/测试改动全部落在 write_scope 内 |
| D5 | `node scripts/check-frozen-files.mjs`、`node scripts/check-unused.mjs` | 均 exit 0（`ok (8 files)` / `ok (files=26)`） |
| D6 | availability 无 `child_process` 且含 `ctx.exec(` | exit 0 |
| D7 | exec 源码含 `E_UNSAFE_ARG: unsafe argument at index` | exit 0 |
| E1 | `node scripts/run-tests.mjs` | 44 文件、344 用例、341 pass、3 fail——三条都是**基线既存失败**，见下节；T-010 新增/改动的用例全过，无发现漂移 |
| E2 | `pwsh -NoProfile -File scripts/check-fast.ps1` | 在 `check-no-collab.mjs` 步失败（基线既存，见下节）；其前的 check-ci / contract-doc / defects / frozen / golden 均 ok |
| E3 | `git status --porcelain` | 由集成方执行；本任务产出见 §1 清单（另加本文件 `.collab/tasks/010/impl.md`） |

## 4. 基线阻断项（不在 T-010 write_scope，需其他任务处理）

E1/E2/D3 的失败均可定位到本任务之外：

1. `test/unit/gitignore.test.mjs:13,18`（AC-013，T-005）——`.gitignore` 里没有 `.collab/` 规则，`git check-ignore` 对 `.collab/x` 返回 1；同一文件因为字面引用 `.collab` 又被 `check-no-collab.mjs` 判为 `no_collab` 违规。于是 E1 的 AC-013 用例、AC-073（`check-no-collab`）用例以及 E2 的 `check-no-collab` 步骤一起失败。
2. `test/unit/import-safe.test.mjs:70`（AC-006，T-003）——用例仍期待「缺配置文件 → exit 1 + stderr `ERROR:`」，而现实是 `loadConfig` 抛 `E_CONFIG`（注册表退出码 3）+ JSON 信封；该分支在 `exec` 之前，与本次改动无关。
3. `node scripts/milestone-gate.mjs --milestone M2` 的 7 条 `gate.ac_not_covered` 全是 AC-029..AC-035，属主为 T-011..T-015（M2 其他任务尚未实现），按验收说明单列，不计入 T-010。

上述文件的修复都需要改 `test/unit/*`、`.gitignore`、`lib/config.mjs` 或 `lib/cli.mjs`，均不在本任务 write_scope，故本任务不改动。
