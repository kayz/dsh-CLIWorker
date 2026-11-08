# Task 010 验收标准

所有命令在仓库根（worktree 根）执行，使用 Node 20+。基准：分支 `task/010`，起点提交 `040d2e9`。
`node scripts/run-tests.mjs --ac AC-nnn` 通过的判定：退出码 0，输出不含以 `FAIL` 开头的行，且末行形如 `run-tests: filtered <n> files, manifest <path>`。

## A. AC-026（unit，三平台）

| # | 命令 | 期望 |
|---|---|---|
| A1 | `node scripts/run-tests.mjs --ac AC-026` | 退出码 0；输出含 `test/unit/exec.test.mjs`、`test/characterization/defects/a5-shell.test.mjs` 的用例通过；无 `FAIL` 行 |
| A2 | `node --test test/unit/exec.test.mjs` | 退出码 0；通过的用例标题包含 `[AC-026]`（每个子点至少一条：shell:false、10 个敌意参数直通、cmd 回退 E_UNSAFE_ARG、四种垫片解析、EINVAL 转入解析） |
| A3 | `node --test test/characterization/defects/a5-shell.test.mjs` | 退出码 0；输出中同时有通过的 `[repro]` 与 `[fixed] [AC-026]` 用例 |
| A4 | `node scripts/check-defects.mjs --milestone M2` | 退出码 0；无 `FAIL`/错误行（a5-shell 具备 `[fixed]` 部分，`[repro]` 哈希未变） |
| A5 | `node -e "const l=require('fs').readFileSync('lib/exec.mjs','utf8');process.exit(/shell:\s*process\.platform/.test(l)||/shell:\s*true/.test(l)?1:0)"` | 退出码 0（源码没有按平台开启 shell） |

## B. AC-027（integration，win32；其他平台跳过）

| # | 命令 | 期望 |
|---|---|---|
| B1 | `node scripts/run-tests.mjs --ac AC-027`（win32） | 退出码 0；`test/integration/exec-native.test.mjs` 中 `[AC-027]` 用例通过且不是 skip；无 `FAIL` 行 |
| B2 | `node scripts/run-tests.mjs --ac AC-027`（linux/darwin） | 退出码 0；该用例被标记为 skipped（不是 pass、不是 fail） |
| B3 | 设置 `CLIWORKER_RESULTS_DIR=<空临时目录>` 后在 linux/darwin 运行 B2，再执行 `node -e "const t=require('fs').readFileSync(process.argv[1],'utf8').trim().split('\n').map(JSON.parse);process.exit(t.some(r=>r.schema==='cliworker.skip/v1'&&r.ac==='AC-027'&&r.requires==='win32')?0:1)" <临时目录>/skips.jsonl` | 退出码 0（写出了 `cliworker.skip/v1` 跳过记录） |

## C. AC-028（integration，三平台）

| # | 命令 | 期望 |
|---|---|---|
| C1 | `node scripts/run-tests.mjs --ac AC-028` | 退出码 0；`test/integration/exec-tree.test.mjs` 的超时用例与并发用例通过；无 `FAIL` 行 |
| C2 | `node --test test/integration/exec-tree.test.mjs` | 退出码 0；超时用例：结果 `error_code === 'E_TIMEOUT'`，`child` 与 `grandchild` 的 `process.kill(pid,0)` 在 5 秒内均抛 `ESRCH`，伪时钟 `pending()===0`；并发用例：10 个全部 ok，`observed.log` 10 行且最大值 ≤ 4 |
| C3 | `node --test test/unit/exec.test.mjs` | 退出码 0；含通过的 `[AC-028]` 用例（伪 spawn 并发峰值恰为 4，定时器经伪时钟登记，advance 触发杀树调用） |

## D. 范围与规则检查

| # | 命令 | 期望 |
|---|---|---|
| D1 | `node scripts/check-seams.mjs` | 退出码 0，末行 `check-seams: ok (files=<n>)`（exec.mjs 无 `node:fs`、无全局定时器/墙钟） |
| D2 | `node scripts/check-traceability.mjs` | 退出码 0，无 `FAIL`；T-010 分片中 AC-026/027/028 为 covered |
| D3 | `node scripts/milestone-gate.mjs --milestone M2` | 对 T-010 拥有的三条 AC 无阻断项（M2 其他任务未完成造成的 planned 不属本任务，需在报告中单独注明） |
| D4 | `node scripts/check-write-scope.mjs --base 040d2e9 --scope lib/exec.mjs --scope lib/availability.mjs --scope test/unit/exec.test.mjs --scope test/integration/exec-native.test.mjs --scope test/integration/exec-tree.test.mjs --scope "test/fixtures/exec/**" --scope test/characterization/defects/a5-shell.test.mjs --scope test/traceability/T-010.json` | 退出码 0（改动只在 write_scope 内；`.collab/**` 状态文件不计入则按脚本默认处理） |
| D5 | `node scripts/check-frozen-files.mjs` 与 `node scripts/check-unused.mjs` | 均退出码 0 |
| D6 | `node -e "const t=require('fs').readFileSync('lib/availability.mjs','utf8');process.exit(/child_process/.test(t)||!/ctx\.exec\(/.test(t)?1:0)"` | 退出码 0（availability 不碰 child_process，经 ctx.exec 调用） |
| D7 | `node -e "const l=require('fs').readFileSync('lib/exec.mjs','utf8');process.exit(/E_UNSAFE_ARG: unsafe argument at index/.test(l)?0:1)"` | 退出码 0（E_UNSAFE_ARG 错误消息为"参数下标"形式，不回显参数值） |

## E. 回归与完成前检查

| # | 命令 | 期望 |
|---|---|---|
| E1 | `node scripts/run-tests.mjs` | 退出码 0；末行 `run-tests: full <n> files, manifest <path>`；无 `FAIL` 行（完整运行的文件集合相等校验通过；既有 `test/unit/*`、`test/contract/*` 不回归） |
| E2 | `pwsh -NoProfile -File scripts/check-fast.ps1` | 退出码 0（项目约定的完成前检查） |
| E3 | `git status --porcelain`（由集成方执行） | 改动路径全部匹配 design.md 顶部 `write_scope`（`.collab/tasks/010/**` 的流程文件除外） |

## 判定规则

- 每行命令独立判定；任一行不满足即该 AC 不通过。
- B 组在非 win32 上的"通过"仅指"被记录为跳过"，win32 基线的通过只认 Windows runner 上的 B1。
- 不断言墙钟时间；C 组的等待上限（屏障 10 秒、进程消亡 5 秒）只是超时保护，不是性能指标。
