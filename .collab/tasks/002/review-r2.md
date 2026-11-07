# Task 002 评审（r2）

结论：**pass**。核验 Git SHA：`2865dd5aae6316b82425fe2280e957f11b12c4ed`。`acceptance.md` 的 25 条编号用例 **25/25 通过**（`ci-results.json:2-7`：passed=25, total=25, ok=true, ranAt=2026-11-08T01:19:26+08:00）。r1 唯一的 P1 已修复，没有新增 finding。

## 1. 证据口径

- SHA（只读）：worktree 的 `.git` 指向 `C:/git/dsh-CLIWorker/.git/worktrees/002`，其 `HEAD` 为 `ref: refs/heads/task/002`；`.git/refs/heads/task/002` 为 `2865dd5aae6316b82425fe2280e957f11b12c4ed`，与会话开头 git log 首行 `2865dd5 fix(dev-r2): address review findings (task 002)` 一致。未执行 git 命令。
- 执行类用例直接引用 `.collab/tasks/002/ci-results.json`（25 条全部 `passed=true`、`exitCode=0`、`lastLine='<id> OK'`），没有自行重跑。该文件的 ranAt 晚于 r1 的 ci-results，也晚于 `2865dd5`。
- **E2 的 CI 输出仍有同样的噪声**：`ci-results.json:205` 里第二段（`git status` 写域检查）的 `node -e` 引号在 PowerShell 里被破坏，脚本仍打印 `E2 OK`。这与 r1 相同，是验收命令本身的问题，不是实现问题。第一段（`git diff main...HEAD`）成功，否则会 `throw`。第二段只读核验：会话开头 `git status` 只有 `.collab/tasks/002/` 下的文件（`ci-results.json`、`run.json`、`state.json`、`live.json`、`logs/review-r2-1.log`），都在范围内。r2 的两处改动（`scripts/check-defects.mjs`、`test/unit/frozen-files.test.mjs`）已在 `2865dd5` 提交，也在 write_scope 内。这不与代码矛盾，所以不据此判 needs_revision。

## 2. r1 P1 的修复核验

r1 finding：严格模式下 `defects.json` 缺失会静默通过。

- `scripts/check-defects.mjs:467-468`：`strictMode = strict || !rootGiven`，不带 `--root`（`check-fast` 的调用方式）总是严格。
- `scripts/check-defects.mjs:482-485`：`strictMode && absent` 时追加 `{ id: 'defects.file_missing', detail: 'test/characterization/defects.json' }`；若 `--milestone` 已经由 `checkDefects`（`:55`）加过同 id，则不重复。
- `scripts/check-defects.mjs:502`：「nothing to check」出口收紧为 `absent && errors.length === 0 && !milestone`。严格模式缺账本时 `errors` 非空，落到 `:513-515` 的 `FAIL ... / FAILED (n errors)` 出口并以 1 退出。
- 非严格模式（带 `--root`、无 `--strict`、无 `--milestone`）仍打印 `absent` 并退出 0，T-001 夹具行为不变。`checkDefects` 的签名、返回值和 `absent` 语义没有动（`:478-480` 调用方式不变），D7 通过。
- 新用例 `test/unit/frozen-files.test.mjs:313-329`，标题 `[AC-005] defects: strict mode fails when the ledger is missing`：空临时根上 `--root <tmp> --strict` 断言退出码 1、输出含 `FAIL defects.file_missing test/characterization/defects.json`、不含 `absent`；去掉 `--strict` 断言退出码 0 且仍为 `check-defects: defects.json absent, nothing to check`，同时锁住 T-001 兼容。`finally` 里清理临时根。

结论：P1 已按 r1 建议的方案修复，真实仓库不会再因删除账本而静默跳过全部 repro 与 canary 校验。

## 3. 回归核验

- 冻结面没有被碰：r2 只改 `check-defects.mjs` 和 `frozen-files.test.mjs`，这两个文件都不在 `frozen-files.json` 的 8 条登记中，所以 A2（`check-frozen-files: ok (8 files)`）与 B2、B3 不受影响。`defects.json` 里的 `repro_sha256` 只覆盖 `defects/<id>.test.mjs` 的 `[repro]` 段，未改动。
- 新增用例在 `frozen-files.test.mjs` 内，标题带 `[AC-005]`，A1 的 21 个标题子串不变，仍会被 `--ac AC-005` 过滤选中。
- `frozen-files.test.mjs` 新增的 `node:child_process`、`node:url` 都是 `node:` 内置模块，E3 通过。
- impl.md §10.3 记录：`--ac AC-005` 32 tests / 0 fail，全量 70 tests / 0 fail，`check-fast: ok`，与 CI 结果一致。

## 4. 验收清单逐条（25 条）

| 编号 | 结论 | 证据 |
|---|---|---|
| A1 | 通过 | `ci-results.json:9-16`；新增用例标题带 `[AC-005]`，原 21 个标题不变 |
| A2 | 通过 | `ci-results.json:18-25`；r2 未动登记文件 |
| A3 | 通过 | `ci-results.json:27-34`；严格模式、账本存在，11 条 canary 全部命中 |
| A4 | 通过 | `ci-results.json:36-43` |
| A5 | 通过 | `ci-results.json:45-52`；impl.md §10.3 记录 70 tests / 0 fail |
| B1 | 通过 | `ci-results.json:54-61` |
| B2 | 通过 | `ci-results.json:63-70` |
| B3 | 通过 | `ci-results.json:72-79` |
| B4 | 通过 | `ci-results.json:81-88` |
| B5 | 通过 | `ci-results.json:90-97` |
| B6 | 通过 | `ci-results.json:99-106` |
| C1 | 通过 | `ci-results.json:108-115` |
| C2 | 通过 | `ci-results.json:117-124` |
| D1 | 通过 | `ci-results.json:126-133` |
| D2 | 通过 | `ci-results.json:135-142` |
| D3 | 通过 | `ci-results.json:144-151` |
| D4 | 通过 | `ci-results.json:153-160` |
| D5 | 通过 | `ci-results.json:162-169` |
| D6 | 通过 | `ci-results.json:171-178` |
| D7 | 通过 | `ci-results.json:180-187`；非严格 absent 路径由 `frozen-files.test.mjs:322-325` 同时锁住 |
| E1 | 通过 | `ci-results.json:189-196` |
| E2 | 通过（带说明） | `ci-results.json:198-205`；git status 段的 CI 命令引号被破坏，已按只读方式核验，见 §1 |
| E3 | 通过 | `ci-results.json:207-214` |
| F1 | 通过 | `ci-results.json:216-223` |
| F2 | 通过 | `ci-results.json:225-232` |

brief 没有指定验收报告路径，所以没有需要追加本轮结论的文档。
