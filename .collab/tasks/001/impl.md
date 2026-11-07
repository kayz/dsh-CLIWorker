# Task 001 实现说明（dev）

## 0. 继承的改动

候选 #1 在限流前留下的未提交改动全部保留，本轮没有再改实现文件。交班单里的旧 `impl.md` 写于这些改动之前，当时还写着「删不掉 `test/select.test.mjs`、没有改代码」；工作区里的 diff 已经不是那份说明。保留的原因是：没有这四处，验收里的完整运行、嵌套运行和 pwsh 门控过不了。

1. 删除 `test/select.test.mjs`。内容已在 `test/unit/select.test.mjs`，导入改为 `../../lib/select.mjs` 与 `../../lib/forecast.mjs`。`design.md` §3.6 要求迁完后原路径不存在；留着它时 `findOrphans` 报 `discovery.orphan test/select.test.mjs`，`a3-runner` 的 `[fixed]`、发现自测和 `npm test` 都会失败。
2. `scripts/run-tests.mjs` 在 `spawn` 子进程前从环境里去掉 `NODE_TEST_CONTEXT`。自测和 `milestone-gate` 都在 `node --test` 里面再启动 `run-tests`，子进程若继承这个变量，内层 `node --test` 会拒绝执行传入的文件。其余环境仍按 §3.3 继承，并写入 `CLIWORKER_RUN_MODE`、`CLIWORKER_RUN_FILTER`、`CLIWORKER_ROOT`、`CLIWORKER_RESULTS_DIR`、`CLIWORKER_RUN_ACTIVE`。
3. `scripts/reporters/files.mjs` 只收录以 `.test.mjs` 结尾的 `event.data.file`。`platformTest` 在 `test/helpers/platform-gate.mjs` 里调用 `test()`，node 会把这条测试记到 helper 上。helper 不在枚举集合里，写进清单会变成 `discovery.unexpected`。被加载的 `*.test.mjs` 自己仍有文件级事件，所以枚举到的文件不会丢。空文件、只含 skip 的文件、加载失败的文件都以 `.test.mjs` 结尾，仍然入清单。
4. `test/helpers/platform-gate.mjs` 的可执行文件探测仍只用 `fs`，不启子进程。`existsSync` 之后，若目录项是 Windows 应用执行别名（重解析点，`stat` 返回 `EACCES`），再用 `readdirSync` 按文件名匹配。这样 `pwsh` 在这类别名下仍能被 `satisfies('pwsh')` 看见。

未跟踪的 `.collab/tasks/001/notice.json` 以及同目录下的 `state.json`、`run.json`、日志是调度器产物，不在本角色写入范围，没有删除，也没有改。

## 1. 交付物

工作区里的实现与 `design.md` 一致，本轮只核对、没有重写：

- `package.json` 只增加 `test`、`check`、`perf`、`snapshot:update` 四个脚本，没有依赖。`package-lock.json` 的 `packages` 只有根包 `""`。
- `scripts/run-tests.mjs` 导出 `enumerateTestFiles`、`findOrphans`、`verifyFullRun`。完整运行先拒孤儿，再跑显式文件列表，并用 `verifyFullRun` 比较清单；过滤运行只写 `mode:'filtered'`，不比较。`--ac` 非法退出 2，没有命中时 `FAIL run.no_match` 退出 1。`--perf` 只跑 `test/perf`，没有文件时打印 `run-tests: no perf tests` 并退出 0，不写 `files-executed.json`。产物目录优先级是 `--out-dir`、`CLIWORKER_RESULTS_DIR`、临时目录下按根路径 sha256 前 12 位分桶；默认不落在仓库里。嵌套且 `outDir` 等于父进程的 `CLIWORKER_RESULTS_DIR` 时退出 2。
- `scripts/reporters/files.mjs` 写出 `{ mode, filter, files, platform, node }`。完整运行的 `filter` 是空串；直接当 reporter 用、环境变量缺失时 `mode` 为 `filtered`、`filter` 为 `null`。
- `scripts/check-test-discovery.mjs`、`check-fast.mjs`、`check-fast.ps1`、`check-ci.mjs`、`gen-ci.mjs`、`ci-matrix.json`、`.github/workflows/ci.yml`、`check-traceability.mjs`、`check-defects.mjs`、`milestone-gate.mjs` 按设计的错误标识和退出码工作。`check-fast.ps1` 只有两行：调用 `node` 跑同目录的 `check-fast.mjs`，然后 `exit $LASTEXITCODE`。
- `contracts/spec/ac-index.json` 为 `cliworker.ac-index/v1`，恰含 AC-001..AC-074。例外 baseline：AC-027 为 `win32`，AC-033 与 AC-069 为 `linux`，AC-038 为 `real-smoke`，其余为 `darwin,linux,win32`。
- `test/traceability/T-001.json` 把 AC-001、AC-002、AC-003、AC-004、AC-074 标为 `covered`，不含 `baseline`。其余 69 条没有分片，状态为 `planned`。
- 夹具覆盖发现漂移、追踪分片的四种失败加 baseline、以及 `m2-planned` / `m4-nocache` 两道门。
- `test/characterization/defects/a3-runner.test.mjs` 含 `[repro]` 与 `[fixed]`。仓库里还没有 `test/characterization/defects.json`，所以 `check-defects` 默认模式打印缺账本并退出 0，`--milestone` 模式报 `defects.file_missing` 并退出 1。

## 2. reporter 在 Node 20 与 Node 22 上的行为

用同一份临时夹具分别跑了 Node v20.19.5（linux）和 Node v22.23.3（win32）。夹具含空的 `empty.test.mjs`、只有 `test.skip` 的文件、语法错误的文件、普通测试，以及一个只通过 helper 调用 `test()` 的文件。

两个版本的清单都包含这五个 `.test.mjs`：

- 空文件会产生文件级 `test:start` / `test:pass`，因此会进入清单，不会被判成 `discovery.missing`。§3.5 说空文件「可能」没有带 `file` 的事件；在这两个版本上这个情况没有发生，集合相等不用放宽。
- 只有 skip 的文件、加载失败的文件都有带 `file` 的事件，并进入清单。
- helper 里的 `test()` 会额外产生 helper 模块路径的事件。reporter 丢掉非 `.test.mjs` 路径后，清单里仍有对应的测试文件（文件级事件还在），没有 helper。这就是第 0 节第 3 条要留着的原因。
- Node 22 在 win32 上，部分 `test:stderr` 的 `file` 是相对路径且用反斜杠。`relativize` 会转成相对根的 `/` 路径，和枚举结果一致。

## 3. a3-runner 的假设

「a3-runner 是缺陷」来自 0.1 的仓库形状：`package.json` 没有 `scripts`，唯一的测试平铺在 `test/select.test.mjs`，不在七个发现目录里。0.1 副本属于 T-002，本文件把这个事实写成常量 `V01`，不引用副本。缺陷账本也由 T-002 写入；本任务只提供 `[repro]` / `[fixed]` 测试。`[fixed]` 断言四个脚本存在、`test/unit/select.test.mjs` 能被枚举、`findOrphans` 为空、原路径不存在。

## 4. 自测

环境：仓库根 `C:\git\dsh-CLIWorker\.collab\worktrees\001`，Windows PowerShell 7.6.9，Node v22.23.3。按 `acceptance.md` 在同一个 pwsh 会话里先定义 `Run` / `NewTmp`，再按 V-01 到 T-03 的命令依次执行。

结果：每一条命令的退出码和期望输出都符合 acceptance。其中：

- `npm test` 退出 0。spec reporter 汇总为 `ℹ tests 36`、`ℹ pass 36`、`ℹ fail 0`、`ℹ skipped 0`。设计规定使用 spec reporter，所以汇总行是 `ℹ fail 0`，不是 TAP 的 `# fail 0`。没有跳过，因此这次运行的 `skips.jsonl` 只有运行器预先截出的空文件。
- `npm run check` 与 `pwsh -NoProfile -File scripts/check-fast.ps1` 都退出 0。步骤顺序是 `check-ci.mjs`、`check-defects.mjs`、`check-fast` 自身不在列表里、`check-test-discovery.mjs`、`check-traceability.mjs`，最后是 `npm test`，收尾 `check-fast: ok`。
- `check-traceability` 为 `ok (covered=5 planned=69)`。加上 `--task-graph .collab/blueprint/cliworker-v2/task-graph.json` 后退出 0，没有 `graph.mismatch`。脚本和 `test/unit`、`test/helpers/platform-gate.mjs` 中没有字面量 `.collab`。
- 跑完后按 V-01 再查一次写入范围，没有输出。`npm test` 与 `npm run perf` 都没有在仓库里生成 `files-executed.json` 或 `test-results/`。

文本文件为 UTF-8 无 BOM、LF。锁文件与 `package.json` 的脚本字段与 V-02、V-03 逐字一致。
