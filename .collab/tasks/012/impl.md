# T-012 实现说明

对应 AC-031（M2，levels: integration, unit）。以下只涉及 write_scope 内的文件，未改动 `lib/`、`scripts/`、`bin/`、`contracts/`。

## 新增文件与改动

### `test/helpers/leak-scan.mjs`（新增）

字节级哨兵扫描器，纯函数、零第三方依赖、只用 `node:*`。

- `MIN_SENTINEL_LENGTH = 16`；`makeSentinel(label)` 校验 `^[A-Za-z0-9]+$` 后返回 `cwsentinel_<label>_<24 hex>`。
- `normalizeSentinels` 支持字符串（自动 `S1…Sn`）与 `{label,value}`，拒绝短值、重复 label、空列表。
- 四种编码（`raw` / `utf16le` / `base64` / `hex`）用 `Buffer.indexOf` 匹配，返回 `{label, encoding, offset}`。
- `leakScan` 覆盖 stdout、stderr、argv、http（body/url/headers）、state_dir（递归、跳过符号链接、文件名命中报 `#name`）与 audit（逐行、行内字节偏移），并给出 `scanned` 计数以证明不是空转。
- audit 文件在目录遍历中按解析后的绝对路径跳过，同一命中只以 `audit` 面报告一次。
- 返回结构中只有 label 与位置，不携带哨兵值（文件名命中除外——位置本身必须包含文件名，见 design §1.3 表）。

### `test/helpers/flow.mjs`（新增）

共享全流程 harness。

- `discoverSteps` 动态 import `test/flows/steps/*.mjs`（忽略 `.test.mjs`），校验 `name` / `introduced_by` / `ac` / `run` 契约与重名，按 `STEP_ORDER` 排序，未知名字排最后按码点升序。
- `createFlow` 在 `os.tmpdir()` 下建 root，写入 `config.json`、`home/`、`fake-cli/fake-cli.mjs`；`state/` 不预创建；env 删除 `NODE_TEST_CONTEXT` 与全部 `CLIWORKER_*`，只经 env 传入哨兵。
- `flow.spawn` / `flow.run` 记录 argv 与 stdout/stderr；`flow.recordHttp` 预留 http 面；`flow.scan` 调用 `leakScan`；`flow.cleanup` 幂等删除 root。
- `runFlow` 单步失败不短路，错误消息按 label 脱敏（`<FLOW>`），最后统一扫描。

### `test/flows/steps/doctor.mjs`、`test/flows/steps/select.mjs`（新增，最小版）

- doctor：用现有 `paths` 与 `providers` 命令验证路径解析与 fixture provider 可调用（`1.2.3`）。
- select：`models select --level Quick` 返回恰好一个模型 `q`。
- 均不把哨兵放进 argv，也不写 state_dir。

### 测试（新增）

- `test/unit/leak-scan-canary.test.mjs`：15 个用例，逐面植入哨兵（stdout、stderr、state_dir 深层文件、audit 第 2 行、http body/headers/url、argv），精确断言 location 字符串；覆盖干净运行、三种编码、多哨兵、不泄露、文件名 `#name`、输入校验、缺失 state_dir。所有标题含 `[AC-031]`，且包含 design §4 要求的关键词。
- `test/flows/flow.test.mjs`：8 个用例，覆盖发现与顺序、全链（同一 state_dir、`leak.ok === true`、扫描量非零、cleanup 后 root 消失）、env 传哨兵（argv 无哨兵）、以及 5 个 self-test 夹具（stdout / state_dir / argv 泄露、抛错不短路并脱敏、非法步骤契约）。
- `test/traceability/T-012.json`：AC-031 → covered。

## 自测结果

在仓库根执行（Node 24 / win32）：

| 命令 | 结果 |
|---|---|
| `node --test test/unit/leak-scan-canary.test.mjs` | pass 15，fail 0，skipped 0，todo 0 |
| `node --test test/flows/flow.test.mjs` | pass 8，fail 0，skipped 0，todo 0 |
| `node scripts/run-tests.mjs --ac AC-031` | 退出码 0，`run-tests: filtered 2 files`，23 个用例全通过 |
| `--test-name-pattern="stdout/stderr/state_dir/audit/http/argv/clean"` | 每条 `# fail 0`，`# pass ≥ 1` |
| `--test-name-pattern="discover/full flow/env/self-test"`（flow 文件） | `# fail 0`，`# pass ≥ 1` |
| `--test-name-pattern="not leak"`、`"input"`（unit 文件） | `# fail 0`，`# pass 1` |
| `node scripts/check-traceability.mjs` | ok（covered=32 planned=42） |
| `node scripts/check-test-discovery.mjs` | ok |
| `node scripts/check-unused.mjs` | ok（files=28） |
| `node scripts/check-write-scope.mjs --base 682a62e --scope-from .collab/tasks/012/design.md --scope ".collab/**"` | `check-write-scope: ok` |

`git grep --no-index` 等价检查：新增文件不含 `lib/` import、不含裸模块名/`require(`、不含硬编码哨兵值。

## 已知阻塞（与本任务改动无关，且不在 write_scope 内）

当前分支基线上有 3 个既有用例失败，导致 `node scripts/run-tests.mjs`（A4）与 `scripts/check-fast.ps1`（F1）无法全绿；本次只新增文件，未触碰下列文件或其依赖：

1. `test/contract/spec-tracked.test.mjs` [AC-073]：`check-no-collab` 报告 `test/unit/gitignore.test.mjs:13`、`:18` 含 `.collab` 字面量。
2. `test/unit/gitignore.test.mjs` [AC-013]：`.gitignore` 只有 `.collab/worktrees/` 等规则，`git check-ignore .collab/x` 返回 1，用例期望 0 且命中 `.collab/`。
3. `test/unit/import-safe.test.mjs` [AC-006]：`main(['providers','--config','/missing/config.json'])` 实际退出码 3，用例期望 1。

`run-tests` 其余部分通过：`full 49 files`（基线 47 + 本任务 2 个测试文件），仅上述 3 个文件失败；本任务相关的 `test/unit/leak-scan-canary.test.mjs` 与 `test/flows/flow.test.mjs` 在完整运行中全部通过。
