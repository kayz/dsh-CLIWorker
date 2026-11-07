# Task 001 实现说明（dev）

## 0. 本轮结论与唯一阻塞

按 `design.md` 落地的文件在当前工作树里已经齐备（见 §1）。本轮我把它们逐份对照 `design.md` 与 `acceptance.md` 做了静态复核，**没有发现需要改动的代码**，因此没有重写实现，只补充了本说明。

**唯一未完成的动作：删除 `test/select.test.mjs`。** `design.md` §3.6 要求迁移完成后该路径必须不存在，`acceptance.md` V-05 断言 `Test-Path test/select.test.mjs` 为 `False`，`a3-runner` 的 `[fixed]` 也断言它不存在。

本会话的沙箱只放行读操作（`Read` / `Grep` / 只读 PowerShell），`Bash` 整体被拒绝，`PowerShell` 的 `Remove-Item` 与 `Move-Item` 在非交互模式下无法获得授权提示而被拒绝，`Write` 只能覆盖不能 unlink，也没有其它可用的删除工具。前一轮 dev 遇到的是同一阻塞。

请在仓库根执行一次（只需一次，之后所有验收项即可通过）：

```powershell
Remove-Item test/select.test.mjs
```

在删除之前，下列验收项必然失败，原因都只有这一条（`test/select.test.mjs` 被 `findOrphans` 判为 `discovery.orphan`）：

- A1-08（`check-test-discovery` 完整自测第一段）
- A3-06（`npm run check` 的首个失败步骤是 `check-test-discovery.mjs`）
- T-02 / T-03（`npm test` 以 1 退出，且 `a3-runner` 的 `[fixed]` 断言 `findOrphans(ROOT)` 为空失败）
- `test/unit/runner-selftest.test.mjs` 中 `[AC-001] enumeration ...` 与 `[AC-001] the discovery self-test ...` 两处
- V-05

其余验收命令在删除后应当全部通过。我无法执行 Node（见 §4），所以上面的判断来自逐行静态核对，不是实测。

## 1. 交付物与实现要点

### 运行器与 reporter（AC-001）

- `scripts/run-tests.mjs`
  - `enumerateTestFiles(root)`：只遍历 `test/{unit,integration,contract,e2e,smoke,characterization,flows}`，递归收 `*.test.mjs`，输出相对 `<root>`、`/` 分隔、码点升序、去重。
  - `findOrphans(root)`：从 `<root>/test` 顶层递归，跳过 `fixtures`、`helpers`、`perf` 三个子树，凡存在但不在枚举集合里的 `*.test.mjs` 都是孤儿。`test/select.test.mjs` 正是靠这条被抓住。
  - `verifyFullRun({ enumerated, manifest })`：`discovery.mode_not_full` / `discovery.missing` / `discovery.unexpected` / `discovery.no_files`，`mode:'filtered'` 即使文件集合相同也不通过。
  - CLI：`--ac`（可重复，`^AC-\d{3}$`）、`--root`、`--out-dir`、`--perf`、`--update-snapshots`；未知参数与非法 `--ac` 退出 2。
  - 完整运行先查孤儿，有孤儿直接 `FAIL discovery.orphan <path>` 退出 1 且不启动子进程；过滤运行按文件文本中的 `[AC-nnn]` 选文件（多个取并集），零命中打印 `FAIL run.no_match <AC>` 退出 1。
  - 子进程固定为 `node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=<files.mjs 的 file URL> --test-reporter-destination=<outDir>/files-executed.json <显式文件列表>`，`spawn` + 参数数组、`shell` 关闭；文件列表拼接超过 24000 字符退出 2。
  - 产物目录优先级 `--out-dir` > `CLIWORKER_RESULTS_DIR` > `os.tmpdir()/cliworker-test-results/<sha256(root) 前 12 位>`，默认不落在仓库里，所以 `npm test` 不会让 V-01/T-03 出现多余文件。
  - 嵌套保护：`CLIWORKER_RUN_ACTIVE` 已设置且解出的产物目录等于环境里的 `CLIWORKER_RESULTS_DIR` 时退出 2。
  - 完整运行结束后读清单做集合相等校验，校验失败时即使测试全绿也退出 1；最后一行固定为 `run-tests: <full|filtered> <n> files, manifest <path>`。
- `scripts/reporters/files.mjs`：消费 node:test 事件流，收集所有 `event.data.file` 为字符串的事件（含只有 skip 的文件、加载失败的文件；兼容 `file:` URL），转成相对 `CLIWORKER_ROOT` 的 `/` 路径后去重排序；流结束 yield 一次 `{ mode, filter, files, platform, node }`。环境变量缺失时退化为 `filtered` + `filter:null`，不可能顶替完整清单。

### 发现自测（AC-001）

- `scripts/check-test-discovery.mjs`：无参数跑五步自测（真实仓库的孤儿与排除前缀、`ok` 夹具真跑完整运行并比对三个文件、`drift` 四份清单分别验证 `missing`/`unexpected`/`mode_not_full`/通过、`orphan` 夹具、`ok` 夹具的 `--ac AC-001` 过滤运行不做相等比较）；`--root [--manifest]` 走单点校验。
- 夹具：`ok/`（三个可执行测试 + 三处 `assert.fail('decoy executed')` 诱饵）、`drift/`（两个测试 + 四份清单）、`orphan/`（`test/loose.test.mjs`）。

### 平台门控（AC-001 的 skips.jsonl 来源）

- `test/helpers/platform-gate.mjs`：`satisfies`（`win32|wsl|darwin|linux|pwsh|secret-tool|security`；可执行文件只在 `PATH` 各目录里 `existsSync`，win32 叠加 `PATHEXT`，不起子进程）、`recordSkip`（`CLIWORKER_RESULTS_DIR` 存在时追加一行 `cliworker.skip/v1`，字段九个：`schema,test,file,ac,requires,platform,node,reason,at`）、`platformTest`（条件不满足先记录再 `t.skip(reason)`，`file` 由 `import.meta.url` 转相对仓库根路径）。

### CI 矩阵（AC-002）

- `scripts/ci-matrix.json`：3 OS × Node 20/22，`check_command`、`results_dir`、`artifacts`、`perf{blocking:false}`。
- `scripts/gen-ci.mjs`：`renderCi(matrix)` 纯函数拼 YAML（零依赖、确定性、LF、末尾换行），CLI 支持 `--root`、`--stdout`，默认写 `.github/workflows/ci.yml`。
- `scripts/check-ci.mjs`：按 `ci.matrix_invalid` → `ci.missing` → `ci.stale`（逐字节）→ `ci.perf_blocking` 依次检查。
- `.github/workflows/ci.yml`：6 个矩阵格；每格 checkout、setup-node、`npm ci`、`npm run check`、`actions/upload-artifact@v4`（`if: always()`、按 OS 与 Node 命名、上传两个产物、`if-no-files-found: warn`）；`perf` 作业独立、`continue-on-error: true`、全文件无 `needs:`。

### 追踪（AC-004）

- `contracts/spec/ac-index.json`：74 条，键顺序 `ac,owner,milestone,levels,baseline`；owner/milestone/levels 取自任务图；baseline 默认 `["darwin","linux","win32"]`，例外 AC-027→`["win32"]`、AC-033→`["linux"]`、AC-038→`["real-smoke"]`、AC-069→`["linux"]`。
- `scripts/check-traceability.mjs`：导出 `validateIndex`、`mergeShards`、`extractTitles`；CLI 支持 `--root`、`--index`、`--task-graph`、`--json`；脚本内无 `.collab` 字面量（任务图只经参数传入）。
- `test/traceability/T-001.json`：AC-001/002/003 → `runner-selftest`，AC-004 → `traceability`，AC-074 → `milestone-gate`，全部 `covered`，不声明 baseline。
- 夹具 `test/fixtures/traceability/`：共用一份与真实索引逐字节相同的 74 条索引，另有 `ok/`、`duplicate/`、`not-owner/`、`missing-file/`、`missing-title/`（含 `test.skip('[AC-001] …')`）、`baseline-in-shard/`。

### 门禁与缺陷（AC-074）

- `scripts/check-defects.mjs`：导出 `checkDefects({root,index,milestone})`、`milestoneRank`、`hasFixedSection`。默认模式只对「`ac` 在属主分片里已 covered」的缺陷要求 `[fixed]`（不提前误报）；`--milestone Mx` 按 `owner_milestone <= Mx` 要求；`M5` 额外校验 11 个 id 集合；账本缺失只在 `--milestone` 模式下算错误。
- `scripts/milestone-gate.mjs`：`--milestone` 必填（缺失或非法退出 2）；`mergeShards` 错误转 `gate.trace_error`；`gate.ac_not_covered`；`checkDefects` 严格模式；前三步干净才在 `mkdtemp` 目录跑嵌套完整 `run-tests`，再校验 `mode==='full'` 与 covered 文件确实被执行（`gate.file_not_executed`），目录用完即删。
- 夹具 `test/fixtures/milestone-gate/m2-planned`、`m4-nocache`：自带迷你索引、分片、可执行测试、缺陷账本与缺陷文件。

### check-fast（AC-003）

- `scripts/check-fast.mjs`：`<dir>` 下 `^check-.*\.mjs$`（排除自身）码点升序，最后一步为 `process.execPath <dir>/run-tests.mjs`；步骤横幅用 `fs.writeSync(1, …)` 同步写，避免与 `stdio:'inherit'` 的子进程输出交错；失败立即停止并打印 `check-fast: FAILED step <名称> (exit <码>)`，以该码退出（信号或 `null` 记 1）；`CLIWORKER_TEST_CHECK_DIR` / `CLIWORKER_TEST_FINAL_SCRIPT` 任一被使用时先向 stderr 打印 `check-fast: test injection active`。
- `scripts/check-fast.ps1`：两行 `< node (Join-Path $PSScriptRoot 'check-fast.mjs') @args` + `exit $LASTEXITCODE`。

### 其它

- `package.json`：只加 `scripts`（`test`/`check`/`perf`/`snapshot:update`），无任何依赖字段。
- `package-lock.json`：`lockfileVersion: 3`，`packages` 只有根包 `""`。
- `test/unit/select.test.mjs`：由旧的 `test/select.test.mjs` 迁入，只改两个相对导入为 `../../lib/…`（已用 `Compare-Object` 确认差异仅这两行）。
- `test/characterization/defects/a3-runner.test.mjs`：`[repro]` 用内联常量表达 0.1 的形态（无 scripts、测试平铺在 `test/select.test.mjs`）；`[fixed]` 断言 live 仓库四个脚本、`test/unit/select.test.mjs` 在枚举内、孤儿为空、`test/select.test.mjs` 不存在。
- 自测：`test/unit/runner-selftest.test.mjs`（AC-001/002/003）、`test/unit/traceability.test.mjs`（AC-004）、`test/unit/milestone-gate.test.mjs`（AC-074）。嵌套调用 `run-tests` 一律传 `--out-dir`；调用 `check-fast` 一律同时设置两个注入变量，避免 check-fast → npm test → 自测 → check-fast 的无限递归。

## 2. 为什么这样实现

- **产物不落仓库**：`.gitignore` 不在 write_scope，改用 `os.tmpdir()` + `CLIWORKER_RESULTS_DIR` 覆盖，这样 `npm test` 之后 V-01/T-03 仍然干净；CI 用 workflow 的 `env.CLIWORKER_RESULTS_DIR` 指到 `${{ github.workspace }}/test-results`，上传步骤读同一目录。
- **显式文件列表**：把「我们枚举的」与「node 实际跑的」做成两个独立集合，`verifyFullRun` 才有意义；`mode` 参与比较，过滤清单无法冒充完整清单。
- **纯函数生成 CI**：零第三方依赖下不引 YAML 库，`renderCi` 确定性输出，`check-ci` 用逐字节比较识别手改（改一个字符、多一个尾随空格、CRLF 都会被抓到）。
- **门禁复用同一套合并逻辑**：`milestone-gate` 与 `check-defects` 都 import `check-traceability` 的 `mergeShards`，避免两份判定漂移；`mergeShards` 的返回结构保持 design 定义的 `{ errors, acs }`，covered 文件清单在 gate 内部单独收集，不扩充约定。
- **同步写横幅**：`spawnSync(..., {stdio:'inherit'})` 下若先 `console.log`，父进程缓冲可能与子进程输出交错；A3-06 要求横幅顺序确定，所以用 `fs.writeSync`。

## 3. 本轮做过的静态核对

因为无法执行 Node，我把能静态验证的都核对了：

1. `contracts/spec/ac-index.json` 74 条，AC 编号顺序、owner/milestone 与 design §6.1 数据表逐条一致；四个 baseline 例外取值正确；`AC-008` 为 `contract,integration`、`AC-038` 为 `smoke`、`AC-074` 为 `T-001/M1`。
2. 抽查任务图 `.collab/blueprint/cliworker-v2/task-graph.json`（在本工作树内）：顶层确有 `acceptance[].levels`、`tasks[].acceptance`、`tasks[].milestone`；T-001 的 acceptance 为 AC-001/002/003/004/074，T-003 为 AC-006/007/008/072，T-004 含 AC-073，T-029 为 AC-038/069 且 milestone 为 M5；抽查的 AC-008/012/038/053/066/073 的 levels 与索引一致。所以 `check-traceability --task-graph` 不会误报 `graph.mismatch`。
3. `test/fixtures/traceability/ac-index.json` 与真实索引逐字节相同（`Compare-Object` 差异为 0），因此夹具用例不会额外触发 `index.*`，A4-06 的 `False|shard.duplicate,shard.not_owner` 成立。
4. 六个分片夹具的期望错误互不污染：`duplicate` 只产生 duplicate+not_owner；`not-owner` 只产生 not_owner；`missing-file` 的 `test/unit/absent.test.mjs` 确实不存在；`missing-title` 的标题只有 `[AC-002]` 的 plain 与 `[AC-001]` 的 `test.skip`；`baseline-in-shard` 的 baseline 在条目里。
5. `test/fixtures/milestone-gate/*` 的两套迷你工程：分片、缺陷账本、缺陷文件与可执行测试互相自洽（`m2-planned` 的 AC-026 为 planned、a5-shell 只有 `[repro]`；`m4-nocache` 的 AC-043/AC-055 都 covered、a5-nocache 只有 `[repro]`），嵌套完整运行只会在夹具根上进行，不会递归回本仓库。
6. `scripts/`、`test/helpers/platform-gate.mjs`、`test/unit/*.test.mjs` 中不含 `.collab` 字面量（A4-08 期望 0）。
7. 全部新增/修改的 `.mjs/.json/.ps1/.yml` 不含 CR（用 `\r` 检索，命中列表里没有本任务的任何交付文件）；文本均以 LF 结尾。
8. `scripts/check-fast.ps1` 的非空非注释行为 2 行（A3-05 要求 ≤ 3）。
9. `.github/workflows/ci.yml` 与 `scripts/gen-ci.mjs` 的 `renderCi` 输出逐行比对：6 个矩阵格顺序（ubuntu→windows→macos，各 20→22）、`env`、5 个步骤、上传路径两行、`perf` 作业的 5 行完全一致，无 `needs:`。
10. 运行器/门禁的路径与退出码逐条对照 `acceptance.md` 的期望值（A1-01…A1-13、A2-01…A2-04、A3-01…A3-06、A4-01…A4-08、A74-01…A74-08）。

## 4. 自测方式（本环境不能执行，列出应跑的序列）

```powershell
node scripts/check-traceability.mjs                     # 期望 0，末行 check-traceability: ok (covered=5 planned=69)
node scripts/check-traceability.mjs --task-graph .collab/blueprint/cliworker-v2/task-graph.json  # 期望 0
node scripts/check-ci.mjs                               # 期望 check-ci: ok
node scripts/run-tests.mjs --ac AC-004                  # 期望只跑 test/unit/traceability.test.mjs
node scripts/run-tests.mjs --ac AC-074                  # 期望 0，只跑 test/unit/milestone-gate.test.mjs
node scripts/check-test-discovery.mjs                   # 期望 check-test-discovery: ok（需先删 test/select.test.mjs）
node scripts/milestone-gate.mjs --milestone M1 --root test/fixtures/milestone-gate/m2-planned   # PASS
node scripts/milestone-gate.mjs --milestone M2 --root test/fixtures/milestone-gate/m2-planned   # BLOCKED
node scripts/milestone-gate.mjs --milestone M3 --root test/fixtures/milestone-gate/m4-nocache   # PASS
node scripts/milestone-gate.mjs --milestone M4 --root test/fixtures/milestone-gate/m4-nocache   # BLOCKED
node scripts/check-defects.mjs --root test/fixtures/milestone-gate/m2-planned                    # 0
node scripts/check-defects.mjs --root test/fixtures/milestone-gate/m4-nocache                   # 1
npm test
npm run check
npm run perf                                            # no perf tests, 0
```

`acceptance.md` §0 的 `Run`/`NewTmp` 辅助函数与 §1–§7 的命令按顺序执行即为完整回归；唯一需要人工补的动作是 §0 中已说明的 `Remove-Item test/select.test.mjs`。

## 5. 已知偏差与风险

1. **`test/select.test.mjs` 未删除**（§0），这是当前唯一阻塞验收的动作。
2. **`# fail 0` 与 spec reporter**：`acceptance.md` T-02 用 `# fail 0` 描述失败计数，但 `design.md` §3.3 明确要求 stdout 用 `--test-reporter=spec`，该 reporter 的汇总行是 `ℹ fail 0`（不是 TAP 的 `# fail 0`）。实现按 design 保留 spec；若验收要求输出里必须出现字面量 `# fail 0`，需要改 design 的 reporter 约定，不能只改实现。
3. **Node 20 vs 22 的 reporter 事件差异（design §13 风险 1）**：实现收集所有 `data.file` 为字符串的事件并兼容 `file:` URL，但没有实测「只有 skip 的文件」「空测试文件」「加载失败的文件」在两个版本上的事件覆盖。按 design，空测试文件不产生事件会被判 `discovery.missing`，这是期望行为；建议在 Node 20 与 22 上各跑一次 `npm test` 并把观察结果补到本节。
4. **命令行长度**：仅在文件列表超过 24000 字符时退出 2 大声失败，未实现分批（设计把分批留给后续任务）。
5. **`a3-runner` 是缺陷**：按 design §11，这是从 0.1 现状推断的（没有 test 脚本、测试不在发现范围内）；缺陷账本由 T-002 落地，本任务只写 `[repro]`/`[fixed]` 两侧内容。
