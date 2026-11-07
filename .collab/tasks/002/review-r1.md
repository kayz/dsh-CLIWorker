# Task 002 评审（r1）

结论：**needs_revision**。核验 Git SHA：`ccd916fb0ef211d53f0725b5dff0d9f9d52a22ad`。`acceptance.md` 的 25 条编号用例 **25/25 通过**（`ci-results.json:2-7`：passed=25, total=25, ok=true），另有 **1 条 P1 finding**：该问题在 acceptance 判据之外，但违反 `design.md` §5.6 与 AC-005 的「不得静默通过」。

## 1. 证据口径

- SHA（只读）：worktree 的 `.git` 指向 `C:/git/dsh-CLIWorker/.git/worktrees/002`，其 `HEAD` 为 `ref: refs/heads/task/002`；`.git/refs/heads/task/002` 为 `ccd916fb0ef211d53f0725b5dff0d9f9d52a22ad`，与会话开头 git log 首行 `ccd916f` 一致。未执行 git 命令。
- 执行类用例直接引用 `.collab/tasks/002/ci-results.json`（ranAt 2026-11-08T01:14:00+08:00，25 条全部 `passed=true`、`exitCode=0`、`lastLine='<id> OK'`），没有自行重跑。
- **E2 的 CI 输出有噪声**：`ci-results.json:205` 显示第二段（`git status` 写域检查）的 `node -e` 引号在 PowerShell 里被破坏，报「不会被识别为 cmdlet」和「不能对值为 Null 的表达式调用方法」，但脚本仍打印 `E2 OK`。第一段（`git diff main...HEAD`）成功，否则会 `throw`。第二段按只读方式独立核验：会话开头 `git status` 只有 `.collab/tasks/002/` 下的文件；`lib/*` 与 `config/cliworker.example.json` 去 CR 后与副本逐字节相同；工作树没有 `.gitattributes`。这不与代码矛盾，所以不据此判 needs_revision，只在此如实记录。

## 2. 独立核验

- **副本与冻结清单**：对 `frozen-files.json` 的 8 条登记（副本 7 个 + `stable.test.mjs`），用 CRLF→LF 口径重算 sha256，8 条全部与磁盘一致。`source_commit` 为 `f75bb76`，键仅 `files`、`source_commit`。`contracts/spec/ac-index.json` 按 design §2 没有登记。副本目录只有 `lib` 6 个 + `config` 1 个，`canary/` 下没有 `*.test.mjs`。
- **`scripts/check-frozen-files.mjs`**：`:36-55` 的 `classifyPath` 先拦反斜杠、盘符、绝对路径、`..`，再按 `lib/`、`bin/`、`config/`（大小写不敏感）报 `forbidden_path`，最后判允许集合；`:143-152` 扫描副本目录和 `stable.test.mjs` 报 `unregistered`；`:157-188` 的 CLI 输出、退出码 0/1/2 与 design §4 一致。
- **`scripts/check-defects.mjs`**：`:144-179` 的 `extractReproSection`、`reproSha256` 与 design §5.2 一致；`:316-408` 的 `checkRepros` 七类失败 id 齐全；`:272-314` 的运行方式（mkdtemp、finally 删除、删 `NODE_TEST_CONTEXT`、60s 超时、tap reporter）与 §5.6 一致；`:385-386` 基线要求退出码 0 且有 `ok [repro]`；`:401` canary 必须出现 `not ok <n> - [repro]`，导入或语法错误不算命中。`checkDefects` 的签名与返回值未变（D7）。
- **测试**：`stable.test.mjs` 6 条、`frozen-files.test.mjs` 15 条，标题与 design §3、§6 逐字一致；`stable.test.mjs:10-11` 只静态导入副本；`frozen-files.test.mjs:261-269` 用恒真 repro 直接证明 `canary_survived`，`:291-307` 证明加载失败不被计为 canary 命中。
- **账本与 canary**：`defects.json` 11 条，`owner_task`、`owner_milestone`、`ac` 与 design §5.1 表逐行一致，`repro_sha256` 均为 64 位小写十六进制；11 个 `canary.json` 的 `defect` 等于目录名。`a5-dup-call` 的 overlay 与 `lib/select.mjs` 只差 `cli: call,` 一处，是最小已修复变体。
- **追踪**：`T-002.json` 键恰为 `task`、`milestone`、`entries`，AC-005 `covered`，两个测试文件，无 `baseline`。

## 3. Findings

### P1 严格模式下缺失 `defects.json` 会静默通过

`scripts/check-defects.mjs:482`（严格分支）与 `:497-501`（absent 出口）。

design §5.6 规定：不带 `--root`（真实仓库，即 check-fast 的调用方式）必须严格，账本 id 集合必须恰好是 11 个，「真实仓库不会静默跳过」；AC-005 也要求 canary 失效时 check-defects 不得静默通过。实现里只有 `strictMode && !absent` 才进入严格检查。账本缺失时 `checkDefects` 返回 `absent: true`，随后 `:497-501` 打印 `check-defects: defects.json absent, nothing to check` 并以 0 退出。

后果：删掉 `test/characterization/defects.json`，11 条 repro 与 canary 校验全部失效，而 `check-defects` 和 `check-fast` 仍然是绿的。`defects.json` 也不在 `frozen-files.json` 的登记里。A3 判据专门检查输出不含 `absent`，说明这正是验收想挡住的情形，只是 A3 只在账本存在时运行。

建议修复（一处小改）：严格模式（不带 `--root`，或带 `--strict`）下账本缺失时追加 `{ id: 'defects.file_missing', detail: 'test/characterization/defects.json' }` 并退出 1；非严格模式（带 `--root`、无 `--strict`、无 `--milestone`）保持现有 absent 行为，T-001 夹具测试不受影响。再在 `test/unit/frozen-files.test.mjs` 补一条用例，断言 `check-defects --root <无账本的临时根> --strict` 退出 1。

## 4. 验收清单逐条（25 条）

| 编号 | 结论 | 证据 |
|---|---|---|
| A1 | 通过 | `ci-results.json:9-16`；21 个标题与 10 个 `[repro] [AC-005]` 标题均存在于源码 |
| A2 | 通过 | `ci-results.json:18-25`；独立重算 8 条哈希一致，登记数 8 ≥ 8 |
| A3 | 通过 | `ci-results.json:27-34`；但见 P1：账本缺失的严格性缺口不在该判据内 |
| A4 | 通过 | `ci-results.json:36-43`；check-fast 自动运行 `scripts/check-*.mjs` |
| A5 | 通过 | `ci-results.json:45-52`；全量 69 tests / 0 fail（impl.md §8.3） |
| B1 | 通过 | `ci-results.json:54-61`；独立确认副本与 `lib/` 去 CR 后相同 |
| B2 | 通过 | `ci-results.json:63-70`；形状独立核对一致 |
| B3 | 通过 | `ci-results.json:72-79`；`check-frozen-files.mjs:138-140` |
| B4 | 通过 | `ci-results.json:81-88`；`check-frozen-files.mjs:47-53` |
| B5 | 通过 | `ci-results.json:90-97`；`check-frozen-files.mjs:143-149` |
| B6 | 通过 | `ci-results.json:99-106`；`check-frozen-files.mjs:172-176` |
| C1 | 通过 | `ci-results.json:108-115`；`stable.test.mjs:10-11` |
| C2 | 通过 | `ci-results.json:117-124`；`stable.test.mjs:71-77` |
| D1 | 通过 | `ci-results.json:126-133`；与 design §5.1 表逐行一致 |
| D2 | 通过 | `ci-results.json:135-142` |
| D3 | 通过 | `ci-results.json:144-151` |
| D4 | 通过 | `ci-results.json:153-160`；`check-defects.mjs:352-356` |
| D5 | 通过 | `ci-results.json:162-169`；`check-defects.mjs:401-404` |
| D6 | 通过 | `ci-results.json:171-178`；`check-defects.mjs:219-232` |
| D7 | 通过 | `ci-results.json:180-187`；`checkDefects` 签名与非严格行为未变 |
| E1 | 通过 | `ci-results.json:189-196`；`T-002.json` 形状独立核对 |
| E2 | 通过（带说明） | `ci-results.json:198-205`；git status 段在 CI 中因引号问题没有真正执行，已按只读方式独立核验，见 §1 |
| E3 | 通过 | `ci-results.json:207-214`；四个文件只有 `node:` 与相对导入 |
| F1 | 通过 | `ci-results.json:216-223`；repro 自包含并经 `CLIWORKER_V01_ROOT` 动态导入副本 |
| F2 | 通过 | `ci-results.json:225-232`；canary 命中判据为 `not ok [repro]` |

brief 没有指定验收报告路径，所以没有需要追加本轮结论的文档。
