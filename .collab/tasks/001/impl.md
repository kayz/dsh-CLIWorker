# Task 001 实现说明（dev）

## 0. 先说一件必须由人来做的事

`design.md` §3.6 要求迁移完成后 **`test/select.test.mjs` 必须不存在**，但本次会话里 `Bash` 与 `PowerShell` 两个工具都被权限系统拒绝（非交互模式无法弹权限提示），我没有任何可用的删除文件手段（Write 只能覆盖，无法 unlink）。

因此 `test/select.test.mjs` 仍然在仓库里，需要执行一次：

```powershell
Remove-Item test/select.test.mjs
```

在删除之前，下列验收项会失败，原因都只有这一条（`findOrphans` 报 `test/loose`/`test/select.test.mjs` 为孤儿）：

- A1-08（`check-test-discovery` 完整自测）
- A3-06（`npm run check`，其中第一段 `check-test-discovery` 失败）
- T-02（`npm test` 的 `discovery.orphan`）
- 以及 `test/unit/runner-selftest.test.mjs` 与 `test/characterization/defects/a3-runner.test.mjs` 里断言 `findOrphans(ROOT) === []` 的两处

其余文件都已按 design.md 落地。我无法运行任何命令，所以下文的「自测」是给出应当执行的命令，不是我实际跑过的结果。

## 1. 改了什么

### 运行器与 reporter（AC-001）

- `scripts/run-tests.mjs`
  - `enumerateTestFiles(root)`：只遍历 `test/{unit,integration,contract,e2e,smoke,characterization,flows}`，递归收集 `*.test.mjs`，输出相对 `<root>`、`/` 分隔、码点升序、去重。
  - `findOrphans(root)`：从 `<root>/test` 顶层开始走，跳过 `fixtures`、`helpers`、`perf` 三个子树，凡是存在但不在枚举集合里的 `*.test.mjs` 都算孤儿。`test/select.test.mjs` 就是靠这条被抓住的。
  - `verifyFullRun({ enumerated, manifest })`：`discovery.mode_not_full` / `discovery.missing` / `discovery.unexpected` / `discovery.no_files` 四类错误，`mode:'filtered'` 即使集合相同也不通过。
  - CLI：`--ac`（可重复、`^AC-\d{3}$`）、`--root`、`--out-dir`、`--perf`、`--update-snapshots`；未知参数与非法 `--ac` 退出 2。
  - 完整运行先查孤儿，有孤儿直接退出 1 且不启动子进程；过滤运行按文件文本里的 `[AC-nnn]` 选文件，零命中打印 `FAIL run.no_match` 退出 1。
  - 子进程固定为 `node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=<files.mjs 的 file URL> --test-reporter-destination=<outDir>/files-executed.json <显式文件列表>`，`spawn` + 参数数组，`shell` 关闭。
  - 产物目录优先级 `--out-dir` > `CLIWORKER_RESULTS_DIR` > `os.tmpdir()/cliworker-test-results/<sha256(root) 前 12 位>`；默认不落在仓库里，所以跑 `npm test` 不会让 `V-01` 出现多余文件。
  - 嵌套保护：`CLIWORKER_RUN_ACTIVE` 已设置且解出的产物目录与 `CLIWORKER_RESULTS_DIR` 相同 → 退出 2。
  - 完整运行结束后读清单做集合相等校验，不通过时即使测试全绿也退出 1。
- `scripts/reporters/files.mjs`：消费 node:test 事件流，收集所有 `event.data.file` 为字符串的事件（含只有 skip 的文件、加载失败的文件），转成相对 `CLIWORKER_ROOT` 的 `/` 路径；结束时输出一份 `{ mode, filter, files, platform, node }`。环境变量缺失时退化为 `filtered` + `filter:null`，因此不可能顶替完整清单。

### 发现自测（AC-001）

- `scripts/check-test-discovery.mjs`：无参数跑五步自测（真实仓库孤儿与排除前缀、`ok` 夹具真跑完整运行并比对三文件、`drift` 四份清单分别验证 `missing`/`unexpected`/`mode_not_full`/通过、`orphan` 夹具、`ok` 夹具的 `--ac AC-001` 过滤运行）；`--root [--manifest]` 走单点校验。
- 夹具 `test/fixtures/discovery-selftest/`：`ok/`（三个可执行测试 + 三处 `assert.fail` 诱饵）、`drift/`（两个测试 + 四份清单）、`orphan/`（`test/loose.test.mjs`）。

### 平台门控（AC-001 的 skips.jsonl 来源）

- `test/helpers/platform-gate.mjs`：`satisfies`（win32/wsl/darwin/linux/pwsh/secret-tool/security，只在 PATH 里 `existsSync`，不起子进程）、`recordSkip`（追加 `cliworker.skip/v1` 一行，字段严格为 interfaces §15 列出的九个）、`platformTest`（条件不满足时先记录再 `t.skip`，且 `file` 用 `import.meta.url` 转相对仓库根的 `/` 路径）。

### CI 矩阵（AC-002）

- `scripts/ci-matrix.json`：3 个 OS × Node 20/22，`check_command`、`results_dir`、`artifacts`、`perf{blocking:false}`。
- `scripts/gen-ci.mjs`：`renderCi(matrix)` 纯函数拼 YAML（零依赖、确定性、LF、末尾换行）；CLI 支持 `--root`、`--stdout`，默认写 `.github/workflows/ci.yml`。
- `scripts/check-ci.mjs`：按 `ci.matrix_invalid` → `ci.missing` → `ci.stale` → `ci.perf_blocking` 的顺序检查，`stale` 是逐字节比较。
- `.github/workflows/ci.yml`：由 `renderCi` 的输出手写落地，内容与生成器一一对应（6 个矩阵格、每格 `npm ci` + `npm run check` + `actions/upload-artifact@v4` 上传两个产物、`if: always()`、按 OS 与 Node 命名；`perf` 作业独立、`continue-on-error: true`、没有任何 `needs:`）。

### 追踪（AC-004）

- `contracts/spec/ac-index.json`：74 条，键顺序 `ac,owner,milestone,levels,baseline`，owner/milestone 取自任务图，baseline 默认三平台，例外 AC-027→win32、AC-033→linux、AC-038→real-smoke、AC-069→linux。
- `scripts/check-traceability.mjs`：导出 `validateIndex`、`mergeShards`、`extractTitles`；CLI 支持 `--root`、`--index`、`--task-graph`、`--json`。脚本里没有任何 `.collab` 字面量（任务图路径只来自参数），满足 A4-08。
- `test/traceability/T-001.json`：AC-001/002/003 → `runner-selftest`，AC-004 → `traceability`，AC-074 → `milestone-gate`，全部 `covered`，不声明 baseline。
- 夹具 `test/fixtures/traceability/`：共用一份 74 条合法索引 `ac-index.json`，另有 `ok/`、`duplicate/`、`not-owner/`、`missing-file/`、`missing-title/`（同时含 `test.skip('[AC-001] …')` 证明 skip 不算）、`baseline-in-shard/`。

### 门禁与缺陷（AC-074）

- `scripts/check-defects.mjs`：导出 `checkDefects({root,index,milestone})`、`milestoneRank`、`hasFixedSection`。默认模式用 `mergeShards` 的 covered 状态决定哪些缺陷必须有 `[fixed]`（不会提前误报）；`--milestone Mx` 按 `owner_milestone <= Mx` 要求；M5 额外校验 11 个 id 集合。
- `scripts/milestone-gate.mjs`：`--milestone` 必填（缺失或非法退出 2），依次做索引/分片、`gate.ac_not_covered`、`checkDefects` 严格模式，前三步干净才在 `mkdtemp` 目录上跑完整 `run-tests`，再校验 `mode==='full'` 与 covered 文件确实被执行（`gate.file_not_executed`）。
- 夹具 `test/fixtures/milestone-gate/m2-planned`、`m4-nocache`：自带迷你索引、分片、可执行测试、缺陷账本与缺陷文件。

### check-fast（AC-003）

- `scripts/check-fast.mjs`：`<dir>` 下 `^check-.*\.mjs$`（排除自身）码点升序，最后一步用 `process.execPath <dir>/run-tests.mjs`；每步 `fs.writeSync(1, '==> …')` 保证与子进程输出有序；失败立即停止并 `check-fast: FAILED step <名称> (exit <码>)`，以该码退出，信号/null 记 1；`CLIWORKER_TEST_CHECK_DIR` / `CLIWORKER_TEST_FINAL_SCRIPT` 注入时会先向 stderr 打印 `check-fast: test injection active`。
- `scripts/check-fast.ps1`：只有两行实质内容（`& node …@args` + `exit $LASTEXITCODE`）。

### 其它

- `package.json`：只加 `scripts`（`test`/`check`/`perf`/`snapshot:update`），无任何依赖字段。
- `package-lock.json`：`lockfileVersion: 3`，`packages` 只有根包 `""`。
- `test/unit/select.test.mjs`：由 `test/select.test.mjs` 逐字迁入，仅把两个相对导入改成 `../../lib/…`。
- `test/characterization/defects/a3-runner.test.mjs`：`[repro]` 用内联常量表达 0.1 的形态（无 scripts、测试平铺在 `test/select.test.mjs`），`[fixed]` 断言 live 仓库的四个脚本、`test/unit/select.test.mjs` 在枚举内、孤儿为空、`test/select.test.mjs` 不存在。
- 自测：`test/unit/runner-selftest.test.mjs`（AC-001/002/003）、`test/unit/traceability.test.mjs`（AC-004）、`test/unit/milestone-gate.test.mjs`（AC-074）。嵌套调用 `run-tests` 一律传 `--out-dir`，调用 `check-fast` 一律同时设置两个注入变量（避免 check-fast → npm test → 自测 → check-fast 的无限递归）。

## 2. 为什么这样实现

- **产物不落仓库**：`.gitignore` 不在 write_scope，改用 `os.tmpdir()` + `CLIWORKER_RESULTS_DIR` 覆盖，这样 `npm test` 之后 `V-01`/`T-03` 仍然干净；CI 通过 workflow 的 `env.CLIWORKER_RESULTS_DIR` 指到 `${{ github.workspace }}/test-results` 供上传步骤读取。
- **显式文件列表**：把「我们枚举的」和「node 实际跑的」做成两个独立集合，`verifyFullRun` 才有意义；`mode` 参与比较，过滤清单无法冒充完整清单。
- **纯函数生成 CI**：零第三方依赖的约束下不引 YAML 库，`renderCi` 确定性输出，`check-ci` 用逐字节比较识别手改（多一个字符、多一个尾随空格、CRLF 都会被抓到）。
- **门禁复用同一套合并逻辑**：`milestone-gate` 与 `check-defects` 都 import `check-traceability` 的 `mergeShards`，避免两份判定漂移；`mergeShards` 的返回结构保持 design 定义的 `{ errors, acs }`，covered 文件清单在 gate 内部单独收集，不扩充约定。
- **`fs.writeSync` 打印步骤横幅**：`spawnSync(..., {stdio:'inherit'})` 下如果先 `console.log`，父进程的缓冲可能与子进程输出交错，A3-06 要求「`==> check-x.mjs` 之后才是 `==> npm test`」，用同步写保证顺序。

## 3. 自测方式（本环境无法执行，仅列出命令）

```powershell
node scripts/check-traceability.mjs                     # 期望 ok (covered=5 planned=69)
node scripts/check-ci.mjs                               # 期望 check-ci: ok
node scripts/check-test-discovery.mjs                   # 期望 check-test-discovery: ok（需先删 test/select.test.mjs）
node scripts/run-tests.mjs --ac AC-074                  # 期望 0
node scripts/run-tests.mjs --ac AC-004                  # 期望只跑 test/unit/traceability.test.mjs
node scripts/milestone-gate.mjs --milestone M1 --root test/fixtures/milestone-gate/m2-planned
node scripts/milestone-gate.mjs --milestone M2 --root test/fixtures/milestone-gate/m2-planned
node scripts/check-defects.mjs --root test/fixtures/milestone-gate/m4-nocache
npm test
npm run check
```

逐条对应：AC-004 → A4-01/02/03/04/05/06/07；AC-002 → A2-01..04；AC-001 → A1-01..13；AC-074 → A74-01..08；AC-003 → A3-01..06。

## 4. 设计未写死、由我判断的地方

1. **`files-executed.json` 的 `filter` 在完整运行是空字符串**：A1-02 期望 `full||true|…`，所以完整运行写 `''`（不是 `null`）；`null` 只在环境变量完全缺失时出现。为防 Windows 丢弃空环境变量，reporter 在 `mode==='full'` 且变量缺失时也回落到 `''`。
2. **`a3-runner` 是缺陷**：按 design §11 的说明，这是从 0.1 现状推断出来的（没有 test 脚本、测试不在发现范围内）。缺陷账本由 T-002 落地，本任务只写 `[repro]`/`[fixed]` 两侧内容。
3. **`validateIndex` 的 `index.count` 也管乱序**：design 写「缺、多、重复、乱序都算」，所以按位置逐条比对 AC-001..AC-074，而不是只比集合。
4. **`--task-graph` 的 `graph.mismatch` 判定**：owner 取「在 `acceptance` 里列了该 AC 的那个任务」，milestone 取该任务的 `milestone`，levels 取 `acceptance[].levels`，三者分别比对（levels 按集合）。
5. **`check-defects` 读到非法 JSON** 归 `defects.schema`，文件不存在才归 `defects.file_missing`（后者只在 `--milestone` 模式下是错误，与 §8.2 一致）。
6. **门禁的 covered 文件清单**在 `milestone-gate.mjs` 内部单独扫描分片，避免为 `mergeShards` 增加 design 未声明的返回字段。

## 5. 风险与未验证项

- **Node 20 vs 22 的 reporter 事件差异（design §13 风险 1）**：本环境不能执行 Node，我按要求实现了「收集所有 `data.file` 为字符串的事件」并兼容 `file:` URL，但没有实测「只有 skip 的文件」「空测试文件」「加载失败的文件」在两个版本上是否都产生事件。按 design，空测试文件不产生事件会被判 `discovery.missing`，这是期望行为；需要实现者在 Node 20 与 22 上各跑一次 `npm test` 确认并把观察结果补到这里。
- **命令行长度**：仅在 `files` 拼接后超过 24000 字符时退出 2 大声失败，未实现分批，符合 design 把分批留给后续任务。
- **`test/select.test.mjs` 未删除**（见 §0），这是当前唯一阻塞验收的动作。
