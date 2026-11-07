---
task: T-002
write_scope:
  - test/fixtures/characterization/**
  - test/characterization/stable.test.mjs
  - test/characterization/defects.json
  - test/characterization/frozen-files.json
  - test/characterization/defects/a1-quota.test.mjs
  - test/characterization/defects/a2-pack.test.mjs
  - test/characterization/defects/a4-paths.test.mjs
  - test/characterization/defects/a4-null-config.test.mjs
  - test/characterization/defects/a5-dup-call.test.mjs
  - test/characterization/defects/a5-forecast-x3.test.mjs
  - test/characterization/defects/a5-unused.test.mjs
  - test/characterization/defects/a5-shell.test.mjs
  - test/characterization/defects/a5-nocache.test.mjs
  - test/characterization/defects/a5-ignored-fields.test.mjs
  - test/unit/frozen-files.test.mjs
  - scripts/check-frozen-files.mjs
  - test/traceability/T-002.json
  - scripts/check-defects.mjs
  - test/characterization/canary/**
---

# T-002 设计：0.1 副本冻结、保留面测试、缺陷账本与 repro 档案

只对应 AC-005。规格来源：蓝图 design.md 第 5 节、interfaces.md 第 15 节、test-strategy.md「加强判据」第 2、4 条、Q-3 纪要。冻结口径以 AC-005 当前文本为准（副本 + stable.test.mjs + contracts/spec/** + contracts/golden/**），不是设计稿第 5 节那版「只冻结副本」。

## 0. 起点事实（实现者不必再核实）

- 本工作树的 `lib/`、`config/cliworker.example.json` 与提交 f75bb76 一致（f75bb76 之后只有 `package.json` 多了 scripts），可以作为副本来源，但**权威来源是 f75bb76 的 blob**，不是工作树。
- 本机 `core.autocrlf=true`：工作树文件是 CRLF，git 里是 LF，仓库没有 `.gitattributes`，且 `.gitattributes` 不在 write_scope。所以所有 sha256 一律在「CRLF 全部替换为 LF」之后计算（见 §2）。不要用 `git show` 往 PowerShell 管道里取内容，会被按文本解码。
- `contracts/spec/` 目前只有 T-001 写的 `ac-index.json`；`contracts/spec/surfaces.json`、`contracts/golden/**` 属于 T-004，本分支里还没有。因此 stable.test.mjs **不读取 surfaces.json**，保留面直接按 AC-005 括号里列出的四类写死（§3）。
- `scripts/check-defects.mjs` 已由 T-001 写好并有测试（`test/unit/milestone-gate.test.mjs`），本任务只在其上**追加**（§5），不得改变现有行为：带 `--root` 且不带 `--strict` 时，输出和退出码必须与现在完全一致。
- `scripts/run-tests.mjs --ac AC-005` 选文件的办法是：测试文件源码里含字面量 `[AC-005]` 就整文件运行。`check-traceability` 还要求分片列出的文件里至少有一个普通 `test('...[AC-005]...')` 标题。
- `check-fast.mjs` 会自动运行所有 `scripts/check-*.mjs`，所以新增的 `scripts/check-frozen-files.mjs` 无需登记就会被 check-fast 执行。
- 测试发现只收 `*.test.mjs`。`test/characterization/canary/**` 下**不得出现 `*.test.mjs`**（会被当作测试执行）。

## 1. 交付物与目录

```
test/fixtures/characterization/v0.1/
  lib/availability.mjs  lib/cli.mjs  lib/config.mjs  lib/forecast.mjs  lib/index.js  lib/select.mjs
  config/cliworker.example.json
test/characterization/
  stable.test.mjs
  frozen-files.json
  defects.json
  defects/<10 个文件>.test.mjs          （a3-runner 由 T-001 持有，不动）
  canary/<id>/canary.json               （11 个，含 a3-runner）
  canary/<id>/overlay/<相对 v0.1 根的路径>  （仅需要覆盖文件的缺陷才有）
test/unit/frozen-files.test.mjs
test/traceability/T-002.json
scripts/check-frozen-files.mjs
scripts/check-defects.mjs               （追加）
```

副本恰好 7 个文件（上面 lib 6 个 + example 1 个），不含 package.json、bin/、README。不要往副本目录里放任何别的文件（含说明文件），否则 §4 的 `frozen.unregistered` 会失败。

## 2. 副本与 frozen-files.json

**逐字节副本**：每个文件的内容 = `f75bb76` 中同路径 blob 的内容。副本里的相对路径与 f75bb76 保持一致（`lib/select.mjs` → `test/fixtures/characterization/v0.1/lib/select.mjs`）。`lib/index.js` 里 `'../lib/config.mjs'` 这类相对导入在副本目录内自然成立，不需要改。

**hash 口径**：`sha256( 文件字节中把每个 \r\n 换成 \n 之后的内容 )`，小写十六进制。这样 Windows（autocrlf）和 Linux CI 的结果相同；blob 本身是 LF，所以也等于 blob 的 sha256。

**frozen-files.json**（字段严格按 interfaces 第 15 节，不加字段）：

```json
{ "source_commit": "f75bb76",
  "files": [ { "path": "test/fixtures/characterization/v0.1/lib/select.mjs", "sha256": "<64 hex>" } ] }
```

登记内容：副本 7 个文件 + `test/characterization/stable.test.mjs` + 实现时仓库里已存在的 `contracts/spec/**`、`contracts/golden/**` 文件，**但不登记 `contracts/spec/ac-index.json`**。理由：它是 T-001 的活索引，后续新增 AC（如 AC-078）必须能改它；冻结它会让每次蓝图加 AC 都卡死 check-fast。T-004 的 `golden/manifest.json`（AC-073）另有自己的逐文件登记，所以本检查**不要求** spec/golden 下的文件必须被登记（只要求已登记的不被改动），这样 T-004 合入后不会让本检查误报。`path` 用 `/` 分隔，相对仓库根。

## 3. stable.test.mjs（保留面，只 import 副本）

- 所有 import 都指向 `../fixtures/characterization/v0.1/lib/*.mjs`（静态 import，相对路径）。不 import `lib/`、`bin/`、`scripts/`，也不 import `lib/cli.mjs`（导入即执行 main）。
- 夹具配置在测试内联：`providers: { claude: { cli: 'claude', readonly: true } }`；`status = { claude: { state: 'callable' } }`；模型形如 `{ provider: 'claude', id, level, identity: 'verified' }`。
- 标题全部为 `[AC-005] stable: ...`。必需的用例（标题前缀必须一致，下表的断言是对 0.1 实际行为的锁定）：

| 标题 | 断言 |
|---|---|
| `[AC-005] stable: deprecated models are never candidates` | `listModels(config,{status})` 不含 `deprecated:true` 的模型，`includeDeprecated:true` 时含且 `availability==='deprecated'`；`selectModels` 的 `rejected` 里该 key 的原因为 `availability:deprecated`，`models` 不含它 |
| `[AC-005] stable: unverified identity is rejected unless require_verified is false` | 模型 `identity` 非 `'verified'` 时 `rejected` 原因为 `identity_unverified`；请求带 `require_verified:false` 时该模型入选 |
| `[AC-005] stable: level filter rejects other levels` | 请求 `level:'top'`（大小写不敏感），Quick 模型被拒，原因 `level:Quick`；level 缺失时 `ok:false, reason:'E_LEVEL_REQUIRED'` |
| `[AC-005] stable: exclude wins and reports excluded` | `request.exclude:[key]` 时该 key 原因 `excluded`，且 `excluded` 先于 level 判定（一个本应 `level:` 被拒的 key 被 exclude 时原因仍是 `excluded`） |
| `[AC-005] stable: the four schema names` | `config.mjs` 的 `SCHEMA==='cliworker.config/v1'`；`select.mjs` 的 `SCHEMA==='cliworker.selection/v1'`；`listModels` 条目的 `schema==='cliworker.model/v1'`；入选 handle 的 `schema==='cliworker.handle/v1'` |
| `[AC-005] stable: imports only the v0.1 copy` | 读取自身源码，所有以 `.` 开头的 import 说明符都含 `fixtures/characterization/v0.1/` |

「四个 schema 名」在 AC-005 里没有列出具体是哪四个，这里取库模块能直接产出的四个（config、selection、model、handle）。`cli.mjs` 里的 providers/models/forecast/usage 四个名字需要执行 CLI 才能观察，不在保留面内。

## 4. scripts/check-frozen-files.mjs

用法：`node scripts/check-frozen-files.mjs [--root <dir>]`（默认仓库根）。导出 `checkFrozenFiles({ root })` 返回 `{ errors:[{id,detail}] }` 供单测直接调用。未知参数退出码 2。输出风格与 check-defects 一致：

- 通过：`check-frozen-files: ok (<N> files)`，退出码 0
- 失败：每个错误一行 `FAIL <id> <detail>`，最后 `check-frozen-files: FAILED (<n> errors)`，退出码 1

错误 id（全部要实现）：

| id | 触发 |
|---|---|
| `frozen.manifest_missing` | `test/characterization/frozen-files.json` 不存在或不是合法 JSON |
| `frozen.manifest_schema` | 缺 `files` 数组；`source_commit` 不是字符串 `f75bb76`；条目缺 `path`/`sha256` 或 sha256 不是 64 位小写十六进制；路径重复 |
| `frozen.forbidden_path` | 规范化后的路径以 `lib/`、`bin/`、`config/` 开头（大小写不敏感）。detail 为该路径 |
| `frozen.outside_allowed` | 路径不在允许集合内（含 `scripts/`、`package.json` 等）、是绝对路径、含 `..`、含反斜杠或盘符 |
| `frozen.file_missing` | 已登记文件在磁盘上不存在 |
| `frozen.hash_mismatch` | 按 §2 口径算出的 sha256 与登记值不同 |
| `frozen.unregistered` | 副本目录 `test/fixtures/characterization/v0.1/` 下有未登记的文件，或 `test/characterization/stable.test.mjs` 未登记 |

允许集合（硬编码在脚本里）：前缀 `test/fixtures/characterization/v0.1/`、精确路径 `test/characterization/stable.test.mjs`、前缀 `contracts/spec/`、前缀 `contracts/golden/`。判定顺序：先规范化（`\`→ 视为非法，`path.posix.normalize`），再判 `forbidden_path`，再判 `outside_allowed`，其余才去读文件。不调用 git，不读网络。

## 5. 缺陷账本、[repro] 段与 canary

### 5.1 defects.json

11 条，字段 `{id, owner_task, owner_milestone, ac, repro_sha256}`。`repro_sha256` 是本设计为 AC-005「每条 [repro] 段的 sha256」新增的字段，不属于 interfaces 第 15 节原文；`check-defects` 现有校验对多余字段不敏感，T-001 的夹具（不带该字段）继续有效。

| id | owner_task | owner_milestone | ac |
|---|---|---|---|
| a1-quota | T-006 | M1 | AC-015 |
| a2-pack | T-009 | M1 | AC-025 |
| a3-runner | T-001 | M1 | AC-001 |
| a4-paths | T-005 | M1 | AC-012 |
| a4-null-config | T-005 | M1 | AC-014 |
| a5-dup-call | T-007 | M1 | AC-020 |
| a5-forecast-x3 | T-007 | M1 | AC-020 |
| a5-unused | T-007 | M1 | AC-022 |
| a5-ignored-fields | T-008 | M1 | AC-024 |
| a5-shell | T-010 | M2 | AC-026 |
| a5-nocache | T-022 | M4 | AC-055 |

a1-quota 在蓝图里写成「T-006/T-007」两个属主，但校验器要求单个 `T-\d{3}`，这里取 T-006 / AC-015（draft 部分由 T-007 另补 [fixed]，不影响本账本）。数组顺序按上表。`a3-runner` 的文件由 T-001 持有、不在本任务写域，只登记它的 `repro_sha256`，不修改文件。

### 5.2 [repro] 段的格式与 sha256

为让「段」可机器识别，且后续任务在同一文件里追加 `[fixed]` 不会改动已登记的哈希，约定：

- 一个 `[repro]` 块 = 文件中**行首无缩进**、以 `test('[repro]` 或 `test("[repro]` 开头且该行以 `{` 结尾的那一行，到其后第一个行首为 `})` 的行（含）。不允许单行写法。
- 段文本 = 文件中全部 [repro] 块（按出现顺序），每块先把 CRLF 换成 LF，块之间用 `\n` 连接；`repro_sha256 = sha256(段文本的 UTF-8)`。块之外的内容（import、常量、辅助函数、`[fixed]` 块）不进哈希。
- [repro] 块与 [fixed] 块在不同的 `test()` 里，标题分别以 `[repro]`、`[fixed]` 开头（`hasFixedSection` 已按此识别）。
- 本任务写的 10 个 [repro] 标题形如 `[repro] [AC-005] <说明>`，这样 `run-tests --ac AC-005` 会直接运行它们；每个块**自包含**（需要的常量、夹具、清理都写在块里）。
- 在 `scripts/check-defects.mjs` 里导出 `extractReproSection(source)` 和 `reproSha256(source)`，实现者用它们生成登记值；同一个函数被检查使用，保证口径唯一。

### 5.3 [repro] 对副本的访问方式

所有 repro 文件在块外定义：

```js
const V01 = process.env.CLIWORKER_V01_ROOT
  ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))
```

块内用 `await import(pathToFileURL(path.join(V01, 'lib', 'select.mjs')).href)` 动态导入副本，不要静态导入、不要用 `import.meta.url` 之外的位置推断。这是 canary 能把同一个 repro 指向「已修复变体」的前提。

### 5.4 各缺陷的 [repro] 断言与 canary

repro 断言的是 **0.1 副本里缺陷存在**（所以在副本上通过）。canary 的覆盖文件是 0.1 副本的「最小已修复变体」，repro 在其上必须失败。

| id | [repro] 断言（在 0.1 副本上） | canary |
|---|---|---|
| a1-quota | `forecast({records:[3 条同一 model、at 在 now 前 1 小时内、cost_usd 0.5], model, quota:{remaining_pct:5}, now})` 的 `risk==='unknown'`、`tasks_left===null`，且结果没有 `remaining_fraction`、`risk_basis` 键；`quota:{remaining:1, unit:'credits'}` 同样 `unknown` 且没有 `reason` 键 | overlay `lib/forecast.mjs`：识别 `remaining_pct`，输出 `remaining_fraction` 与 `risk:'low_reserve'` |
| a2-pack | 块外内联 `V01_PACKAGE = { bin: null, files: ['lib','cordis.patch.yml','dsh.plugin.json','README.md'] }`（f75bb76 的 package.json 形状；副本不含 package.json，沿用 a3-runner 的做法）。断言 `bin===null`，`files` 不含 `bin`、`config`，且副本里存在 `config/cliworker.example.json`（说明示例存在但不会随包发布） | `repro_edits`：把 `bin: null` 改成 `bin: 'bin/cliworker.mjs'` |
| a3-runner | 沿用 T-001 已写好的 [repro]，不改 | `repro_edits`：把 `scripts: null,` 改成 `scripts: { test: 'node scripts/run-tests.mjs' },` |
| a4-paths | 用 `os.tmpdir()` 下的两个临时目录各写一个 `{providers:{},models:{}}` 配置，设置 `CLIWORKER_HOME` 为第三个临时目录；`loadConfig` 两份得到的 `_home` 相同，且都不在各自配置文件所在目录之下（块内 try/finally 还原环境变量并清理） | overlay `lib/config.mjs`：`_home` 取配置文件所在目录下的 `state` |
| a4-null-config | 配置文件内容为 `null` 时，`loadConfig` 抛出的是 `TypeError` 且 `error.code===undefined`；内容为 `{}` 时抛出的 Error 的 `code===undefined` | overlay `lib/config.mjs`：所有 throw 都带 `code='E_CONFIG'`，并避免对 null 取属性 |
| a5-dup-call | 一个可调用、已验证的 Quick 模型：`selectModels` 的入选 handle 同时有 `cli` 和 `call` 两个键，且 `deepEqual(h.cli, h.call)` | overlay `lib/select.mjs`：去掉 `cli: call` |
| a5-forecast-x3 | 同一 provider 下 12 个都通过前置过滤的模型；`config.quotas` 用 Proxy 统计对 provider 键的 `get` 次数（每次 forecast 调用恰好读一次）。断言次数 **大于 12**（0.1 在过滤、排序比较器、入选三处各算一遍） | overlay `lib/select.mjs`：按模型 key 记忆化，且 handle 的 `quota` 也复用同一次读取，使次数恰好等于 12 |
| a5-unused | 读副本源码：`lib/select.mjs` 中 `isObject` 只出现 1 次（即声明处）；`lib/cli.mjs` 有 `import fs from` 但不存在 `fs.` 的使用 | overlay `lib/select.mjs`（删 `isObject`）与 `lib/cli.mjs`（删 `fs` 导入） |
| a5-ignored-fields | `selectModels(config,{level:'Quick', role:'dev', importance:'high'})` 返回的结果 `ok===true`，且 `'warnings' in result === false` | overlay `lib/select.mjs`：返回 `warnings:[{code:'W_FIELD_IGNORED', field:'role'}]` |
| a5-shell | 读副本 `lib/availability.mjs` 源码，匹配 `/shell:\s*process\.platform\s*===\s*'win32'/` | overlay `lib/availability.mjs`：改为 `shell: false` |
| a5-nocache | 临时目录里写 `probe.mjs`（向环境变量 `CLIWORKER_TEST_PROBE_FILE` 指向的文件追加一个字符并打印 `node 1.0.0`），`process.chdir` 到该目录，provider 为 `{cli:'node', version_args:['probe.mjs']}`（无 auth_args），连续两次 `providerStatus(config)`，断言探测文件长度为 2（没有缓存，每次都真的起进程）；finally 里还原 cwd 与环境变量并清理 | overlay `lib/availability.mjs`：对同一 provider 配置缓存状态，使长度为 1 |

a5-nocache 里用 `cli:'node'` 加相对脚本名，是为了绕开 0.1 在 win32 上 `shell:true` 对带空格路径的拆分（那正是 a5-shell 的缺陷）。

### 5.5 canary 目录与格式

`test/characterization/canary/<id>/canary.json`：

```json
{ "defect": "a5-dup-call", "repro_edits": [ { "find": "...", "replace": "..." } ] }
```

- `defect` 必须等于目录名；`repro_edits` 可省略。
- 覆盖文件放在 `canary/<id>/overlay/` 下，路径相对 v0.1 根（如 `overlay/lib/select.mjs`）；这些文件是 0.1 副本的完整修改版，**扩展名保持 `.mjs`/`.js`，但不得叫 `*.test.mjs`**。
- 每个 canary 至少有一个 overlay 文件或一条 `repro_edits`，否则 `defects.canary_missing`。a3-runner 与 a2-pack 只用 `repro_edits`（它们的 repro 断言内联常量，无法通过副本变体改变）。
- `repro_edits[].find` 必须在 repro 测试文件源码中**恰好出现一次**，否则 `defects.canary_error`。

### 5.6 check-defects 的追加行为

在现有 `checkDefects` 之外新增导出 `checkRepros({ root, defects, nodePath })` 与 `STRICT` 模式；`checkDefects` 原有签名与返回值不变（`milestone-gate.mjs` 仍按原样调用它，不进入严格模式）。

**何时严格**：CLI 不带 `--root` 时（即检查真实仓库，也就是 check-fast 的调用方式）严格；带 `--root` 时只有再加 `--strict` 才严格。这样 T-001 的夹具测试（带 `--root`、无 repro_sha256）保持原样通过，而真实仓库不会静默跳过。严格模式在原有检查之外还做：

1. 账本 id 集合必须恰好是 11 个预期 id（复用 `defects.set_mismatch`，不论是否带 `--milestone`）。
2. 对每一条缺陷调用 `checkRepros`。

**checkRepros 对每条缺陷**（`root` 下 `test/fixtures/characterization/v0.1/` 为副本，`test/characterization/defects/<id>.test.mjs` 为 repro 文件，`test/characterization/canary/<id>/` 为 canary）：

| 步骤 | 失败 id |
|---|---|
| `repro_sha256` 缺失或不是 64 位十六进制 | `defects.repro_sha_missing` |
| repro 文件不存在、没有任何 [repro] 块、或某块的起始行不以 `{` 结尾 / 没有结束的 `})` | `defects.repro_missing` / `defects.repro_format` |
| 段 sha256 与登记值不同 | `defects.repro_changed` |
| 没有合法的 `canary.json` | `defects.canary_missing` |
| 编辑的 `find` 不是恰好一次、overlay 路径越界 | `defects.canary_error` |
| **基线运行**：把副本原样复制到临时目录后运行 repro，必须通过 | `defects.repro_baseline_failed` |
| **canary 运行**：把副本复制到临时目录，叠加 overlay，应用 `repro_edits`，运行 repro，**必须失败** | `defects.canary_survived` |

**运行方式**（基线与 canary 完全相同，只是临时树不同）：

1. `fs.mkdtempSync(os.tmpdir()/cliworker-canary-)` 建一个临时根，结束时无论成败都删除。不要在仓库里生成临时文件。
2. 复制副本到 `<tmp>/v0.1`，写入 `<tmp>/v0.1/package.json` 内容 `{"type":"module"}`（副本里的 `lib/index.js` 需要它）。canary 运行再叠加 overlay。
3. 把 repro 文件复制到 `<tmp>/repro.test.mjs`：先应用 `repro_edits`，再把所有以 `.` 开头的 import / 动态 import 说明符按原文件所在目录解析成 `file://` 绝对 URL（让 `../../../scripts/run-tests.mjs` 这类导入仍指向真实仓库）。
4. 运行：`node --test --test-reporter=tap --test-name-pattern=\[repro\] <tmp>/repro.test.mjs`，环境变量 `CLIWORKER_V01_ROOT=<tmp>/v0.1`，并**删除** `NODE_TEST_CONTEXT`（check-defects 可能在测试进程里被调用）。超时 60 秒，超时按失败处理。
5. 判定：基线要求退出码 0、输出里至少有一行 `ok <n> - [repro]` 且没有 `not ok`；canary 要求输出里**至少有一行** `not ok <n> - [repro]`（匹配 `/^\s*not ok \d+ - \[repro\]/m`）。只靠退出码非 0 不算失败成立，这样导入失败或语法错误不会被误判为 canary 命中。

失败输出沿用现有风格：`FAIL <id> <defect-id> <detail>`，最后 `check-defects: FAILED (<n> errors)`，退出码 1；全部通过为 `check-defects: ok`。

## 6. 测试：test/unit/frozen-files.test.mjs

标题全部以 `[AC-005]` 开头，必需用例（标题前缀必须一致）。测试内部在 `os.tmpdir()` 建迷你根目录（含副本的最小文件、frozen-files.json、stable.test.mjs 占位），直接调用 `checkFrozenFiles` / `checkRepros`，不碰真实仓库文件：

1. `[AC-005] frozen: untouched fixture root passes`
2. `[AC-005] frozen: changing one registered byte fails with frozen.hash_mismatch`
3. `[AC-005] frozen: CRLF checkout of a registered file still passes`
4. `[AC-005] frozen: lib/, bin/ and config/ paths are rejected as frozen.forbidden_path`
5. `[AC-005] frozen: scripts/ and other unlisted paths fail with frozen.outside_allowed`
6. `[AC-005] frozen: contracts/spec and contracts/golden paths are allowed`
7. `[AC-005] frozen: unregistered file in the v0.1 copy fails with frozen.unregistered`
8. `[AC-005] frozen: missing registered file fails with frozen.file_missing`
9. `[AC-005] frozen: path traversal and absolute paths are rejected`
10. `[AC-005] defects: well-formed fixture ledger passes`
11. `[AC-005] defects: repro edited after registration fails with defects.repro_changed`
12. `[AC-005] defects: canary that still passes fails with defects.canary_survived`
13. `[AC-005] defects: missing canary fails with defects.canary_missing`
14. `[AC-005] defects: repro failing on the unmodified copy fails with defects.repro_baseline_failed`
15. `[AC-005] defects: a repro that cannot even load is not counted as a canary hit` （canary 让 repro 因语法错误而失败时，输出里没有 `not ok ... [repro]`，必须得到 `defects.canary_survived` 或 `defects.canary_error`，而不是通过）

用例 12 的夹具是一个**恒真 repro**（`assert.ok(true)`）配合任意 canary——这就是 AC-005 要求「canary 通过则 check-defects 失败」的直接证据。

## 7. test/traceability/T-002.json

```json
{ "task": "T-002", "milestone": "M1",
  "entries": [ { "ac": "AC-005", "status": "covered",
                 "files": ["test/characterization/stable.test.mjs", "test/unit/frozen-files.test.mjs"] } ] }
```

不写 `baseline` 字段（分片禁止）。

## 8. 实现顺序

1. 从 f75bb76 取 blob 建副本（用 `git cat-file blob`，不要从工作树复制，避免 CRLF 混入），7 个文件。
2. 写 stable.test.mjs，在副本上先跑通。
3. 写 `check-frozen-files.mjs` 与 §6 的 1–9 号用例。
4. 在 `check-defects.mjs` 追加 `extractReproSection`、`reproSha256`、`checkRepros`、严格模式；跑 `node --test test/unit/milestone-gate.test.mjs` 确认 T-001 的测试不受影响。
5. 写 10 个 repro 文件（先让它们在副本上通过），再写 11 个 canary，逐个确认 canary 使 repro 失败。
6. 生成 `defects.json`（用 `reproSha256` 算值）和 `frozen-files.json`（stable.test.mjs 与全部 repro 之外的登记文件最后算 hash）。
7. 写 `T-002.json`，最后跑 acceptance.md 全部命令。

## 9. 风险与取舍（实现者需知道）

- **surfaces.json 未到位**：保留面按 AC-005 括号里的四类写死。T-004 合入后若 surfaces.json 里的清单更多，由 T-004 或后续任务补测，不阻塞本任务。
- **「四个 schema 名」取库模块可观察的四个**（§3），已写明；如需改成别的四个，只改 stable.test.mjs 的那一条用例及其 hash。
- **a3-runner / a2-pack 的 repro 断言内联常量**，对「副本变体」不敏感，因此它们的 canary 用 `repro_edits` 篡改 repro 自身的常量。这是对「已修复变体」的变通，只用于这两条。
- **frozen-files 的哈希对换行不敏感**（CRLF→LF），所以无法检出「只改换行」的改动；这是 autocrlf 环境下保证跨平台一致的代价。
- **canary 增加 check-defects 约 22 次 `node --test` 子进程**（11 缺陷 × 基线/canary），预计数秒到十几秒；超时 60 秒/次。
- **a5-nocache 依赖 PATH 上有 `node`**（测试本身就由 node 运行，视为成立）。
- 令牌与密钥：本任务不接触任何密钥；repro 与临时目录里只放构造出来的假配置。
