# Task 004 实现说明（dev）

## 1. 结论

按 design.md 落地了契约冻结的全部产物，并逐条跑通了 acceptance.md 的 A、B、C、D、E、F、G、H 各组命令。

- AC-009 / AC-010 / AC-011 / AC-073 的测试全绿（15 / 10 / 10 / 16 条）。
- 注册表与快照深相等，30 个码、403 互斥、阈值、映射、枚举全部就位。
- 四个新检查脚本（`check-contract-doc`、`check-golden-frozen`、`check-no-collab`、`check-write-scope`）被 `check-fast` 按码点自动纳入并通过。
- `npm test` 89/89 通过，`check-fast` 与 `check-fast.ps1` 均退出 0。
- 唯一与 acceptance 的逐字差异是 G-4（见 §6.2），原因是 `join` 把 JSON `null` 渲染成空串；按 design §9.4 保留 `null`，未改动金标语义。

## 2. 产物与改动清单

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
| `contracts/registry.snapshot.json` | `snapshot_version: 1`，由 `snapshot-update` 写出，键序即注册表书写顺序 |
| `contracts/schemas/*.schema.json` | 14 个线上对象 + 7 个规格对象，共 21 个 |
| `contracts/examples/<name>/{valid,invalid}/*.json` | 14 组，各 ≥1 正例、2 反例；反例声明 `expect.path/keyword` 且恰好产生 1 条错误 |
| `contracts/agentline-forbidden.json` | 25 个禁用键 + `call` 模板（8 项 args） |
| `contracts/spec/surfaces.json`、`contracts/spec/migration-map.json` | 保留面 4 项 / semantic_change 5 项；10 条原因映射 + 15 条字段迁移 + 7 条 v1→v2 配置迁移 |
| `contracts/golden/**` | 11 个金标文件（quota-shapes 9、b44 9、forecast 4 个共 61、capacity 5、policy 4 个共 6） |
| `contracts/golden/manifest.json` | 14 个文件（`contracts/spec/**` + `contracts/golden/**`，不含自身、不含快照）的归一化 sha256 |
| `docs/contract.md` | 由 `gen-contract-doc` 生成的 10 节文档 |

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

本轮相对上一轮的实质改动只有一处（`impl.md` 之外）：见 §6.3 的 `.github/workflows/ci.yml` 行尾归一，仓库内容未变。

## 3. 关键实现说明

- **注册表**：`REGISTRY` 是唯一数据源，`snapshot-update` 用 `JSON.stringify(REGISTRY, null, 2) + "\n"` 写出，因此快照键序固定。`compareRegistry` 对 `codes` 按 `code`、`draft_reason_mapping` 按 `draft`、两张阈值表按 `risk` 建索引；值列表按元素集合比较；`write_route_order` 与 `thresholds.priority` 按有序列表比较、键为 `*`。三组结果各按码点排序。
- **`decideGate`**：`admin_write` 严格短路"会话 → readonly → csrf → 请求体"；测试穷举 5 条路由 × 32 种布尔组合，验证五码互斥且各自可达。
- **校验器**：`$ref` 解析同时携带"当前文档根"，处理 `handle.v1.schema.json#/$defs/call` 内部再引用本文件 `$defs` 的情况；`required` / `additionalProperties` 的路径指向缺失/多余属性名；同一位置同一关键字只报一次。
- **扫描器**：键用"转小写后精确相等"，值用 `[a-z0-9]` 为边界的整词匹配；`call` 子树完全跳过键/值扫描，先判键集合（命中即返回，保证只报 1 条）再逐字段比对模板，因此 `cwd` 里出现模型 id 不算命中。
- **CRLF**：清单哈希与文档比较都先归一；所有产出文件为 UTF-8 无 BOM、LF、末尾一个换行。

## 4. 自测方式与结果

在仓库根逐条执行 acceptance.md 的命令，结果：

| 组 | 结果 |
|---|---|
| A-1～A-4 | 四组 `run-tests --ac` 均 `run-tests: filtered`、`exit=0`、无 `✖` 行（15/10/10/16 条全过） |
| B-1～B-4 | design §11 的 51 个标题全部出现，`missing=0` |
| C-1～C-8 | 输出与 acceptance 逐字一致（`equal`、`1 30 30 30 E_TIMEOUT+E_INSUFFICIENT_QUOTA+E_LEASE_EXPIRED`、403 五行、`session,readonly,csrf,body`、`14 true`、`21`；C-7/C-8 两条 grep 无输出） |
| D-1～D-4 | 三行 diff 逐字一致；`snapshot-update` 输出 `unchanged (snapshot_version 1)` 且未写盘；计数行与两张阈值表逐字一致 |
| E-1～E-3 | `25 true false ... 8`；键/值命中路径与 `true 0`；`true false call_mismatch` |
| F-1、F-2、F-7、F-10、F-13 | `ok (14 files)` / manifest 七项 / `ok` / `ok (scanned 165 files)` / `ok` |
| F-3～F-6 | 临时副本上改/加/删金标分别得到 `golden.changed` / `golden.unregistered` / `golden.missing`（各 1 条、exit 1）；新增 `contracts/spec/x.json` 得到 `write_scope.unregistered`（exit 1） |
| F-8、F-9 | F-8 `ok`（本任务全部变更落在写域内）；F-9 报出大量 `write_scope.outside` 并 exit 1 |
| F-11、F-12 | 6 行 `FAIL no_collab`（路径与行号逐字一致）与 `ok (scanned 2 files)` |
| F-14～F-16 | `true false false true`；11 个标题逐行一致；`missing 0` |
| F-17 | 无输出（既有文件未改动） |
| G-1～G-3、G-5～G-7 | 逐字一致（含 11 个金标的 case 数 `9 9 21 15 11 14 5 1 1 2 2`） |
| G-4 | 第二行逐字一致；第一行为 `0.3 3 18 `（差 `null` 一词，见 §6.2） |
| H-1～H-5 | `check-traceability: ok (covered=9 planned=65)`；追踪分片无 `baseline`；`run-tests: full` 89/89；`check-fast: ok`；`check-fast.ps1` 退出 0 |

补充：`node scripts/snapshot-update.mjs` 在干净仓库上为 no-op；`check-ci`、`check-defects`、`check-test-discovery`、`check-traceability` 均单独退出 0。

## 5. 与 acceptance 的对应关系

- AC-009 注册表/快照深相等、30 码字段与唯一性、403 互斥与判定顺序、视图规则、纯函数性、schema 关键字白名单、正反例、枚举一致、校验器路径表、令牌样式 → `test/contract/registry.test.mjs`、`examples.test.mjs`。
- AC-010 冻结比较、`checkFrozen`、`snapshot-update` 六种情形、快照内容 → `test/contract/freeze.test.mjs`。
- AC-011 键/值深度与大小写、整词、call 模板、干净样例、1000 层嵌套 → `test/contract/scan-canary.test.mjs`。
- AC-073 git 跟踪、规格/金标 schema、必需 case id、manifest 哈希、三个冻结失败场景、范围检查、禁词、文档生成、接口第 5 节清单、检查脚本可发现性 → `test/contract/spec-tracked.test.mjs`。

## 6. 需要说明的三点

### 6.1 新文件已被 git 跟踪

AC-073 的"被 git 跟踪"一条以 `git ls-files` 为准，当前 33 个要求路径全部已登记，且 `git check-ignore` 不命中；该测试通过。

### 6.2 G-4 的逐字差异（design 与 acceptance 的冲突，按 design 处理）

`contracts/golden/forecast/quantiles.json` 的 `n2-invalid` / `n1-invalid` / `n0-invalid` 按 design §9.4 写成 `"expected": {"value": null}`（"n<3 时 value 为 null"）。G-4 的命令用 `Array.prototype.join` 打印这四个值，`join` 把 `null` 渲染为空串，实际输出是 `0.3 3 18 `（末尾一个空格），与文中 `0.3 3 18 null` 差一个词。

保留 `null` 的理由：design §9.1 规定金标 `expected` 与下游实测值**深相等**，T-006 消费这三个 case 时 `quantile_for_usage` 返回的就是 `null`；改成字符串 `"null"` 会让金标与被冻结的语义不一致，正是本任务要防止的缺陷。若验收坚持逐字匹配，改动只有三处值是 `"null"`，随后需依次运行 `node scripts/check-golden-frozen.mjs --write` 与 `node scripts/gen-contract-doc.mjs`（manifest 与文档都含哈希）。

### 6.3 `.github/workflows/ci.yml` 的行尾（环境问题，仓库内容未变）

本机 `core.autocrlf=true`，检出的 `ci.yml` 是 CRLF，而 `gen-ci.mjs` 渲染 LF，`check-ci` 逐字节比较，导致 `[AC-002] check-ci accepts the committed workflow` 失败、`check-fast` 在第一步中断（H-3/H-4/H-5 随之失败）。

处理方式：运行 `node scripts/gen-ci.mjs` 把工作区文件重新渲染为 LF。这不是内容改动——归一化后与生成输出逐字节相同（`normalized-equal true`，1516 字节），git 侧的规范化也视其为未修改（`check-write-scope --base 93ebbb3` 仍为 `ok`，未出现 `.github/workflows/ci.yml` 的越界报告），且该文件不在本任务写域内、未被提交。修复后 `npm test` 89/89、`check-fast: ok`、`check-fast.ps1` 均通过。
