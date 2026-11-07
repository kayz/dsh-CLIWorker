---
task: "001"
role: design
write_scope:
  - package.json
  - package-lock.json
  - scripts/run-tests.mjs
  - scripts/reporters/**
  - scripts/check-test-discovery.mjs
  - scripts/check-fast.mjs
  - scripts/check-fast.ps1
  - scripts/check-traceability.mjs
  - scripts/check-ci.mjs
  - scripts/gen-ci.mjs
  - scripts/ci-matrix.json
  - scripts/milestone-gate.mjs
  - scripts/check-defects.mjs
  - contracts/spec/ac-index.json
  - .github/workflows/**
  - test/select.test.mjs
  - test/unit/select.test.mjs
  - test/unit/runner-selftest.test.mjs
  - test/unit/traceability.test.mjs
  - test/unit/milestone-gate.test.mjs
  - test/helpers/platform-gate.mjs
  - test/fixtures/discovery-selftest/**
  - test/fixtures/traceability/**
  - test/fixtures/milestone-gate/**
  - test/characterization/defects/a3-runner.test.mjs
  - test/traceability/T-001.json
---

# Task 001 设计：测试运行器、CI 矩阵、check-fast、AC 索引、追踪合并、里程碑门与缺陷检查

规格来源：`brief.md`，以及蓝图 `.collab/blueprint/cliworker-v2/` 下的 `design.md`（§3、§5、§6）、`interfaces.md`（§15）、`task-graph.json`（T-001）。本文只补充实现所需的、蓝图没有写死的细节。本文中由本设计新定的名字（错误标识、选项名、环境变量名、`ci-matrix.json` 的字段）都标明「本设计定义」，实现者不得改名，验收按这些名字判定。

## 0. 对上一候选的处理

- 候选 #1（gpt-6.1-sol）在 stall 时只读了蓝图，没有产出 design.md 或 acceptance.md。工作区没有已跟踪文件的改动，没有代码文件，未跟踪项只有调度器的产物（`.collab/tasks/001/` 下的 logs、handoff、state.json、run.json、live.json）。
- 结论：没有可继承的设计改动，所以不存在「保留」的内容，也不需要 `git checkout HEAD -- .`。未跟踪的调度器产物不是候选 #1 写的方案，不能删，也不属于本角色的写入范围。
- 交班单里没有任何需求，本文所有要求都来自 brief 和蓝图。

## 1. 现状与范围

- 仓库当前只有 `lib/`、`bin/`、`config/`、`test/select.test.mjs`（平铺在 `test/` 下，导入 `../lib/select.mjs` 和 `../lib/forecast.mjs`）。没有 `scripts/`、`contracts/`、`.github/`、`package-lock.json`，`package.json` 没有 `scripts` 字段。
- `.gitignore` 只忽略 `config/cliworker.local.json`、`usage.jsonl`、`node_modules/`、`.collab/worktrees/`，而且不在 write_scope 内，**不能改**。因此运行器的产物（files-executed.json、skips.jsonl）默认不能写进仓库目录，见 §3.4。
- 本任务只交付 brief 列出的文件。以下不在本任务内，不要提前写：`check-frozen-files`、`check-seams`、`check-no-collab`、`release-gate`、`test/characterization/defects.json`、`stable.test.mjs`、其余缺陷文件（T-002 及后续任务）。
- 零第三方运行时依赖，Node 20+，ESM（`package.json` 已是 `"type": "module"`）。`package-lock.json` 只含根包，由 `npm install --package-lock-only` 生成。
- 所有文本文件 UTF-8 无 BOM，LF 换行，末尾带换行。
- 不使用 shell 字符串拼命令：所有子进程用 `spawn`/`spawnSync`，`process.execPath` 作为可执行文件，参数用数组，不开 `shell`。
- 不使用 Node 22 才有的 API（如 `fs.globSync`、`import.meta.dirname`）；目录遍历自己写。

## 2. 交付物总览

| 文件 | 作用 | 对应 AC |
|---|---|---|
| `package.json`（改） | 增加 `scripts` | AC-001、AC-003 |
| `package-lock.json`（新） | 零依赖锁文件，供 CI 的 `npm ci` | AC-002 |
| `scripts/run-tests.mjs` | 枚举、运行、写 files-executed.json、完整运行当场校验；导出可复用函数 | AC-001 |
| `scripts/reporters/files.mjs` | node:test 自定义 reporter，写 files-executed.json | AC-001 |
| `scripts/check-test-discovery.mjs` | 发现机制的自测与单点校验 | AC-001 |
| `scripts/check-fast.mjs`、`check-fast.ps1` | 按字母序跑全部 check-*，最后跑完整 `npm test` | AC-003 |
| `scripts/ci-matrix.json`、`gen-ci.mjs`、`check-ci.mjs`、`.github/workflows/ci.yml` | CI 矩阵、生成器、校验 | AC-002 |
| `contracts/spec/ac-index.json` | AC-001..AC-074 的属主、里程碑、层级、baseline | AC-004 |
| `scripts/check-traceability.mjs` | 索引校验与分片合并；导出合并函数供门禁复用 | AC-004 |
| `scripts/check-defects.mjs`、`scripts/milestone-gate.mjs` | 缺陷检查、里程碑门 | AC-074 |
| `test/helpers/platform-gate.mjs` | 平台门控与 `cliworker.skip/v1` 记录 | AC-001（skips.jsonl 的来源） |
| `test/unit/select.test.mjs`（迁入）、删除 `test/select.test.mjs` | 让既有测试进入发现范围 | AC-001 |
| `test/unit/runner-selftest.test.mjs`、`traceability.test.mjs`、`milestone-gate.test.mjs` | 自测 | AC-001..004、AC-074 |
| `test/fixtures/discovery-selftest/**`、`traceability/**`、`milestone-gate/**` | 夹具 | 同上 |
| `test/characterization/defects/a3-runner.test.mjs` | a3-runner 的 `[repro]` 与 `[fixed]` | AC-074 的缺陷口径 |
| `test/traceability/T-001.json` | 本任务的追踪分片 | AC-004 |

## 3. 运行器：`scripts/run-tests.mjs` 与 `scripts/reporters/files.mjs`

### 3.1 命令行

```
node scripts/run-tests.mjs [--ac AC-nnn]... [--root <dir>] [--out-dir <dir>] [--perf] [--update-snapshots]
```

- `--root`：被测项目根，默认是 `scripts/` 的上一级。夹具自测用它指向 `test/fixtures/...` 下的迷你工程。
- `--ac`：可重复；值必须匹配 `^AC-\d{3}$`，否则退出 2。出现 `--ac` 即为过滤运行。
- `--out-dir`：产物目录，见 §3.4。
- `--perf`：只跑 `test/perf/**/*.test.mjs`，不写 files-executed.json（interfaces 里 mode 只有 full 与 filtered，不增加第三种）。`test/perf` 不存在或没有文件时打印 `run-tests: no perf tests` 并退出 0。
- `--update-snapshots`：完整运行，并给子进程设置环境变量 `CLIWORKER_UPDATE_SNAPSHOT=1`（本设计定义）。本任务只提供开关，快照由后续任务的测试读取。
- 未知参数、`--ac` 值非法：退出 2，stderr 给用法。

### 3.2 枚举规则（导出 `enumerateTestFiles(root)`）

- 只看 `<root>/test/` 下的七个一级目录：`unit`、`integration`、`contract`、`e2e`、`smoke`、`characterization`、`flows`，递归，收集文件名以 `.test.mjs` 结尾的文件。
- `test/fixtures`、`test/helpers`、`test/perf` 整个排除。
- 结果为相对 `<root>`、用 `/` 分隔的路径，按码点升序排序（不用 `localeCompare`），去重。
- 导出 `findOrphans(root)`：递归遍历 `<root>/test/`（跳过 `fixtures`、`helpers`、`perf`），返回所有不在上述七个目录里的 `*.test.mjs`。孤儿文件意味着写了测试但永远不会被执行，完整运行与 `check-test-discovery` 都必须把它当成失败（`discovery.orphan`）。这就是 `test/select.test.mjs` 必须迁走的原因。
- 导出 `verifyFullRun({ enumerated, manifest })`，返回 `{ ok, errors }`，错误标识（本设计定义）：
  - `discovery.mode_not_full`：`manifest.mode !== 'full'`。过滤清单即使文件列表恰好相同也不能通过。
  - `discovery.missing`：枚举到、清单里没有。
  - `discovery.unexpected`：清单里有、枚举里没有。
  - `discovery.no_files`：完整运行枚举为空。运行零个文件不得算通过。

### 3.3 运行流程

1. 解析参数；解出 `outDir`；创建目录；删除旧的 `files-executed.json`，把 `skips.jsonl` 截为空文件（保证 CI 上传的两个文件总是存在）。
2. 完整运行：`enumerateTestFiles(root)`，同时 `findOrphans(root)`；有孤儿则输出 `FAIL discovery.orphan <path>`，退出 1，不启动子进程。
   过滤运行：在枚举结果里选出文本中含字面量 `[AC-nnn]` 的文件（多个 `--ac` 取并集）；一个文件都选不出来时输出 `FAIL run.no_match <AC>` 并退出 1。
3. 启动子进程（cwd 为 `<root>`）：
   `process.execPath --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=<files.mjs 的 file URL> --test-reporter-destination=<outDir>/files-executed.json <文件列表...>`
   - 文件列表显式传入，使「我们枚举的」和「node 实际跑的」是两个独立的集合，才有比较的意义。
   - reporter 必须用 `pathToFileURL(...).href`，Windows 绝对路径不能直接给 `--test-reporter`。
   - 子进程环境：继承父环境，并设置 `CLIWORKER_RUN_MODE`（`full` 或 `filtered`）、`CLIWORKER_RUN_FILTER`（过滤值，完整运行为空串）、`CLIWORKER_ROOT`（`<root>` 绝对路径）、`CLIWORKER_RESULTS_DIR`（`outDir`）、`CLIWORKER_RUN_ACTIVE=1`（均为本设计定义）。
   - 文件列表拼起来超过 24000 个字符时退出 2 并提示（Windows 命令行上限约 32767），宁可大声失败。
4. 子进程结束后：
   - 完整运行：读 `<outDir>/files-executed.json`，调用 `verifyFullRun`；不通过则打印 `FAIL <标识> <路径>`（每条一行）并退出 1，即使所有测试都通过。
   - 过滤运行：不做任何比较。
   - 退出码：子进程非 0 时用子进程的码（`null` 当作 1）；子进程为 0 但校验失败时为 1；否则 0。
   - 最后打印一行 `run-tests: <full|filtered> <n> files, manifest <路径>`。
5. 防止嵌套覆盖：若环境变量 `CLIWORKER_RUN_ACTIVE` 已设置，且本次解出的 `outDir` 等于环境里的 `CLIWORKER_RESULTS_DIR`，退出 2 并说明「嵌套运行会覆盖父运行的产物」。自测代码在嵌套调用时必须总是传 `--out-dir <mkdtemp 目录>`。

### 3.4 产物目录（解决「不写仓库」）

优先级：`--out-dir` > 环境变量 `CLIWORKER_RESULTS_DIR` > `path.join(os.tmpdir(), 'cliworker-test-results', <root 绝对路径（win32 转小写）的 sha256 前 12 位>)`。默认不落在仓库里，所以跑 `npm test` 不会产生需要 `.gitignore` 的文件，也不会被写域检查误报。CI 把 `CLIWORKER_RESULTS_DIR` 设为 `${{ github.workspace }}/test-results`（见 §5），上传步骤读同一个目录。

### 3.5 reporter：`scripts/reporters/files.mjs`

- 默认导出异步生成器，消费 node:test 事件流。收集所有 `event.data.file` 为字符串的事件的文件路径，包括只含 skip 的文件和加载失败的文件。路径转成相对 `CLIWORKER_ROOT`、`/` 分隔、去重、排序。
- 流结束后 `yield` 一次 JSON（2 空格缩进，末尾换行）：`{ mode, filter, files, platform, node }`。`platform` 取 `process.platform`，`node` 取 `process.version`，`filter` 为过滤值字符串或 `null`。字段名与 interfaces §15 一致，不增不减。
- 环境变量缺失时（有人直接用 `node --test --test-reporter` 调它）：`mode` 取 `filtered`、`filter` 取 `null`，宁可让它不能满足完整校验。
- 一个文件里一个测试都没有，可能不产生任何带 `file` 的事件，从而被判为 `discovery.missing`。这是期望行为：空测试文件应当被发现。实现者要在 Node 20 和 22 上各确认一次，把实际行为写进 impl.md。

### 3.6 迁入 select 测试

`test/select.test.mjs` 内容迁到 `test/unit/select.test.mjs`，只改相对导入：`../lib/select.mjs`→`../../lib/select.mjs`，`../lib/forecast.mjs`→`../../lib/forecast.mjs`，其余逐字保留。迁完后 `test/select.test.mjs` 必须不存在。

## 4. 平台门控：`test/helpers/platform-gate.mjs`

导出：

- `satisfies(requires, opts?)`：`requires` 取 `win32|wsl|darwin|linux|pwsh|secret-tool|security`。
  - `win32`/`darwin`/`linux`：与 `process.platform`（或 `opts.platform`）比较。
  - `pwsh`、`secret-tool`、`security`：在 `PATH` 各目录里找可执行文件（win32 叠加 `PATHEXT`），用 `fs.existsSync`，不起子进程。
  - `wsl`：win32 且 `%SystemRoot%\System32\wsl.exe` 存在，或 linux 且设置了 `WSL_DISTRO_NAME`。
- `recordSkip({ test, file, ac, requires, reason })`：若环境变量 `CLIWORKER_RESULTS_DIR` 已设置，向 `<dir>/skips.jsonl` 追加一行 JSON，字段严格为 interfaces §15：`schema:'cliworker.skip/v1'`、`test`、`file`、`ac`、`requires`、`platform`、`node`、`reason`、`at`（ISO 时间）。未设置时不写文件。
- `platformTest(name, { ac, requires, file, reason? }, fn)`：包装 `node:test` 的 `test`。`file` 必须传 `import.meta.url`，函数内部转成相对仓库根的 `/` 路径。运行时若 `satisfies` 为假：先 `recordSkip`，再 `t.skip(reason)` 并返回，不执行 `fn`；否则执行 `fn(t)`。默认 `reason` 为 `requires <requires> not satisfied on <platform>`。

约束：skip 只会出现在 node 的 skipped 统计里，不会让任何东西「通过」。函数名 `platformTest` 要能被 §6.2 的标题提取正则识别。该文件在 `test/helpers/` 下，不会被当作测试执行。

## 5. CI：`ci-matrix.json`、`gen-ci.mjs`、`check-ci.mjs`、`ci.yml`

### 5.1 `scripts/ci-matrix.json`（字段本设计定义）

```json
{
  "os": [
    { "name": "ubuntu",  "runs_on": "ubuntu-latest",  "baseline": "linux" },
    { "name": "windows", "runs_on": "windows-latest", "baseline": "win32" },
    { "name": "macos",   "runs_on": "macos-latest",   "baseline": "darwin" }
  ],
  "node": [20, 22],
  "check_command": "npm run check",
  "results_dir": "test-results",
  "artifacts": ["files-executed.json", "skips.jsonl"],
  "perf": { "runs_on": "ubuntu-latest", "node": 22, "command": "npm run perf", "blocking": false }
}
```

### 5.2 `scripts/gen-ci.mjs`

- 导出 `renderCi(matrix)`，返回 YAML 字符串；纯函数、确定性、不依赖 YAML 库，用模板拼接。
- 命令行：无参数时写 `.github/workflows/ci.yml`；`--stdout` 打印到标准输出；`--root <dir>` 指定根（默认仓库根）。写文件用 UTF-8 无 BOM、LF。
- 生成内容的要求（顺序固定）：
  - 顶部注释 `# generated by scripts/gen-ci.mjs from scripts/ci-matrix.json - do not edit`。
  - `name: ci`；`on: [push, pull_request]`；`permissions: contents: read`。
  - 作业 `check`：`strategy.fail-fast: false`，矩阵 `include` 展开 3 个 OS × 2 个 Node 共 6 格；`runs-on` 取 `runs_on`；`env.CLIWORKER_RESULTS_DIR: ${{ github.workspace }}/<results_dir>`；步骤依次为 `actions/checkout@v4`、`actions/setup-node@v4`（`node-version` 取矩阵）、`npm ci`、`npm run check`、`actions/upload-artifact@v4`。
  - 上传步骤带 `if: always()`，`name` 含 OS 与 Node 版本以免冲突（如 `test-results-${{ matrix.name }}-node${{ matrix.node }}`），`path` 为 `<results_dir>/files-executed.json` 与 `<results_dir>/skips.jsonl` 两行，`if-no-files-found: warn`。
  - 作业 `perf`：`runs-on` 取 `perf.runs_on`，`continue-on-error: true`，Node 取 `perf.node`，步骤为 checkout、setup-node、`npm ci`、`npm run perf`；不被任何作业 `needs`，也不 `needs` 其他作业。

### 5.3 `scripts/check-ci.mjs`

选项：`--root <dir>`（默认仓库根；读取 `<root>/scripts/ci-matrix.json` 与 `<root>/.github/workflows/ci.yml`）。顺序检查，错误标识为本设计定义：

1. `ci.matrix_invalid`：矩阵 `os` 的 `name` 集合不等于 {ubuntu, windows, macos}；`node` 不等于 [20, 22]；`check_command` 不是 `npm run check`；`artifacts` 不是 [files-executed.json, skips.jsonl]；`perf.blocking` 不是 `false`。
2. `ci.missing`：`ci.yml` 不存在。
3. `ci.stale`：`ci.yml` 与 `renderCi(matrix)` 的结果不逐字节相等（含手工改一个字符、多一个尾部空格、CRLF）。
4. `ci.perf_blocking`：生成结果里 `perf` 作业缺少 `continue-on-error: true`，或存在 `needs: perf`。

通过时最后一行输出 `check-ci: ok`，退出 0；任一失败输出 `FAIL <标识> <说明>` 并以 `check-ci: FAILED (<n> errors)` 结尾，退出 1。

## 6. 追踪：`contracts/spec/ac-index.json` 与 `scripts/check-traceability.mjs`

### 6.1 `ac-index.json` 的数据

格式：`{ "schema": "cliworker.ac-index/v1", "acs": [ { "ac", "owner", "milestone", "levels", "baseline" } ] }`，`acs` 按 AC 编号升序，每条的键顺序固定为 `ac, owner, milestone, levels, baseline`，`levels` 与 `baseline` 都是按字母序排序的数组，2 空格缩进。

生成规则：

- `owner` 与 `levels`：逐行取自蓝图 `acceptance-matrix.md`（`levels` 列），与 `task-graph.json` 一致。
- `milestone`：取属主任务的里程碑。T-001..T-009 为 M1，T-010..T-015 为 M2，T-016..T-020 为 M3，T-021..T-023 为 M4，T-024..T-030 为 M5。
- `baseline`：默认 `["darwin","linux","win32"]`，下列四条例外：AC-027 → `["win32"]`；AC-033 → `["linux"]`；AC-038 → `["real-smoke"]`；AC-069 → `["linux"]`。

数据表（`AC 属主 层级`）：

```
AC-001 T-001 unit                 AC-038 T-029 smoke
AC-002 T-001 unit                 AC-039 T-016 integration
AC-003 T-001 integration          AC-040 T-016 integration
AC-004 T-001 unit                 AC-041 T-017 unit
AC-005 T-002 unit                 AC-042 T-017 unit
AC-006 T-003 unit                 AC-043 T-018 unit
AC-007 T-003 unit                 AC-044 T-018 unit
AC-008 T-003 contract,integration AC-045 T-019 unit
AC-009 T-004 contract             AC-046 T-019 unit
AC-010 T-004 contract             AC-047 T-020 integration
AC-011 T-004 contract,unit        AC-048 T-020 integration
AC-012 T-005 integration,unit     AC-049 T-021 unit
AC-013 T-005 unit                 AC-050 T-021 unit
AC-014 T-005 unit                 AC-051 T-022 unit
AC-015 T-006 unit                 AC-052 T-022 unit
AC-016 T-006 unit                 AC-053 T-022 contract,unit
AC-017 T-006 unit                 AC-054 T-022 integration
AC-018 T-006 unit                 AC-055 T-022 unit
AC-019 T-006 unit                 AC-056 T-022 contract
AC-020 T-007 unit                 AC-057 T-023 integration
AC-021 T-007 unit                 AC-058 T-023 integration
AC-022 T-007 unit                 AC-059 T-024 integration
AC-023 T-008 integration          AC-060 T-024 integration
AC-024 T-008 unit                 AC-061 T-024 integration,unit
AC-025 T-009 integration          AC-062 T-025 unit
AC-026 T-010 unit                 AC-063 T-025 integration
AC-027 T-010 integration          AC-064 T-026 e2e
AC-028 T-010 integration          AC-065 T-027 e2e
AC-029 T-011 integration,unit     AC-066 T-027 e2e,integration
AC-030 T-011 unit                 AC-067 T-028 integration
AC-031 T-012 integration,unit     AC-068 T-028 unit
AC-032 T-013 integration          AC-069 T-029 smoke
AC-033 T-013 unit                 AC-070 T-030 unit
AC-034 T-014 unit                 AC-071 T-030 integration
AC-035 T-015 integration          AC-072 T-003 unit
AC-036 T-016 integration          AC-073 T-004 contract,unit
AC-037 T-016 unit                 AC-074 T-001 unit
```

`levels` 写进文件时按字母序（`e2e,integration` → `["e2e","integration"]`）。

### 6.2 `scripts/check-traceability.mjs`

导出函数（供 `milestone-gate`、`check-defects` 复用，文件末尾用 `process.argv[1]` 对比 `import.meta.url` 做入口判断，导入时不执行）：

- `validateIndex(index)` → `errors[]`（只在 check-traceability 的入口使用，门禁不调用它，因此门禁的夹具可以只含几条 AC）。
- `mergeShards({ root, index })` → `{ errors, acs }`，`acs` 为 `ac → 'covered'|'planned'`。
- `extractTitles(source)` → `[{ kind, title }]`：用正则 `(?<![\w.])(test|it|describe|platformTest)(\.(skip|todo|only))?\s*\(\s*(['"`])((?:\\.|(?!\4).)*)\4`（platformTest 的标题是第一个参数，同样匹配）。`kind` 为 `plain`（无后缀）或 `skip`/`todo`/`only`。

命令行：`node scripts/check-traceability.mjs [--root <dir>] [--index <file>] [--task-graph <file>] [--json]`

- `--root` 默认仓库根，分片取 `<root>/test/traceability/*.json`，被引用的测试文件相对 `<root>`；`--index` 默认 `<root>/contracts/spec/ac-index.json`。
- `--task-graph`：可选交叉校验，传入蓝图 `task-graph.json` 的路径。脚本里**不得出现字面量 `.collab`**（后续的 `check-no-collab` 会扫 `scripts/`），路径只能来自参数。
- `--json`：把结果以单个 JSON 输出到 stdout：`{ ok, errors:[{id, ac?, file?, detail}], covered, planned, acs:[{ac,status}] }`。

错误标识（本设计定义），人读输出时每条一行 `FAIL <标识> <ac 或文件> <说明>`，全部输出到 stdout：

| 标识 | 触发 |
|---|---|
| `index.schema` | `schema` 不是 `cliworker.ac-index/v1`，或条目含有五个键之外的键、缺键 |
| `index.count` | 条目集合不是恰好 AC-001..AC-074（缺、多、重复、乱序都算） |
| `index.owner` | `owner` 不是匹配 `^T-\d{3}$` 的字符串 |
| `index.milestone` | 不是 M1..M5 |
| `index.levels` | 为空、含未知层级（只允许 unit、integration、contract、e2e、smoke）、有重复 |
| `index.baseline` | 为空、含未知值（只允许 linux、win32、darwin、real-smoke）、有重复 |
| `index.baseline_incompatible` | levels 含 unit/contract/integration/e2e 任一但 baseline 含 `real-smoke`；或 levels 含 smoke 但 baseline 含 win32/darwin |
| `graph.mismatch` | 仅 `--task-graph`：owner、milestone、levels 与任务图不一致（owner = 在 `acceptance` 里列了该 AC 的那个任务，milestone = 该任务的 milestone，levels 按集合比较） |
| `shard.schema` | 分片 JSON 解析失败；`task` 与文件名不符；条目缺 `ac`/`status`/`files`；`status` 不是 `covered`/`planned` |
| `shard.baseline_forbidden` | 分片顶层或任一条目带 `baseline` 键 |
| `shard.unknown_ac` | 条目的 AC 不在索引里 |
| `shard.duplicate` | 同一 AC 在同一分片内出现两次，或出现在两个分片 |
| `shard.not_owner` | 条目所在分片的 `task` 不是该 AC 的 `owner` |
| `shard.missing_file` | `covered` 条目的 `files` 为空，或任一文件不存在，或路径是绝对路径/含 `..` |
| `shard.missing_title` | `covered` 条目没有任何一个文件含 `kind==='plain'` 且标题含字面量 `[AC-nnn]` 的测试（`test.skip` 里的标题不算） |

没有分片的 AC 状态为 `planned`；分片里显式写 `planned` 的条目同样是 `planned`，且不检查文件。通过时最后一行输出 `check-traceability: ok (covered=<n> planned=<m>)`，退出 0；失败以 `check-traceability: FAILED (<n> errors)` 结尾，退出 1。

### 6.3 `test/traceability/T-001.json`

`{ "task": "T-001", "milestone": "M1", "entries": [...] }`，五条都为 `covered`，不含 `baseline`：

- AC-001、AC-002、AC-003 → `["test/unit/runner-selftest.test.mjs"]`
- AC-004 → `["test/unit/traceability.test.mjs"]`
- AC-074 → `["test/unit/milestone-gate.test.mjs"]`

AC-003 的层级是 integration，但 write_scope 里没有 `test/integration/**`，所以它的测试放在 `test/unit/runner-selftest.test.mjs`；检查器只看文件存在与标题标签，不比较目录与层级。

### 6.4 夹具 `test/fixtures/traceability/`

- `ac-index.json`：一份合法的 74 条索引（内容等同于 §6.1 生成的真实索引），所有分片夹具共用，通过 `--index` 传入。
- 每个用例一个目录，内含 `test/traceability/*.json` 与被引用的测试文件：
  - `ok/`：T-001 分片中 AC-001 `covered`（文件存在且含 `test('[AC-001] ...')`），AC-002 显式 `planned`。通过。
  - `duplicate/`：`T-001.json` 与 `T-002.json` 都列了 AC-001（同时会触发 `shard.not_owner`）。期望含 `shard.duplicate`。
  - `not-owner/`：`T-002.json` 列了 AC-001（属主是 T-001）。期望含 `shard.not_owner`。
  - `missing-file/`：AC-001 `covered`，文件不存在。期望 `shard.missing_file`。
  - `missing-title/`：AC-001 `covered`，文件存在，但标题只有 `[AC-002]`，或标签在 `test.skip` 里。期望 `shard.missing_title`。
  - `baseline-in-shard/`：分片条目带 `baseline`。期望 `shard.baseline_forbidden`。
- 索引自身的失败（`index.*`）在 `test/unit/traceability.test.mjs` 里用内存对象变异断言：少一条、重复一条、乱序、`levels` 为空、unit 配 `real-smoke`、smoke 配 `win32`、缺键、多键。

夹具里的 `*.test.mjs` 在 `test/fixtures/` 下，不会被运行器枚举。

## 7. `check-fast`

`scripts/check-fast.mjs`：

- 步骤列表：`<dir>` 下所有匹配 `^check-.*\.mjs$` 的文件，**排除 `check-fast.mjs` 自身**，按码点升序排序；之后追加最后一步 `npm test`，实现为 `process.execPath <dir>/run-tests.mjs`（不经 npm/cmd，避免 Windows 上的 shell 问题；与 `package.json` 的 `test` 脚本等价）。
- `<dir>` 默认为 `check-fast.mjs` 所在目录；子进程 cwd 为 `<dir>` 的上一级（仓库根）。
- 测试注入，只靠环境变量（经 pwsh 包装时也不会被参数解析吃掉）：`CLIWORKER_TEST_CHECK_DIR` 覆盖 `<dir>`；`CLIWORKER_TEST_FINAL_SCRIPT` 覆盖最后一步的脚本路径。任一变量被使用时先向 stderr 打印一行 `check-fast: test injection active`。
- 每步先向 stdout 打印 `==> <文件名>`（最后一步为 `==> npm test`），子进程 `stdio: 'inherit'`，不开 shell。
- 任一步退出码非 0：立即停止，向 stderr 打印 `check-fast: FAILED step <名称> (exit <码>)`，并以该码退出；子进程被信号终止或码为 `null` 时用 1。后续步骤（包括最后的 `npm test`）不得执行。
- 全部成功：打印 `check-fast: ok` 并退出 0。

`scripts/check-fast.ps1` 只有两行实质内容，不含其他逻辑：

```powershell
& node (Join-Path $PSScriptRoot 'check-fast.mjs') @args
exit $LASTEXITCODE
```

自测的硬规则：**测试里调用 check-fast 时必须同时设置两个注入变量**；不设置会形成 check-fast → npm test → 自测 → check-fast 的无限递归。

## 8. 缺陷检查与里程碑门

### 8.1 共用约定

- 里程碑比较：`M1..M5` 取数字比较。`--milestone` 值不匹配 `^M[1-5]$` 时退出 2。
- 缺陷账本 `test/characterization/defects.json`：`{ "defects": [ { "id", "owner_task", "owner_milestone", "ac" } ] }`，由 T-002 写入；本任务只读，夹具里自带。
- 缺陷文件 `test/characterization/defects/<id>.test.mjs`：用 `extractTitles` 判断。**具备 `[fixed]`** 指存在 `kind==='plain'` 且标题以 `[fixed]` 开头的 `test`/`it`/`describe`；`test.skip`/`todo` 不算。`[repro]` 同理，标题以 `[repro]` 开头。
- 两个脚本都支持 `--root <dir>`（默认仓库根）和 `--index <file>`（默认 `<root>/contracts/spec/ac-index.json`）。

### 8.2 `scripts/check-defects.mjs`

```
node scripts/check-defects.mjs [--milestone Mx] [--root <dir>] [--index <file>]
```

导出 `checkDefects({ root, index, milestone? })`，供门禁复用，并留给 T-002 追加 canary 检查。

错误标识（本设计定义）：

| 标识 | 触发 |
|---|---|
| `defects.file_missing` | 缺陷账本不存在。**仅**在给了 `--milestone` 时是错误；默认模式下打印 `check-defects: defects.json absent, nothing to check` 并退出 0（T-002 之前的过渡态） |
| `defects.schema` | 账本解析失败；条目缺键；`id` 重复；`owner_task` 不匹配 `^T-\d{3}$`；`owner_milestone` 不是 M1..M5；`ac` 不在索引里 |
| `defects.missing_fixed` | 应当具备 `[fixed]` 而没有（缺陷文件不存在也归此类） |
| `defects.set_mismatch` | 仅 `--milestone M5`：账本 id 集合不等于 {a1-quota, a2-pack, a3-runner, a4-paths, a4-null-config, a5-dup-call, a5-forecast-x3, a5-unused, a5-ignored-fields, a5-shell, a5-nocache} |

判定：

- 默认模式（无 `--milestone`）：只对「`ac` 在 `owner_task` 的分片里已是 `covered`」的缺陷要求具备 `[fixed]`；其余跳过，不误报。分片状态用 `mergeShards` 得到。
- `--milestone Mx`：对所有 `owner_milestone <= Mx` 的缺陷都要求具备 `[fixed]`，不看分片状态；`owner_milestone > Mx` 的不检查。
- 通过时最后一行 `check-defects: ok`，退出 0；失败每条一行 `FAIL <标识> <id> <说明>`，并以 `check-defects: FAILED (<n> errors)` 结尾，退出 1。

### 8.3 `scripts/milestone-gate.mjs`

```
node scripts/milestone-gate.mjs --milestone Mx [--root <dir>] [--index <file>]
```

`--milestone` 必填，缺失或不匹配 `^M[1-5]$` 时退出 2。依次执行（错误标识本设计定义）：

1. 读取索引（不调用 `validateIndex`，所以夹具索引可以只有几条）和分片：`mergeShards` 的错误原样转成 `gate.trace_error`。
2. `gate.ac_not_covered <AC>`：索引里 `milestone <= Mx` 的 AC，状态不是 `covered`。`milestone > Mx` 的 AC 完全不检查（所以 M1 门不会因为 AC-026、AC-055 阻断）。
3. `checkDefects({ milestone: Mx })` 的错误原样输出（标识保留 `defects.*`）。该步在门禁里是严格模式，账本缺失同样阻断。
4. 前三步都没有错误时，才跑完整运行：`process.execPath scripts/run-tests.mjs --root <root> --out-dir <mkdtemp 目录>`（`run-tests.mjs` 取门禁脚本所在目录）。
   - 退出码非 0：`gate.run_failed`（完整运行内部已含集合相等校验）。
   - 读该目录里的 `files-executed.json`：`mode` 不是 `full`：`gate.manifest_not_full`；属主里程碑 `<= Mx` 的所有 `covered` 条目引用的文件，有不在 `files` 里的：`gate.file_not_executed <文件>`。
   - 目录用完即删。
   这样「在完整运行中通过」的含义是：完整运行整体以 0 退出，且这些 AC 的文件确实被执行过。
5. 有错误时输出 `milestone-gate <Mx>: BLOCKED (<n> errors)` 并退出 1；否则输出 `milestone-gate <Mx>: PASS` 并退出 0。

门禁夹具里自带迷你工程，嵌套的完整运行只在夹具根上进行，不会递归调用本仓库的 `npm test`。

### 8.4 夹具 `test/fixtures/milestone-gate/`

每个夹具是一个迷你根：`contracts/spec/ac-index.json`（几条 AC 即可）、`test/traceability/*.json`、`test/unit/*.test.mjs`（真实可通过的测试，标题含 `[AC-xxx]`）、`test/characterization/defects.json`、`test/characterization/defects/<id>.test.mjs`。

- `m2-planned/`
  - 索引：AC-001（T-001，M1）、AC-026（T-010，M2）。
  - 分片：T-001 的 AC-001 为 `covered`（测试文件通过）；T-010 的 AC-026 为 `planned`。
  - 账本：`a3-runner`（T-001，M1，AC-001，文件含 `[fixed]`）、`a5-shell`（T-010，M2，AC-026，文件只含 `[repro]`）。
  - 期望：M1 门 `PASS`；M2 门 `BLOCKED`，错误含 `gate.ac_not_covered AC-026` 与 `defects.missing_fixed a5-shell`。`check-defects`（默认）通过，因为 AC-026 不是 covered；`check-defects --milestone M2` 失败；`check-defects --milestone M5` 失败（`defects.set_mismatch`）。
- `m4-nocache/`
  - 索引：AC-001（T-001，M1）、AC-043（T-018，M3）、AC-055（T-022，M4）。三条分片都为 `covered`，测试都能通过。
  - 账本：`a5-nocache`（T-022，M4，AC-055，文件只含 `[repro]`）。
  - 期望：M3 门 `PASS`；M4 门 `BLOCKED`，错误含 `defects.missing_fixed a5-nocache`，且不含 `gate.ac_not_covered`。`check-defects`（默认）失败，因为 AC-055 已 covered 却没有 `[fixed]`。

## 9. 发现自测：`scripts/check-test-discovery.mjs`

```
node scripts/check-test-discovery.mjs                      # 完整自测
node scripts/check-test-discovery.mjs --root <dir> [--manifest <file>]   # 单点校验
```

- 单点校验：对 `<root>` 做 `findOrphans`；给了 `--manifest` 时把 `enumerateTestFiles(<root>)` 与该清单做 `verifyFullRun`。每个错误一行 `FAIL <标识> <路径>`，有错误退出 1。
- 完整自测（无参数）依次执行，全部通过才输出 `check-test-discovery: ok`：
  1. 真实仓库：`findOrphans(仓库根)` 为空，且枚举结果不含 `test/fixtures`、`test/helpers`、`test/perf` 前缀的路径。
  2. 用 `run-tests.mjs --root test/fixtures/discovery-selftest/ok --out-dir <mkdtemp>` 真跑一遍完整运行：退出 0，清单 `mode:'full'`，`files` 恰为夹具预期（见下）。
  3. 对 `drift/` 夹具验证三种清单：缺文件 → `discovery.missing`；多文件 → `discovery.unexpected`；`mode:'filtered'` 且文件列表恰好相等 → `discovery.mode_not_full`；对照的 `ok` 清单 → 通过。
  4. 对 `orphan/` 夹具：`findOrphans` 报出 `test/loose.test.mjs`。
  5. 对 `ok/` 的过滤运行：`--ac AC-001` 产生 `mode:'filtered'` 清单，且不做相等比较（`files` 只有一个文件）。

夹具 `test/fixtures/discovery-selftest/`：

- `ok/`：`test/unit/a.test.mjs`（标题含 `[AC-001]`）、`test/integration/b.test.mjs`、`test/flows/c.test.mjs`；诱饵 `test/fixtures/decoy.test.mjs`、`test/helpers/decoy.test.mjs`、`test/perf/decoy.test.mjs`，诱饵内容为 `assert.fail('decoy executed')`，任何一个被执行都会让运行失败。预期清单为 a、b、c 三个文件。
- `drift/`：一个含 `test/unit/a.test.mjs`、`test/unit/b.test.mjs` 的迷你根，外加四份清单 JSON：`manifest-ok.json`、`manifest-missing.json`（少 b）、`manifest-extra.json`（多一个 `test/fixtures/x.test.mjs`）、`manifest-filtered.json`（`mode:'filtered'`，文件集合与 ok 相同）。
- `orphan/`：含合法的 `test/unit/a.test.mjs` 与游离的 `test/loose.test.mjs`。

## 10. 自测文件与标题约定

- 所有归属 AC 的测试，标题以 `[AC-nnn]` 开头，如 `test('[AC-004] duplicate AC across shards fails', ...)`，这样 `--ac` 过滤和追踪检查才能命中。
- `test/unit/runner-selftest.test.mjs`：
  - `[AC-001]`：枚举排除规则；`verifyFullRun` 的四类错误；用夹具真跑 `ok/` 完整运行与 `--ac` 过滤运行；`check-test-discovery` 的完整自测以退出 0 收尾；`platformTest` 在条件不满足时写出合规的 `cliworker.skip/v1` 记录（用 `mkdtemp` 目录与 `CLIWORKER_RESULTS_DIR`）。
  - `[AC-002]`：在 `mkdtemp` 里复制 `scripts/ci-matrix.json` 与 `ci.yml` 后，分别篡改（改一字符、删一个 Node 版本、`perf.blocking:true`、缺 windows），`check-ci --root` 各自失败，标识对应；未篡改通过。
  - `[AC-003]`：`mkdtemp` 里放 `check-a.mjs`（退出 0 并追加日志）、`check-b.mjs`（退出 7）、`check-c.mjs`（写标记文件）、`final.mjs`（写标记文件），设置两个注入变量后 `node check-fast.mjs` 退出 7，stderr 含 `check-b.mjs`，`check-c` 与 `final` 的标记不存在；全部成功时执行顺序为 a、b、final，且目录里的 `check-fast.mjs` 副本不被执行。
  - `[AC-003]` 的 pwsh 用例用 `platformTest` 并要求 `pwsh`：经 `pwsh -NoProfile -File scripts/check-fast.ps1` 得到同样的退出码 7；同时断言 `.ps1` 的非空非注释行数 ≤ 3。
- 嵌套调用 `run-tests.mjs` 总是传 `--out-dir`；调用 `check-fast.mjs` 总是同时设置两个注入变量。
- `test/unit/traceability.test.mjs`（`[AC-004]`）：§6.4 的夹具用例、`validateIndex` 的内存变异、真实 `ac-index.json` 通过校验、`extractTitles` 对 `test.skip` 的处理。
- `test/unit/milestone-gate.test.mjs`（`[AC-074]`）：§8.4 的夹具，经 `spawnSync` 调用脚本，断言退出码与关键错误标识；`extractTitles` 对 `[fixed]` 的判定（含 `test.skip('[fixed] ...')` 不算）。

## 11. `test/characterization/defects/a3-runner.test.mjs`

- 标题为 `[repro] ...` 的测试：断言 0.1 的状态。0.1 的 `package.json` 没有 `scripts`，唯一的测试文件平铺在 `test/select.test.mjs`。由于 0.1 副本是 T-002 的产物，这里内联一个常量（0.1 的 `package.json` 里 `scripts` 缺失这一事实），不引用副本；T-002 如需改指向副本，要走蓝图协调，因为该文件不在它的 write_scope 里。
- 标题为 `[fixed] ...` 的测试（针对 live 仓库）：
  - `package.json` 的 `scripts` 含 `test`、`check`、`perf`、`snapshot:update` 四项，且 `test` 为 `node scripts/run-tests.mjs`、`check` 为 `node scripts/check-fast.mjs`。
  - `enumerateTestFiles(仓库根)` 含 `test/unit/select.test.mjs`；`findOrphans(仓库根)` 为空；`test/select.test.mjs` 不存在。
- 本文件位于 `characterization` 目录，所以会被 `npm test` 枚举到。它不带 `[AC-nnn]` 标签，也不进 T-001 分片。
- 「a3-runner 是缺陷」这一描述是根据 0.1 仓库现状推断的（没有 test 脚本、测试不在发现范围内），蓝图的缺陷账本由 T-002 落地；实现者在 impl.md 里记录这个假设。

## 12. `package.json` 的改动

只加 `scripts`，其他字段保持不变（`files` 不含 `scripts`，所以脚本不会随包发布）：

```json
"scripts": {
  "test": "node scripts/run-tests.mjs",
  "check": "node scripts/check-fast.mjs",
  "perf": "node scripts/run-tests.mjs --perf",
  "snapshot:update": "node scripts/run-tests.mjs --update-snapshots"
}
```

不添加任何 `dependencies`/`devDependencies`。

## 13. 实现顺序与风险

建议顺序：`ac-index.json` → `check-traceability` 与其夹具和测试 → `run-tests` + reporter + `platform-gate` → 迁入 select 测试 → `check-test-discovery` 与夹具 → `gen-ci`/`check-ci`/`ci.yml` → `check-defects`/`milestone-gate` 与夹具 → `check-fast` + ps1 → `package.json`/lock → `a3-runner` 测试 → `T-001.json`。

风险与留给后续任务的事项：

1. node:test reporter 的 `file` 字段在 Node 20 与 22 的事件覆盖略有差异（全部跳过的文件、空文件、加载失败的文件）。实现者必须在两个版本上验证（本机 Node 22，CI 上有 20），把观察结果写进 impl.md；若发现某类文件不产生事件，只能靠调整 reporter 解决，不能放宽集合相等。
2. 命令行长度上限（§3.3 第 3 步）：目前文件很少，上限检查是兜底；若将来逼近上限，要改成分批运行并合并清单，这属于后续任务。
3. `check-fast` 会跑 `check-defects`，在 T-002 落地前账本不存在，默认模式放行（§8.2）；T-002 落地后账本缺失只在 `--milestone` 模式下才阻断，如需默认模式也阻断，由 T-002/T-030 改。
4. 本任务不改 `.gitignore`（不在 write_scope）。蓝图里 `.gitignore` 的整理由其他任务负责；本任务通过 §3.4 避免在仓库里生成产物。
5. `check-seams` 等后续检查对 `scripts/` 与 `test/helpers/` 的扫描范围由 T-003 决定；`platform-gate.mjs` 里用 `new Date().toISOString()` 记录 `at`，如果将来被纳入限制，由该任务处理。
