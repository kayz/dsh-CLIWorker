# T-012 验收标准

对应 AC-031（owner T-012，M2，levels: integration, unit）。brief 未给基准 commit 或既有验收报告；以任务开始时的 HEAD `682a62e`（`chore(010): mark merged after human permission`）作为写入范围对比基准。

所有命令在仓库根（worktree 根）执行，shell 为 `pwsh` 或 bash 均可（命令只用 `node`/`git`，不含 shell 特有语法）。每条命令独立判定：“期望”列写明退出码与输出特征，不满足即失败。

## A. 目标测试（AC-031）

| # | 命令 | 期望 |
|---|---|---|
| A1 | `node scripts/run-tests.mjs --ac AC-031` | 退出码 0；输出含 `run-tests: filtered 2 files`；输出不含 `FAIL`；spec 报告中 `test/unit/leak-scan-canary.test.mjs` 与 `test/flows/flow.test.mjs` 的用例全部 ✔，无 skipped/todo |
| A2 | `node --test test/unit/leak-scan-canary.test.mjs` | 退出码 0；`# fail 0`、`# skipped 0`、`# todo 0`；`# pass` ≥ 9（design §4 的 9 组 canary 各至少 1 个用例） |
| A3 | `node --test test/flows/flow.test.mjs` | 退出码 0；`# fail 0`、`# skipped 0`、`# todo 0`；`# pass` ≥ 4 |
| A4 | `node scripts/run-tests.mjs` | 退出码 0；输出不含 `FAIL`（无 `discovery.orphan` / `discovery.missing` / `discovery.unexpected`）；末行形如 `run-tests: full N files`，N 比任务前多 2 |

## B. 六个面的 canary（design §1.3 / §4.1）

以下用 `--test-name-pattern` 单独判定每个面。每条：退出码 0，输出含 `# pass 1`（或更多）且 `# fail 0`。

| # | 命令 | 期望 |
|---|---|---|
| B1 | `node --test --test-name-pattern="stdout" test/unit/leak-scan-canary.test.mjs` | 退出码 0；`# fail 0`；`# pass` ≥ 1 |
| B2 | `node --test --test-name-pattern="stderr" test/unit/leak-scan-canary.test.mjs` | 同上 |
| B3 | `node --test --test-name-pattern="state_dir" test/unit/leak-scan-canary.test.mjs` | 同上（深层文件 `a/b/c/deep.bin`，location 精确断言） |
| B4 | `node --test --test-name-pattern="audit" test/unit/leak-scan-canary.test.mjs` | 同上（`audit:audit.jsonl:2@…`，且不重复报告） |
| B5 | `node --test --test-name-pattern="http" test/unit/leak-scan-canary.test.mjs` | 同上（body、headers、url） |
| B6 | `node --test --test-name-pattern="argv" test/unit/leak-scan-canary.test.mjs` | 同上（`argv[0][3]@0`） |
| B7 | `node --test --test-name-pattern="clean" test/unit/leak-scan-canary.test.mjs` | 同上（干净运行 0 命中，`scanned.files ≥ 1`、`scanned.stdout > 0`） |

> 测试标题须让上述 pattern 各至少匹配 1 个用例（标题中含对应面名称的英文词；干净用例标题含 `clean`）。pattern 匹配 0 个用例时 node 报 `# pass 0`，视为失败。

## C. 全流程框架（design §2、§3、§4 flow.test）

| # | 命令 | 期望 |
|---|---|---|
| C1 | `node --test --test-name-pattern="discover" test/flows/flow.test.mjs` | 退出码 0；`# fail 0`；`# pass` ≥ 1（自动发现 `doctor`、`select`，契约合法，顺序遵循 STEP_ORDER） |
| C2 | `node --test --test-name-pattern="full flow" test/flows/flow.test.mjs` | 退出码 0；`# fail 0`；`# pass` ≥ 1（同一临时 state_dir、同一哨兵下依次跑全部已有步骤，`leak.ok === true`） |
| C3 | `node --test --test-name-pattern="env" test/flows/flow.test.mjs` | 退出码 0；`# fail 0`；`# pass` ≥ 1（哨兵经 env 到达子进程，`captured.argv` 无哨兵） |
| C4 | `node --test --test-name-pattern="self-test" test/flows/flow.test.mjs` | 退出码 0；`# fail 0`；`# pass` ≥ 1（夹具步骤把哨兵泄到 stdout / state_dir / argv 均被 `runFlow` 报告 `ok === false`；抛错步骤不短路） |
| C5 | `node --test test/flows/flow.test.mjs`，随后 `git status --short -- test` | 两条命令退出码均为 0；`git status --short -- test` 的输出只含本任务 write_scope 内的文件（见 D1），无残留的临时文件 |

## D. 写入范围、文件存在与静态约束

| # | 命令 | 期望 |
|---|---|---|
| D1 | `node scripts/check-write-scope.mjs --base 682a62e --scope-from .collab/tasks/012/design.md --scope ".collab/**"` | 退出码 0；输出 `check-write-scope: ok`；无 `write_scope.outside` 行 |
| D2 | `git ls-files --others --exclude-standard -- test/helpers/leak-scan.mjs test/helpers/flow.mjs test/flows/flow.test.mjs test/flows/steps/select.mjs test/flows/steps/doctor.mjs test/unit/leak-scan-canary.test.mjs test/traceability/T-012.json` | 提交前：恰好输出这 7 个路径各一行（已提交后改用 `git ls-files -- <同样 7 个路径>`，同样恰好 7 行） |
| D3 | `git grep --no-index -n -E "from ['\"](\.\./)+lib/|import\(['\"](\.\./)+lib/" -- test/helpers/leak-scan.mjs test/helpers/flow.mjs test/flows/steps test/unit/leak-scan-canary.test.mjs test/flows/flow.test.mjs` | 退出码 1，无输出（本任务文件不 import `lib/` 下任何模块） |
| D4 | `git grep --no-index -n -E "from ['\"][^.n/][^'\"]*['\"]|require\(" -- test/helpers/leak-scan.mjs test/helpers/flow.mjs test/flows test/unit/leak-scan-canary.test.mjs` | 退出码 1，无输出（无第三方依赖、无 CommonJS；内置模块须带 `node:` 前缀，因此裸模块名也会命中） |
| D5 | `node scripts/check-traceability.mjs` | 退出码 0；无 `FAIL`；T-012 分片中 AC-031 为 covered，files 含 `test/unit/leak-scan-canary.test.mjs` 与 `test/flows/flow.test.mjs`，且两者标题均含 `[AC-031]` |
| D6 | `node scripts/check-test-discovery.mjs` | 退出码 0；无 `FAIL`（`test/flows/steps/*.mjs` 不被当作测试文件或 orphan） |
| D7 | `node scripts/check-unused.mjs` | 退出码 0；无 `FAIL`（本任务新增导出若被 check-unused 视为未使用，须在测试中被引用） |

## E. 不泄露（令牌不进仓库/日志/JSON）

| # | 命令 | 期望 |
|---|---|---|
| E1 | `node --test --test-name-pattern="not leak" test/unit/leak-scan-canary.test.mjs` | 退出码 0；`# fail 0`；`# pass` ≥ 1（`JSON.stringify(leakScan 结果)` 不含任何哨兵值；`hit.sentinel` 为 label） |
| E2 | `git grep --no-index -n -E "cwsentinel_[A-Za-z0-9]+_[0-9a-f]{24}" -- test` | 退出码 1，无输出（仓库中没有硬编码的哨兵值；哨兵只在运行时由 `makeSentinel` 生成） |
| E3 | `node --test --test-name-pattern="input" test/unit/leak-scan-canary.test.mjs` | 退出码 0；`# fail 0`；`# pass` ≥ 1（非法 label、<16 长度、重复 label、空列表均抛 `TypeError`） |

## F. 完成前总检

| # | 命令 | 期望 |
|---|---|---|
| F1 | `pwsh -NoProfile -File scripts/check-fast.ps1` | 退出码 0（`$LASTEXITCODE` 为 0）；输出无 `FAIL`；其中的完整 `npm test` 通过 |
