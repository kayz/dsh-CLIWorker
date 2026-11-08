# Task 010 验收标准（AC-026 / AC-027 / AC-028）

仓库根：`C:\git\dsh-CLIWorker\.collab\worktrees\010`（worktree），Node 20+，起点提交 `040d2e9`。
命令均为单行、零第三方依赖、可从任意目录（含 TEMP）执行，路径一律用绝对路径。
判定：退出码 0 且输出含对应的 `<AC-id> OK` 即为通过。

## AC-026 安全执行层单测：shell:false、参数白名单、垫片解析、EINVAL 回退、a5-shell 缺陷修复

- 命令: `node "C:/git/dsh-CLIWorker/.collab/worktrees/010/scripts/run-tests.mjs" --ac AC-026 && node "C:/git/dsh-CLIWorker/.collab/worktrees/010/scripts/check-seams.mjs" && node "C:/git/dsh-CLIWorker/.collab/worktrees/010/scripts/check-defects.mjs" --milestone M2 && echo "AC-026 OK"`
- 期望: `run-tests --ac AC-026` 退出码 0，覆盖 `test/unit/exec.test.mjs`（直接/node/cmd.exe/taskkill 各路径 `shell === false`、10 个敌意参数直通、cmd 回退逐个返回 `E_UNSAFE_ARG`、npm v6 / npm v7+ / pnpm / bun 四种垫片解析、`EINVAL` 转入 node+script）与 `test/characterization/defects/a5-shell.test.mjs`（`[repro]` 保持原样 + `[fixed] [AC-026]` 通过），无 `FAIL` 行；`check-seams` 末行 `check-seams: ok (files=<n>)`，即 exec 不导入 `node:fs`、无全局定时器与墙钟；`check-defects --milestone M2` 输出 `check-defects: ok`，即 `[repro]` 哈希未变。

## AC-027 win32 原生 .cmd 垫片：解析后直接 node 执行，argv 原样，全程不调用 cmd.exe

- 命令: `node "C:/git/dsh-CLIWorker/.collab/worktrees/010/scripts/run-tests.mjs" --ac AC-027 && echo "AC-027 OK"`
- 期望: win32 上退出码 0，`test/integration/exec-native.test.mjs` 的 `[AC-027]` 用例通过且不是 skip：测试在临时目录自行生成 npm v7+ 形态的 `foo.cmd` 指向夹具脚本，`runSync` 与 `runAsync` 收到的 argv 与传入（含 `a&b`、空格、`p|q`、`c^d`、`50%`、`bang!`、双引号、`;`、反引号）完全一致，记录到的唯一 spawn 的 `file` 为 `nodePath`、basename 无 `cmd.exe`，`cmd-ran.marker` 不存在。linux/darwin 上该用例写 `cliworker.skip/v1` 跳过记录，命令仍退出码 0。

## AC-028 超时经 ctx.clock、杀进程树、并发上限 4

- 命令: `node "C:/git/dsh-CLIWorker/.collab/worktrees/010/scripts/run-tests.mjs" --ac AC-028 && echo "AC-028 OK"`
- 期望: 退出码 0，`test/integration/exec-tree.test.mjs` 与 `test/unit/exec.test.mjs` 的 `[AC-028]` 用例通过：屏障 `pids.json` 出现后 `advance(timeout_ms)` 得到 `error_code === 'E_TIMEOUT'`，随后 5 秒内 `process.kill(child, 0)` 与 `process.kill(grandchild, 0)` 均抛 `ESRCH`，伪时钟 `pending() === 0`；并发上限 4 时 10 个任务全部 `ok`，`observed.log` 恰 10 行且观测到的最大并发 ≤ 4；单测断言并发峰值恰为 4、定时器经伪时钟登记、`advance` 触发 `taskkill` 或进程组 kill。

## 判定规则

- 每行命令独立判定；退出码 0 且打印 `<AC-id> OK` 才算通过。
- 不断言墙钟时间；AC-028 的等待上限（屏障 10 秒、进程消亡 5 秒）只是超时保护，不是性能指标。
- AC-027 在非 win32 上的"通过"仅指被记录为跳过；win32 基线的通过只认 Windows 上的本命令。
