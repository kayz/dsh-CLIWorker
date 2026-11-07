# Task 004 实现说明（dev）

## 1. 本轮结论

契约冻结的全部产物已在仓库内，且**工作树对实现文件无任何待提交改动**（`git status --short -- contracts lib/contract scripts docs test` 为空）。本轮把 acceptance.md 的 52 条命令在当前 worktree（`C:\git\dsh-CLIWorker\.collab\worktrees\004`，基线 `93ebbb3`）上逐条重跑，全部满足断言：

- AC-009 / AC-010 / AC-011 / AC-073 四组 `run-tests --ac` 全绿（15 / 10 / 10 / 16 条，`exit=0`，无 `✖`）。
- 52 条命令（A-1…A-4、B-1…B-4、C-1…C-8、D-1…D-4、E-1…E-3、F-1…F-17、G-1…G-7、H-1…H-5）的输出与退出码逐条符合 acceptance 的断言要点。
- `run-tests` 全量 89/89；`check-fast` 与新检查脚本、`check-fast.ps1` 均 `exit=0`。

因此本轮**没有修改任何源码、契约数据、脚本或测试**，只重写了本说明文件。上一轮记录的两处环境处理仍然有效（§7）。

## 2. 产物清单（现状核对）

库（纯函数：无 `node:` 导入、无时钟、无环境、不读文件）：

| 文件 | 内容 |
|---|---|
| `lib/contract/registry.mjs` | 零 import；30 码注册表 + 枚举/阈值/映射；`getCode`、`compareRegistry`、`checkFrozen`、`WRITE_ROUTE_ORDER`、`decideGate`；深度冻结 |
| `lib/contract/validate.mjs` | 受支持关键字子集的 `validate` 与 `checkSchema`；跨文件 `$ref`、JSON Pointer 路径、深度上限 64 |
| `lib/contract/scan.mjs` | `scanView`：显式栈遍历、禁用键大小写不敏感精确匹配、禁用值整词匹配、`call` 子树模板比对 |
| `lib/contract/views.mjs` | `resolveView` 与 `VIEW_NAMES`（full > draft > agentline） |

契约数据：

| 路径 | 内容 |
|---|---|
| `contracts/registry.snapshot.json` | `snapshot_version: 1`，键序即 `REGISTRY` 书写顺序，与 `REGISTRY` 深相等 |
| `contracts/schemas/*.schema.json` | 14 个线上对象 + 7 个规格对象，共 21 个 |
| `contracts/examples/<name>/{valid,invalid}/*.json` | 14 组，各 ≥1 正例、≥2 反例；反例声明 `expect.path/keyword` 且恰好产生 1 条错误 |
| `contracts/agentline-forbidden.json` | 25 个禁用键 + `call` 模板（8 项 args） |
| `contracts/spec/surfaces.json`、`contracts/spec/migration-map.json` | 保留面 4 项 / semantic_change 5 项；10 条原因映射 + 15 条字段迁移 + 7 条 v1→v2 配置迁移 |
| `contracts/golden/**` | 11 个金标文件（quota-shapes 9、b44 9、forecast 4 个共 61、capacity 5、policy 4 个共 6 个 case） |
| `contracts/golden/manifest.json` | 14 个文件（`contracts/spec/**` + `contracts/golden/**`，不含自身、不含快照）的归一化 sha256 |
| `docs/contract.md` | 由 `gen-contract-doc` 生成的 10 节文档（218 行） |

脚本：

| 文件 | 内容 |
|---|---|
| `scripts/snapshot-update.mjs` | 动态加载候选 `REGISTRY`，实现 design §3.7 的六种情形与退出码；只在版本恰为旧版本 +1 时写盘 |
| `scripts/gen-contract-doc.mjs` | `renderContractDoc(root)` + 直接运行时写文件；被 import 无副作用 |
| `scripts/check-contract-doc.mjs` | 重新生成并比较（两侧归一 CRLF） |
| `scripts/check-golden-frozen.mjs` | 清单校验 + `--write` 唯一生成入口；哈希前 `\r\n`→`\n` |
| `scripts/check-write-scope.mjs` | 登记检查 + `--base/--scope/--scope-from` 范围检查（`*` 单段、`**` 跨段） |
| `scripts/check-no-collab.mjs` | 扫描 `lib/`、`scripts/`、`test/`、`contracts/`、`docs/` 与 `package.json`；禁用字面量用拼接构造 |

测试与追踪：`test/contract/{registry,examples,freeze,scan-canary,spec-tracked}.test.mjs`（共 51 条，标题与 design §11 逐字一致，覆盖 AC-009/010/011/073）、`test/fixtures/no-collab/**`（6 个违规 + 2 个干净夹具）、`test/traceability/T-004.json`。

## 3. 关键实现说明

- **注册表**：`REGISTRY` 是唯一数据源，`snapshot-update` 用 `JSON.stringify(REGISTRY, null, 2) + "\n"` 写出，因此快照键序固定。`compareRegistry` 对 `codes` 按 `code`、`draft_reason_mapping` 按 `draft`、两张阈值表按 `risk` 建索引；值列表按元素集合比较；`write_route_order` 与 `thresholds.priority` 按有序列表比较、键为 `*`。三组结果各按码点排序。
- **`decideGate`**：`admin_write` 严格短路“会话 → readonly → csrf → 请求体”；测试穷举 5 条路由 × 32 种布尔组合，验证五码互斥且各自可达。
- **校验器**：`$ref` 解析同时携带“当前文档根”，处理 `handle.v1.schema.json#/$defs/call` 内部再引用本文件 `$defs` 的情况；`required` / `additionalProperties` 的路径指向缺失/多余属性名；同一位置同一关键字只报一次。
- **扫描器**：键用“转小写后精确相等”，值用 `[a-z0-9]` 为边界的整词匹配；`call` 子树完全跳过键/值扫描，先判键集合（命中即返回，保证只报 1 条）再逐字段比对模板，因此 `cwd` 里出现模型 id 不算命中。
- **CRLF**：清单哈希与文档比较都先归一化；所有产出文件为 UTF-8 无 BOM、LF、末尾一个换行。

## 4. 本轮自测（逐组实测输出）

| 组 | 实测 |
|---|---|
| A-1～A-4 | 四组均 `run-tests: filtered`、`exit=0`、无 `✖`；通过数 15 / 10 / 10 / 16 |
| B-1～B-4 | design §11 的 51 个标题全部出现在输出，四条均 `missing=0` |
| C-1～C-8 | `equal`；`1 30 30 30 E_TIMEOUT+E_INSUFFICIENT_QUOTA+E_LEASE_EXPIRED`；403 五个码逐字一致；`session,readonly,csrf,body`；`14 true` + 14 个名称逐字一致；`21`；C-7/C-8 两条 grep 命中数均为 0 |
| D-1～D-4 | 三行 `compareRegistry` 逐字一致；`snapshot-update: unchanged (snapshot_version 1)`、`exit=0` 且快照未被改写（运行前后 `git status --short -- contracts/registry.snapshot.json` 均为空）；计数行与两张阈值表逐字一致 |
| E-1～E-3 | `cliworker.agentline-forbidden/v1 25 true false command,args,cwd,input,output,timeout_ms 8`；键命中 `[["/a/b/Model_Key","forbidden_key"]]`、值命中 `[["/a/0/m","forbidden_value"]]`、干净样例 `true 0`；call 模板 `true false call_mismatch` |
| F-1、F-2、F-7、F-10、F-13 | `check-golden-frozen: ok (14 files)`；manifest 七项 `cliworker.golden-manifest/v1 14 false true false true true`；`check-write-scope: ok`；`check-no-collab: ok (scanned 165 files)`；`check-contract-doc: ok` |
| F-3～F-6 | 临时副本上改 → `FAIL golden.changed contracts/golden/b44.json`（exit 1）；加 → `FAIL golden.unregistered contracts/golden/extra.json`（exit 1）；删 → `FAIL golden.missing contracts/golden/capacity.json`（exit 1）；新增 `contracts/spec/x.json` → `FAIL write_scope.unregistered contracts/spec/x.json`（exit 1），四者末行均为 `FAILED (1 errors)` |
| F-8、F-9 | F-8 `check-write-scope: ok`（本任务全部变更落在写域内）；F-9 报出 111 行 `write_scope.outside`、`FAILED (111 errors)`、exit 1 |
| F-11、F-12 | 6 行 `FAIL no_collab`（`contracts/d.json:2`、`docs/e.md:3`、`lib/a.mjs:1`、`package.json:2`、`scripts/b.mjs:2`、`test/c.txt:1`）+ `FAILED (6 violations)`；干净夹具 `ok (scanned 2 files)` |
| F-14～F-17 | `true false false true`；11 个标题逐行一致；`missing 0`；`git diff --name-only 93ebbb3 -- <既有文件>` 无输出 |
| G-1～G-7 | `cliworker.migration-map/v1 10 15 7 cliworker.surfaces/v1 4 5`；`true true true`；case 数 `9 9 21 15 11 14 5 1 1 2 2`；`0.3 3 18 null` 与阈值行逐字一致；三张金标的 expected 子集一致；kind 行与 `true`；p1 选序 `mA plan / mB plan / mC paid` |
| H-1～H-5 | `check-traceability: ok (covered=9 planned=65)`；`T-004 M1 AC-009:covered AC-010:covered AC-011:covered AC-073:covered false`；`run-tests: full` 89/89（`pass 89 fail 0`）；`check-fast: ok`，输出依次含 `==> check-contract-doc.mjs`、`==> check-golden-frozen.mjs`、`==> check-no-collab.mjs`、`==> check-write-scope.mjs`、`==> npm test`；`pwsh -NoProfile -File scripts/check-fast.ps1` 末尾 `check-fast: ok`、exit 0 |

补充：`node scripts/snapshot-update.mjs` 在本仓库为 no-op；`check-traceability`、`check-contract-doc`、`check-golden-frozen`、`check-no-collab`、`check-write-scope` 单独运行均 exit 0。

## 5. 与验收条目的对应关系

- AC-009 → `registry.test.mjs`（注册表/快照深相等、30 码字段与唯一性、403 互斥与判定顺序、视图规则、纯函数性）+ `examples.test.mjs`（schema 关键字白名单、正反例、枚举一致、校验器路径、令牌样式）。
- AC-010 → `freeze.test.mjs`（冻结比较、`checkFrozen`、`snapshot-update` 六种情形、快照内容）。
- AC-011 → `scan-canary.test.mjs`（键/值深度与大小写、整词、call 模板、干净样例、1000 层嵌套）。
- AC-073 → `spec-tracked.test.mjs`（git 跟踪、规格/金标 schema、必需 case id、manifest 哈希、三个冻结失败场景、范围检查、禁词、文档生成、interfaces 第 5 节清单、检查脚本可发现性）。

## 6. 新文件已被 git 跟踪

AC-073 的“被 git 跟踪”以 `git ls-files` 为准：F-16 的 33 个要求路径全部已登记，`missing 0`。这些文件在更早的 dev 轮次已用显式路径提交，本轮无需再 `git add`。

## 7. 环境与外部约束（沿用上一轮的处理，本轮复核仍成立）

### 7.1 CRLF 与 `check-ci`

本机 `core.autocrlf=true`。`gen-ci.mjs` 渲染 LF，`check-ci.mjs` 逐字节比较，检出为 CRLF 时 `[AC-002] check-ci accepts the committed workflow` 会失败并中断 `check-fast`。当前工作区的 `.github/workflows/ci.yml` 已是 LF，`check-fast` 第一步 `==> check-ci.mjs` 通过；运行 `node scripts/gen-ci.mjs` 即为修复手段，内容归一化后与提交版本一致，git 侧视为未修改，`F-8` 不因此报越界。

### 7.2 `-Encoding utf8NoBOM` 只在 pwsh 7 存在

F-4、F-6 的临时文件用 `Set-Content -Encoding utf8NoBOM`，这是 PowerShell 7 的参数；Windows PowerShell 5.1 会报参数不识别。acceptance 已声明用 pwsh 7 执行，本机 `pwsh` 为 7.x，两条已按原文逐字跑通（`golden.unregistered` / `write_scope.unregistered`，exit 1）。脚本本身的判定不依赖该编码参数。

### 7.3 CI 提取器与 acceptance.md 的章节形态不一致（需 acceptance 属主处理，dev 无权改）

最近三次 CI 均以 `exit 2, zero commands extracted, ci-results.json not written` 阻塞，而本轮 52 条命令在 pwsh 7 下全部通过，说明问题在**提取格式**而非命令本身。对照通过 CI 的 `.collab/tasks/001/acceptance.md` 与 `.collab/tasks/002/acceptance.md`（后者 `ci-results.json` 为 `passed 25 / total 25 / ok true`），可用形态是：

- 每个用例是一个 `### <编号> <标题>` 三级标题，编号为“字母 + 数字”（如 `A1`、`B3`、`D4`，001 用 `V-01`）；
- 小节下**只有一个** ```powershell 代码块（围栏带 `powershell` 语言标记），块内首行就是可执行命令。

当前 `.collab/tasks/004/acceptance.md` 用的是 `## A-1 <标题>`（二级标题）+ 无语言标记的 ``` 围栏，两处都与上面不符，因此提取数为 0。

处理建议（属于 design/acceptance 写域，dev 不自行修改）：把 `## A-1 标题` 改成 `### A1 标题`，并把每个围栏改成 ```powershell；命令与断言要点不变，则本轮已验证的 52 条命令无需任何改动即可被提取执行。若调度器暂时无法改 acceptance.md，也可直接按本说明 §4 的证据人工判定。
