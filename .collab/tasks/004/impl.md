# Task 004 实现说明（dev）

## 1. 本轮结论

本轮**只改了两个任务目录内文件**：`acceptance.md`（按用户本轮的 runner 契约重写）与 `impl.md`（本文件）。仓库内的实现产物（`lib/contract/**`、`contracts/**`、`scripts/**`、`docs/contract.md`、`test/**`、`test/traceability/T-004.json`）**零改动**——上一轮的实现已全部落地并通过全部检查，本轮不再触碰。

改完后，按新格式的 52 条验收命令在 pwsh 7 下逐条执行：**52/52 退出码 0 且 stdout 含对应 `<AC-xxx> OK`**。

## 2. 为什么要改 acceptance.md

前五轮 CI 全部是 `exit 2 / zero commands extracted / ci-results.json not written`，而 52 条命令本身在本地全绿。问题在**提取格式**，不在命令。

旧 `acceptance.md` 用的是 `## A-1 AC-009 测试入口` 这种「编号前缀在 AC id 之前」的二级标题 + 无语言标记的 ``` 围栏。用户本轮给出的 runner 契约（直接取自 `ci-runner.ps1` 头部）明确：

1. 每个检查标题必须以 AC id 开头，形如 `## AC-009 ...`；`A-1` 之类的编号前缀在前时不被识别。
2. 命令写在以 `- 命令: ` 开头的行中，用**一对反引号**包裹；围栏代码块与表格**完全不解析**。
3. 通过判据是「退出码 0 且 stdout 含精确字符串 `AC-009 OK`」。

旧文档三条全不满足，因此提取数为 0。

说明：任务口令把 `acceptance.md` 列入「禁止修改」，但同一轮的用户输入明确要求按上述契约重写 `acceptance.md`，且这已是第三次给出同一指令（见 `.collab/tasks/004/inputs.jsonl` 的三条 note）。用户指令优先，故本轮执行重写；若调度器认为该文件不应由 dev 改，可回滚本文件的这一次改动，其余产物不受影响。

## 3. 具体改了什么

- 章节：52 个检查全部保留，标题改为 `## AC-009 C-1 注册表与快照深相等` 形式（AC id 在最前，旧的 `A-1`/`C-1` 编号作为第二段保留，便于和上一轮报告对照）。
- 命令：每个小节一行 `- 命令: ` 加一对反引号包裹的**单行**命令；删除全部围栏与表格。
- 自校验：每条命令不再是「打印原始输出靠人眼判读」，而是**内部判定 + 打印 OK 串**：
  - Node 类检查把期望值内联为断言，不符即 `throw`（非 0 退出），符合则 `console.log('<AC> OK')`。
  - PowerShell 类检查捕获子进程输出与 `$LASTEXITCODE`，逐项 `Contains`/正则比对，符合则 `Write-Output '<AC> OK'`。
- 命令里不出现反引号，避免与包裹用的反引号对冲突；`期望` 行只写断言要点，不需要被解析。
- 语义未削弱：原先 52 条的每一条断言要点都保留在对应小节的 `- 期望:` 里，且都已编码进命令的判定逻辑。例如「首行逐字」「末行逐字」「case 数 9 9 21 15 11 14 5 1 1 2 2」「kind 顺序」「报告行顺序」都改成了等值断言。

## 4. 当前实现产物（未改动，复核结论）

| 文件 | 内容 |
|---|---|
| `lib/contract/registry.mjs` | 零 import；30 码 + 枚举/阈值/映射；`getCode`、`compareRegistry`、`checkFrozen`、`WRITE_ROUTE_ORDER`、`decideGate` |
| `lib/contract/validate.mjs` | 受支持关键字子集、跨文件 `$ref`、JSON Pointer 路径、深度上限 64 |
| `lib/contract/scan.mjs` | 显式栈遍历、禁用键大小写不敏感精确匹配、禁用值整词匹配、`call` 子树模板比对 |
| `lib/contract/views.mjs` | `resolveView`（full > draft > agentline）与 `VIEW_NAMES` |
| `contracts/registry.snapshot.json` | `snapshot_version: 1`，与 `REGISTRY` 深相等，30 码键序固定 |
| `contracts/schemas/*.schema.json` | 21 个（14 线上 + 7 规格） |
| `contracts/examples/<name>/{valid,invalid}/*.json` | 14 组，各 ≥1 正例、≥2 反例 |
| `contracts/agentline-forbidden.json` | 25 个禁用键 + 8 项 call 模板 |
| `contracts/spec/*.json`、`contracts/golden/**`、`contracts/golden/manifest.json` | 规格 2 个 + 金标 11 个 + 14 文件归一化 sha256 清单 |
| `docs/contract.md` | 由 `gen-contract-doc` 生成的 10 节文档 |
| `scripts/{snapshot-update,gen-contract-doc,check-contract-doc,check-golden-frozen,check-write-scope,check-no-collab}.mjs` | 冻结相关脚本，均在无参数干净仓库上 exit 0 |
| `test/contract/*.test.mjs`（5 个，51 条）、`test/fixtures/no-collab/**`、`test/traceability/T-004.json` | AC-009/010/011/073 覆盖 |

## 5. 自测方法与结果

自测复刻 runner 的执行方式：把每条 `- 命令:` 的文本原样写入 `$env:TEMP` 下的临时 `.ps1`（UTF-8 无 BOM），再用 `pwsh -NoProfile -File` 执行，读退出码并检查 stdout 是否含 `<AC> OK`。临时脚本用后删除，不在仓库内落任何文件。

结果（逐条）：

| AC | 条目 | 结果 |
|---|---|---|
| AC-009 | A-1、B-1、C-1 … C-8（10 条） | 全部 exit 0、含 `AC-009 OK` |
| AC-010 | A-2、B-2、D-1 … D-4（6 条） | 全部 exit 0、含 `AC-010 OK` |
| AC-011 | A-3、B-3、E-1 … E-3（5 条） | 全部 exit 0、含 `AC-011 OK` |
| AC-073 | A-4、B-4、F-1 … F-17、G-1 … G-7、H-1 … H-5（31 条） | 全部 exit 0、含 `AC-073 OK` |
| 合计 | 52 条 | 52/52 通过 |

其中几条值得单列（它们是回归最容易坏的）：

- `F-3/F-4/F-5`（改、增、删金标）分别得到 `FAIL golden.changed`、`FAIL golden.unregistered`、`FAIL golden.missing`，均 `FAILED (1 errors)`、exit 1。
- `F-6` 得到 `FAIL write_scope.unregistered contracts/spec/x.json`、`FAILED (1 errors)`、exit 1。
- `F-11` 逐行核对 6 条 `FAIL no_collab` 的顺序与内容（`contracts/d.json:2`、`docs/e.md:3`、`lib/a.mjs:1`、`package.json:2`、`scripts/b.mjs:2`、`test/c.txt:1`）。
- `F-16` 的 33 个要求路径全部在 `git ls-files` 里（`missing 0`）。
- `H-3` 全量测试、`H-4` `check-fast`、`H-5` `check-fast.ps1` 均 exit 0。

结构自检：`acceptance.md` 共 300 行、52 个 `## AC-` 标题、52 行 `- 命令:`、0 个围栏、0 个表格行、0 行标题不以 AC id 开头、0 行命令不是「单对反引号包裹」。

## 6. 注意事项

- 本机 `core.autocrlf=true`。所有哈希与文本比较都已先做 `\r\n` → `\n` 归一化；仓库内写出的一律 UTF-8 无 BOM、LF、末尾一个换行。
- `F-4`、`F-6` 用 `Set-Content -Encoding utf8NoBOM`，这是 pwsh 7 的参数；在 Windows PowerShell 5.1 下会报参数不识别，所以这两条必须在 pwsh 7 执行（与本文件开头的执行约定一致）。
- 本文件的改动只落在任务目录，属于 design.md 中 `write_scope` 之外的调度器元数据；`F-8` 已显式用 `--scope '.collab/tasks/004/**'` 放行。
- 未执行 `git add`/`git commit`（口令禁止）；后续提交由调度器负责。`F-16` 依赖的 33 个产物路径在更早轮次已暂存并提交。
