# Task 001 实现说明（dev）

## 继承

本轮候选 #1（deepseek-v4.1-flash）在限流时没有改任何实现文件。交班单里的未跟踪项只有调度日志 `.collab/tasks/001/logs/dev-r2-1.log`。工作区里已有的脚本、索引、夹具和测试是上一轮留下的，和 design.md 的交付物一致，所以保留，没有 `git checkout`。

保留的既有行为：

1. `test/select.test.mjs` 已迁到 `test/unit/select.test.mjs`，导入改为 `../../lib/select.mjs` 与 `../../lib/forecast.mjs`，原路径不存在。留着原文件时 `findOrphans` 会报 `discovery.orphan`。
2. `scripts/run-tests.mjs` 在 `spawn` 前从子进程环境里去掉 `NODE_TEST_CONTEXT`。自测和 `milestone-gate` 都在 `node --test` 里面再启动运行器；子进程若继承这个变量，内层 `node --test` 会拒绝执行传入的文件。其余环境仍继承父进程，并写入 `CLIWORKER_RUN_MODE`、`CLIWORKER_RUN_FILTER`、`CLIWORKER_ROOT`、`CLIWORKER_RESULTS_DIR`、`CLIWORKER_RUN_ACTIVE`。
3. `test/helpers/platform-gate.mjs` 的可执行文件探测仍只用 `fs`，不起子进程。`existsSync` 看不到 Windows 应用执行别名（重解析点，`stat` 返回 `EACCES`）时，再用 `readdirSync` 按文件名匹配，这样 `pwsh` 仍能被 `satisfies('pwsh')` 看见。

## 本轮改了什么、为什么

上一轮有两处和 design.md 不一致，完整运行的成功路径测不出来。

1. `scripts/run-tests.mjs`：解出 `outDir` 并拒绝嵌套覆盖之后，先创建目录、删除旧的 `files-executed.json`、把 `skips.jsonl` 截为空文件，然后再做孤儿检查、`--ac` 过滤、空枚举和命令行长度检查。先前这些失败分支在清理之前返回，同一 `--out-dir` 上一次完整运行的清单会留下来。`--perf` 仍然在这之前返回，不写清单。嵌套运行（`CLIWORKER_RUN_ACTIVE` 已设置且本次 `outDir` 等于 `CLIWORKER_RESULTS_DIR`）仍然先退出 2，不碰父运行的产物。
2. `scripts/reporters/files.mjs`：收集所有 `event.data.file` 为字符串的路径，不再按 `.test.mjs` 过滤。上一轮的过滤是为了藏起 helper 上的事件；design.md §3.5 要求全部收录。
3. `test/helpers/platform-gate.mjs`：`platformTest` 仍包装 `node:test` 的 `test`。`node:test` 把测试记到调用 `test()` 的那个文件上，直接在 helper 里调用会把 `test/helpers/platform-gate.mjs` 写进清单，完整运行变成 `discovery.unexpected`。现在用 `vm.compileFunction`，`filename` 取调用方传入的 `file`（`import.meta.url`），事件落在测试文件自己身上。跳过时仍先 `recordSkip`，再 `t.skip`，不执行 `fn`。
4. `test/unit/runner-selftest.test.mjs`：补了两条 `[AC-001]`。一条对同一输出目录先完整跑通，再用 `AC-999` 和 orphan 夹具失败，断言旧清单被删、`skips.jsonl` 被截空。另一条在嵌套拒绝时断言父清单和跳过记录原样还在。

其余交付物没有重写：`package.json` 只有四个脚本且没有依赖；`package-lock.json` 的 `packages` 只有根包；`ac-index.json` 是 `cliworker.ac-index/v1`，恰含 AC-001..AC-074；`T-001.json` 覆盖 AC-001、AC-002、AC-003、AC-004、AC-074，其余 69 条没有分片，状态为 `planned`。

## reporter 在 Node 20 与 Node 22 上的行为

用同一份临时夹具分别跑了 Node v20.19.5、v22.21.1 和本机 v24.22.1（都是 linux）。夹具含空的 `empty.test.mjs`、只有 `test.skip` 的文件、语法错误的文件、普通测试，以及一个通过 `platformTest` 注册的文件。

三个版本的清单都是这五个 `.test.mjs`，`mode` 为 `full`：

- 空文件有文件级事件，进入清单，不会被判成 `discovery.missing`。§3.5 说空文件「可能」没有带 `file` 的事件；这三个版本上没有发生，集合相等不用放宽。
- 只有 skip 的文件、加载失败的文件都有带 `file` 的事件，并进入清单。语法错误使子进程以非 0 退出，清单集合仍然相等。
- `platformTest` 的事件记在调用方测试文件上。清单和 spec 输出里都没有 `platform-gate.mjs`。

## a3-runner 的假设

「a3-runner 是缺陷」来自 0.1 的仓库形状：`package.json` 没有 `scripts`，唯一的测试平铺在 `test/select.test.mjs`，不在七个发现目录里。0.1 副本属于 T-002，`test/characterization/defects/a3-runner.test.mjs` 把这个事实写成常量 `V01`，不引用副本。缺陷账本也由 T-002 写入。本工作树没有 `test/characterization/defects.json`，所以 `check-defects` 默认模式打印缺账本并退出 0，`--milestone` 模式报 `defects.file_missing` 并退出 1。`[fixed]` 断言四个脚本存在、`test/unit/select.test.mjs` 能被枚举、`findOrphans` 为空、原路径不存在。

## 自测

在仓库根用 PowerShell 7 跑了 acceptance.md 的辅助函数，并按 V-01 到 T-03 的命令在同一个会话里执行。Node 是 v24.22.1。每一条的退出码和期望输出都符合 acceptance，包括：

- `npm test` 退出 0。spec reporter 汇总为 38 个测试、`fail 0`、`skipped 0`。设计规定使用 spec reporter，所以汇总行是 `ℹ fail 0`。没有跳过，`skips.jsonl` 是运行器预先截出的空文件。
- `npm run check` 与 `pwsh -NoProfile -File scripts/check-fast.ps1` 都退出 0。顺序是 `check-ci.mjs`、`check-defects.mjs`、`check-test-discovery.mjs`、`check-traceability.mjs`，然后 `npm test`，收尾 `check-fast: ok`。没有 `==> check-fast.mjs`。
- `check-traceability` 为 `ok (covered=5 planned=69)`。加上任务图路径后退出 0，没有 `graph.mismatch`。
- `--ac AC-999` 与 orphan 夹具在复用输出目录时退出 1，并删掉上一份 `files-executed.json`。嵌套同一目录退出 2。
- `npm test` 与 `npm run perf` 都没有在仓库里留下 `files-executed.json` 或 `test-results/`。`perf` 输出含 `no perf tests`。

本轮改过的文本是 UTF-8 无 BOM、LF、末尾有换行。
