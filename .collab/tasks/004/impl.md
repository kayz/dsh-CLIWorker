# Task 004 实现说明（dev）

## 1. 结论

按 design.md 落地了契约冻结的全部产物：嵌入式注册表与快照、21 个 schema、14 组正反例、禁用清单与视图扫描器、两名视图决策、规格与金标、4 个检查脚本、生成文档、5 个契约测试、追踪分片。

- AC-009 / AC-010 / AC-011 的测试全绿。
- AC-073 的 16 条测试里 15 条通过，唯一失败项是“文件被 git 跟踪”，因为本角色被禁止执行 git 命令（见 §6.1）。
- 除该条与两处环境/文档层面的已知差异外，acceptance.md 中可直接执行的命令逐字匹配（见 §5）。

## 2. 改动清单

库（纯函数，无 `node:` 导入、无时钟、无环境）：

| 文件 | 内容 |
|---|---|
| `lib/contract/registry.mjs` | 30 码注册表、`getCode`、`compareRegistry`、`checkFrozen`、`WRITE_ROUTE_ORDER`、`decideGate`；零 import，深度冻结 |
| `lib/contract/validate.mjs` | 受支持关键字子集的校验器 `validate` 与 `checkSchema`，支持跨文件 `$ref`、JSON Pointer 路径、深度上限 64 |
| `lib/contract/scan.mjs` | `scanView`：显式栈遍历、禁用键/禁用值整词匹配、`call` 子树模板比对 |
| `lib/contract/views.mjs` | `resolveView` 与 `VIEW_NAMES` |

契约数据：

| 路径 | 内容 |
|---|---|
| `contracts/registry.snapshot.json` | 由 `snapshot-update` 生成，`snapshot_version: 1`，30 码 + 全部枚举/阈值/映射 |
| `contracts/schemas/*.schema.json` | 14 个线上对象 + 7 个规格对象，共 21 个 |
| `contracts/examples/<name>/{valid,invalid}/*.json` | 14 组，各 ≥1 正例、2 反例；反例带 `expect.path/keyword` |
| `contracts/agentline-forbidden.json` | 25 个禁用键 + call 模板（8 项 args） |
| `contracts/spec/surfaces.json`、`contracts/spec/migration-map.json` | 保留面 4 项 / semantic_change 5 项；10 条原因映射 + 15 条字段迁移 + 7 条 v1→v2 配置迁移 |
| `contracts/golden/*.json` | 11 个金标文件（quota-shapes 9、b44 9、forecast 4 个共 61、capacity 5、policy 4 个共 6） |
| `contracts/golden/manifest.json` | 14 个文件的归一化 sha256（`contracts/spec/**` + `contracts/golden/**`，不含自身，不含 registry 快照） |
| `docs/contract.md` | 由 `gen-contract-doc` 生成 |

脚本：

| 文件 | 内容 |
|---|---|
| `scripts/snapshot-update.mjs` | 动态加载候选 `REGISTRY`，按 design §3.7 的六种情形输出与退出码 |
| `scripts/check-golden-frozen.mjs` | 清单校验 + `--write` 唯一生成入口；哈希前 `\r\n`→`\n` |
| `scripts/check-write-scope.mjs` | 登记检查 + `--base/--scope/--scope-from` 范围检查（glob `*` 单段、`**` 跨段） |
| `scripts/check-no-collab.mjs` | 扫描 `lib/scripts/test/contracts/docs` 与 `package.json`；禁词用拼接构造 |
| `scripts/gen-contract-doc.mjs` | `renderContractDoc(root)` + 直接运行时写文件 |
| `scripts/check-contract-doc.mjs` | 重新生成并比较（两侧归一 CRLF） |

测试与追踪：`test/contract/{registry,examples,freeze,scan-canary,spec-tracked}.test.mjs`（共 51 条、标题与 design §11 逐字一致），`test/fixtures/no-collab/**`（6 个违规 + 2 个干净夹具），`test/traceability/T-004.json`。

## 3. 关键实现说明

- **注册表**：`REGISTRY` 为唯一数据源，`snapshot-update` 用 `JSON.stringify(REGISTRY, null, 2) + "\n"` 写出，因此快照键序即书写顺序；`compareRegistry` 对 30 码按 `code`、映射按 `draft`、两张阈值表按 `risk` 建索引，值列表按元素集合比较，`write_route_order` 与 `thresholds.priority` 按有序列表比较（键为 `*`）。三组结果各按码点排序。
- **`decideGate`**：`admin_write` 严格按“会话 → readonly → csrf → 请求体”短路；测试对 5 条路由 × 32 种布尔组合穷举，验证五码互斥且各自可达。
- **校验器**：`$ref` 解析时同时携带“当前文档根”，修复了 `handle.v1.schema.json#/$defs/call` 内部再引用 `#/$defs/call` 的归属问题；`required` / `additionalProperties` 的路径按 design §4 指向缺失/多余属性名，且同一位置同一关键字只报一次。
- **扫描器**：键检查用“转小写后精确相等”，值检查用 `[a-z0-9]` 为词边界的整词匹配；`call` 子树（键名为 `call` 的值、顶层 `calls[i]`）完全跳过键/值扫描，改为键集合（先判，命中即返回，保证“仅 1 条”）与逐字段模板比对；`cwd` 因此不参与值扫描。
- **CRLF**：清单哈希、文档比较都先归一；所有新文件以 LF、UTF-8 无 BOM 写出。
- **禁词**：`check-no-collab.mjs`、测试与夹具生成代码都不含该字面量（用 `['.', 'coll', 'ab'].join('')`），夹具文件本身按 design 表保留违规内容。

## 4. 自测方式

在仓库根逐条执行 acceptance.md 的命令。可直接运行的部分结果：

- `node scripts/run-tests.mjs --ac AC-009` / `AC-010` / `AC-011`：`fail 0`，标题齐全（`missing=0`）。
- `node scripts/check-golden-frozen.mjs` → `check-golden-frozen: ok (14 files)`；`--root` 临时副本上改/加/删分别得到 `golden.changed` / `golden.unregistered` / `golden.missing`，均 1 条错误、exit 1；把某个金标改写成 CRLF 后仍通过（归一化生效）。
- `node scripts/check-write-scope.mjs` → `ok`；临时副本新增 `contracts/spec/x.json` → `write_scope.unregistered`，exit 1；临时 git 仓库里 `--base HEAD --scope 'lib/contract/**'` 只报 `lib/other.mjs`，`--scope 'lib/*.mjs'` 只报 `lib/contract/ok.mjs`，`--scope-from` 与 `--scope` 同效，front matter 缺失 exit 2。
- `node scripts/check-no-collab.mjs` → `ok`；两个夹具分别为 6 行 `FAIL no_collab`（行号与 F-11 逐字一致）与 `ok (scanned 2 files)`。
- `node scripts/check-contract-doc.mjs` → `ok`；临时副本改动一个字符 → `contract_doc.stale`，exit 1。
- `node scripts/check-traceability.mjs` → `check-traceability: ok (covered=9 planned=65)`。
- C-1～C-6、D-1～D-4、E-1～E-3、F-1、F-2、F-7、F-10、F-13～F-15、G-1～G-7 的输出与 acceptance 逐字一致（G-4 见 §6.2）。
- `node scripts/snapshot-update.mjs` → `snapshot-update: unchanged (snapshot_version 1)`，不写文件。

## 5. 与 acceptance 的对应关系

- 注册表/快照深相等、30 码字段与唯一性、403 互斥与判定顺序、视图规则、纯函数性：`test/contract/registry.test.mjs`。
- schema 关键字白名单、正反例、枚举一致、校验器路径表、令牌样式：`test/contract/examples.test.mjs`。
- 冻结比较、`checkFrozen`、`snapshot-update` 六种情形、快照内容：`test/contract/freeze.test.mjs`。
- 键/值深度与大小写、整词、call 模板、干净样例、1000 层嵌套：`test/contract/scan-canary.test.mjs`。
- git 跟踪、规格/金标 schema、必需 case id、manifest 哈希、三个冻结失败场景、范围检查、禁词、文档生成、接口第 5 节清单、检查脚本可发现性：`test/contract/spec-tracked.test.mjs`。

## 6. 已知问题与交接

### 6.1 需要集成方执行 `git add`（阻塞 AC-073 的“被 git 跟踪”一条）

本角色被明确禁止执行 git 命令，因此新文件目前是未跟踪状态，`[AC-073] snapshot, spec, golden and forbidden files are tracked by git and not ignored` 会失败（其余 15 条通过）。集成前请显式暂存（不要用 `git add -A`）：

```bash
git add contracts lib/contract scripts/snapshot-update.mjs scripts/gen-contract-doc.mjs \
        scripts/check-contract-doc.mjs scripts/check-golden-frozen.mjs \
        scripts/check-no-collab.mjs scripts/check-write-scope.mjs \
        docs/contract.md test/contract test/fixtures/no-collab test/traceability/T-004.json
```

暂存后 A-4 / B-4 / F-16 / H-3 / H-4 / H-5 即可通过（H-4/H-5 另见 §6.3）。

### 6.2 G-4 的字面差异（设计层面）

`contracts/golden/forecast/quantiles.json` 的 `n2-invalid`/`n1-invalid`/`n0-invalid` 按 design §9.4 写为 `"expected": {"value": null}`（“n<3 时 value 为 null”，下游按值深相等消费）。acceptance 的 G-4 命令用 `Array.prototype.join` 打印这四个值，而 `join` 把 `null` 渲染为空串，实际输出是 `0.3 3 18 `（末尾一个空格），与文中 `0.3 3 18 null` 相差一个词。

这里按 design 保留 JSON `null`：改成字符串 `"null"` 会让金标类型与 design 冲突，并使后续按值比对的消费方失败。若验收要求逐字匹配，请把预期行改为 `0.3 3 18 `（或修改 G-4 命令用 `String(x)`/`JSON.stringify`）。

### 6.3 既有基线问题（非本任务引入）

`node scripts/check-ci.mjs` 在本机 `core.autocrlf` 生效的检出下失败：`.github/workflows/ci.yml` 在工作区是 CRLF，而 `gen-ci` 渲染的是 LF，`check-ci` 逐字节比较。该文件与 `package.json` 等均在 write_scope 之外（F-17 也要求它们不变），因此未做任何改动；结果是 `npm test` 里 `[AC-002] check-ci accepts the committed workflow` 失败，`check-fast` 在第一步 `check-ci.mjs` 就中断（也就到不了新增的四个检查脚本）。把该文件按 LF 重新检出后即可恢复。
